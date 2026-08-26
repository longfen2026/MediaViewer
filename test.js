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

      // 解压视频缓存必须清理孤儿文件
      console.log('✓ 测试10: 解压视频缓存孤儿清理');
      const origVideoCacheDir = config.videoCacheDir;
      const videoTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gal-video-test-'));
      config.videoCacheDir = videoTmp;
      try {
        const orphan = path.join(videoTmp, 'orphan.mp4');
        const keep = path.join(videoTmp, 'keep.mp4');
        fs.writeFileSync(orphan, Buffer.alloc(1024));
        fs.writeFileSync(keep, Buffer.alloc(1024));
        const r = await thumbnail.cleanupVideoCache(new Set([keep]));
        const ok = !fs.existsSync(orphan) && fs.existsSync(keep);
        console.log('  孤儿视频删除:', ok ? '✓ 通过' : '✗ 失败', `(释放 ${r.freed} bytes)`, '\n');
        if (!ok) throw new Error('cleanupVideoCache 孤儿清理行为错误');
      } finally {
        config.videoCacheDir = origVideoCacheDir;
        fs.rmSync(videoTmp, { recursive: true, force: true });
      }

      // 总容量上限必须跨三个缓存目录按 atime 淘汰最久未访问的文件
      console.log('✓ 测试11: 总缓存容量上限淘汰');
      const budgetOrig = {
        thumbDir: config.thumbDir,
        videoThumbDir: config.videoThumbDir,
        videoCacheDir: config.videoCacheDir,
        max: config.cacheMaxBytes,
      };
      const budgetTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gal-budget-test-'));
      config.thumbDir = path.join(budgetTmp, 'thumbs');
      config.videoThumbDir = path.join(budgetTmp, 'videothumbs');
      config.videoCacheDir = path.join(budgetTmp, 'videos');
      try {
        fs.mkdirSync(path.join(config.thumbDir, 'ab'), { recursive: true });
        fs.mkdirSync(config.videoCacheDir, { recursive: true });
        const oldThumb = path.join(config.thumbDir, 'ab', 'old.webp');
        const newVideo = path.join(config.videoCacheDir, 'new.mp4');
        fs.writeFileSync(oldThumb, Buffer.alloc(600));
        fs.writeFileSync(newVideo, Buffer.alloc(600));
        const past = new Date(Date.now() - 60 * 60 * 1000);
        fs.utimesSync(oldThumb, past, past);

        const usage = await thumbnail.cacheUsage();
        if (usage !== 1200) throw new Error(`cacheUsage 统计错误: ${usage}`);

        config.cacheMaxBytes = 1000;
        const r = await thumbnail.enforceCacheBudget();
        const evicted = !fs.existsSync(oldThumb) && fs.existsSync(newVideo);
        console.log('  跨目录统计:', usage, 'bytes ✓');
        console.log('  超限淘汰最久未访问:', evicted ? '✓ 通过' : '✗ 淘汰顺序错误', `(剩余 ${r.total} bytes)`);
        if (!evicted) throw new Error('enforceCacheBudget 淘汰顺序错误');

        config.cacheMaxBytes = 0;
        const noop = await thumbnail.enforceCacheBudget();
        if (noop.deleted !== 0) throw new Error('cacheMaxBytes=0 时不应淘汰');
        console.log('  上限为 0 时不淘汰: ✓ 通过\n');
      } finally {
        Object.assign(config, {
          thumbDir: budgetOrig.thumbDir,
          videoThumbDir: budgetOrig.videoThumbDir,
          videoCacheDir: budgetOrig.videoCacheDir,
          cacheMaxBytes: budgetOrig.max,
        });
        fs.rmSync(budgetTmp, { recursive: true, force: true });
      }

      // TtlCache 必须在过期与超限时移除条目
      console.log('✓ 测试12: TtlCache 过期与容量上限');
      const { TtlCache } = require('./src/ttlCache');
      const c = new TtlCache({ ttl: 20, max: 2 });
      c.set('a', 1);
      c.set('b', 2);
      c.set('c', 3);
      if (c.size !== 2) throw new Error(`TtlCache 未按上限淘汰, size=${c.size}`);
      if (c.get('a') !== undefined) throw new Error('TtlCache 未淘汰最旧键');
      await new Promise(r => setTimeout(r, 30));
      if (c.get('c') !== undefined) throw new Error('TtlCache 未按 TTL 过期');
      c.prune();
      if (c.size !== 0) throw new Error(`TtlCache prune 未清空过期项, size=${c.size}`);
      console.log('  容量淘汰 + TTL 过期: ✓ 通过\n');
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
