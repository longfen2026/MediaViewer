const { execFile, spawn } = require('child_process');
const fs = require('fs');
const { normalizeArchiveEntry } = require('./utils');
const { TtlCache } = require('./ttlCache');

const ENTRIES_CACHE_TTL = 30 * 1000;
const ENTRIES_CACHE_MAX = 200;
const entriesCache = new TtlCache({ ttl: ENTRIES_CACHE_TTL, max: ENTRIES_CACHE_MAX });

function cacheKeyOf(filePath) {
  try {
    return filePath + '@' + fs.statSync(filePath).mtimeMs;
  } catch {
    return null;
  }
}

function getCachedEntries(filePath) {
  const key = cacheKeyOf(filePath);
  if (!key) return null;
  return entriesCache.get(key) || null;
}

function setCachedEntries(filePath, data) {
  const key = cacheKeyOf(filePath);
  if (key) entriesCache.set(key, data);
}

function execFileAsync(cmd, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 1024 * 1024 * 1024, ...options }, (err, stdout, stderr) => {
      if (err) reject(new Error(`${cmd} failed: ${stderr || err.message}`));
      else resolve({ stdout, stderr });
    });
  });
}

const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

// bsdtar 的日期列右对齐，单数日会出现 "Sep  3"，故整体按空白匹配而非按字段切分
const LIST_DATE_RE = /\s(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})\s+(\d{1,2}:\d{2}|\d{4})\s/;

function parseBsdtarTime(month, day, tok) {
  const m = MONTHS[month];
  const d = parseInt(day, 10);
  if (m === undefined || isNaN(d)) return null;
  const now = new Date();
  if (tok.includes(':')) {
    const [hh, mm] = tok.split(':').map(Number);
    return new Date(now.getFullYear(), m, d, hh || 0, mm || 0).getTime();
  }
  return new Date(parseInt(tok, 10) || now.getFullYear(), m, d).getTime();
}

function parseListLine(line) {
  const isDirectory = line.endsWith('/');
  const m = LIST_DATE_RE.exec(line);
  if (!m) return { name: normalizeArchiveEntry(line), isDirectory, size: null, mtime: null };

  const sizeTok = line.slice(0, m.index).trim().split(/\s+/).pop();
  const size = parseInt(sizeTok, 10);
  return {
    name: normalizeArchiveEntry(line.slice(m.index + m[0].length).trim()),
    isDirectory,
    size: isNaN(size) ? null : size,
    mtime: parseBsdtarTime(m[1], m[2], m[3]),
  };
}

// zip 与 rar 统一使用 bsdtar（libarchive）流式读取，避免整包读入内存
async function listEntries(filePath) {
  const cached = getCachedEntries(filePath);
  if (cached) return cached;

  const { stdout } = await execFileAsync('bsdtar', ['-tvf', filePath]);
  const result = stdout.split('\n')
    .map(l => l.trim())
    .filter(Boolean)
    .map(parseListLine);

  setCachedEntries(filePath, result);
  return result;
}

async function readEntryBuffer(filePath, entryName) {
  const entry = normalizeArchiveEntry(entryName);
  const { stdout } = await execFileAsync('bsdtar', ['-xOf', filePath, entry], { encoding: 'buffer' });
  return Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout);
}

// 流式解压单个条目到目标文件，避免大文件整条读入内存
function extractEntryToFile(filePath, entryName, targetPath) {
  const entry = normalizeArchiveEntry(entryName);
  return new Promise((resolve, reject) => {
    const child = spawn('bsdtar', ['-xOf', filePath, entry], { stdio: ['ignore', 'pipe', 'inherit'] });
    const out = fs.createWriteStream(targetPath);
    child.stdout.pipe(out);
    child.on('error', (err) => { out.destroy(); reject(err); });
    out.on('error', (err) => { child.kill(); reject(err); });
    child.on('close', (code) => {
      out.end();
      if (code !== 0) reject(new Error(`bsdtar extract failed with code ${code}`));
      else resolve(targetPath);
    });
  });
}

// 流式解压单个条目到可写流（如 HTTP 响应），避免大文件整条读入内存
function streamEntry(filePath, entryName, dest) {
  const entry = normalizeArchiveEntry(entryName);
  return new Promise((resolve, reject) => {
    const child = spawn('bsdtar', ['-xOf', filePath, entry], { stdio: ['ignore', 'pipe', 'inherit'] });
    child.on('error', (err) => { child.kill(); reject(err); });
    dest.on('close', () => child.kill());
    child.stdout.on('error', reject);
    child.stdout.pipe(dest);
    child.on('close', (code) => {
      if (code !== 0) reject(new Error(`bsdtar extract failed with code ${code}`));
      else resolve();
    });
  });
}

module.exports = { listEntries, readEntryBuffer, extractEntryToFile, streamEntry };
