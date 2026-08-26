/* 移动端视图浏览器 */
(function () {
  'use strict';

  const { thumbUrl, rawUrl, videoUrl, favKey, formatTimeHeader } = window.MV;
  const groupByTime = (items, level) => window.MV.groupByTime(items, level, state.sortOrder);

  const state = {
    user: null,
    tree: null,
    favorites: {},
    favKey: null,
    currentPath: '',
    currentMode: 'dir',
    cachedItems: null,
    thumbSize: 'm',
    sortBy: 'time',
    sortOrder: 'desc',
    timeGroup: 'month',
    pageNum: 1,
    totalPages: 1,
  };

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));

  const api = window.MV.createApi();

  function isFavored(key) {
    return !!state.favorites[key];
  }

  /* ---------------- Views ---------------- */
  function showLogin() {
    $('#m-login').classList.remove('hidden');
    $('#m-main').classList.add('hidden');
  }

  function showMain(user) {
    state.user = user;
    $('#m-user').textContent = user;
    $('#m-login').classList.add('hidden');
    $('#m-main').classList.remove('hidden');
    init();
  }

  /* ---------------- Login ---------------- */
  $('#m-login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#m-login-error');
    err.classList.add('hidden');
    try {
      const data = await api('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: $('#m-username').value.trim(),
          password: $('#m-password').value,
        }),
      });
      showMain(data.user);
    } catch (err2) {
      err.textContent = err2.message;
      err.classList.remove('hidden');
    }
  });

  $('#m-logout-btn').addEventListener('click', async () => {
    try { await api('/api/logout', { method: 'POST' }); } catch {}
    location.reload();
  });

  /* ---------------- Tree (drawer) ---------------- */
  function buildTreeEl(nodes, depth) {
    if (!nodes || !nodes.length) return null;
    const wrap = document.createElement('div');
    wrap.className = 'm-tree-children' + (depth === 0 ? ' open' : '');
    nodes.forEach((node) => {
      const hasChildren = node.children && node.children.length > 0;
      const el = document.createElement('div');
      el.dataset.rel = node.rel || '';
      el.className = 'm-tree-node' +
        (node.type === 'dir' ? ' m-tree-node-dir' : ' m-tree-node-file') +
        (hasChildren ? '' : ' leaf');
      el.style.paddingLeft = (16 + depth * 16) + 'px';

      const caret = document.createElement('span');
      caret.className = 'm-tree-caret' + (hasChildren ? '' : ' placeholder');
      caret.textContent = '▸';
      el.appendChild(caret);

      const label = document.createElement('span');
      label.className = 'm-tree-label';
      label.textContent = node.name;
      el.appendChild(label);

      if (node.type === 'dir') {
        el.addEventListener('click', (ev) => {
          if (ev.target === caret) return;
          selectTreeDir(node.rel, node, el);
        });
      }
      if (hasChildren) {
        const childWrap = buildTreeEl(node.children, depth + 1);
        if (childWrap) {
          el.appendChild(childWrap);
          caret.addEventListener('click', (ev) => {
            ev.stopPropagation();
            childWrap.classList.toggle('open');
            el.classList.toggle('expanded');
          });
        }
      }

      wrap.appendChild(el);
    });
    return wrap;
  }

  async function loadTree() {
    const drawer = $('#m-tree');
    drawer.innerHTML = '<div class="m-loading">加载中...</div>';
    try {
      const data = await api('/api/tree');
      state.tree = data.tree || [];

      const rootEl = document.createElement('div');
      rootEl.className = 'm-tree-node m-tree-node-root';
      rootEl.dataset.rel = '';
      rootEl.innerHTML = '<span class="m-tree-icon"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg></span><span class="m-tree-label">根目录</span>';
      rootEl.addEventListener('click', () => {
        openDirectory('');
        closeDrawer();
      });
      drawer.innerHTML = '';
      drawer.appendChild(rootEl);

      const body = buildTreeEl(state.tree, 0);
      if (body) drawer.appendChild(body);
      markActiveTree();
    } catch (e) {
      drawer.innerHTML = `<div class="m-loading">${escapeHtml(e.message)}</div>`;
    }
  }

  function markActiveTree() {
    $$('.m-tree-node').forEach((el) => el.classList.remove('active'));
    if (!state.currentPath) {
      const rootEl = $$('.m-tree-node-root')[0];
      if (rootEl) rootEl.classList.add('active');
      return;
    }
    $$('.m-tree-node[data-rel]').forEach((el) => {
      if (el.dataset.rel === state.currentPath) el.classList.add('active');
    });
    expandPathInTree(state.currentPath);
  }

  function selectTreeDir(rel, node, el) {
    $$('.m-tree-node').forEach((x) => x.classList.remove('active'));
    el.classList.add('active');
    openDirectory(rel);
    closeDrawer();
  }

  function expandPathInTree(rel) {
    if (!rel || !state.tree) return;
    const parts = rel.split('/').filter(Boolean);
    const pathSet = new Set();
    let acc = '';
    for (const part of parts) {
      acc = acc ? acc + '/' + part : part;
      pathSet.add(acc);
    }
    $$('.m-tree-node[data-rel]').forEach((el) => {
      if (pathSet.has(el.dataset.rel)) {
        const wrap = el.querySelector('.m-tree-children');
        if (wrap) { wrap.classList.add('open'); el.classList.add('expanded'); }
      }
    });
  }

  /* ---------------- Drawer ---------------- */
  function openDrawer() {
    loadTree();
    $('#m-drawer').classList.add('open');
    $('#m-drawer-bg').classList.remove('hidden');
  }

  function closeDrawer() {
    $('#m-drawer').classList.remove('open');
    $('#m-drawer-bg').classList.add('hidden');
  }

  $('#m-menu-btn').addEventListener('click', () => {
    openDrawer();
    history.pushState({ drawer: true }, '');
  });
  $('#m-drawer-bg').addEventListener('click', closeDrawer);

  /* ---------------- Browsing ---------------- */
  function showPath(path) {
    const parts = (path || '').split('/').filter(Boolean);
    $('#m-path-display').textContent = parts.length ? parts.join(' / ') : '根目录';
  }

  async function openDirectory(relPath, pageNum = 1) {
    state.currentPath = relPath || '';
    state.currentMode = 'dir';
    showPath(state.currentPath);
    showLoading();
    try {
      const url = `/api/browse?path=${encodeURIComponent(state.currentPath)}&page=${pageNum}&pageSize=80&sortBy=${state.sortBy}&sortOrder=${state.sortOrder}`;
      const data = await api(url);
      renderBrowse(data);
    } catch (e) {
      renderEmpty(e.message);
    }
  }

  async function openArchive(relPath) {
    state.currentPath = relPath;
    state.currentMode = 'archive';
    showPath(state.currentPath);
    showLoading();
    try {
      const url = `/api/archive-images?path=${encodeURIComponent(relPath)}&sortBy=${state.sortBy}&sortOrder=${state.sortOrder}`;
      const data = await api(url);
      const mediaItems = (data.media || []).map((m) => ({
        type: 'archive', mime: m.mime, path: relPath, entry: m.entry, name: m.name, mtime: m.mtime,
      }));
      if (mediaItems.length) {
        showSortbar();
      } else {
        hideSortbar();
      }
      renderMedia(mediaItems);
    } catch (e) {
      renderEmpty(e.message);
    }
  }

  async function openFavorites() {
    state.currentMode = 'favorites';
    state.currentPath = 'favorites';
    $('#m-path-display').textContent = '我的收藏';
    showLoading();
    try {
      const data = await api('/api/favorites');
      const items = (data.favorites || []).map((f) => ({
        type: f.type, mime: f.mime, path: f.path, entry: f.entry, name: f.name, mtime: f.mtime,
      }));
      renderOnlyMedia(items);
    } catch (e) {
      renderEmpty(e.message);
    }
  }

  function renderBrowse(data) {
    const folders = data.folders || [];
    const archives = data.archives || [];
    const media = data.media || [];

    $('#m-empty').classList.add('hidden');
    $('#m-loading').classList.add('hidden');

    /* 文件夹卡片 */
    const folderGrid = $('#m-folders');
    folderGrid.innerHTML = '';
    const dirCards = folders.map((f) => ({
      name: f.name, rel: f.rel, count: f.count, type: 'dir',
    }));
    const archCards = archives.map((a) => ({
      name: a.name, rel: a.rel, count: null, type: 'archive',
    }));
    [...dirCards, ...archCards].forEach((item) => {
      if (item.type === 'dir') folderGrid.appendChild(makeFolderCard(item));
      else folderGrid.appendChild(makeArchiveCard(item));
    });

    if (!folders.length && !archives.length) {
      folderGrid.style.display = 'none';
    } else {
      folderGrid.style.display = '';
    }

    if (media.length) {
      showSortbar();
    } else {
      hideSortbar();
    }

    renderMedia(media);
    renderPagination(data);
  }

  function renderPagination(data) {
    const pag = data.pagination;
    if (!pag || pag.totalPages <= 1) {
      $('#m-pagination').classList.add('hidden');
      state.pageNum = 1;
      state.totalPages = 1;
      return;
    }
    state.pageNum = pag.pageNum;
    state.totalPages = pag.totalPages;
    $('#m-page-info').textContent = pag.pageNum + '/' + pag.totalPages;
    $('#m-pagination').classList.remove('hidden');
  }

  function renderOnlyMedia(media) {
    $('#m-empty').classList.add('hidden');
    $('#m-loading').classList.add('hidden');
    $('#m-folders').innerHTML = '';
    $('#m-folders').style.display = 'none';
    if (media.length) {
      showSortbar();
    } else {
      hideSortbar();
    }
    renderMedia(media);
  }

  function showSortbar() {
    const sb = $('#m-sortbar');
    sb.classList.remove('hidden');
    $('#m-content').classList.add('has-sortbar');
    syncSortbar();
  }

  function hideSortbar() {
    $('#m-sortbar').classList.add('hidden');
    $('#m-content').classList.remove('has-sortbar');
  }

  $('#m-page-prev').addEventListener('click', () => {
    if (state.pageNum > 1) openDirectory(state.currentPath, state.pageNum - 1);
  });
  $('#m-page-next').addEventListener('click', () => {
    if (state.pageNum < state.totalPages) openDirectory(state.currentPath, state.pageNum + 1);
  });

  function makeFolderCard(f) {
    const card = document.createElement('div');
    card.className = 'm-folder-card';
    card.innerHTML = `
      <div class="m-folder-icon"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg></div>
      <div class="m-folder-name"></div>
      <div class="m-folder-count">${f.count !== undefined ? f.count : ''}</div>
    `;
    card.querySelector('.m-folder-name').textContent = f.name;
    card.addEventListener('click', () => openDirectory(f.rel));
    return card;
  }

  function makeArchiveCard(a) {
    const card = document.createElement('div');
    card.className = 'm-family-card';
    card.innerHTML = `
      <div class="m-family-icon"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M13.5 2H7v20h10V2h-3.5zM9 12a3 3 0 0 1 6 0 3 3 0 0 1-6 0z"/></svg></div>
      <div class="m-family-name"></div>
    `;
    card.querySelector('.m-family-name').textContent = a.name;
    card.addEventListener('click', () => openArchive(a.rel));
    return card;
  }

  function renderMedia(items) {
    state.cachedItems = items;
    if (state.sortBy === 'time') return renderTimeline(items);
    const mediaBox = $('#m-media');
    mediaBox.innerHTML = '';
    mediaBox.className = 'm-masonry';
    if (!items || !items.length) {
      $('#m-empty').classList.remove('hidden');
      $('#m-empty').textContent = '此目录为空';
      return;
    }
    items.forEach((item) => mediaBox.appendChild(makeMediaItem(item)));
    lazyLoad();
  }

  function renderTimeline(items) {
    const groups = groupByTime(items, state.timeGroup);
    const mediaBox = $('#m-media');
    mediaBox.innerHTML = '';
    mediaBox.className = '';
    if (!groups.length) {
      $('#m-empty').classList.remove('hidden');
      $('#m-empty').textContent = '此目录为空';
      return;
    }
    groups.forEach(group => {
      const header = document.createElement('div');
      header.className = 'm-timeline-header';
      header.innerHTML = `<span class="m-th-date">${formatTimeHeader(group.items[0].mtime, state.timeGroup)}</span><span class="m-th-count">${group.items.length} 个文件</span><span class="m-th-line"></span>`;
      mediaBox.appendChild(header);
      const row = document.createElement('div');
      row.className = 'm-masonry m-timeline-row';
      group.items.forEach((item) => row.appendChild(makeMediaItem(item)));
      mediaBox.appendChild(row);
    });
    lazyLoad();
  }

  function makeMediaItem(item) {
    const box = document.createElement('div');
    box.className = 'm-item' + (item.mime === 'video' ? ' m-item-video' : '');

    const img = document.createElement('img');
    img.loading = 'lazy';
    img.alt = item.name;
    img.dataset.thumb = thumbUrl(item);
    box.appendChild(img);

    if (item.mime === 'video') {
      const badge = document.createElement('div');
      badge.className = 'm-item-video-badge';
      badge.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
      box.appendChild(badge);
    }

    const fav = document.createElement('button');
    fav.className = 'm-item-fav';
    fav.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 21C12 21 4 14.6 4 8.8C4 6 6 4 8.7 4c1.3 0 2.5.6 3.3 1.6.8-1 2-1.6 3.3-1.6C18 4 20 6 20 8.8c0 5.8-8 12.2-8 12.2z"/></svg>';
    const key = favKey(item);
    fav.classList.toggle('fav-on', isFavored(key));
    fav.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleFav(item, fav);
    });
    box.appendChild(fav);

    box.addEventListener('click', () => openViewer(item));
    return box;
  }

  /* ---------------- Lazy load ---------------- */
  const lazyLoad = window.MV.createLazyLoader({
    selector: '#m-media img[data-thumb]',
    rootMargin: '300px',
  });

  /* ---------------- Favorites ---------------- */
  function showToast(msg) {
    const t = $('#m-toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    setTimeout(() => t.classList.add('hidden'), 2000);
  }

  async function toggleFav(item, el) {
    const key = favKey(item);
    try {
      const data = await api('/api/favorites/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: item.path,
          entry: item.entry || null,
          name: item.name,
          mime: item.mime,
          mtime: item.mtime || null,
        }),
      });
      if (data.favorited) state.favorites[key] = item;
      else delete state.favorites[key];
      if (el) el.classList.toggle('fav-on', data.favorited);
      if (state.currentMode === 'favorites' && !data.favorited) {
        const box = el && el.closest('.m-item');
        if (box) box.remove();
      }
    } catch (e) {
      console.error('收藏操作失败', e);
      if (el) el.classList.toggle('fav-on', data && data.favorited);
      showToast('收藏操作失败');
    }
  }

  $('#m-fav-btn').addEventListener('click', () => {
    openFavorites();
  });

  async function loadFavorites() {
    try {
      const data = await api('/api/favorites');
      state.favorites = {};
      (data.favorites || []).forEach((f) => {
        state.favorites[f.entry ? f.path + '|' + f.entry : f.path] = f;
      });
    } catch (e) {
      console.error('加载收藏失败', e);
    }
  }

  /* ---------------- Viewer ---------------- */
  let viewerItems = [];
  let viewerIndex = -1;
  let viewerScale = 1;
  let viewerTranslateX = 0;
  let viewerTranslateY = 0;
  let viewerMinScale = 1;
  let viewerMaxScale = 5;
  let viewerTouchStartX = 0;
  let viewerTouchStartY = 0;
  let viewerLastTouchX = 0;
  let viewerLastTouchY = 0;
  let viewerIsDragging = false;
  let viewerIsPinching = false;
  let viewerPinchStartDist = 0;
  let viewerPinchStartScale = 1;
  let viewerBlobUrl = null;
  let viewerAnimating = false;

  function applyViewerTransform() {
    const img = $('#m-viewer-img');
    img.style.transform = `translate(calc(-50% + ${viewerTranslateX}px), calc(-50% + ${viewerTranslateY}px)) scale(${viewerScale})`;
  }

  function fitScaleFor(nw, nh) {
    const vw = window.innerWidth, vh = window.innerHeight;
    if (!nw || !nh) return 1;
    if (nw <= vw && nh <= vh) return 1;
    return Math.min(vw / nw, vh / nh);
  }

  function clampViewerPan() {
    const img = $('#m-viewer-img');
    const displayW = img.naturalWidth * viewerScale;
    const displayH = img.naturalHeight * viewerScale;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const maxX = Math.max(0, (displayW - vw) / 2);
    const maxY = Math.max(0, (displayH - vh) / 2);
    viewerTranslateX = Math.max(-maxX, Math.min(maxX, viewerTranslateX));
    viewerTranslateY = Math.max(-maxY, Math.min(maxY, viewerTranslateY));
  }

  function calcViewerFitScale() {
    const img = $('#m-viewer-img');
    return fitScaleFor(img.naturalWidth, img.naturalHeight);
  }

  function initViewerImage() {
    const img = $('#m-viewer-img');
    img.style.width = img.naturalWidth + 'px';
    img.style.height = img.naturalHeight + 'px';
    viewerMinScale = calcViewerFitScale();
    viewerScale = viewerMinScale;
    viewerTranslateX = 0;
    viewerTranslateY = 0;
    applyViewerTransform();
  }

  function openViewer(item) {
    const items = state.cachedItems || [];
    viewerItems = items;
    viewerIndex = items.indexOf(item);
    renderViewer(item);
  }

  function renderViewer(item) {
    const img = $('#m-viewer-img');
    const video = $('#m-viewer-video');
    const spinner = $('#m-viewer-spinner');
    img.classList.add('hidden');
    video.classList.add('hidden');
    spinner.classList.remove('hidden');
    video.removeAttribute('src');
    video.removeAttribute('srcObject');
    delete video.dataset.fallback;
    img.style.transform = '';
    img.style.width = '';
    img.style.height = '';

    $('#m-viewer').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    history.pushState({ viewer: true }, '');

    if (item.mime === 'video') {
      spinner.classList.add('hidden');
      video.classList.remove('hidden');
      const url = videoUrl(item);
      const onError = () => {
        video.dataset.fallback = '1';
        fetch(url, { credentials: 'same-origin' }).then(r => {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.blob();
        }).then(blob => {
          if (viewerBlobUrl) URL.revokeObjectURL(viewerBlobUrl);
          video.removeAttribute('src');
          viewerBlobUrl = URL.createObjectURL(blob);
          video.src = viewerBlobUrl;
          video.play().catch(() => {});
        }).catch(() => {});
      };
      video.addEventListener('error', onError, { once: true });
      video.src = url;
      video.load();
      video.play().catch(() => {});
    } else {
      img.classList.remove('hidden');
      img.dataset.loaded = '0';
      delete img.dataset.slideIn;
      img.onload = () => {
        if (img.dataset.loaded === '1') return;
        img.dataset.loaded = '1';
        $('#m-viewer-spinner').classList.add('hidden');
        initViewerImage();
      };
      img.onerror = () => {
        if (img.dataset.loaded === '1') return;
        img.dataset.loaded = '1';
        $('#m-viewer-spinner').classList.add('hidden');
      };
      img.src = rawUrl(item);
      if (img.complete && img.naturalWidth > 0) {
        img.onload();
      }
    }
  }

  function closeViewer() {
    const video = $('#m-viewer-video');
    video.pause();
    video.removeAttribute('src');
    video.load();
    if (viewerBlobUrl) { URL.revokeObjectURL(viewerBlobUrl); viewerBlobUrl = null; }
    const img = $('#m-viewer-img');
    img.src = '';
    delete img.dataset.loaded;
    img.style.transition = '';
    viewerAnimating = false;
    $('#m-viewer').classList.add('hidden');
    document.body.style.overflow = '';
  }

  function onViewerTouchStart(e) {
    if (e.target.tagName === 'VIDEO') return;
    if (viewerAnimating) { e.preventDefault(); return; }
    e.preventDefault();
    const t = e.touches;
    if (t.length === 1) {
      viewerIsDragging = true;
      viewerIsPinching = false;
      viewerTouchStartX = t[0].clientX;
      viewerTouchStartY = t[0].clientY;
      viewerLastTouchX = t[0].clientX;
      viewerLastTouchY = t[0].clientY;
    } else if (t.length === 2) {
      viewerIsPinching = true;
      viewerIsDragging = false;
      viewerPinchStartDist = Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
      viewerPinchStartScale = viewerScale;
    }
  }

  function onViewerTouchMove(e) {
    if (e.target.tagName === 'VIDEO') return;
    e.preventDefault();
    const t = e.touches;
    if (viewerIsPinching && t.length === 2) {
      const dist = Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
      viewerScale = Math.max(viewerMinScale, Math.min(viewerMaxScale, viewerPinchStartScale * (dist / viewerPinchStartDist)));
      clampViewerPan();
      applyViewerTransform();
    } else if (viewerIsDragging && t.length === 1) {
      viewerTranslateX += t[0].clientX - viewerLastTouchX;
      viewerTranslateY += t[0].clientY - viewerLastTouchY;
      clampViewerPan();
      applyViewerTransform();
      viewerLastTouchX = t[0].clientX;
      viewerLastTouchY = t[0].clientY;
    }
  }

  function onViewerTouchEnd(e) {
    if (e.target.tagName === 'VIDEO') return;
    e.preventDefault();

    if (viewerIsPinching) {
      viewerIsPinching = false;
      const fit = calcViewerFitScale();
      if (viewerScale < fit) {
        viewerScale = fit;
        viewerTranslateX = 0;
        viewerTranslateY = 0;
        applyViewerTransform();
      }
      return;
    }

    if (viewerIsDragging) {
      viewerIsDragging = false;
      const absDx = Math.abs(viewerLastTouchX - viewerTouchStartX);
      const absDy = Math.abs(viewerLastTouchY - viewerTouchStartY);
      if (absDx < 10 && absDy < 10) {
        closeViewer();
      }
    }
  }

  function onViewerTouchCancel(e) {
    viewerIsDragging = false;
    viewerIsPinching = false;
  }

  const viewerEl = $('#m-viewer');
  viewerEl.addEventListener('touchstart', onViewerTouchStart, { passive: false });
  viewerEl.addEventListener('touchmove', onViewerTouchMove, { passive: false });
  viewerEl.addEventListener('touchend', onViewerTouchEnd, { passive: false });
  viewerEl.addEventListener('touchcancel', onViewerTouchCancel, { passive: false });

  /* ---------------- Sortbar ---------------- */
  function sortOrderArrow() {
    $('#m-sort-order').value = state.sortOrder;
  }

  function syncSortbar() {
    $('#m-sort-by').value = state.sortBy;
    $('#m-time-group').value = state.timeGroup;
    $('#m-time-group').classList.toggle('hidden', state.sortBy !== 'time');
    sortOrderArrow();
  }

  $('#m-sort-by').addEventListener('change', (e) => {
    state.sortBy = e.target.value;
    syncSortbar();
    reloadCurrent();
  });

  $('#m-sort-order').addEventListener('change', (e) => {
    state.sortOrder = e.target.value;
    sortOrderArrow();
    reloadCurrent();
  });

  $('#m-time-group').addEventListener('change', (e) => {
    state.timeGroup = e.target.value;
    if (state.cachedItems) renderMedia(state.cachedItems);
  });

  function reloadCurrent() {
    if (state.currentMode === 'favorites') {
      openFavorites();
    } else if (state.currentMode === 'archive') {
      openArchive(state.currentPath);
    } else {
      openDirectory(state.currentPath, 1);
    }
  }

  /* ---------------- UI helpers ---------------- */
  function showLoading() {
    hideSortbar();
    $('#m-pagination').classList.add('hidden');
    $('#m-loading').classList.remove('hidden');
    $('#m-empty').classList.add('hidden');
    $('#m-folders').innerHTML = '';
    $('#m-media').innerHTML = '';
    $('#m-folders').style.display = '';
  }

  function renderEmpty(msg) {
    hideSortbar();
    $('#m-pagination').classList.add('hidden');
    $('#m-loading').classList.add('hidden');
    $('#m-folders').innerHTML = '';
    $('#m-folders').style.display = 'none';
    $('#m-media').innerHTML = '';
    state.cachedItems = null;
    $('#m-empty').textContent = msg || '暂无内容';
    $('#m-empty').classList.remove('hidden');
  }

  function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  /* ---------------- Init ---------------- */
  async function init() {
    await loadFavorites();
    /* 打开根目录，若根目录有子文件夹则自动进入第一个 */
    try {
      const data = await api(`/api/browse?path=&page=1&pageSize=80&sortBy=${state.sortBy}&sortOrder=${state.sortOrder}`);
      const folders = data.folders || [];
      if (folders.length > 0) {
        openDirectory(folders[0].rel);
      } else {
        state.currentPath = '';
        showPath('');
        renderBrowse(data);
      }
    } catch (e) {
      state.currentPath = '';
      showPath('');
      renderEmpty(e.message);
    }
  }

  /* Android 返回键：关闭查看器或抽屉 */
  window.addEventListener('popstate', () => {
    if (!$('#m-viewer').classList.contains('hidden')) {
      closeViewer();
    } else if ($('#m-drawer').classList.contains('open')) {
      closeDrawer();
    } else if (!$('#m-login').classList.contains('hidden')) {
      return;
    } else {
      openFavorites(); /* 兜底 */
    }
  });

  (async () => {
    try {
      const v = await fetch('/api/version').then(r => r.json());
      if (v.version) {
        document.querySelector('.m-version-badge').textContent = v.version;
      }
    } catch {}
    try {
      const data = await api('/api/me');
      showMain(data.user);
    } catch {
      showLogin();
    }
  })();
})();