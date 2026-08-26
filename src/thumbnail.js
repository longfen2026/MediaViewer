const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const sharp = require('sharp');
const { config } = require('./config');
const { isVideoFile, mimeType } = require('./utils');

function videoCacheDir() {
  return config.videoCacheDir;
}

function videoThumbDir() {
  return config.videoThumbDir;
}

// 并发信号量，限制重任务（ffmpeg/sharp）同时运行数
class Semaphore {
  constructor(max) { this.max = max; this.queue = []; this.active = 0; }
  acquire() {
    if (this.active < this.max) { this.active++; return Promise.resolve(); }
    return new Promise(r => this.queue.push(r));
  }
  release() {
    if (this.queue.length > 0) { this.queue.shift()(); }
    else { this.active--; }
  }
}
const thumbSem = new Semaphore(2);

// 请求合并：同一缓存键正在生成时，后续请求等待同一 Promise
const pendingThumbs = new Map();

// 生成逻辑变更时递增，用于强制作废历史缓存
const IMAGE_THUMB_VERSION = 'v3';
const VIDEO_THUMB_VERSION = 'v1';

function cacheKey(...parts) {
  const hash = crypto.createHash('sha1').update(parts.join('|')).digest('hex');
  return path.join(config.thumbDir, hash.slice(0, 2), hash + '.webp');
}

function videoCacheKey(...parts) {
  const hash = crypto.createHash('sha1').update(parts.join('|')).digest('hex');
  return path.join(videoThumbDir(), hash.slice(0, 2), hash + '.webp');
}

// 缩略图键构造收敛在此，供生成与清理共用，避免两处逻辑漂移
function fileThumbKey(filePath, stat, width) {
  return isVideoFile(filePath)
    ? videoCacheKey('file', VIDEO_THUMB_VERSION, filePath, stat.size, stat.mtimeMs, width)
    : cacheKey('file', IMAGE_THUMB_VERSION, filePath, stat.size, stat.mtimeMs, width);
}

function archiveThumbKey(archivePath, stat, entryName, width) {
  return isVideoFile(entryName)
    ? videoCacheKey('archive', VIDEO_THUMB_VERSION, archivePath, stat.size, stat.mtimeMs, entryName, width)
    : cacheKey('archive', IMAGE_THUMB_VERSION, archivePath, stat.size, stat.mtimeMs, entryName, width);
}

async function ensureDir(dir) {
  await fs.promises.mkdir(dir, { recursive: true }).catch(() => {});
}

async function generateThumb(input, targetPath, { width } = {}) {
  await ensureDir(path.dirname(targetPath));
  const size = width || config.thumbSize;
  await sharp(input, { failOn: 'none', animated: false })
    .rotate()
    .resize(size, size, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: config.thumbQuality })
    .toFile(targetPath);
  return targetPath;
}

// 带并发控制的缩略图生成（仅限制重任务 — ffmpeg/sharp）
async function generateThumbManaged(fn) {
  await thumbSem.acquire();
  try {
    await fn();
  } finally {
    thumbSem.release();
  }
}

function execFileAsync(cmd, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 64 * 1024 * 1024, ...options }, (err, stdout, stderr) => {
      if (err) reject(new Error(`${cmd} failed: ${stderr || err.message}`));
      else resolve({ stdout, stderr });
    });
  });
}

async function probeVideoSize(inputPath) {
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'error', '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height',
      '-of', 'json', inputPath,
    ]);
    const info = JSON.parse(stdout);
    const s = info.streams && info.streams[0];
    if (s && s.width && s.height) return { width: s.width, height: s.height };
  } catch (e) { /* fall through */ }
  return null;
}

async function generateThumbFromVideo(inputPath, targetPath, { width } = {}) {
  await ensureDir(path.dirname(targetPath));
  const size = width || config.thumbSize;
  const tmp = path.join(path.dirname(targetPath), path.basename(targetPath) + '.png');
  try {
    // 先用 ffmpeg 无损提取单帧高清 PNG，再由 sharp 高质量缩放编码 WebP
    await execFileAsync('ffmpeg', [
      '-hide_banner', '-loglevel', 'error',
      '-y', '-ss', '1', '-i', inputPath,
      '-vframes', '1',
      '-qscale:v', '2',
      tmp,
    ]);
    await sharp(tmp, { failOn: 'none' })
      .resize(size, size, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: config.thumbQuality })
      .toFile(targetPath);
  } finally {
    fs.promises.unlink(tmp).catch(() => {});
  }
  return targetPath;
}

