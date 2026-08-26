const fs = require('fs');
const path = require('path');
const express = require('express');
const { body, validationResult } = require('express-validator');
const { config } = require('../config');
const { verify } = require('../auth');
const gallery = require('../gallery');
const thumb = require('../thumbnail');
const favorites = require('../favorites');
const preferences = require('../preferences');
const version = require('../version').getVersion;
const { mimeType, isImageFile, isArchiveFile, isVideoFile } = require('../utils');
const logger = require('../logger');
const { loginLimiter } = require('../middleware');

const router = express.Router();

// 应用登录速率限制到整个路由
router.use(loginLimiter);

function isAuth(req) {
  return req.session && req.session.user;
}

function requireAuth(req, res, next) {
  if (!isAuth(req)) return res.status(401).json({ error: '未登录' });
  next();
}

// 缩略图按内容哈希寻址，内容不可变，可长期缓存
function sendThumb(res, filePath, fallbackMime) {
  res.setHeader('Content-Type', fallbackMime || mimeType(filePath));
  res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
  res.sendFile(path.resolve(filePath));
}

async function sendRawImage(res, filePath, userPath) {
  const stat = await fs.promises.stat(filePath);
  res.setHeader('Content-Type', mimeType(userPath || filePath));
  res.setHeader('Content-Length', stat.size);
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.sendFile(path.resolve(filePath));
}

router.get('/ping', (req, res) => res.json({ ok: true }));

router.get('/version', (req, res) => res.json({ version: version() }));

router.get('/me', (req, res) => {
  if (isAuth(req)) return res.json({ user: req.session.user });
  res.status(401).json({ error: '未登录' });
});

router.post('/login', [
  body('username').trim().notEmpty().withMessage('用户名不能为空'),
  body('password').notEmpty().withMessage('密码不能为空'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ error: errors.array()[0].msg });
  }

  const { username, password } = req.body;
  try {
    const ok = await verify(username, password);
    if (ok) {
      req.session.user = username;
      logger.info('用户登录成功', { user: username });
      return res.json({ user: username });
    }
    logger.warn('登录失败 - 凭证错误', { username });
    return res.status(401).json({ error: '用户名或密码错误' });
  } catch (e) {
    logger.error('认证失败', { username, error: e.message });
    return res.status(500).json({ error: '认证失败' });
  }
});

// 修改密码端点已移除，账户密码由环境变量 ADMIN_USER / ADMIN_PASSWORD 设置

router.get('/preferences', requireAuth, (req, res) => {
  res.json(preferences.getPreferences(req.session.user));
});

router.put('/preferences', requireAuth, async (req, res, next) => {
  const { layout } = req.body || {};
  if (!preferences.VALID_LAYOUTS.includes(layout)) {
    return res.status(400).json({ error: '非法的布局模式' });
  }
  try {
    await preferences.setPreference(req.session.user, 'layout', layout);
    res.json({ layout });
  } catch (e) { next(e); }
});

router.post('/logout', (req, res) => {
  const user = req.session.user;
  req.session.destroy(() => {
    logger.info('用户登出', { user });
    res.json({ ok: true });
  });
});

router.get('/tree', requireAuth, async (req, res, next) => {
  try {
    res.json({ tree: await gallery.buildTree() });
  } catch (e) { next(e); }
});

router.get('/info', requireAuth, async (req, res, next) => {
  try {
    const info = await gallery.getMediaInfo(req.query.path || '', req.query.entry);
    res.json(info);
  } catch (e) {
    if (e.message === 'file not found') return res.status(404).json({ error: '文件不存在' });
    if (e.message === 'invalid path' || e.message === 'path outside gallery root') return res.status(403).json({ error: '访问被拒绝' });
    next(e);
  }
});

router.get('/browse', requireAuth, async (req, res, next) => {
  try {
    const p = req.query.path || '';
    const pageNum = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 50));
    const sortBy = req.query.sortBy === 'time' ? 'time' : 'name';
    const sortOrder = req.query.sortOrder === 'desc' ? 'desc' : 'asc';
    res.json(await gallery.listGalleryDir(p, pageNum, pageSize, sortBy, sortOrder));
  } catch (e) { next(e); }
});

router.get('/archive-images', requireAuth, async (req, res, next) => {
  try {
    const p = req.query.path || '';
    const sortBy = req.query.sortBy === 'time' ? 'time' : 'name';
    const sortOrder = req.query.sortOrder === 'desc' ? 'desc' : 'asc';
    res.json(await gallery.listArchiveMedia(p, sortBy, sortOrder));
  } catch (e) { next(e); }
});

