(() => {
  'use strict';

  const { thumbUrl, rawUrl, videoUrl, favKey, formatTimeHeader } = window.MV;
  const groupByTime = (items, level) => window.MV.groupByTime(items, level, state.sortOrder);

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  function icon(name) {
    return window.ICONPARK && ICONPARK[name] ? ICONPARK[name] : '';
  }

  function initIcons() {
    $$('[data-icon]').forEach(el => {
      const name = el.dataset.icon;
      el.innerHTML = icon(name);
    });
  }

  const LAYOUT_SIZES = { s: 160, m: 240, l: 320 };
  const MASONRY_GAP = 18;
  let pendingMetaItem = null;

  const state = {
    user: null,
    tree: [],
    currentPath: '',
    imageList: [],
    lbIndex: -1,
    browseData: null,
    sortBy: 'time',
    sortOrder: 'desc',
    timeGroup: 'month',
    pageNum: 1,
    pageSize: 50,
    totalPages: 1,
    thumbSize: 'm',
    zoom: false,
    zoomX: 0,
    zoomY: 0,
    favorites: {},
    favMode: false,
    stashedImageList: null,
  };

  function isFavored(key) {
    return !!state.favorites[key];
  }

  async function loadFavorites() {
    try {
      const data = await api('/api/favorites');
      state.favorites = {};
      (data.favorites || []).forEach(f => {
        state.favorites[f.entry ? f.path + '|' + f.entry : f.path] = f;
      });
    } catch (e) {
      console.error('加载收藏失败', e);
    }
    updateFavUI(null, '');
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
      if (data.favorited) {
        state.favorites[key] = item;
      } else {
        delete state.favorites[key];
      }
      updateFavUI(el, key);
      if (state.favMode && !data.favorited) refreshFavGrid();
    } catch (e) {
      console.error('收藏失败', e);
    }
  }

  function updateFavUI(el, key) {
    if (el) {
      const on = isFavored(key);
      el.innerHTML = icon('heart');
      el.classList.toggle('fav-on', on);
    }
    $$('.fav-btn').forEach(btn => {
      const k = btn.dataset.favKey;
      const on = isFavored(k);
      btn.innerHTML = icon('heart');
      btn.classList.toggle('fav-on', on);
    });
    updateLightboxFav();
  }

  const api = window.MV.createApi({ onUnauthorized: () => showLogin() });

  /* ---------------- Auth ---------------- */
  function showLogin() {
    $('#boot-loading').classList.add('hidden');
    $('#main-view').classList.add('hidden');
    $('#login-view').classList.remove('hidden');
    state.user = null;
    $('#password').value = '';
    $('#username').focus();
  }

  async function showMain(user) {
    $('#boot-loading').classList.add('hidden');
    state.user = user;
    $('#login-view').classList.add('hidden');
    $('#main-view').classList.remove('hidden');
    $('#current-user').textContent = user;
    applyThumbSize();
    await loadTree();
    await loadFavorites();
    await openDirectory('');
    if (state.browseData && state.browseData.mode === 'dir' && state.browseData.folders.length > 0) {
      const firstDir = findTreeDir(state.tree, state.browseData.folders[0].rel);
      if (firstDir) selectNode(firstDir);
    }
  }

  function findTreeDir(nodes, rel) {
    for (const n of nodes) {
      if (n.rel === rel) return n;
      if (n.children) {
        const found = findTreeDir(n.children, rel);
        if (found) return found;
      }
    }
    return null;
  }

  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = $('#username').value.trim();
    const password = $('#password').value;
    try {
      const data = await api('/api/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
      showMain(data.user);
    } catch (err) {
      $('#login-error').textContent = err.message;
      $('#login-error').classList.remove('hidden');
    }
  });

  $('#btn-logout').addEventListener('click', async () => {
    if (!confirm('确定要退出登录吗？')) return;
    try { await api('/api/logout', { method: 'POST' }); } catch {}
    showLogin();
  });

  /* ---------------- Favorites page ---------------- */
  $('#btn-favorites').addEventListener('click', openFavorites);

  async function openFavorites() {
    state.favMode = true;
    state.stashedImageList = state.imageList;
    $('#main-view').classList.add('hidden');
    $('#favorites-view').classList.remove('hidden');
    $('#lightbox').classList.add('hidden');
    document.body.style.overflow = '';
    await refreshFavGrid();
  }

  function closeFavorites() {
    state.favMode = false;
    $('#favorites-view').classList.add('hidden');
    $('#main-view').classList.remove('hidden');
    if (state.stashedImageList) {
      state.imageList = state.stashedImageList;
      state.stashedImageList = null;
    }
    state.lbIndex = -1;
  }

  $('#fav-back').addEventListener('click', closeFavorites);

  async function refreshFavGrid() {
    const grid = $('#fav-grid');
    const empty = $('#fav-empty');
    const count = $('#fav-count');
    try {
      const data = await api('/api/favorites');
      const items = (data.favorites || []).map(f => ({ ...f }));
      state.favorites = {};
      items.forEach(f => {
        state.favorites[f.entry ? f.path + '|' + f.entry : f.path] = f;
      });
      grid.dataset.size = state.thumbSize;
      count.textContent = items.length ? `共 ${items.length} 个收藏` : '';
      if (!items.length) {
        grid.innerHTML = '';
        empty.classList.remove('hidden');
        empty.textContent = '暂无收藏，点击图片右下角心形按钮收藏';
        return;
      }
      empty.classList.add('hidden');
      state.imageList = items;
      renderMasonry(items, grid);
    } catch (err) {
      console.error('加载收藏失败', err);
      empty.classList.remove('hidden');
      empty.textContent = err.message || '加载收藏失败';
    }
  }

