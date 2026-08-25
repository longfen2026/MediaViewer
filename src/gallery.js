const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { config } = require('./config');
const { isImageFile, isArchiveFile, isHiddenName, isVideoFile, normalizeArchiveEntry } = require('./utils');
const { listEntries, readEntryBuffer } = require('./archive');
const { probeVideoSize, extractVideoToCache } = require('./thumbnail');

const TREE_CACHE_TTL = 30 * 1000;
const COUNT_CACHE_TTL = 30 * 1000;
let treeCache = { data: null, ts: 0 };
let pendingTree = null;
const childCountCache = new Map();

function treeCacheIsFresh() {
  return treeCache.data && Date.now() - treeCache.ts < TREE_CACHE_TTL;
}

function countCacheIsFresh(key) {
  const c = childCountCache.get(key);
  return c && Date.now() - c.ts < COUNT_CACHE_TTL;
}

function toRel(p) {
  const rel = path.relative(config.galleryRoot, p);
  if (rel.startsWith('..')) throw new Error('path outside gallery root');
  return rel.split(path.sep).join('/');
}

function safeResolve(userPath) {
  const target = path.resolve(config.galleryRoot, userPath || '.');
  const rel = path.relative(config.galleryRoot, target);
  if (rel.startsWith('..')) throw new Error('invalid path');
  if (!fs.existsSync(target)) throw new Error('file not found');
  try {
    const real = fs.realpathSync(target);
    const realRel = path.relative(fs.realpathSync(config.galleryRoot), real);
    if (realRel.startsWith('..')) throw new Error('invalid path');
  } catch (e) {
    if (e.message === 'invalid path') throw e;
  }
  return target;
}

async function exists(p) {
  try {
    await fs.promises.access(p);
    return true;
  } catch {
    return false;
  }
}

async function isDirectory(p) {
  try {
    return (await fs.promises.stat(p)).isDirectory();
  } catch {
    return false;
  }
}

async function buildTree() {
  if (treeCacheIsFresh()) return treeCache.data;
  if (pendingTree) return pendingTree;

  async function walk(dir) {
    let names;
    try {
      names = await fs.promises.readdir(dir);
    } catch {
      return [];
    }
    const stats = await Promise.all(names.map(n =>
      fs.promises.stat(path.join(dir, n)).catch(() => null)
    ));
    const out = [];
    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      if (isHiddenName(name)) continue;
      const stat = stats[i];
      if (!stat) continue;
      const full = path.join(dir, name);
      if (stat.isDirectory()) {
        out.push({
          name,
          rel: toRel(full),
          type: 'dir',
          children: await walk(full),
        });
      } else if (isArchiveFile(name)) {
        out.push({
          name,
          rel: toRel(full),
          type: 'archive',
          children: [],
        });
      }
    }
    out.sort((a, b) => a.name.localeCompare(b.name, 'zh'));
    return out;
  }

  pendingTree = walk(config.galleryRoot);
  try {
    treeCache.data = await pendingTree;
    treeCache.ts = Date.now();
    return treeCache.data;
  } finally {
    pendingTree = null;
  }
}

async function listGalleryDir(userPath, pageNum = 1, pageSize = 50, sortBy = 'name', sortOrder = 'asc') {
  const dir = safeResolve(userPath);
  if (!(await isDirectory(dir))) throw new Error('not a directory');

  const entries = await fs.promises.readdir(dir);

  const stats = await Promise.all(entries.map(n =>
    fs.promises.stat(path.join(dir, n)).catch(() => null)
  ));

  let folders = [];
  let archives = [];
  let images = [];
  let videos = [];

  for (let i = 0; i < entries.length; i++) {
    const name = entries[i];
    if (isHiddenName(name)) continue;
    const stat = stats[i];
    if (!stat) continue;
    const full = path.join(dir, name);
    if (stat.isDirectory()) {
      const childCount = await countChildImages(full);
      folders.push({ name, rel: toRel(full), type: 'dir', count: childCount, mtime: stat.mtimeMs });
    } else if (isArchiveFile(name)) {
      archives.push({ name, rel: toRel(full), type: 'archive', mtime: stat.mtimeMs });
    } else if (isVideoFile(name)) {
      videos.push({ name, path: toRel(full), type: 'file', mime: 'video', mtime: stat.mtimeMs });
    } else if (isImageFile(name)) {
      images.push({ name, path: toRel(full), type: 'file', mime: 'image', mtime: stat.mtimeMs });
    }
  }

  const sortByName = (arr) => arr.sort((a, b) => a.name.localeCompare(b.name, 'zh'));
  folders = sortByName(folders);
  archives = sortByName(archives);

  // 图片和视频按 sortBy/sortOrder 排序后合并分页
  // 所有媒体（图片+视频）统一排序后分页
  const allMedia = [...images, ...videos];
  const sortMedia = (arr) => {
    const dir = sortOrder === 'desc' ? -1 : 1;
    return arr.sort((a, b) => {
      if (sortBy === 'time') return (a.mtime - b.mtime) * dir;
      return a.name.localeCompare(b.name, 'zh') * dir;
    });
  };
  sortMedia(allMedia);
  const totalCount = allMedia.length;
  const totalPages = Math.ceil(totalCount / pageSize);
  const page = Math.max(1, Math.min(pageNum, totalPages || 1));
  const start = (page - 1) * pageSize;
  const end = start + pageSize;
  const pagedMedia = allMedia.slice(start, end);

  return {
    folders,
    archives,
    media: pagedMedia,
    pagination: {
      pageNum: page,
      pageSize: pageSize,
      totalCount: totalCount,
      totalPages: totalPages,
    },
  };
}

