/* 桌面端与移动端共享的纯逻辑：URL 构造、时间分组、收藏键、懒加载、API 封装。
   通过 window.MV 暴露，两端各自保留视图层实现。 */
(() => {
  'use strict';

  function mediaUrl(kind, item) {
    const p = encodeURIComponent(item.path);
    if (item.type === 'archive') {
      return `/api/${kind}?path=${p}&entry=${encodeURIComponent(item.entry)}`;
    }
    return `/api/${kind}?path=${p}`;
  }

  const thumbUrl = (item) => mediaUrl('thumb', item);
  const rawUrl = (item) => mediaUrl('image', item);
  const videoUrl = (item) => mediaUrl('video', item);

  function favKey(item) {
    return item.entry ? item.path + '|' + item.entry : item.path;
  }

  function groupByTime(items, level, sortOrder) {
    const groups = {};
    items.forEach((item) => {
      const d = new Date(item.mtime);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      let key;
      if (level === 'year') key = String(y);
      else if (level === 'month') key = `${y}-${m}`;
      else key = `${y}-${m}-${String(d.getDate()).padStart(2, '0')}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(item);
    });
    const keys = Object.keys(groups).sort();
    if (sortOrder === 'desc') keys.reverse();
    return keys.map((k) => ({ key: k, items: groups[k] }));
  }

  const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

  function formatTimeHeader(mtime, level) {
    const d = new Date(mtime);
    if (level === 'year') return `${d.getFullYear()}年`;
    if (level === 'month') return `${d.getFullYear()}年${d.getMonth() + 1}月`;
    const today = new Date();
    const dayStr = `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
    const suffix = `${dayStr} 星期${WEEKDAYS[d.getDay()]}`;
    if (d.toDateString() === today.toDateString()) return `今天 · ${suffix}`;
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return `昨天 · ${suffix}`;
    return suffix;
  }

  // rootMargin 差异来自两端滚动速度不同，故作为参数暴露
  function createLazyLoader({ selector = 'img[data-thumb]', rootMargin = '200px' } = {}) {
    let observer = null;
    return function lazyLoad() {
      if (!observer) {
        observer = new IntersectionObserver((entries) => {
          entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            const img = entry.target;
            if (!img.src) {
              img.src = img.dataset.thumb;
              img.dataset.thumb = '';
            }
            observer.unobserve(img);
          });
        }, { rootMargin });
      }
      document.querySelectorAll(selector).forEach((img) => observer.observe(img));
    };
  }

  // onUnauthorized 为可选钩子：桌面端借此回到登录页，移动端按普通错误处理
  function createApi({ onUnauthorized } = {}) {
    return async function api(path, options = {}) {
      const res = await fetch(path, {
        headers: { 'Content-Type': 'application/json' },
        ...options,
      });
      if (res.status === 401 && onUnauthorized && !path.startsWith('/api/login')) {
        onUnauthorized();
        throw new Error('unauthorized');
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `请求失败 (${res.status})`);
      }
      const ct = res.headers.get('Content-Type') || '';
      return ct.includes('application/json') ? res.json() : res;
    };
  }

  window.MV = {
    thumbUrl,
    rawUrl,
    videoUrl,
    favKey,
    groupByTime,
    formatTimeHeader,
    createLazyLoader,
    createApi,
  };
})();
