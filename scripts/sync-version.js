// 以根目录 version 文件为唯一版本来源，同步写入 package.json。
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const versionFile = path.join(ROOT, 'version');
const pkgFile = path.join(ROOT, 'package.json');

const version = fs.readFileSync(versionFile, 'utf8').trim().replace(/^v/, '');
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(`version 文件内容不是合法的语义化版本: "${version}"`);
  process.exit(1);
}

const raw = fs.readFileSync(pkgFile, 'utf8');
const pkg = JSON.parse(raw);

if (pkg.version === version) {
  console.log(`package.json 版本已是 ${version}，无需修改`);
  process.exit(0);
}

const updated = raw.replace(
  /("version"\s*:\s*")[^"]*(")/,
  `$1${version}$2`
);
if (JSON.parse(updated).version !== version) {
  console.error('未能在 package.json 中定位 version 字段');
  process.exit(1);
}

fs.writeFileSync(pkgFile, updated);
console.log(`package.json 版本已同步: ${pkg.version} → ${version}`);