async function countChildImages(dir) {
  const cached = childCountCache.get(dir);
  if (cached && Date.now() - cached.ts < COUNT_CACHE_TTL) return cached.count;

  let count = 0;
  try {
    const entries = await fs.promises.readdir(dir);
    const stats = await Promise.all(entries.map(n =>
      fs.promises.stat(path.join(dir, n)).catch(() => null)
    ));
    const dirs = [];
    for (let i = 0; i < entries.length; i++) {
      if (isHiddenName(entries[i])) continue;
      const stat = stats[i];
      if (!stat) continue;
      if (stat.isDirectory()) {
        dirs.push(path.join(dir, entries[i]));
      } else if (isImageFile(entries[i])) {
        count += 1;
      }
    }
    const childCounts = await Promise.all(dirs.map(d => countChildImages(d)));
    count += childCounts.reduce((a, b) => a + b, 0);
  } catch { /* ignore */ }

  childCountCache.set(dir, { count, ts: Date.now() });
  return count;
}

function formatSize(bytes) {
  if (bytes == null || isNaN(bytes) || bytes < 0) return '-';
  if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / 1024).toFixed(1) + ' KB';
}

function formatTime(ms) {
  if (!ms) return '-';
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

async function imageDimensionsFromFile(filePath) {
  try {
    const meta = await sharp(filePath, { failOn: 'none' }).metadata();
    return { width: meta.width, height: meta.height };
  } catch {
    return {};
  }
}

async function imageDimensionsFromBuffer(buf) {
  try {
    const meta = await sharp(buf, { failOn: 'none' }).metadata();
    return { width: meta.width, height: meta.height };
  } catch {
    return {};
  }
}

function mediaType(name) {
  if (isVideoFile(name)) return 'video';
  if (isImageFile(name)) return 'image';
  return 'file';
}

async function getMediaInfo(userPath, entryName) {
  const full = safeResolve(userPath);
  if (!(await exists(full))) throw new Error('file not found');

  if (entryName) {
    const entry = normalizeArchiveEntry(entryName);
    const entries = await listEntries(full);
    const target = entries.find(e => normalizeArchiveEntry(e.name) === entry && !e.isDirectory);
    if (!target) throw new Error('file not found');
    const info = {
      name: path.basename(entry),
      path: userPath,
      entry,
      location: 'archive',
      archiveName: path.basename(full),
      type: mediaType(entry),
      sizeBytes: target.size != null ? target.size : null,
      sizeText: formatSize(target.size),
      mtime: target.mtime,
      mtimeText: formatTime(target.mtime),
    };
    if (info.type === 'image') {
      const buf = await readEntryBuffer(full, entry);
      Object.assign(info, await imageDimensionsFromBuffer(buf));
    } else if (info.type === 'video') {
      const videoPath = await extractVideoToCache(full, entry);
      const dim = await probeVideoSize(videoPath);
      if (dim) Object.assign(info, dim);
    }
    return info;
  }

  const stat = await fs.promises.stat(full);
  const info = {
    name: path.basename(full),
    path: userPath,
    location: 'filesystem',
    type: mediaType(full),
    sizeBytes: stat.size,
    sizeText: formatSize(stat.size),
    mtime: stat.mtimeMs,
    mtimeText: formatTime(stat.mtimeMs),
  };
  if (info.type === 'image') {
    Object.assign(info, await imageDimensionsFromFile(full));
  } else if (info.type === 'video') {
    const dim = await probeVideoSize(full);
    if (dim) Object.assign(info, dim);
  }
  return info;
}

async function listArchiveMedia(archiveRel, sortBy = 'name', sortOrder = 'asc') {
  const full = safeResolve(archiveRel);
  if (!(await exists(full))) throw new Error('archive not found');
  const entries = await listEntries(full);
  const media = entries.filter(e => !e.isDirectory && (isImageFile(e.name) || isVideoFile(e.name)));
  const allMedia = [];
  for (const e of media) {
    if (isVideoFile(e.name)) allMedia.push({ name: e.name, entry: e.name, type: 'file', mime: 'video', mtime: e.mtime });
    else allMedia.push({ name: e.name, entry: e.name, type: 'file', mime: 'image', mtime: e.mtime });
  }
  const dir = sortOrder === 'desc' ? -1 : 1;
  allMedia.sort((a, b) => {
    if (sortBy === 'time') return (a.mtime - b.mtime) * dir;
    return a.name.localeCompare(b.name, 'zh') * dir;
  });
  return { media: allMedia };
}

module.exports = { buildTree, listGalleryDir, listArchiveMedia, getMediaInfo, safeResolve, toRel, exists, isDirectory };
