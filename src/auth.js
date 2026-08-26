const crypto = require('crypto');
const { config } = require('./config');

// 定长哈希比较：直接对原文做 timingSafeEqual 会因长度不等抛错并泄漏长度信息
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a), 'utf8').digest();
  const hb = crypto.createHash('sha256').update(String(b), 'utf8').digest();
  return crypto.timingSafeEqual(ha, hb);
}

function verify(username, password) {
  const userOk = safeEqual(username, config.adminUser);
  const passOk = safeEqual(password, config.adminPassword);
  return userOk && passOk;
}

module.exports = { verify };