async function thumbExists(targetPath) {
  try {
    await fs.promises.stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function getThumbForFile(filePath) {
  const stat = await fs.promises.stat(filePath);
  const genWidth = config.thumbSize * 2;
  const isVideo = isVideoFile(filePath);
  const key = fileThumbKey(filePath, stat, genWidth);
  if (!(await thumbExists(key))) {
    await coalesceThumb(key, () => generateThumbManaged(() =>
      isVideo ? generateThumbFromVideo(filePath, key, { width: genWidth })
              : generateThumb(filePath, key, { width: genWidth })
    ));
  }
  return { path: key, mime: 'image/webp' };
}

async function getThumbForArchiveEntry(archivePath, entryName) {
  const { readEntryBuffer } = require('./archive');
  const stat = await fs.promises.stat(archivePath);
  const genWidth = config.thumbSize * 2;
  const isVideo = isVideoFile(entryName);
  let video = null;
  if (isVideo) {
    video = await coalesceExtract(archivePath, entryName);
  }
  const key = archiveThumbKey(archivePath, stat, entryName, genWidth);
  if (!(await thumbExists(key))) {
    await coalesceThumb(key, () => generateThumbManaged(async () =>
      isVideo ? generateThumbFromVideo(video, key, { width: genWidth })
              : generateThumb(await readEntryBuffer(archivePath, entryName), key, { width: genWidth })
    ));
  }
  return { path: key, mime: 'image/webp' };
}

// 请求合并：同一缓存键的缩略图只生成一次，其余请求等待
async function coalesceThumb(key, run) {
  const existing = pendingThumbs.get(key);
  if (existing) return existing;
  const p = (async () => {
    try {
      await run();
    } finally {
      pendingThumbs.delete(key);
    }
  })();
  pendingThumbs.set(key, p);
  return p;
}

// 请求合并：同一视频文件只解压一次（流式写入缓存，避免大文件整条读入内存）
const pendingExtracts = new Map();
async function coalesceExtract(archivePath, entryName) {
  const { extractEntryToFile } = require('./archive');
  const target = await videoCacheFile(archivePath, entryName);
  const done = async () => {
    try {
      await fs.promises.stat(target);
      return target;
    } catch { /* not extracted yet */ }
    await extractEntryToFile(archivePath, entryName, target);
    return target;
  };
  const existing = pendingExtracts.get(target);
  if (existing) return existing;
  const p = done().finally(() => pendingExtracts.delete(target));
  pendingExtracts.set(target, p);
  return p;
}

function videoCacheFileKey(archivePath, stat, entryName) {
  const hash = crypto.createHash('sha1').update(['video', archivePath, stat.size, stat.mtimeMs, entryName].join('|')).digest('hex');
  const ext = path.extname(entryName) || '.mp4';
  return path.join(videoCacheDir(), hash + ext);
}

async function videoCacheFile(archivePath, entryName) {
  const stat = await fs.promises.stat(archivePath);
  const file = videoCacheFileKey(archivePath, stat, entryName);
  await ensureDir(videoCacheDir());
  return file;
}

async function extractVideoToCache(archivePath, entryName) {
  return coalesceExtract(archivePath, entryName);
}

// 清理解压视频缓存中的孤儿文件（源压缩包已删除或已修改）
async function cleanupVideoCache(expectedVideos) {
  const dir = videoCacheDir();
  let deleted = 0;
  let freed = 0;
  let names;
  try { names = await fs.promises.readdir(dir); } catch { return { deleted, freed }; }

  for (const name of names) {
    const fp = path.join(dir, name);
    const stat = await fs.promises.stat(fp).catch(() => null);
    if (!stat || !stat.isFile()) continue;
    if (pendingExtracts.has(fp)) continue;
    if (expectedVideos.has(fp)) continue;
    await fs.promises.unlink(fp).catch(() => {});
    deleted++;
    freed += stat.size;
  }

  return { deleted, freed };
}

function cacheRoots() {
  return [config.thumbDir, videoThumbDir(), videoCacheDir()];
}

async function collectCacheFiles(dir, out) {
  let names;
  try { names = await fs.promises.readdir(dir); } catch { return; }
  for (const name of names) {
    const fp = path.join(dir, name);
    const stat = await fs.promises.stat(fp).catch(() => null);
    if (!stat) continue;
    if (stat.isDirectory()) await collectCacheFiles(fp, out);
    else if (stat.isFile()) out.push({ fp, size: stat.size, atimeMs: stat.atimeMs });
  }
}

async function cacheUsage() {
  const files = [];
  for (const root of cacheRoots()) await collectCacheFiles(root, files);
  return files.reduce((sum, f) => sum + f.size, 0);
}

// 总容量上限：跨缩略图与视频缓存按 atime 淘汰最久未访问的文件
async function enforceCacheBudget() {
  const limit = config.cacheMaxBytes;
  if (limit <= 0) return { deleted: 0, freed: 0, total: await cacheUsage() };

  const files = [];
  for (const root of cacheRoots()) await collectCacheFiles(root, files);

  let total = files.reduce((sum, f) => sum + f.size, 0);
  if (total <= limit) return { deleted: 0, freed: 0, total };

  files.sort((a, b) => a.atimeMs - b.atimeMs);
  let deleted = 0;
  let freed = 0;
  for (const f of files) {
    if (total <= limit) break;
    if (pendingExtracts.has(f.fp) || pendingThumbs.has(f.fp)) continue;
    await fs.promises.unlink(f.fp).catch(() => {});
    total -= f.size;
    deleted++;
    freed += f.size;
  }
  return { deleted, freed, total };
}

async function cleanupThumbCache() {
  const logger = require('./logger');
  const { isImageFile, isVideoFile, isArchiveFile, isHiddenName } = require('./utils');
  const { listEntries } = require('./archive');

  const expected = new Set();
  const expectedVideos = new Set();
  const genWidth = config.thumbSize * 2;
  let fileCount = 0;

  async function walkDir(dir) {
    let names;
    try { names = await fs.promises.readdir(dir); } catch { return; }
    for (const name of names) {
      if (isHiddenName(name)) continue;
      const full = path.join(dir, name);
      const stat = await fs.promises.stat(full).catch(() => null);
      if (!stat) continue;
      if (stat.isDirectory()) {
        await walkDir(full);
      } else if (isImageFile(name) || isVideoFile(name)) {
        expected.add(fileThumbKey(full, stat, genWidth));
        fileCount++;
      } else if (isArchiveFile(name)) {
        let entries;
        try { entries = await listEntries(full); } catch { continue; }
        for (const e of entries) {
          if (e.isDirectory) continue;
          const entry = e.name;
          if (isImageFile(entry) || isVideoFile(entry)) {
            expected.add(archiveThumbKey(full, stat, entry, genWidth));
            if (isVideoFile(entry)) expectedVideos.add(videoCacheFileKey(full, stat, entry));
            fileCount++;
          }
        }
      }
    }
  }

  logger.info('开始清理缩略图缓存...');
  await walkDir(config.galleryRoot);
  logger.info(`扫描到 ${fileCount} 个媒体文件，开始比对缩略图目录`);

  let deleted = 0;
  let freed = 0;

  for (const thumbRoot of [config.thumbDir, videoThumbDir()]) {
    if (!fs.existsSync(thumbRoot)) continue;
    const dirs = await fs.promises.readdir(thumbRoot);
    for (const d of dirs) {
      const sub = path.join(thumbRoot, d);
      const stat = await fs.promises.stat(sub).catch(() => null);
      if (!stat || !stat.isDirectory()) continue;
      const files = await fs.promises.readdir(sub);
      for (const f of files) {
        const fp = path.join(sub, f);
        if (!expected.has(fp)) {
          const sz = (await fs.promises.stat(fp).catch(() => null))?.size || 0;
          await fs.promises.unlink(fp).catch(() => {});
          deleted++;
          freed += sz;
        }
      }
      // remove empty subdirectories
      try {
        const remaining = await fs.promises.readdir(sub);
        if (remaining.length === 0) await fs.promises.rmdir(sub);
      } catch { /* ignore */ }
    }
  }

  logger.info(`缩略图清理完成: 删除 ${deleted} 个文件，释放 ${(freed / 1024 / 1024).toFixed(1)} MB`);

  const video = await cleanupVideoCache(expectedVideos);
  logger.info(`视频缓存清理完成: 删除 ${video.deleted} 个文件，释放 ${(video.freed / 1024 / 1024).toFixed(1)} MB`);

  const budget = await enforceCacheBudget();
  if (budget.deleted > 0) {
    logger.info(`缓存超出上限，淘汰 ${budget.deleted} 个最久未访问文件，释放 ${(budget.freed / 1024 / 1024).toFixed(1)} MB`);
  }
  logger.info(`缓存占用: ${(budget.total / 1024 / 1024).toFixed(1)} MB / 上限 ${config.cacheMaxBytes ? (config.cacheMaxBytes / 1024 / 1024).toFixed(0) + ' MB' : '不限'}`);

  return {
    thumbs: { deleted, freed },
    videos: video,
    budget,
  };
}

module.exports = {
  getThumbForFile,
  getThumbForArchiveEntry,
  extractVideoToCache,
  generateThumb,
  generateThumbFromVideo,
  cacheKey,
  mimeType,
  cleanupThumbCache,
  cleanupVideoCache,
  enforceCacheBudget,
  cacheUsage,
  probeVideoSize,
};
