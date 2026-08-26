const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const ROOT_DIR = path.resolve(__dirname, '..');

const SECRET_FILE = path.join(ROOT_DIR, 'data', 'session_secret');

function ensureDir(dir) {
  try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { /* ignore */ }
}

function loadOrCreateSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  try {
    const s = fs.readFileSync(SECRET_FILE, 'utf8').trim();
    if (s) return s;
  } catch (e) {
    // fallthrough to create
  }
  const secret = crypto.randomBytes(32).toString('hex');
  ensureDir(path.dirname(SECRET_FILE));
  try { fs.writeFileSync(SECRET_FILE, secret, { mode: 0o600 }); } catch (e) { /* ignore write errors */ }
  return secret;
}

const config = {
  port: parseInt(process.env.PORT || '8080', 10),
  galleryRoot: path.resolve(process.env.GALLERY_ROOT || '/gallery'),
  // 仅在反向代理后运行时开启：否则客户端可伪造 X-Forwarded-For 绕过按 IP 的限流
  trustProxy: parseInt(process.env.TRUST_PROXY || '0', 10),
  adminUser: process.env.ADMIN_USER || 'admin',
  adminPassword: process.env.ADMIN_PASSWORD || (() => {
    const pw = require('crypto').randomBytes(4).toString('hex');
    console.warn(`\n⚠ 未设置 ADMIN_PASSWORD，已自动生成随机密码: ${pw}\n`);
    return pw;
  })(),
  sessionSecret: loadOrCreateSecret(),
  thumbDir: process.env.THUMB_DIR || path.join(ROOT_DIR, 'data', 'thumbs'),
  videoThumbDir: process.env.VIDEO_THUMB_DIR || path.join(ROOT_DIR, 'data', 'videothumbs'),
  // 压缩包内视频解压后的落地目录
  videoCacheDir: process.env.VIDEO_CACHE_DIR || path.join(ROOT_DIR, 'data', 'videos'),
  // 缩略图 + 视频缓存的总容量上限（MB，0 = 不限）
  cacheMaxBytes: parseInt(process.env.CACHE_MAX_MB || '2048', 10) * 1024 * 1024,
  thumbSize: parseInt(process.env.THUMB_SIZE || '320', 10),
  thumbQuality: parseInt(process.env.THUMB_QUALITY || '80', 10),
};

module.exports = { config, ROOT_DIR };
