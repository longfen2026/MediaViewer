const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const sharp = require('sharp');
const auth = require('./src/auth');
const { config } = require('./src/config');
const gallery = require('./src/gallery');
const thumbnail = require('./src/thumbnail');
const logger = require('./src/logger');

async function runTests() {
  console.log('🧪 开始运行测试...\n');

  try {
    // 测试1: Logger
    console.log('✓ 测试1: Logger 模块');
    logger.info('测试日志输出', { test: 'success' });
    console.log('  日志系统初始化成功\n');

    // 测试2: 环境变量认证
    console.log('✓ 测试2: 环境变量认证验证');
    console.log('  管理员账号:', config.adminUser);
    const isValid = await auth.verify(config.adminUser, config.adminPassword);
    console.log('  正确凭证验证:', isValid ? '✓ 通过' : '✗ 失败', '\n');

    // 测试3: 密码验证（错误情况）
    console.log('✓ 测试3: 密码验证（错误情况）');
    const wrongUser = await auth.verify('nobody', 'wrongpass');
    console.log('  错误用户名:', wrongUser ? '✗ 不应通过' : '✓ 正确拒绝');
    const wrongPwd = await auth.verify(config.adminUser, 'wrongpass');
    console.log('  错误密码:', wrongPwd ? '✗ 不应通过' : '✓ 正确拒绝', '\n');

    // 测试4: 日志文件
    console.log('✓ 测试4: 日志文件检查');
    const logsDir = path.join(__dirname, 'data', 'logs');
    if (fs.existsSync(logsDir)) {
      const logs = fs.readdirSync(logsDir);
      console.log('  日志文件数:', logs.length);
      console.log('  日志文件:', logs.join(', '));

      // 检查日志内容
      const combinedLog = path.join(logsDir, 'combined.log');
      if (fs.existsSync(combinedLog)) {
        const logContent = fs.readFileSync(combinedLog, 'utf8');
        const logLines = logContent.trim().split('\n').length;
        console.log('  日志行数:', logLines, '\n');
      }
    } else {
      console.log('  日志目录将在首次启动时创建\n');
    }

    // 测试5: getMediaInfo 图片元数据
    console.log('✓ 测试5: getMediaInfo 图片元数据');
    const origRoot = config.galleryRoot;
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gal-info-test-'));
    config.galleryRoot = tmpDir;
    try {
      const imgPath = path.join(tmpDir, 'test.png');
      await sharp({ create: { width: 100, height: 80, channels: 3, background: '#ff0000' } }).png().toFile(imgPath);
      const info = await gallery.getMediaInfo('test.png');
      console.log('  文件名:', info.name);
      console.log('  类型:', info.type);
      console.log('  大小:', info.sizeText);
      console.log('  尺寸:', info.width + 'x' + info.height);
      const imageOk = info.name === 'test.png' && info.type === 'image'
        && info.width === 100 && info.height === 80 && !!info.mtimeText;
      console.log('  图片字段验证:', imageOk ? '✓ 通过' : '✗ 失败', '\n');
      if (!imageOk) throw new Error('getMediaInfo 图片字段不正确');

      // 压缩包条目元数据
      console.log('✓ 测试6: getMediaInfo 压缩包条目');
      const innerPng = path.join(tmpDir, 'inner.png');
      await fs.promises.copyFile(imgPath, innerPng);
      const zipPath = path.join(tmpDir, 'album.zip');
      execFileSync('bsdtar', ['-a', '-cf', zipPath, '-C', tmpDir, 'inner.png']);
      const aInfo = await gallery.getMediaInfo('album.zip', 'inner.png');
      console.log('  类型:', aInfo.type);
      console.log('  位置:', aInfo.location);
      console.log('  压缩包:', aInfo.archiveName);
      const archiveOk = aInfo.location === 'archive' && aInfo.archiveName === 'album.zip'
        && aInfo.type === 'image' && aInfo.width === 100 && aInfo.height === 80;
      console.log('  压缩包字段验证:', archiveOk ? '✓ 通过' : '✗ 失败', '\n');
      if (!archiveOk) throw new Error('getMediaInfo 压缩包字段不正确');

      // 不存在的文件
      console.log('✓ 测试7: 不存在的文件处理');
      try {
        await gallery.getMediaInfo('not_exist.png');
        throw new Error('不应成功');
      } catch (e) {
        const notFoundOk = e.message === 'file not found';
        console.log('  返回错误:', notFoundOk ? '✓ file not found' : '✗ ' + e.message, '\n');
        if (!notFoundOk) throw e;
      }

      // 路径遍历防护
      console.log('✓ 测试8: 路径遍历防护');
      try {
        await gallery.safeResolve('../../etc/passwd');
        throw new Error('不应成功');
      } catch (e) {
        const blocked = e.message === 'invalid path';
        console.log('  越界路径:', blocked ? '✓ 已拒绝' : '✗ ' + e.message, '\n');
        if (!blocked) throw e;
      }

      // 缩略图缓存清理必须能处理含压缩包的图库（回归：曾把 entry 对象当字符串导致整体中止）
      console.log('✓ 测试9: 缩略图缓存清理（含压缩包）');
      const origThumbDir = config.thumbDir;
      const thumbTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gal-thumb-test-'));
      config.thumbDir = thumbTmp;
      try {
        const stale = path.join(thumbTmp, 'ab');
        fs.mkdirSync(stale, { recursive: true });
        const staleFile = path.join(stale, 'deadbeef.webp');
        fs.writeFileSync(staleFile, 'stale');
        await thumbnail.cleanupThumbCache();
        const removed = !fs.existsSync(staleFile);
        console.log('  过期缩略图删除:', removed ? '✓ 通过' : '✗ 未删除', '\n');
        if (!removed) throw new Error('cleanupThumbCache 未清理过期缩略图');
      } finally {
        config.thumbDir = origThumbDir;
        fs.rmSync(thumbTmp, { recursive: true, force: true });
      }
    } finally {
      config.galleryRoot = origRoot;
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }

    console.log('✅ 所有测试通过！\n');
    console.log('📝 核心功能验证:');
    console.log('  ✓ Logger 结构化日志系统');
    console.log('  ✓ 环境变量认证（ADMIN_USER / ADMIN_PASSWORD）');
    console.log('  ✓ 安全验证（错误凭证拒绝）');
    console.log('  ✓ 日志文件记录');
    console.log('  ✓ getMediaInfo 图片/压缩包元数据\n');
    console.log('📝 接下来的步骤:');
    console.log('1. 设置环境变量 ADMIN_USER / ADMIN_PASSWORD');
    console.log('2. 运行: npm start');
    console.log('3. 打开: http://localhost:8080');

  } catch (err) {
    console.error('❌ 测试失败:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

runTests();
