// 移动端重定向。抽成外部脚本以避免 CSP 需要 script-src 'unsafe-inline'。
if (/Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) && window.innerWidth < 768) {
  location.href = '/m';
}
