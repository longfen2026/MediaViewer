const { config } = require('./config');
const logger = require('./logger');
const { cleanupThumbCache, enforceCacheBudget, cacheUsage } = require('./thumbnail');

const BUDGET_INTERVAL_MS = 6 * 60 * 60 * 1000;
const SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000;

let running = false;
let timers = [];

// 两个周期任务共用此锁，避免同时扫目录互相误删
async function withLock(label, fn) {
  if (running) return;
  running = true;
  try {
    await fn();
  } catch (err) {
    logger.error(`${label}失败`, { error: err.message, stack: err.stack });
  } finally {
    running = false;
  }
}

// 仅在缓存超出容量上限时淘汰最久未访问的文件
async function tick() {
  if (config.cacheMaxBytes <= 0) return;
  await withLock('缓存容量淘汰', async () => {
    if ((await cacheUsage()) <= config.cacheMaxBytes) return;
    const r = await enforceCacheBudget();
    if (r.deleted > 0) {
      logger.info('缓存超出上限，已淘汰最久未访问文件', {
        deleted: r.deleted,
        freedMB: +(r.freed / 1024 / 1024).toFixed(1),
        totalMB: +(r.total / 1024 / 1024).toFixed(1),
      });
    }
  });
}

// 完整清理：比对图库删除孤儿缓存，I/O 较重，低频运行
async function sweep() {
  await withLock('缓存完整清理', () => cleanupThumbCache());
}

function start() {
  if (timers.length) return;
  timers = [setInterval(tick, BUDGET_INTERVAL_MS), setInterval(sweep, SWEEP_INTERVAL_MS)];
  timers.forEach((t) => t.unref());
}

function stop() {
  timers.forEach(clearInterval);
  timers = [];
}

module.exports = { start, stop, tick, sweep };
