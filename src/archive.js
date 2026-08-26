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

function parseBsdtarTime(fields) {
  for (let i = 0; i < fields.length; i++) {
    const m = MONTHS[fields[i]];
    if (m === undefined) continue;
    const day = parseInt(fields[i + 1], 10);
    const tok = fields[i + 2];
    if (isNaN(day) || !tok) return null;
    const now = new Date();
    let year = now.getFullYear();
    let hour = 0;
    let min = 0;
    if (tok.includes(':')) {
      const [hh, mm] = tok.split(':').map(Number);
      hour = hh || 0;
      min = mm || 0;
    } else {
      year = parseInt(tok, 10) || year;
    }
    return new Date(year, m, day, hour, min).getTime();
  }
  return null;
}

// zip 与 rar 统一使用 bsdtar（libarchive）流式读取，避免整包读入内存
async function listEntries(filePath) {
  const cached = getCachedEntries(filePath);
  if (cached) return cached;

  const { stdout } = await execFileAsync('bsdtar', ['-tvf', filePath]);
  const result = stdout.split('\n')
    .map(l => l.trim())
    .filter(Boolean)
    .map(l => {
      const fields = l.split(' ');
      let time = null;
      let size = null;
      let name = '';
      for (let i = 0; i < fields.length; i++) {
        if (MONTHS[fields[i]] !== undefined) {
          time = parseBsdtarTime(fields);
          size = parseInt(fields[i - 1], 10);
          if (isNaN(size)) size = null;
          name = fields.slice(i + 3).join(' ').trim();
          break;
        }
      }
      return { name: normalizeArchiveEntry(name), isDirectory: l.endsWith('/'), size, mtime: time };
    });

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

module.exports = { listEntries, readEntryBuffer, extractEntryToFile };