router.get('/favorites', requireAuth, (req, res) => {
  res.json({ favorites: favorites.listFavorites(req.session.user) });
});

router.post('/favorites/toggle', requireAuth, (req, res, next) => {
  try {
    const result = favorites.toggleFavorite(req.session.user, req.body);
    res.json(result);
  } catch (e) { next(e); }
});

router.get('/thumb', requireAuth, async (req, res, next) => {
  try {
    const p = req.query.path || '';
    const entry = req.query.entry;
    const filePath = await gallery.safeResolve(p);
    const stat = await fs.promises.stat(filePath).catch(() => null);
    if (!stat) throw new Error('file not found');
    if (stat.isDirectory()) return res.status(400).json({ error: '不能为目录生成缩略图' });

    let result;
    if (isArchiveFile(filePath)) {
      if (!entry) return res.status(400).json({ error: '缺少 entry 参数' });
      result = await thumb.getThumbForArchiveEntry(filePath, entry);
    } else if (isImageFile(filePath) || isVideoFile(filePath)) {
      result = await thumb.getThumbForFile(filePath);
    } else {
      return res.status(400).json({ error: '不支持的文件类型' });
    }
    sendThumb(res, result.path, result.mime);
  } catch (e) { next(e); }
});

router.get('/image', requireAuth, async (req, res, next) => {
  try {
    const p = req.query.path || '';
    const entry = req.query.entry;
    const filePath = await gallery.safeResolve(p);
    const stat = await fs.promises.stat(filePath).catch(() => null);
    if (!stat) throw new Error('file not found');
    if (stat.isDirectory()) return res.status(400).json({ error: '不能读取目录' });

    if (isArchiveFile(filePath)) {
      if (!entry) return res.status(400).json({ error: '缺少 entry 参数' });
      const { readEntryBuffer } = require('../archive');
      const buf = await readEntryBuffer(filePath, entry);
      res.setHeader('Content-Type', mimeType(entry));
      res.setHeader('Cache-Control', 'private, max-age=86400');
      return res.send(buf);
    }

    if (!isImageFile(filePath)) return res.status(400).json({ error: '不支持的文件类型' });
    await sendRawImage(res, filePath, filePath);
  } catch (e) { next(e); }
});

async function sendVideoStream(req, res, filePath) {
  let stat;
  try {
    stat = await fs.promises.stat(filePath);
  } catch {
    res.status(404).end();
    return;
  }
  const total = stat.size;
  const range = req.headers.range;
  const type = mimeType(filePath);

  res.setHeader('Content-Type', type);
  res.setHeader('Accept-Ranges', 'bytes');

  function pipeStream(stream) {
    stream.on('error', () => {});
    res.on('close', () => stream.destroy());
    stream.pipe(res);
  }

  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    if (m) {
      let start = m[1] ? parseInt(m[1], 10) : 0;
      let end = m[2] ? parseInt(m[2], 10) : total - 1;
      if (isNaN(start) || start < 0) start = 0;
      if (isNaN(end) || end >= total) end = total - 1;
      if (start > end) {
        res.status(416).setHeader('Content-Range', `bytes */${total}`).end();
        return;
      }
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
      res.setHeader('Content-Length', end - start + 1);
      pipeStream(fs.createReadStream(filePath, { start, end }));
      return;
    }
  }
  res.setHeader('Content-Length', total);
  pipeStream(fs.createReadStream(filePath));
}

router.get('/video', requireAuth, async (req, res, next) => {
  try {
    const p = req.query.path || '';
    const entry = req.query.entry;
    const filePath = await gallery.safeResolve(p);
    const stat = await fs.promises.stat(filePath).catch(() => null);
    if (!stat) throw new Error('file not found');
    if (stat.isDirectory()) return res.status(400).json({ error: '不能播放目录' });

    if (isArchiveFile(filePath)) {
      if (!entry) return res.status(400).json({ error: '缺少 entry 参数' });
      if (!isVideoFile(entry)) return res.status(400).json({ error: '压缩包内该条目不是视频' });
      const cached = await thumb.extractVideoToCache(filePath, entry);
      await sendVideoStream(req, res, cached);
      return;
    }

    if (!isVideoFile(filePath)) return res.status(400).json({ error: '不支持的文件类型' });
    await sendVideoStream(req, res, filePath);
  } catch (e) { next(e); }
});

module.exports = router;
