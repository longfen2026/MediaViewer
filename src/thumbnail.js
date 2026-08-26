const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const sharp = require('sharp');
const { config } = require('./config');
const { isVideoFile, mimeType } = require('./utils');

const VIDEO_CACHE_DIR = path.join(config.thumbDir, '..', 'videos');

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

function cacheKey(...parts) {
  const hash = crypto.createHash('sha1').update(parts.join('|')).digest('hex');
  return path.join(config.thumbDir, hash.slice(0, 2), hash + '.webp');
}

function videoCacheKey(...parts) {
  const hash = crypto.createHash('sha1').update(parts.join('|')).digest('hex');
  return path.join(videoThumbDir(), hash.slice(0, 2), hash + '.webp');
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
  const key = isVideo
    ? videoCacheKey('file', filePath, stat.size, stat.mtimeMs, genWidth)
    : cacheKey('file', 'v3', filePath, stat.size, stat.mtimeMs, genWidth);
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
  const key = isVideo
    ? videoCacheKey('archive', archivePath, stat.size, stat.mtimeMs, entryName, genWidth)
    : cacheKey('archive', 'v3', archivePath, stat.size, stat.mtimeMs, entryName, genWidth);
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

async function videoCacheFile(archivePath, entryName) {
  const stat = await fs.promises.stat(archivePath);
  const hash = crypto.createHash('sha1').update(['video', archivePath, stat.size, stat.mtimeMs, entryName].join('|')).digest('hex');
  const ext = path.extname(entryName) || '.mp4';
  const file = path.join(VIDEO_CACHE_DIR, hash + ext);
  await ensureDir(VIDEO_CACHE_DIR);
  return file;
}

async function extractVideoToCache(archivePath, entryName) {
  return coalesceExtract(archivePath, entryName);
}

async function cleanupThumbCache() {
  const logger = require('./logger');
  const { isImageFile, isVideoFile, isArchiveFile, isHiddenName } = require('./utils');
  const { listEntries } = require('./archive');

  const expected = new Set();
  let fileCount = 0;

  async function addKey(full, stat, entry) {
    if (isVideoFile(entry)) {
      expected.add(videoCacheKey('file', full, stat.size, stat.mtimeMs, config.thumbSize * 2));
    } else {
      expected.add(cacheKey('file', 'v3', full, stat.size, stat.mtimeMs, config.thumbSize * 2));
    }
    fileCount++;
  }

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
        await addKey(full, stat, name);
      } else if (isArchiveFile(name)) {
        let entries;
        try { entries = await listEntries(full); } catch { continue; }
        for (const e of entries) {
          if (e.isDirectory) continue;
          const entry = e.name;
          if (isImageFile(entry) || isVideoFile(entry)) {
            const video = isVideoFile(entry);
            const key = video
              ? videoCacheKey('archive', full, stat.size, stat.mtimeMs, entry, config.thumbSize * 2)
              : cacheKey('archive', 'v3', full, stat.size, stat.mtimeMs, entry, config.thumbSize * 2);
            expected.add(key);
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
  probeVideoSize,
};
