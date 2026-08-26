const express = require('express');
const session = require('express-session');
const path = require('path');
const { config, ROOT_DIR } = require('./config');
const api = require('./routes/api');
const logger = require('./logger');
const { errorHandler, requestLogger, apiLimiter } = require('./middleware');
const SqliteStore = require('./sessionStore');
const { cleanupThumbCache } = require('./thumbnail');
const { execSync } = require('child_process');

function checkBinary(cmd) {
  const flags = ['-version', '--version', '-V'];
  for (const flag of flags) {
    try {
      execSync(cmd + ' ' + flag, { stdio: 'ignore', shell: true });
      return true;
    } catch {
      /* try next flag */
    }
  }
  return false;
}

const app = express();

async function init() {
  if (config.trustProxy > 0) app.set('trust proxy', config.trustProxy);
  app.disable('x-powered-by');

  // 请求日志中间件 - 应在最前面
  app.use(requestLogger);

  app.use(express.json({ limit: '1mb' }));

  app.use(session({
    name: 'gal.sid',
    secret: config.sessionSecret,
    store: new SqliteStore(),
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: 'auto', // 根据请求协议自动决定：HTTPS 时启用，HTTP 时禁用
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  }));

  // API路由速率限制
  app.use('/api', apiLimiter);
  
  app.use('/api', api);

  const publicDir = path.join(ROOT_DIR, 'public');
  app.use(express.static(publicDir, {
    maxAge: '1h',
    etag: false,
    index: false,
  }));

  app.get('/', (req, res) => {
    res.set('Cache-Control', 'no-cache');
    res.sendFile(path.join(publicDir, 'index.html'));
  });

  app.get('/m', (req, res) => {
    res.set('Cache-Control', 'no-cache');
    res.sendFile(path.join(publicDir, 'mobile', 'index.html'));
  });

  // 404处理
  app.use((req, res) => {
    res.status(404).json({ error: '未找到该请求' });
  });

  // 全局错误处理 - 应在最后
  app.use(errorHandler);

  app.listen(config.port, '0.0.0.0', () => {
    logger.info(`服务器启动成功`, { 
      port: config.port, 
      galleryRoot: config.galleryRoot,
      nodeEnv: process.env.NODE_ENV || 'development',
    });
    if (!checkBinary('ffmpeg')) logger.warn('警告: 未找到ffmpeg - 视频缩略图生成可能失败');
    if (!checkBinary('ffprobe')) logger.warn('警告: 未找到ffprobe - 视频尺寸信息可能不可用');
    if (!checkBinary('bsdtar')) logger.warn('警告: 未找到bsdtar - RAR压缩包支持可能不可用');
    cleanupThumbCache().catch((err) => {
      logger.error('缩略图缓存清理失败', { error: err.message, stack: err.stack });
    });
  });
}

init().catch((err) => {
  logger.error('服务器启动失败', { error: err.message, stack: err.stack });
  process.exit(1);
});