/* ---------------- Account page ---------------- */
  $('#current-user').addEventListener('click', openAccount);

  function openAccount() {
    const user = state.user || '';
    $('#account-username').textContent = user;
    const avatar = $('#account-view .account-avatar');
    if (avatar) avatar.textContent = (user.charAt(0) || 'A').toUpperCase();
    $('#main-view').classList.add('hidden');
    $('#account-view').classList.remove('hidden');
    $('#lightbox').classList.add('hidden');
    document.body.style.overflow = '';
  }

  function closeAccount() {
    $('#account-view').classList.add('hidden');
    $('#main-view').classList.remove('hidden');
  }

  $('#account-back').addEventListener('click', closeAccount);

function applyThumbSize() {
    const grid = $('#image-grid');
    if (grid) grid.dataset.size = state.thumbSize;
    $$('#thumb-size-group .thumb-size-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.size === state.thumbSize);
    });
  }

  $$('#thumb-size-group .thumb-size-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.thumbSize = btn.dataset.size;
      applyThumbSize();
      if (state.browseData) renderBrowse();
    });
  });

  /* ---------------- Sorting ---------------- */
  $('#sort-by').addEventListener('change', (e) => {
    state.sortBy = e.target.value;
    $('#time-group').classList.toggle('hidden', state.sortBy !== 'time');
    if (state.browseData) openDirectory(state.currentPath, 1);
  });

  $('#sort-order').addEventListener('change', (e) => {
    state.sortOrder = e.target.value;
    if (state.browseData) openDirectory(state.currentPath, 1);
  });

  $('#time-group').addEventListener('change', (e) => {
    state.timeGroup = e.target.value;
    if (state.browseData) renderBrowse();
  });

  /* ---------------- Tree ---------------- */
  function renderTree() {
    const root = $('#tree');
    root.innerHTML = '';
    const ul = document.createElement('div');
    ul.className = 'tree-children';
    ul.style.display = 'block';
    state.tree.forEach((node) => ul.appendChild(buildNode(node)));
    root.appendChild(ul);
  }

  function buildNode(node, depth = 0) {
    const wrapper = document.createElement('div');
    wrapper.className = 'tree-node' + (node.children && node.children.length ? '' : ' leaf');

    const item = document.createElement('div');
    item.className = 'tree-item';
    item.style.paddingLeft = (10 + depth * 16) + 'px';

    const toggle = document.createElement('span');
    toggle.className = 'tree-toggle';
    toggle.innerHTML = icon('treeExpand');
    item.appendChild(toggle);

    const iconEl = document.createElement('span');
    iconEl.className = 'tree-icon';
    iconEl.innerHTML = icon(node.type === 'archive' ? 'archive' : 'folder');
    item.appendChild(iconEl);

    const label = document.createElement('span');
    label.className = 'tree-label';
    label.textContent = node.name;
    item.appendChild(label);

    item.dataset.rel = node.rel;

    item.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (node.type === 'dir' && node.children && node.children.length) {
        wrapper.classList.toggle('open');
        toggle.innerHTML = wrapper.classList.contains('open') ? icon('treeCollapse') : icon('treeExpand');
      }
      selectNode(node);
    });

    wrapper.appendChild(item);

    if (node.children && node.children.length) {
      const children = document.createElement('div');
      children.className = 'tree-children';
      node.children.forEach((c) => children.appendChild(buildNode(c, depth + 1)));
      wrapper.appendChild(children);
    }
    return wrapper;
  }

  async function loadTree() {
    try {
      const data = await api('/api/tree');
      state.tree = data.tree || [];
      renderTree();
    } catch (err) {
      console.error(err);
    }
  }

  function clearActive() {
    $$('.tree-item.active').forEach((el) => el.classList.remove('active'));
  }

  function selectNode(node) {
    clearActive();
    const el = $(`.tree-item[data-rel="${CSS.escape(node.rel)}"]`);
    if (el) {
      el.classList.add('active');
      el.querySelector('.tree-label').classList.add('active');
    }
    state.currentPath = node.rel;
    state.imageList = [];
    if (node.type === 'archive') {
      openArchive(node.rel);
    } else {
      openDirectory(node.rel);
    }
  }

  /* ---------------- Breadcrumb ---------------- */
  function renderBreadcrumb() {
    const bc = $('#breadcrumb');
    bc.innerHTML = '';
    const rootCrumb = document.createElement('span');
    rootCrumb.className = 'crumb';
    rootCrumb.textContent = '根目录';
    rootCrumb.addEventListener('click', () => {
      state.currentPath = '';
      openDirectory('');
    });
    bc.appendChild(rootCrumb);

    if (!state.currentPath) return;

    const parts = state.currentPath.split('/');
    let acc = '';
    parts.forEach((part, i) => {
      const sep = document.createElement('span');
      sep.className = 'sep';
      sep.textContent = '/';
      bc.appendChild(sep);

      acc = acc ? acc + '/' + part : part;
      const crumb = document.createElement('span');
      crumb.className = 'crumb';
      crumb.textContent = part;
      crumb.dataset.path = acc;
      const crumbPath = acc;
      crumb.addEventListener('click', () => {
        state.currentPath = crumbPath;
        openDirectory(crumbPath);
      });
      bc.appendChild(crumb);
    });
  }

  /* ---------------- Browsing ---------------- */
  async function openDirectory(relPath, pageNum = 1) {
    state.currentPath = relPath;
    state.pageNum = pageNum;
    renderBreadcrumb();
    try {
      const data = await api(`/api/browse?path=${encodeURIComponent(relPath || '')}&page=${pageNum}&pageSize=${state.pageSize}&sortBy=${state.sortBy}&sortOrder=${state.sortOrder}`);
      state.totalPages = data.pagination ? data.pagination.totalPages : 1;
      if (data.pagination && data.pagination.pageNum) state.pageNum = data.pagination.pageNum;
      state.browseData = {
        mode: 'dir',
        folders: data.folders || [],
        archives: data.archives || [],
        media: data.media || [],
      };
      renderBrowse();
    } catch (err) {
      showEmpty(err.message);
    }
  }

  function renderPagination() {
    const pag = $('#pagination');
    const data = state.browseData;
    if (!data || data.mode !== 'dir' || state.totalPages <= 1) {
      pag.classList.add('hidden');
      return;
    }
    pag.classList.remove('hidden');
    pag.innerHTML = '';

    const pageSizeSel = document.createElement('select');
    pageSizeSel.className = 'page-size';
    [50, 80, 100].forEach((n) => {
      const opt = document.createElement('option');
      opt.value = n;
      opt.textContent = `${n} / 页`;
      opt.selected = n === state.pageSize;
      pageSizeSel.appendChild(opt);
    });
    pageSizeSel.addEventListener('change', () => {
      state.pageSize = parseInt(pageSizeSel.value, 10);
      state.pageNum = 1;
      openDirectory(state.currentPath, 1);
    });
    pag.appendChild(pageSizeSel);

    const mkBtn = (label, page, cls, disabled) => {
      const btn = document.createElement('button');
      btn.className = 'page-btn' + (cls ? ' ' + cls : '');
      if (typeof label === 'string' && '<' === label[0]) btn.innerHTML = label;
      else btn.textContent = label;
      btn.disabled = !!disabled;
      btn.addEventListener('click', () => openDirectory(state.currentPath, page));
      return btn;
    };

    pag.appendChild(mkBtn(icon('first'), 1, 'page-first', state.pageNum === 1));
    pag.appendChild(mkBtn(icon('prev'), state.pageNum - 1, 'page-prev', state.pageNum === 1));

    const total = state.totalPages;
    const cur = state.pageNum;
    const start = Math.max(1, Math.min(cur - 2, total - 4));
    const end = Math.min(total, start + 4);
    for (let p = start; p <= end; p++) {
      pag.appendChild(mkBtn(String(p), p, p === cur ? 'page-cur' : '', p === cur));
    }

    pag.appendChild(mkBtn(icon('next'), state.pageNum + 1, 'page-next', state.pageNum === total));
    pag.appendChild(mkBtn(icon('last'), total, 'page-last', state.pageNum === total));
  }

  function clearArea() {
    $('#empty-tip').classList.add('hidden');
    $('#folder-grid').innerHTML = '';
    $('#folder-grid').classList.add('hidden');
    $('#archive-grid').innerHTML = '';
    $('#archive-grid').classList.add('hidden');
    $('#image-grid').innerHTML = '';
    if (state.browseData) {
      $('#sortbar').classList.remove('hidden');
    }
  }

  function showEmpty(msg) {
    $('#sortbar').classList.add('hidden');
    $('#pagination').classList.add('hidden');
    $('#empty-tip').textContent = msg;
    $('#empty-tip').classList.remove('hidden');
  }

  function renderBrowse() {
    const data = state.browseData;
    if (!data) return;
    const hasFolders = data.folders.length;
    const hasArchives = data.archives.length;
    const mediaItems = data.media || [];
    const hasMedia = mediaItems.length;

    if (!hasFolders && !hasArchives && !hasMedia) {
      showEmpty('该目录下暂无内容');
      return;
    }
    clearArea();

    const folders = data.folders;
    const archives = data.archives;
    if (hasFolders) {
      $('#folder-grid').classList.remove('hidden');
      renderFolderCards(folders, $('#folder-grid'));
    }
    if (hasArchives) {
      $('#archive-grid').classList.remove('hidden');
      renderFolderCards(archives, $('#archive-grid'));
    }
    if (hasMedia) renderMediaGrid(mediaItems);
    renderPagination();
  }

  function folderCountText(item) {
    const parts = [];
    if (item.imageCount) parts.push(item.imageCount + ' 张图片');
    if (item.videoCount) parts.push(item.videoCount + ' 个视频');
    if (parts.length) return parts.join(' · ');
    return item.count !== undefined ? '空文件夹' : '';
  }

  function renderFolderCards(items, container) {
    items.forEach((item) => {
      const card = document.createElement('div');
      card.className = 'folder-card' + (item.type === 'archive' ? ' archive-card' : '');
      const isArchive = item.type === 'archive';
      card.innerHTML = `
        <div class="icon">${isArchive ? icon('archive') : icon('folder')}</div>
        <div class="name"></div>
        <div class="count">${isArchive ? '压缩包' : folderCountText(item)}</div>
      `;
      card.querySelector('.name').textContent = item.name;
      card.addEventListener('click', () => {
        if (isArchive) {
          openArchive(item.rel);
        } else {
          openDirectory(item.rel);
        }
      });
      container.appendChild(card);
    });
  }

  /* ---------------- Archive browsing ---------------- */
  async function openArchive(relPath) {
    state.currentPath = relPath;
    renderBreadcrumb();
    try {
      const data = await api('/api/archive-images?path=' + encodeURIComponent(relPath) + '&sortBy=' + state.sortBy + '&sortOrder=' + state.sortOrder);
      const mediaItems = (data.media || []).map(m => ({
        type: 'archive', mime: m.mime, path: relPath, entry: m.entry, name: m.name, mtime: m.mtime,
      }));
      state.browseData = { mode: 'archive', folders: [], archives: [], media: mediaItems };
      if (!mediaItems.length) {
        showEmpty('压缩包内没有图片或视频');
        return;
      }
      renderBrowse();
    } catch (err) {
      showEmpty(err.message);
    }
  }

  /* ---------------- Media grid ---------------- */
  function renderMediaGrid(items) {
    state.imageList = items;
    if (state.sortBy === 'time') return renderTimeline(items);
    renderMasonry(items);
  }

  function renderTimeline(items) {
    const groups = groupByTime(items, state.timeGroup);
    const grid = $('#image-grid');
    grid.innerHTML = '';
    grid.classList.add('masonry');
    grid.dataset.size = state.thumbSize;
    let globalIdx = 0;
    groups.forEach(group => {
      const header = document.createElement('div');
      header.className = 'timeline-header';
      header.innerHTML = `<span class="th-date">${formatTimeHeader(group.items[0].mtime, state.timeGroup)}</span><span class="th-count">${group.items.length} 个文件</span><span class="th-line"></span>`;
      grid.appendChild(header);
      const row = document.createElement('div');
      row.className = 'timeline-row masonry';
      row.dataset.size = state.thumbSize;
      const width = grid.clientWidth || 800;
      const size = LAYOUT_SIZES[state.thumbSize];
      const gap = MASONRY_GAP;
      const cols = Math.max(2, Math.min(8, Math.floor((width + gap) / (size + gap))));
      const colWidth = (width - gap * (cols - 1)) / cols;
      const columns = [];
      const colHeights = new Array(cols).fill(0);
      for (let i = 0; i < cols; i++) {
        const col = document.createElement('div');
        col.className = 'masonry-col';
        col.style.flex = '0 0 ' + colWidth + 'px';
        columns.push(col);
        row.appendChild(col);
      }
      group.items.forEach((item, idx) => {
        const box = createThumbBox(item, globalIdx++);
        box.style.aspectRatio = '1 / 1';
        const si = colHeights.indexOf(Math.min(...colHeights));
        columns[si].appendChild(box);
        colHeights[si] += colWidth + gap;
      });
      grid.appendChild(row);
    });
    lazyLoad();
  }

  function renderMasonry(items, targetGrid) {
    state.imageList = items;
    const grid = targetGrid || $('#image-grid');
    grid.classList.add('masonry');
    grid.dataset.size = state.thumbSize;
    grid.innerHTML = '';
    const width = grid.clientWidth || 800;
    const size = LAYOUT_SIZES[state.thumbSize];
    const gap = MASONRY_GAP;
    const cols = Math.max(2, Math.min(8, Math.floor((width + gap) / (size + gap))));
    const colWidth = (width - gap * (cols - 1)) / cols;
    const columns = [];
    const colHeights = new Array(cols).fill(0);
    for (let i = 0; i < cols; i++) {
      const col = document.createElement('div');
      col.className = 'masonry-col';
      col.style.flex = '0 0 ' + colWidth + 'px';
      columns.push(col);
      grid.appendChild(col);
    }
    items.forEach((item, idx) => {
      const box = createThumbBox(item, idx);
      box.style.aspectRatio = '1 / 1';
      const si = colHeights.indexOf(Math.min(...colHeights));
      columns[si].appendChild(box);
      colHeights[si] += colWidth + gap;
    });
    lazyLoad();
  }

  function createThumbBox(item, idx) {
    const box = document.createElement('div');
    box.className = 'thumb-box loading';
    const img = document.createElement('img');
    img.loading = 'lazy';
    img.alt = item.name;
    img.dataset.thumb = thumbUrl(item);
    img.addEventListener('load', () => {
      box.classList.remove('loading');
      box.style.aspectRatio = '';
    });
    img.addEventListener('error', () => {
      box.classList.remove('loading');
      box.style.aspectRatio = '';
      box.style.background = '#e0d8c8';
    });

    const name = document.createElement('div');
    name.className = 'thumb-name';
    name.textContent = item.name;
    box.appendChild(img);
    box.appendChild(name);

    const fav = document.createElement('button');
    fav.className = 'fav-btn';
    fav.title = '收藏';
    fav.innerHTML = icon('heart');
    fav.dataset.favKey = favKey(item);
    if (isFavored(fav.dataset.favKey)) {
      fav.classList.add('fav-on');
    }
    fav.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleFav(item, fav);
    });
    box.appendChild(fav);

    if (item.mime === 'video') {
      const badge = document.createElement('div');
      badge.className = 'video-badge';
      badge.innerHTML = icon('videoBadge');
      box.appendChild(badge);
      box.classList.add('video-box');
    }

    box.addEventListener('click', () => openLightbox(idx));
    return box;
  }

  const lazyLoad = window.MV.createLazyLoader({ rootMargin: '200px' });

  /* ---------------- Lightbox ---------------- */
  function openLightbox(index) {
    state.lbIndex = index;
    $('#lightbox').classList.remove('hidden', 'video-playing');
    document.body.style.overflow = 'hidden';
    hideInfoPanel();
    resetZoom();
    updateLightbox();
  }

  function closeLightbox() {
    stopVideo();
    $('#lightbox').classList.remove('video-playing');
    $('#lightbox').classList.add('hidden');
    $('#lb-img').src = '';
    document.body.style.overflow = '';
    hideInfoPanel();
    resetZoom();
  }

  function updateLightbox() {
    const item = state.imageList[state.lbIndex];
    if (!item) return;
    

    if (item.mime === 'video') {
      $('#lb-img').classList.add('hidden');
      $('#lb-video-wrap').classList.remove('hidden');
      $('#lb-zoom-toggle').classList.add('hidden');
      $('#lb-download').classList.add('hidden');
      $('#lb-prev').classList.add('hidden');
      $('#lb-next').classList.add('hidden');
      $('#lightbox').classList.remove('video-playing');
      vcCenter.classList.remove('hidden');
      const video = $('#lb-video');
      stopVideo();
      video.src = videoUrl(item);
      video.load();
      video.play().catch(() => {});
    } else {
      stopVideo();
      $('#lb-video-wrap').classList.add('hidden');
      $('#lb-img').classList.remove('hidden');
      $('#lb-zoom-toggle').classList.remove('hidden');
      $('#lb-download').classList.remove('hidden');
      $('#lb-prev').classList.remove('hidden');
      $('#lb-next').classList.remove('hidden');
      $('#lb-img').src = rawUrl(item);
    }
    resetZoom();
    if (!isInfoPanelHidden()) renderInfoPanel();
    updateLightboxFav();
  }

  function downloadCurrent() {
    const item = state.imageList[state.lbIndex];
    if (!item || item.mime === 'video') return;
    const url = rawUrl(item);
    const a = document.createElement('a');
    a.href = url;
    a.download = item.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  function updateLightboxFav() {
    const item = state.imageList && state.imageList[state.lbIndex];
    const btn = $('#lb-fav');
    if (!item) return;
    const key = favKey(item);
    const on = isFavored(key);
    btn.innerHTML = icon('heart');
    btn.classList.toggle('fav-on', on);
  }

  function toggleLightboxFav() {
    const item = state.imageList && state.imageList[state.lbIndex];
    if (!item) return;
    toggleFav(item, null);
  }

  function stopVideo() {
    const video = $('#lb-video');    try {
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      }
      if (document.pictureInPictureElement === video) {
        document.exitPictureInPicture().catch(() => {});
      }
    } catch (err) {
      console.error(err);
    }
    try {
      video.pause();
      video.removeAttribute('src');
      video.load();
    } catch (err) {
      console.error(err);
    }
    $('#vc-progress-fill').style.width = '0%';
  }

  /* ---------------- Info panel ---------------- */
  function isInfoPanelHidden() {
    return $('#lb-info-panel').classList.contains('hidden');
  }

  function hideInfoPanel() {
    $('#lb-info-panel').classList.add('hidden');
  }

  function showInfoPanel() {
    $('#lb-info-panel').classList.remove('hidden');
    renderInfoPanel();
  }

  function toggleInfoPanel() {
    if (isInfoPanelHidden()) showInfoPanel();
    else hideInfoPanel();
  }

  async function renderInfoPanel() {
    const item = state.imageList[state.lbIndex];
    if (!item) return;
    $('#lb-info-loading').classList.remove('hidden');
    $('#lb-info-error').classList.add('hidden');
    $('#lb-info-fields').classList.add('hidden');
    $('#lb-info-fields').innerHTML = '';
    try {
      let q = 'path=' + encodeURIComponent(item.path);
      if (item.entry) q += '&entry=' + encodeURIComponent(item.entry);
      const info = await api('/api/info?' + q);
      renderInfoFields(info, item);
    } catch (err) {
      $('#lb-info-loading').classList.add('hidden');
      $('#lb-info-error').textContent = err.message;
      $('#lb-info-error').classList.remove('hidden');
    }
  }

  function fmtTime(s) {
    if (!isFinite(s) || s < 0) s = 0;
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${String(sec).padStart(2, '0')}`;
  }

  function infoRow(label, value) {
    const row = document.createElement('div');
    row.className = 'info-row';
    const l = document.createElement('span');
    l.className = 'info-label';
    l.textContent = label;
    const v = document.createElement('span');
    v.className = 'info-value';
    v.textContent = value;
    row.appendChild(l);
    row.appendChild(v);
    return row;
  }

  function renderInfoFields(info, item) {
    const fields = $('#lb-info-fields');
    fields.innerHTML = '';
    $('#lb-info-title').textContent = info.type === 'video' ? '视频信息' : '图片信息';

    const typeText = info.type === 'video' ? '视频' : '图片';
    let pathText = info.path || '-';
    if (info.location === 'archive' && info.archiveName) {
      pathText = info.archiveName + ' / ' + info.entry;
    }

    fields.appendChild(infoRow('文件名', info.name || '-'));
    fields.appendChild(infoRow('路径', pathText));
    fields.appendChild(infoRow('类型', typeText));
    fields.appendChild(infoRow('大小', info.sizeText || '-'));

    let dim = '-';
      if (info.width && info.height) dim = `${info.width} x ${info.height}`;
      fields.appendChild(infoRow('尺寸', dim));

    if (info.type === 'video') {
      const videoEl = $('#lb-video');
      const dur = isFinite(videoEl.duration) && videoEl.duration > 0 ? fmtTime(videoEl.duration) : null;
      if (dur) {
        fields.appendChild(infoRow('时长', dur));
      } else {
        fields.appendChild(infoRow('时长', '加载中...'));
        if (pendingMetaItem !== item) {
          pendingMetaItem = item;
          videoEl.addEventListener('loadedmetadata', () => {
            pendingMetaItem = null;
            if (!isInfoPanelHidden() && state.imageList[state.lbIndex] === item) renderInfoFields(info, item);
          }, { once: true });
        }
      }
    }

    fields.appendChild(infoRow('修改时间', info.mtimeText || '-'));

    $('#lb-info-loading').classList.add('hidden');
    fields.classList.remove('hidden');
  }

  function nextImage() {
    if (!state.imageList.length) return;
    state.lbIndex = (state.lbIndex + 1) % state.imageList.length;
    updateLightbox();
  }

  function prevImage() {
    if (!state.imageList.length) return;
    state.lbIndex = (state.lbIndex - 1 + state.imageList.length) % state.imageList.length;
    updateLightbox();
  }

  $('#lb-close').addEventListener('click', closeLightbox);
  $('#lb-next').addEventListener('click', nextImage);
  $('#lb-prev').addEventListener('click', prevImage);
  $('#lb-info-toggle').addEventListener('click', toggleInfoPanel);
  $('#lb-download').addEventListener('click', downloadCurrent);
  $('#lb-fav').addEventListener('click', toggleLightboxFav);

  /* ---------------- Zoom & pan ---------------- */
  const lbImg = $('#lb-img');
  const navEl = $('#lb-navigator');
  let zoomDrag = null;
  let navDrag = null;

  function resetZoom() {
    state.zoom = false;
    state.zoomX = 0;
    state.zoomY = 0;
    lbImg.classList.remove('zoomed', 'dragging');
    lbImg.style.width = '';
    lbImg.style.height = '';
    lbImg.style.transform = '';
    $('#lb-zoom-toggle').title = '放大到原始大小';
    $('#lb-zoom-ico').innerHTML = icon('zoomIn');
    navEl.classList.add('hidden');
  }

  function clampZoom() {
    const stage = $('.lightbox-stage');
    const natW = lbImg.naturalWidth;
    const natH = lbImg.naturalHeight;
    const stageW = stage.clientWidth;
    const stageH = stage.clientHeight;
    if (natW <= stageW) state.zoomX = (stageW - natW) / 2;
    else state.zoomX = Math.max(Math.min(0, stageW - natW), Math.min(0, state.zoomX));
    if (natH <= stageH) state.zoomY = (stageH - natH) / 2;
    else state.zoomY = Math.max(Math.min(0, stageH - natH), Math.min(0, state.zoomY));
  }

  function applyZoom() {
    lbImg.style.transform = `translate(${state.zoomX}px, ${state.zoomY}px)`;
    renderNavigator();
  }

  function renderNavigator() {
    const stage = $('.lightbox-stage');
    const navW = navEl.clientWidth;
    const navH = navEl.clientHeight;
    const natW = lbImg.naturalWidth;
    const natH = lbImg.naturalHeight;
    if (!natW || !natH) return;
    const scale = Math.min(navW / natW, navH / natH);
    const rW = natW * scale;
    const rH = natH * scale;
    const ox = (navW - rW) / 2;
    const oy = (navH - rH) / 2;
    const navImg = $('#lb-nav-img');
    navImg.style.width = `${rW}px`;
    navImg.style.height = `${rH}px`;
    navImg.style.left = `${ox}px`;
    navImg.style.top = `${oy}px`;
    const stageW = stage.clientWidth;
    const stageH = stage.clientHeight;
    let vx = ox + (-state.zoomX) * scale;
    let vy = oy + (-state.zoomY) * scale;
    let vw = stageW * scale;
    let vh = stageH * scale;
    vw = Math.min(vw, rW);
    vh = Math.min(vh, rH);
    vx = Math.max(ox, Math.min(vx, ox + rW - vw));
    vy = Math.max(oy, Math.min(vy, oy + rH - vh));
    const vp = $('#lb-nav-viewport');
    vp.style.left = `${vx}px`;
    vp.style.top = `${vy}px`;
    vp.style.width = `${vw}px`;
    vp.style.height = `${vh}px`;
  }

  function jumpToView(clientX, clientY) {
    const rect = navEl.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const navW = navEl.clientWidth;
    const navH = navEl.clientHeight;
    const natW = lbImg.naturalWidth;
    const natH = lbImg.naturalHeight;
    const scale = Math.min(navW / natW, navH / natH);
    const rW = natW * scale;
    const rH = natH * scale;
    const ox = (navW - rW) / 2;
    const oy = (navH - rH) / 2;
    const imgX = (x - ox) / scale;
    const imgY = (y - oy) / scale;
    const stage = $('.lightbox-stage');
    state.zoomX = stage.clientWidth / 2 - imgX;
    state.zoomY = stage.clientHeight / 2 - imgY;
    clampZoom();
    applyZoom();
  }

  function toggleZoom() {
    if (!state.zoom) {
      const natW = lbImg.naturalWidth;
      const natH = lbImg.naturalHeight;
      if (!natW || !natH) return;
      state.zoom = true;
      lbImg.classList.add('zoomed');
      lbImg.style.width = `${natW}px`;
      lbImg.style.height = `${natH}px`;
      const stage = $('.lightbox-stage');
      state.zoomX = (stage.clientWidth - natW) / 2;
      state.zoomY = (stage.clientHeight - natH) / 2;
      $('#lb-zoom-toggle').title = '缩放适配屏幕';
      $('#lb-zoom-ico').innerHTML = icon('zoomOut');
      $('#lb-nav-img').src = lbImg.src;
      navEl.classList.remove('hidden');
      clampZoom();
      applyZoom();
    } else {
      resetZoom();
    }
  }

  $('#lb-zoom-toggle').addEventListener('click', toggleZoom);

  lbImg.addEventListener('pointerdown', (e) => {
    if (!state.zoom) return;
    e.preventDefault();
    zoomDrag = { x: e.clientX, y: e.clientY, ox: state.zoomX, oy: state.zoomY };
    lbImg.classList.add('dragging');
    lbImg.setPointerCapture(e.pointerId);
  });

  lbImg.addEventListener('pointermove', (e) => {
    if (!zoomDrag) return;
    state.zoomX = zoomDrag.ox + (e.clientX - zoomDrag.x);
    state.zoomY = zoomDrag.oy + (e.clientY - zoomDrag.y);
    clampZoom();
    applyZoom();
  });

  lbImg.addEventListener('pointerup', () => {
    zoomDrag = null;
    lbImg.classList.remove('dragging');
  });

  lbImg.addEventListener('pointercancel', () => {
    zoomDrag = null;
    lbImg.classList.remove('dragging');
  });

  navEl.addEventListener('pointerdown', (e) => {
    if (!state.zoom) return;
    e.preventDefault();
    navDrag = e.pointerId;
    navEl.setPointerCapture(e.pointerId);
    jumpToView(e.clientX, e.clientY);
  });

  navEl.addEventListener('pointermove', (e) => {
    if (navDrag === null) return;
    jumpToView(e.clientX, e.clientY);
  });

  navEl.addEventListener('pointerup', () => { navDrag = null; });
  navEl.addEventListener('pointercancel', () => { navDrag = null; });

  window.addEventListener('resize', () => {
    if (!state.zoom) return;
    clampZoom();
    applyZoom();
  });

  /* ---------------- Video player UI ---------------- */
  const video = $('#lb-video');
  const videoWrap = $('#lb-video-wrap');
  const vcCenter = $('#vc-center');
  const vcProgressFill = $('#vc-progress-fill');

  function syncVideoUI() {
    const playing = !video.paused;
    $('#lightbox').classList.toggle('video-playing', playing);
    vcCenter.classList.toggle('hidden', playing);
    if (playing) {
      vcProgressFill.style.width = video.duration ? ((video.currentTime / video.duration) * 100) + '%' : '0%';
    }
  }

  video.addEventListener('play', syncVideoUI);
  video.addEventListener('pause', syncVideoUI);

  video.addEventListener('timeupdate', () => {
    if (!video.duration) return;
    vcProgressFill.style.width = (video.currentTime / video.duration) * 100 + '%';
  });

  video.addEventListener('loadedmetadata', () => {
    vcProgressFill.style.width = '0%';
  });

  videoWrap.addEventListener('click', (e) => {
    if (e.target.closest('.vc-fullscreen-btn') || e.target.closest('.vc-progress-bar')) return;
    if (video.paused) video.play();
    else video.pause();
  });

  video.addEventListener('dblclick', () => {
    const target = $('#lightbox');
    if (document.fullscreenElement) document.exitFullscreen();
    else if (document.fullscreenEnabled) target.requestFullscreen();
  });

  /* 进度条点击跳转 */
  const progressBar = $('#vc-progress-bar');
  progressBar.addEventListener('click', (e) => {
    if (!video.duration) return;
    const rect = progressBar.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const pct = Math.max(0, Math.min(1, x / rect.width));
    video.currentTime = pct * video.duration;
    vcProgressFill.style.width = pct * 100 + '%';
  });

  /* 全屏按钮 */
  $('#vc-fullscreen').addEventListener('click', () => {
    const target = $('#lightbox');
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else if (target.requestFullscreen) {
      target.requestFullscreen();
    }
  });

  document.addEventListener('keydown', (e) => {
    if ($('#lightbox').classList.contains('hidden')) return;
    if ($('#lb-video-wrap').classList.contains('hidden')) {
      if (e.key === 'Escape') closeLightbox();
      else if (e.key === 'ArrowRight') nextImage();
      else if (e.key === 'ArrowLeft') prevImage();
      return;
    }
    if (e.key === 'Escape') {
      if (document.fullscreenElement) document.exitFullscreen();
      else closeLightbox();
    } else if (e.key === ' ') {
      e.preventDefault();
      if (video.paused) video.play();
      else video.pause();
    } else if (e.key === 'ArrowRight') { video.currentTime = Math.min(video.duration, video.currentTime + 5); }
    else if (e.key === 'ArrowLeft') { video.currentTime = Math.max(0, video.currentTime - 5); }
  });

  $('#lightbox').addEventListener('click', (e) => {
    if (e.target === $('#lightbox') || e.target.id === 'lightbox') closeLightbox();
  });

  /* ---------------- Init ---------------- */
  initIcons();
  (async () => {
    try {
      const v = await fetch('/api/version').then(r => r.json());
      if (v.version) {
        $('#login-version').textContent = v.version;
        $('#top-version').textContent = v.version;
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
