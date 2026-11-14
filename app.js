/* White Elephant Exchange — a static, single-page host app.
 * State (players, gifts, game progress) lives in localStorage.
 * Photos live in IndexedDB as Blobs. Nothing leaves the browser. */
(() => {
  'use strict';

  // ---------------------------------------------------------------- constants
  const LS_KEY = 'white-elephant/state/v1';
  const VIEW_KEY = 'white-elephant/view';
  const HISTORY_MAX = 50;
  const LOG_MAX = 150;
  const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // [paper, ribbon, pattern dots]
  const PALETTE = [
    ['#b3263a', '#f3c95b', 'rgba(255,255,255,.16)'],
    ['#1d6b4f', '#f4e9d8', 'rgba(255,255,255,.13)'],
    ['#25478a', '#e9b949', 'rgba(255,255,255,.14)'],
    ['#6c3483', '#f6d47e', 'rgba(255,255,255,.14)'],
    ['#c4572a', '#fff3dc', 'rgba(255,255,255,.16)'],
    ['#0f6b75', '#f2a7b5', 'rgba(255,255,255,.14)'],
    ['#8f1f4f', '#ffe08a', 'rgba(255,255,255,.14)'],
    ['#2f4f2a', '#e05a5a', 'rgba(255,255,255,.12)'],
    ['#efe3cc', '#b3263a', 'rgba(179,38,58,.16)'],
    ['#1b1f3b', '#c9d6ff', 'rgba(255,255,255,.12)'],
  ];

  const ICON = {
    plus: '<path d="M12 5v14M5 12h14"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/>',
    download: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>',
    upload: '<path d="M12 21V9"/><path d="m7 14 5-5 5 5"/><path d="M5 3h14"/>',
    trash: '<path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="M6 7l1 13h10l1-13"/><path d="M9 7V4h6v3"/>',
    sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 17v4M17 19h4"/>',
    undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
    shuffle: '<path d="M16 3h5v5"/><path d="M4 20 21 3"/><path d="M21 16v5h-5"/><path d="m15 15 6 6"/><path d="M4 4l5 5"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    more: '<circle cx="5" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="19" cy="12" r="1.6" fill="currentColor"/>',
    up: '<path d="m6 15 6-6 6 6"/>',
    down: '<path d="m6 9 6 6 6-6"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    skip: '<path d="m5 4 10 8-10 8z"/><path d="M19 5v14"/>',
    flag: '<path d="M5 21V4"/><path d="M5 4h11l-2 4 2 4H5"/>',
  };
  const icon = (name, cls = '') =>
    `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name] || ''}</svg>`;

  // ---------------------------------------------------------------- helpers
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
  const plural = (n, w, p = w + 's') => `${n} ${n === 1 ? w : p}`;
  const shuffleArr = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const slug = (s) => (String(s || 'white-elephant').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'white-elephant');
  const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); return true; } catch { return false; } };
  // Wrap an async job so a second click while it's running is ignored.
  let busy = false;
  const exclusive = (fn) => async (...args) => {
    if (busy) { toast('Hang on — still working on the last thing…'); return; }
    busy = true;
    try { return await fn(...args); } finally { busy = false; }
  };
  const blobToDataURL = (b) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(b); });

  // ---------------------------------------------------------------- image store (IndexedDB)
  const idb = (() => {
    let dbp = null;
    const open = () => {
      if (!dbp) {
        dbp = new Promise((resolve, reject) => {
          if (!('indexedDB' in window)) return reject(new Error('IndexedDB unavailable'));
          const req = indexedDB.open('white-elephant', 1);
          req.onupgradeneeded = () => req.result.createObjectStore('images');
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
      }
      return dbp;
    };
    const run = (mode, fn) => open().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction('images', mode);
      fn(tx.objectStore('images'));
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () => reject(tx.error);
    }));
    return {
      put: (k, v) => run('readwrite', (s) => s.put(v, k)),
      del: (k) => run('readwrite', (s) => s.delete(k)),
      clear: () => run('readwrite', (s) => s.clear()),
      all: () => open().then((db) => new Promise((resolve, reject) => {
        const out = [];
        const tx = db.transaction('images', 'readonly');
        const req = tx.objectStore('images').openCursor();
        req.onsuccess = () => { const c = req.result; if (c) { out.push([c.key, c.value]); c.continue(); } };
        tx.oncomplete = () => resolve(out);
        tx.onerror = () => reject(tx.error);
      })),
    };
  })();

  const blobs = new Map(); // key -> Blob     keys look like "box:<giftId>" / "gift:<giftId>"
  const urls = new Map();  // key -> object URL
  let storageWarned = false;

  function setLocalImage(key, blob) {
    if (urls.has(key)) URL.revokeObjectURL(urls.get(key));
    blobs.set(key, blob);
    urls.set(key, URL.createObjectURL(blob));
  }
  function dropLocalImage(key) {
    if (urls.has(key)) URL.revokeObjectURL(urls.get(key));
    urls.delete(key);
    blobs.delete(key);
  }
  async function saveImage(key, blob) {
    setLocalImage(key, blob);
    try { await idb.put(key, blob); } catch {
      if (!storageWarned) { storageWarned = true; toast('This browser blocked photo storage — photos will vanish if you reload.', 'warn'); }
    }
    state.imgRev = (state.imgRev || 0) + 1;
    save();
  }
  async function deleteImage(key) {
    dropLocalImage(key);
    try { await idb.del(key); } catch { /* ignore */ }
    state.imgRev = (state.imgRev || 0) + 1;
    save();
  }
  async function loadImages() {
    try {
      const rows = await idb.all();
      const live = new Set();
      for (const [k, v] of rows) { if (v instanceof Blob) { live.add(k); setLocalImage(k, v); } }
      for (const k of [...urls.keys()]) if (!live.has(k)) dropLocalImage(k);
    } catch { /* keep whatever is in memory */ }
  }

  async function processImage(file) {
    const looksImage = /^image\//.test(file.type) || /\.(jpe?g|png|gif|webp|heic|heif|avif)$/i.test(file.name || '');
    if (!looksImage) throw new Error('That file isn’t an image.');
    if (file.type === 'image/gif' || file.type === 'image/svg+xml') {
      if (file.size > 8e6) throw new Error('That GIF is over 8 MB — try a smaller one.');
      return file; // keep animation / vectors as-is
    }
    const img = await new Promise((resolve, reject) => {
      const u = URL.createObjectURL(file);
      const im = new Image();
      im.onload = () => { URL.revokeObjectURL(u); resolve(im); };
      im.onerror = () => { URL.revokeObjectURL(u); reject(new Error('This browser can’t read that image. Try a JPG or PNG.')); };
      im.src = u;
    });
    const MAX = 1400;
    const w0 = img.naturalWidth, h0 = img.naturalHeight;
    const scale = Math.min(1, MAX / Math.max(w0, h0));
    if (scale === 1 && file.size < 900e3 && /jpeg|png|webp/.test(file.type)) return file;
    const w = Math.round(w0 * scale), h = Math.round(h0 * scale);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    const png = file.type === 'image/png';
    if (!png) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); }
    ctx.drawImage(img, 0, 0, w, h);
    return new Promise((resolve) => c.toBlob((b) => resolve(b || file), png ? 'image/png' : 'image/jpeg', 0.86));
  }

  // ---------------------------------------------------------------- state
  const freshState = () => ({
    v: 1,
    title: 'White Elephant',
    settings: { maxSteals: 3, noStealBack: true, finalSwap: true },
    participants: [], // { id, name } — array order is the turn order
    gifts: [],        // { id, name, color }
    game: null,       // see startGame()
    history: [],      // JSON snapshots of `game` for undo
    imgRev: 0,
  });

  function loadState() {
    try {
      const raw = lsGet(LS_KEY);
      if (raw) {
        const s = JSON.parse(raw);
        if (s && s.v === 1) {
          const f = freshState();
          return { ...f, ...s, settings: { ...f.settings, ...(s.settings || {}) } };
        }
      }
    } catch { /* fall through */ }
    return freshState();
  }

  let state = loadState();
  let lastSaved = '';
  let saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    const raw = JSON.stringify(state);
    lastSaved = raw;
    if (!lsSet(LS_KEY, raw)) toast('Couldn’t save — this browser’s storage is full or blocked.', 'warn');
  }
  function saveSoon() { clearTimeout(saveTimer); saveTimer = setTimeout(save, 250); }

  // ---------------------------------------------------------------- game model
  const giftById = (id) => state.gifts.find((g) => g.id === id);
  const giftNum = (id) => state.gifts.findIndex((g) => g.id === id) + 1;
  const person = (id) => state.participants.find((p) => p.id === id);
  const pName = (id) => person(id)?.name?.trim() || 'Someone';
  const giftLabel = (id) => giftById(id)?.name?.trim() || `Gift #${giftNum(id)}`;
  const BLANK = Object.freeze({ opened: false, owner: null, steals: 0 });
  const gs = (id) => state.game?.gifts?.[id] || BLANK;                                  // read
  const gsm = (id) => (state.game.gifts[id] ||= { opened: false, owner: null, steals: 0 }); // write
  const holdings = (pid) => state.gifts.filter((g) => gs(g.id).owner === pid).map((g) => g.id);
  const unopened = () => state.gifts.filter((g) => !gs(g.id).opened).map((g) => g.id);
  const maxSteals = () => Math.max(0, parseInt(state.settings.maxSteals, 10) || 0);
  const isLocked = (id) => maxSteals() > 0 && gs(id).steals >= maxSteals();
  const canSteal = (pid, id) => {
    const s = gs(id);
    return !!(state.game && s.opened && s.owner && s.owner !== pid && !isLocked(id) && id !== state.game.blocked);
  };
  const stealables = (pid) => state.gifts.filter((g) => canSteal(pid, g.id)).map((g) => g.id);
  function hasMoves(pid) {
    const g = state.game;
    if (!g || !pid) return false;
    if (g.phase === 'playing' && !holdings(pid).length && unopened().length) return true;
    return stealables(pid).length > 0;
  }
  function nextOfficialIndex() {
    const g = state.game;
    let i = g.turn + 1;
    while (i < g.order.length && holdings(g.order[i]).length) i++;
    return i < g.order.length ? i : -1;
  }

  function log(text) {
    const g = state.game;
    g.log.push({ t: Date.now(), text });
    if (g.log.length > LOG_MAX) g.log.splice(0, g.log.length - LOG_MAX);
  }

  function finish() {
    const g = state.game;
    g.phase = 'over'; g.active = null; g.blocked = null;
    log('Game over — enjoy your gifts!');
  }

  // Hand the turn to the next player in order who doesn't already hold a gift.
  function nextTurn() {
    const g = state.game;
    g.blocked = null;
    let i = g.turn + 1;
    while (i < g.order.length && holdings(g.order[i]).length) i++;
    if (i < g.order.length && unopened().length) {
      g.turn = i; g.active = g.order[i]; g.reason = 'turn'; g.phase = 'playing';
      return;
    }
    g.turn = g.order.length;
    const first = g.order[0];
    const firstHeld = first ? holdings(first) : [];
    // a locked gift stays with its owner, so player 1 can only swap an unlocked one away
    if (state.settings.finalSwap && firstHeld.length && !firstHeld.some(isLocked) && stealables(first).length) {
      g.phase = 'final'; g.active = first; g.reason = 'final';
      log(`Final round: ${pName(first)} may swap with anyone.`);
    } else {
      finish();
    }
  }

  function normalizeGame() {
    const g = state.game;
    if (!g) return;
    const ids = new Set(state.participants.map((p) => p.id));
    g.order = g.order.filter((id) => ids.has(id));
    for (const p of state.participants) if (!g.order.includes(p.id)) g.order.push(p.id);
    for (const [gid, s] of Object.entries(g.gifts)) {
      if (!giftById(gid)) delete g.gifts[gid];
      else if (s.owner && !ids.has(s.owner)) s.owner = null;
    }
    if (g.active && !ids.has(g.active)) g.active = null;
  }

  // Every game mutation goes through commit() so it can be undone.
  function commit(fn) {
    state.history.push(JSON.stringify(state.game));
    if (state.history.length > HISTORY_MAX) state.history.splice(0, state.history.length - HISTORY_MAX);
    fn();
    normalizeGame();
    save();
    render();
  }
  function undo() {
    if (!state.history.length) return toast('Nothing to undo.');
    state.game = JSON.parse(state.history.pop());
    normalizeGame();
    save();
    render();
    toast('Undid the last move.');
  }

  // ---------------------------------------------------------------- game actions
  const seen = new Set(); // lastEvent ids already shown in this tab

  function startGame() {
    const P = state.participants.length, G = state.gifts.length;
    if (P < 2) return toast('Add at least two players first.');
    if (!G) return toast('Add at least one gift first.');
    const go = () => commit(() => {
      state.game = {
        phase: 'playing', order: state.participants.map((p) => p.id), turn: -1,
        active: null, reason: 'turn', blocked: null, gifts: {}, log: [], lastEvent: null,
      };
      log('Game started.');
      nextTurn();
    });
    if (P !== G) {
      openModal({
        title: 'Numbers don’t match',
        body: `<p>You have <b>${plural(P, 'player')}</b> and <b>${plural(G, 'gift')}</b>. ${P > G
          ? 'The game ends when the last gift is opened, so some players won’t get a turn.'
          : 'Extra gifts will stay wrapped once everyone has had a turn.'}</p>`,
        actions: [{ label: 'Cancel', ghost: true }, { label: 'Start anyway', primary: true, onClick: go }],
      });
    } else go();
  }

  function doOpen(id) {
    const a = state.game.active;
    const ev = { id: uid(), type: 'open', gift: id, by: a, at: Date.now() };
    commit(() => {
      const s = gsm(id);
      s.opened = true; s.owner = a;
      log(`${pName(a)} opened #${giftNum(id)}: ${giftLabel(id)}`);
      nextTurn();
      state.game.lastEvent = ev;
    });
    seen.add(ev.id);
    playEvent(ev);
  }

  function doSteal(id) {
    const g = state.game;
    const thief = g.active, victim = gs(id).owner, final = g.phase === 'final';
    const ev = { id: uid(), type: 'steal', gift: id, by: thief, from: victim, at: Date.now() };
    commit(() => {
      const s = gsm(id);
      const given = holdings(thief).filter((h) => h !== id);
      s.owner = thief;
      s.steals += 1;
      ev.locked = isLocked(id);
      if (given.length) {
        // Thief already had something (final round): it's a swap.
        given.forEach((h) => { gsm(h).owner = victim; });
        ev.type = 'swap'; ev.given = given;
        log(`${pName(thief)} swapped ${given.map(giftLabel).join(' + ')} for ${giftLabel(id)} with ${pName(victim)}`);
        if (final) finish(); else nextTurn();
      } else {
        log(`${pName(thief)} stole ${giftLabel(id)} from ${pName(victim)}${ev.locked ? ' — it’s now locked' : ''}`);
        g.active = victim; g.reason = 'robbed';
        g.blocked = state.settings.noStealBack ? id : null;
      }
      state.game.lastEvent = ev;
    });
    seen.add(ev.id);
    playEvent(ev);
  }

  function applyAssign(id, owner, steals) {
    const before = gs(id);
    if (owner === before.owner && steals === before.steals) return;
    const ev = owner && !before.opened ? { id: uid(), type: 'open', gift: id, by: owner, at: Date.now() } : null;
    commit(() => {
      const g = state.game;
      const s = gsm(id);
      s.owner = owner; s.opened = !!owner; s.steals = steals;
      log(owner ? `Host gave ${giftLabel(id)} (#${giftNum(id)}) to ${pName(owner)}` : `Host re-wrapped gift #${giftNum(id)}`);
      if (g.phase === 'playing' && g.active && holdings(g.active).length) nextTurn();
      if (ev) g.lastEvent = ev;
    });
    if (ev) { seen.add(ev.id); playEvent(ev); }
  }

  // ---------------------------------------------------------------- media
  function boxSVG(gift, uniq = '') {
    const [paper, ribbon, dot] = PALETTE[(gift.color || 0) % PALETTE.length];
    const pid = `pt-${gift.id}-${uniq}`;
    return `<svg class="box-svg" viewBox="0 0 200 200" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <pattern id="${pid}" width="22" height="22" patternUnits="userSpaceOnUse" patternTransform="rotate(30)">
          <circle cx="5" cy="5" r="2.4" fill="${dot}"/><circle cx="16" cy="16" r="1.5" fill="${dot}"/>
        </pattern>
        <radialGradient id="${pid}-sh" cx="30%" cy="22%" r="95%">
          <stop offset="0" stop-color="#fff" stop-opacity=".16"/><stop offset="1" stop-color="#000" stop-opacity=".28"/>
        </radialGradient>
      </defs>
      <rect width="200" height="200" fill="${paper}"/>
      <rect width="200" height="200" fill="url(#${pid})"/>
      <rect x="87" width="26" height="200" fill="${ribbon}"/>
      <rect y="87" width="200" height="26" fill="${ribbon}"/>
      <rect x="87" width="3" height="200" fill="#000" opacity=".08"/>
      <rect y="87" width="200" height="3" fill="#000" opacity=".08"/>
      <g transform="translate(100 100)" stroke="rgba(0,0,0,.18)" stroke-width="2" fill="${ribbon}">
        <path d="M-3 4 L-24 46 L-13 42 L-7 53 L3 7Z"/>
        <path d="M3 4 L24 46 L13 42 L7 53 L-3 7Z"/>
        <path d="M0 0 C-20 -38 -66 -32 -55 -6 C-49 9 -18 8 0 0Z"/>
        <path d="M0 0 C20 -38 66 -32 55 -6 C49 9 18 8 0 0Z"/>
        <circle r="11"/>
      </g>
      <rect width="200" height="200" fill="url(#${pid}-sh)"/>
    </svg>`;
  }
  function boxMedia(gift, uniq = '') {
    const u = urls.get('box:' + gift.id);
    return u ? `<img src="${u}" alt="" draggable="false">` : boxSVG(gift, uniq);
  }
  function giftMedia(gift, large = false) {
    const u = urls.get('gift:' + gift.id);
    const label = esc(giftLabel(gift.id));
    if (u) {
      return large
        ? `<img class="blurbg" src="${u}" alt="" aria-hidden="true"><img class="fg" src="${u}" alt="${label}">`
        : `<img src="${u}" alt="${label}" draggable="false">`;
    }
    const [paper] = PALETTE[(gift.color || 0) % PALETTE.length];
    return `<div class="gift-fallback ${large ? 'lg' : ''}" style="--c1:${paper}"><span>${label}</span></div>`;
  }
  function thumbMedia(id) {
    const gift = giftById(id);
    const u = urls.get('gift:' + id);
    if (u) return `<img src="${u}" alt="">`;
    const [paper] = PALETTE[(gift?.color || 0) % PALETTE.length];
    return `<span class="thumb-dot" style="background:${paper}"></span>`;
  }

  // ---------------------------------------------------------------- views
  let view = lsGet(VIEW_KEY) === 'play' ? 'play' : 'setup';
  let draftPlayer = '';

  function setView(v) {
    view = v === 'play' ? 'play' : 'setup';
    lsSet(VIEW_KEY, view);
    render();
    window.scrollTo(0, 0);
  }

  function render() {
    // keep focus + caret in text inputs across re-renders
    const a = document.activeElement;
    let key = null, sel = null;
    if (a && a.closest && a.closest('#app') && a.matches('input')) {
      key = a.id ? `#${a.id}`
        : a.dataset.giftName ? `[data-gift-name="${a.dataset.giftName}"]`
        : a.dataset.playerName ? `[data-player-name="${a.dataset.playerName}"]`
        : a.dataset.setting ? `[data-setting="${a.dataset.setting}"]` : null;
      try { sel = [a.selectionStart, a.selectionEnd]; } catch { sel = null; }
    }

    const title = state.title?.trim() || 'White Elephant';
    document.title = `${title} · Gift Exchange`;
    $('#brand-title').textContent = title;
    $$('[data-view-tab]').forEach((b) => b.setAttribute('aria-current', b.dataset.viewTab === view ? 'page' : 'false'));
    document.body.dataset.view = view;
    $('#app').innerHTML = view === 'play' ? renderPlay() : renderSetup();

    if (key) {
      const el = $(key);
      if (el) { el.focus({ preventScroll: true }); if (sel) { try { el.setSelectionRange(sel[0], sel[1]); } catch { /* number inputs */ } } }
    }
  }

  // ----- setup
  function renderSetup() {
    const P = state.participants, G = state.gifts;
    const inGame = !!state.game;
    const mismatch = P.length && G.length && P.length !== G.length;
    return `
    <div class="setup">
      <section class="hero">
        <div class="hero-text">
          <label class="eyebrow" for="ev-title">Event name</label>
          <input id="ev-title" class="title-input" data-field="title" value="${esc(state.title)}" maxlength="60" autocomplete="off" spellcheck="false">
          <ol class="steps">
            <li><b>1</b>Add players — list order is turn order</li>
            <li><b>2</b>Add gifts: a mystery photo and a reveal photo</li>
            <li><b>3</b>Hit Play and put it on the big screen</li>
          </ol>
        </div>
        <div class="hero-cta">
          <button class="btn primary lg" data-action="view" data-id="play">${inGame ? 'Back to the game' : 'Go to the game'} <span aria-hidden="true">→</span></button>
          <div class="hero-meta">${plural(P.length, 'player')} · ${plural(G.length, 'gift')}</div>
        </div>
      </section>
      ${inGame ? `<div class="notice">A game is in progress. You can rename things, change photos and add late arrivals. Removing or reordering is locked until you reset the game.</div>` : ''}
      ${mismatch ? `<div class="notice warn">You have ${plural(P.length, 'player')} and ${plural(G.length, 'gift')}. These usually match — ${P.length > G.length ? 'some players won’t get a turn' : 'extra gifts will stay wrapped'}.</div>` : ''}
      <div class="setup-grid">
        <div class="setup-side">
          ${playersPanel(inGame)}
          ${rulesPanel()}
          ${dataPanel()}
        </div>
        ${giftsPanel(inGame)}
      </div>
    </div>`;
  }

  function playersPanel(inGame) {
    const P = state.participants;
    return `
    <section class="panel">
      <div class="panel-head">
        <h2>Players <span class="count">${P.length}</span></h2>
        <button class="btn ghost sm" data-action="shuffle" ${inGame || P.length < 2 ? 'disabled' : ''}>${icon('shuffle')} Shuffle</button>
      </div>
      <form class="add-row" data-form="add-player" autocomplete="off">
        <input id="add-player" class="input" value="${esc(draftPlayer)}" placeholder="Add a name, or paste a list" maxlength="400" enterkeyhint="done" aria-label="Player name">
        <button class="btn" type="submit">${icon('plus')} Add</button>
      </form>
      ${P.length ? `<ol class="player-list">${P.map((p, i) => `
        <li>
          <span class="pnum">${i + 1}</span>
          <input class="pname" data-player-name="${p.id}" value="${esc(p.name)}" maxlength="40" aria-label="Player ${i + 1} name" spellcheck="false">
          <span class="row-actions">
            <button class="icon-btn" data-action="move-up" data-id="${p.id}" ${inGame || i === 0 ? 'disabled' : ''} aria-label="Move ${esc(p.name)} up">${icon('up')}</button>
            <button class="icon-btn" data-action="move-down" data-id="${p.id}" ${inGame || i === P.length - 1 ? 'disabled' : ''} aria-label="Move ${esc(p.name)} down">${icon('down')}</button>
            <button class="icon-btn danger" data-action="remove-player" data-id="${p.id}" ${inGame ? 'disabled' : ''} aria-label="Remove ${esc(p.name)}">${icon('x')}</button>
          </span>
        </li>`).join('')}</ol>`
        : `<p class="empty">No players yet. Separate names with commas or new lines to add several at once.</p>`}
    </section>`;
  }

  function rulesPanel() {
    const s = state.settings;
    return `
    <section class="panel">
      <div class="panel-head"><h2>House rules</h2></div>
      <label class="field">
        <span class="field-label">Max steals per gift</span>
        <input class="input num" type="number" min="0" max="20" inputmode="numeric" data-setting="maxSteals" value="${esc(s.maxSteals)}">
        <small>After this many steals a gift is locked with whoever has it. 0 means no limit.</small>
      </label>
      <label class="check">
        <input type="checkbox" data-setting="noStealBack" ${s.noStealBack ? 'checked' : ''}>
        <span><b>No immediate steal-backs</b><small>Someone who was just robbed can’t take the same gift straight back.</small></span>
      </label>
      <label class="check">
        <input type="checkbox" data-setting="finalSwap" ${s.finalSwap ? 'checked' : ''}>
        <span><b>Player 1 gets a final swap</b><small>Once every gift is open, the first player may swap with anyone, as long as neither gift is locked.</small></span>
      </label>
    </section>`;
  }

  function dataPanel() {
    return `
    <section class="panel">
      <div class="panel-head"><h2>Save &amp; move</h2></div>
      <p class="hint">Everything is stored in this browser only. Nothing is uploaded. To move your setup to the party computer, export a backup here and import it there.</p>
      <div class="btn-grid">
        <button class="btn sm" data-action="export">${icon('download')} Export backup</button>
        <button class="btn sm" data-action="pick" data-id="import-file">${icon('upload')} Import backup</button>
        <button class="btn sm ghost" data-action="demo">${icon('sparkle')} Load demo party</button>
        <button class="btn sm ghost danger" data-action="clear-all">${icon('trash')} Clear everything</button>
      </div>
      <input id="import-file" type="file" accept="application/json,.json" hidden data-import>
    </section>`;
  }

  function giftsPanel(inGame) {
    const G = state.gifts;
    return `
    <section class="panel gifts-panel">
      <div class="panel-head">
        <h2>Gifts <span class="count">${G.length}</span></h2>
        <div class="head-actions">
          <button class="btn ghost sm" data-action="pick" data-id="bulk-file">${icon('image')} Add several from photos</button>
          <button class="btn primary sm" data-action="add-gift">${icon('plus')} Add gift</button>
        </div>
        <input id="bulk-file" type="file" accept="image/*" multiple hidden data-bulk>
      </div>
      <p class="hint">Each gift has a <b>mystery</b> image that everyone sees while it’s wrapped, and a <b>gift</b> image that’s revealed when it’s opened. Click a square or drop a photo on it. Skip the mystery photo and you get a wrapped-box design. Gift photos stay blurred here until you hover, so you don’t spoil anything.</p>
      <div class="gift-editor-grid">
        ${G.map((g, i) => giftEditor(g, i, inGame)).join('')}
        <button class="add-tile" data-action="add-gift" title="Drop several mystery photos here to add them all">${icon('plus')}<span>Add gift</span><small>or drop mystery photos here</small></button>
      </div>
    </section>`;
  }

  function giftEditor(g, i, inGame) {
    const s = gs(g.id);
    return `
    <article class="gift-editor">
      <header>
        <span class="num-badge">${i + 1}</span>
        ${s.opened ? `<span class="tag">Opened${s.owner ? ' · ' + esc(pName(s.owner)) : ''}</span>` : ''}
        <button class="icon-btn danger push" data-action="remove-gift" data-id="${g.id}" ${inGame ? 'disabled' : ''} aria-label="Remove gift ${i + 1}">${icon('trash')}</button>
      </header>
      <div class="slots">
        ${slotHTML(g, 'box', 'Mystery')}
        ${slotHTML(g, 'gift', 'Gift')}
      </div>
      <input class="input gname-input" data-gift-name="${g.id}" value="${esc(g.name)}" placeholder="What’s inside? e.g. Cozy socks" maxlength="60" aria-label="Gift ${i + 1}: what’s inside">
    </article>`;
  }

  function slotHTML(g, kind, label) {
    const u = urls.get(`${kind}:${g.id}`);
    const inner = u
      ? `<img src="${u}" alt="" draggable="false">`
      : kind === 'box' ? boxSVG(g, 'ed') : `<span class="slot-empty">${icon('image')}<span>Add photo</span></span>`;
    return `
    <div class="slot-wrap" data-slot="${kind}" data-id="${g.id}">
      <button type="button" class="slot ${kind} ${u ? 'has' : 'empty'}" data-action="pick" data-id="f-${kind}-${g.id}" aria-label="${u ? 'Change' : 'Upload'} ${label.toLowerCase()} photo for gift ${giftNum(g.id)}">
        <span class="slot-media ${kind === 'gift' && u ? 'spoiler' : ''}">${inner}</span>
        <span class="slot-label">${label}${!u && kind === 'box' ? ' · default' : ''}</span>
      </button>
      ${u ? `<button type="button" class="slot-clear" data-action="clear-image" data-id="${g.id}" data-kind="${kind}" aria-label="Remove ${label.toLowerCase()} photo">${icon('x')}</button>` : ''}
      <input id="f-${kind}-${g.id}" type="file" accept="image/*" hidden data-upload="${kind}" data-gift="${g.id}">
    </div>`;
  }

  // ----- play
  function renderPlay() {
    const P = state.participants, G = state.gifts;
    if (!state.game && (!G.length || P.length < 2)) {
      return `
      <div class="empty-state">
        <div class="empty-art">${boxSVG({ id: 'empty', color: 0 }, 'x')}</div>
        <h1>Let’s get some gifts under the tree</h1>
        <p>Add at least two players and one gift in Setup, then come back here to play. Or load the demo party to try it out.</p>
        <div class="row-gap">
          <button class="btn primary lg" data-action="view" data-id="setup">Go to setup</button>
          <button class="btn lg ghost" data-action="demo">${icon('sparkle')} Load demo party</button>
        </div>
      </div>`;
    }
    const n = G.length;
    const min = n <= 6 ? 230 : n <= 12 ? 190 : n <= 24 ? 160 : 130;
    return `
    <div class="play">
      ${statusBanner()}
      <div class="play-body">
        <div class="board" style="--card-min:${min}px">${G.map((g, i) => cardHTML(g, i)).join('')}</div>
        ${sidebar()}
      </div>
    </div>`;
  }

  function statusBanner() {
    const g = state.game;
    const P = state.participants, G = state.gifts;
    let eyebrow = '', title = '', sub = '', actions = '', tone = 'turn';
    if (!g) {
      tone = 'ready';
      eyebrow = `${plural(P.length, 'player')} · ${plural(G.length, 'gift')}`;
      title = 'Ready to unwrap?';
      sub = `<b>${esc(pName(P[0]?.id))}</b> goes first. Shuffle the order if you haven’t drawn numbers.`;
      actions = `<button class="btn ghost" data-action="shuffle">${icon('shuffle')} Shuffle order</button>
                 <button class="btn primary lg" data-action="start">Start the game</button>`;
    } else if (g.phase === 'over') {
      tone = 'over';
      eyebrow = 'Game over';
      title = 'That’s a wrap!';
      sub = 'Every gift has found a home. Happy holidays!';
      actions = `<button class="btn primary lg" data-action="results">See who got what</button>`;
    } else if (g.phase === 'final') {
      tone = 'final';
      const mine = holdings(g.active).map(giftLabel).join(' + ');
      eyebrow = 'Final round';
      title = `${esc(pName(g.active))} gets the last word`;
      sub = `Click any unlocked gift to swap it for the <b>${esc(mine)}</b> — or keep it and end the game.`;
      actions = `<button class="btn primary lg" data-action="keep">Keep it &amp; finish</button>`;
    } else {
      const a = g.active;
      const left = unopened().length;
      eyebrow = `Turn ${Math.min(g.turn + 1, g.order.length)} of ${g.order.length} · ${plural(left, 'gift')} still wrapped`;
      if (!a) {
        title = 'Whose turn is it?';
        sub = 'Click a name in the turn order to hand them the turn.';
      } else if (!hasMoves(a)) {
        tone = 'robbed';
        title = `No moves left for ${esc(pName(a))}`;
        sub = 'Every gift is either opened and locked or off-limits.';
        actions = `<button class="btn" data-action="skip">${icon('skip')} Skip</button><button class="btn primary" data-action="end">${icon('flag')} End game</button>`;
      } else if (g.reason === 'robbed') {
        tone = 'robbed';
        title = `${esc(pName(a))}, you’ve been robbed!`;
        sub = `Open a mystery gift, or steal another one${g.blocked ? ` — just not the <b>${esc(giftLabel(g.blocked))}</b>` : ''}.`;
      } else {
        title = `${esc(pName(a))}’s turn`;
        sub = 'Open a mystery gift, or steal one that’s already been opened.';
      }
    }
    return `
    <section class="status tone-${tone}">
      <div class="status-main">
        <div class="eyebrow">${eyebrow}</div>
        <h1 class="status-title">${title}</h1>
        <p class="status-sub">${sub}</p>
      </div>
      ${actions ? `<div class="status-actions">${actions}</div>` : ''}
    </section>`;
  }

  function moveFor(id) {
    const g = state.game;
    const s = gs(id);
    if (!g) return { kind: 'none', why: 'Press “Start the game” first.' };
    if (g.phase === 'over') return s.opened ? { kind: 'view' } : { kind: 'none', why: 'The game is over.' };
    const a = g.active;
    if (!a) return s.opened ? { kind: 'view' } : { kind: 'none', why: 'Nobody has the turn — click a name in the turn order.' };
    if (!s.opened) {
      if (g.phase === 'final') return { kind: 'none', why: 'Final round — swaps only.' };
      if (holdings(a).length) return { kind: 'none', why: `${pName(a)} already has a gift.` };
      return { kind: 'open' };
    }
    if (s.owner === a) return { kind: 'view' };
    if (isLocked(id)) return { kind: 'none', why: `Locked — it’s been stolen ${plural(maxSteals(), 'time')}.` };
    if (id === g.blocked) return { kind: 'none', why: `No steal-backs — ${pName(a)} just lost this one.` };
    return { kind: g.phase === 'final' ? 'swap' : 'steal' };
  }

  function cardHTML(gift, i) {
    const g = state.game;
    const s = gs(gift.id);
    const n = i + 1;
    const mv = moveFor(gift.id);
    const locked = s.opened && isLocked(gift.id);
    const hasImg = urls.has('gift:' + gift.id);
    const cls = [
      'gcard', s.opened ? 'opened' : 'wrapped', `can-${mv.kind}`,
      locked ? 'locked' : '', g && g.blocked === gift.id ? 'blocked' : '',
      g && s.owner && s.owner === g.active ? 'mine' : '', s.opened && !hasImg ? 'noimg' : '',
    ].join(' ');
    const max = maxSteals();
    const pips = s.opened && (max || s.steals)
      ? `<span class="pips" title="Stolen ${plural(s.steals, 'time')}${max ? ` of ${max}` : ''}">${max
        ? Array.from({ length: max }, (_, k) => `<i class="${k < s.steals ? 'on' : ''}"></i>`).join('')
        : `stolen ${s.steals}×`}</span>`
      : '';
    const aria = s.opened
      ? `Gift ${n}: ${giftLabel(gift.id)}, with ${s.owner ? pName(s.owner) : 'nobody'}${locked ? ', locked' : ''}`
      : `Mystery gift ${n}`;
    const cue = mv.kind === 'open' ? '<span class="cue">Open</span>'
      : mv.kind === 'steal' ? '<span class="cue steal">Steal</span>'
      : mv.kind === 'swap' ? '<span class="cue steal">Swap</span>' : '';
    return `
    <div class="card-wrap">
      <div class="${cls}" data-card="${gift.id}" role="button" tabindex="0" aria-label="${esc(aria)}">
        <div class="gcard-media">${s.opened ? giftMedia(gift) : boxMedia(gift, 'bd')}</div>
        <span class="gcard-num">${n}</span>
        ${locked ? `<span class="gcard-lock" title="Locked">${icon('lock')}</span>` : cue}
        ${g && g.blocked === gift.id ? '<span class="gcard-flag">No steal-back</span>' : ''}
        ${s.opened ? `
          <div class="gcard-info">
            <div class="gcard-name">${esc(giftLabel(gift.id))}</div>
            <div class="gcard-owner">${s.owner ? esc(pName(s.owner)) : '—'}</div>
            ${pips}
          </div>` : ''}
      </div>
      ${g ? `<button class="gcard-menu" data-action="gift-menu" data-id="${gift.id}" aria-label="Host controls for gift ${n}" title="Host controls">${icon('more')}</button>` : ''}
    </div>`;
  }

  function sidebar() {
    const g = state.game;
    const order = g ? g.order : state.participants.map((p) => p.id);
    const nextIdx = g && g.phase === 'playing' ? nextOfficialIndex() : -1;
    return `
    <aside class="sidebar">
      <div class="host-tools">
        <button class="btn sm" data-action="undo" ${state.history.length ? '' : 'disabled'} title="Undo (Ctrl/⌘ + Z)">${icon('undo')} Undo</button>
        ${g && g.phase === 'playing' && g.active ? `<button class="btn sm ghost" data-action="skip">${icon('skip')} Skip</button>` : ''}
        ${g ? `<button class="btn sm ghost danger" data-action="reset">Reset</button>` : ''}
      </div>
      <h3 class="side-title">Turn order</h3>
      <ol class="turns">${order.map((pid, i) => turnRow(pid, i, nextIdx)).join('')}</ol>
      ${g ? `<p class="side-hint">Host tip: click a name to give them the turn, or a gift’s <span class="kbd">•••</span> to reassign it.</p>` : ''}
      ${g && g.log.length ? `
        <details class="log">
          <summary>Game log <span class="count">${g.log.length}</span></summary>
          <ol>${g.log.slice().reverse().map((l) => `<li>${esc(l.text)}</li>`).join('')}</ol>
        </details>` : ''}
    </aside>`;
  }

  function turnRow(pid, i, nextIdx) {
    const g = state.game;
    const held = g ? holdings(pid) : [];
    const now = !!(g && g.active === pid);
    const next = i === nextIdx && !now;
    const clickable = g && g.phase === 'playing' && !now;
    let status = '';
    if (g && !held.length) status = now ? 'choosing…' : next ? 'up next' : i <= g.turn ? 'no gift' : 'waiting';
    return `
    <li class="turn ${now ? 'now' : ''} ${next ? 'next' : ''}" ${clickable ? `data-action="make-active" data-id="${pid}" role="button" tabindex="0" title="Give ${esc(pName(pid))} the turn"` : ''}>
      <span class="tnum">${i + 1}</span>
      <span class="tbody">
        <span class="tname">${esc(pName(pid))}</span>
        ${held.length
          ? `<span class="thold">${held.map((h) => `<span class="thumb">${thumbMedia(h)}</span><span class="thold-name">${esc(giftLabel(h))}</span>${isLocked(h) ? icon('lock', 'tiny') : ''}`).join('')}</span>`
          : status ? `<span class="thold muted">${status}</span>` : ''}
      </span>
      ${now ? '<span class="chip">Up now</span>' : next ? '<span class="chip soft">Next</span>' : ''}
    </li>`;
  }

  // ---------------------------------------------------------------- card clicks
  function handleCard(id) {
    const mv = moveFor(id);
    const gift = giftById(id);
    if (!gift) return;
    const n = giftNum(id);
    const a = state.game?.active;
    if (mv.kind === 'none') return toast(mv.why);
    if (mv.kind === 'view') return lightbox(id);
    if (mv.kind === 'open') {
      return openModal({
        title: `Open gift #${n}?`,
        body: `<div class="confirm-art">${boxMedia(gift, 'cf')}</div>
               <p class="center"><b>${esc(pName(a))}</b> is about to unwrap mystery gift #${n}.</p>`,
        actions: [{ label: 'Cancel', ghost: true }, { label: 'Unwrap it!', primary: true, onClick: () => doOpen(id) }],
      });
    }
    const s = gs(id);
    const victim = s.owner;
    const swap = mv.kind === 'swap' || holdings(a).length > 0;
    const max = maxSteals();
    const lastSteal = max && s.steals + 1 >= max;
    const mine = holdings(a).map(giftLabel).join(' + ');
    openModal({
      title: swap ? `Swap with ${esc(pName(victim))}?` : `Steal from ${esc(pName(victim))}?`,
      body: `<div class="confirm-art">${giftMedia(gift)}</div>
             <p class="center"><b>${esc(pName(a))}</b> takes the <b>${esc(giftLabel(id))}</b> from <b>${esc(pName(victim))}</b>.</p>
             ${swap ? `<p class="center muted">${esc(pName(victim))} gets the ${esc(mine)} in return.</p>` : ''}
             ${max ? `<p class="center muted">${lastSteal ? 'That’s its last steal — it will be <b>locked</b>.' : `Steal ${s.steals + 1} of ${max} for this gift.`}</p>` : ''}`,
      actions: [{ label: 'Cancel', ghost: true }, { label: swap ? 'Swap' : 'Steal it', primary: true, danger: !swap, onClick: () => doSteal(id) }],
    });
  }

  // ---------------------------------------------------------------- modals & overlays
  let modal = null;
  let modalSeq = 0;

  function openModal({ title = '', body = '', actions = [], wide = false }) {
    const prevFocus = modal ? modal.prevFocus : document.activeElement;
    closeModal(false);
    const token = ++modalSeq;
    modal = { actions, token, prevFocus };
    $('#modal-root').innerHTML = `
      <div class="modal-backdrop" data-modal-close>
        <div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" ${title ? 'aria-labelledby="modal-title"' : ''} tabindex="-1">
          <button class="icon-btn modal-x" data-modal-close aria-label="Close">${icon('x')}</button>
          ${title ? `<h2 id="modal-title">${title}</h2>` : ''}
          <div class="modal-body">${body}</div>
          ${actions.length ? `<div class="modal-actions">${actions.map((a, i) =>
            `<button class="btn ${a.primary ? 'primary' : ''} ${a.danger ? 'danger' : ''} ${a.ghost ? 'ghost' : ''}" data-modal-act="${i}">${a.label}</button>`).join('')}</div>` : ''}
        </div>
      </div>`;
    const target = $('#modal-root .modal-actions .btn.primary') || $('#modal-root .modal-actions .btn') || $('#modal-root .modal');
    target.focus();
    return token;
  }
  function closeModal(restore = true) {
    if (!modal) return;
    const pf = modal.prevFocus;
    modal = null;
    $('#modal-root').innerHTML = '';
    if (restore && pf && pf.isConnected && pf.focus) pf.focus({ preventScroll: true });
  }

  function confirmModal(title, body, okLabel, onOk, danger = false) {
    openModal({ title, body: `<p>${body}</p>`, actions: [{ label: 'Cancel', ghost: true }, { label: okLabel, primary: true, danger, onClick: onOk }] });
  }

  function lightbox(id) {
    const gift = giftById(id);
    const s = gs(id);
    openModal({
      wide: true,
      title: esc(giftLabel(id)),
      body: `<div class="lightbox-media">${giftMedia(gift, true)}</div>
             <p class="muted lb-meta">Gift #${giftNum(id)} · ${s.owner ? `with <b>${esc(pName(s.owner))}</b>` : 'unclaimed'} · stolen ${plural(s.steals, 'time')}${isLocked(id) ? ' · locked' : ''}</p>`,
    });
  }

  function giftMenu(id) {
    const gift = giftById(id);
    const s = gs(id);
    const n = giftNum(id);
    const opts = state.participants.map((p) => `<option value="${p.id}" ${s.owner === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
    openModal({
      title: `Gift #${n} · host controls`,
      body: `
        <div class="menu-gift">
          <div class="menu-thumb">${s.opened ? giftMedia(gift) : boxMedia(gift, 'mm')}</div>
          <div><div class="menu-name">${s.opened ? esc(giftLabel(id)) : 'Still wrapped'}</div>
          <div class="muted">${s.owner ? 'With ' + esc(pName(s.owner)) : 'Not assigned to anyone'}</div></div>
        </div>
        <label class="field"><span class="field-label">Assign to</span>
          <select id="m-owner" class="input"><option value="">Nobody (wrapped, back in the pile)</option>${opts}</select></label>
        <label class="field"><span class="field-label">Times stolen</span>
          <input id="m-steals" class="input num" type="number" min="0" max="99" inputmode="numeric" value="${s.steals}"></label>
        <p class="hint">Use this to fix a mix-up or record something that happened off-script. Assigning a wrapped gift unwraps it. Undo works on this too.</p>`,
      actions: [
        ...(s.opened ? [{ label: 'View larger', ghost: true, onClick: () => lightbox(id) }] : []),
        { label: 'Cancel', ghost: true },
        {
          label: 'Save', primary: true,
          onClick: (m) => {
            const owner = $('#m-owner', m).value || null;
            const steals = Math.max(0, Math.min(99, parseInt($('#m-steals', m).value, 10) || 0));
            applyAssign(id, owner, steals);
          },
        },
      ],
    });
  }

  function results() {
    const g = state.game;
    if (!g) return;
    const rows = g.order.map((pid) => {
      const h = holdings(pid);
      return `<li class="result">
        <div class="result-media">${h.length ? giftMedia(giftById(h[0])) : '<div class="gift-fallback none"><span>—</span></div>'}</div>
        <div class="result-name">${esc(pName(pid))}</div>
        <div class="result-gift">${h.length ? h.map((x) => esc(giftLabel(x))).join(' + ') : 'No gift'}</div>
      </li>`;
    }).join('');
    openModal({ wide: true, title: 'Who got what', body: `<ul class="results">${rows}</ul>` });
  }

  function toast(msg, kind = '') {
    const root = $('#toast-root');
    const t = document.createElement('div');
    t.className = `toast ${kind}`;
    t.textContent = msg;
    root.appendChild(t);
    while (root.children.length > 3) root.firstElementChild.remove();
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, 2800);
  }

  function playEvent(ev) {
    if (!ev || !giftById(ev.gift)) return;
    if (ev.type === 'open') showReveal(ev);
    else announce(ev);
  }

  function announce(ev) {
    const root = $('#announce-root');
    root.innerHTML = '';
    const gift = giftById(ev.gift);
    const g = state.game;
    let title, sub;
    if (ev.type === 'swap') {
      title = `${esc(pName(ev.by))} swapped with ${esc(pName(ev.from))}!`;
      sub = `${esc(pName(ev.by))} takes the ${esc(giftLabel(ev.gift))}; ${esc(pName(ev.from))} gets the ${esc((ev.given || []).map(giftLabel).join(' + '))}.`;
    } else {
      title = `${esc(pName(ev.by))} stole the ${esc(giftLabel(ev.gift))}!`;
      sub = g && g.active === ev.from ? `${esc(pName(ev.from))}, you’re up — open a gift or steal another.` : '';
    }
    if (ev.locked) sub += `${sub ? ' ' : ''}<span class="a-lock">${icon('lock', 'tiny')} Now locked.</span>`;
    const el = document.createElement('div');
    el.className = `announce ${ev.type}`;
    el.setAttribute('role', 'status');
    el.innerHTML = `<div class="a-thumb">${giftMedia(gift)}</div><div><div class="a-title">${title}</div>${sub ? `<div class="a-sub">${sub}</div>` : ''}</div>`;
    root.appendChild(el);
    const kill = () => { el.classList.add('out'); setTimeout(() => el.remove(), 300); };
    el.addEventListener('click', kill);
    setTimeout(kill, 4200);
  }

  function showReveal(ev) {
    const gift = giftById(ev.gift);
    if (!gift) return;
    $$('.reveal').forEach((r) => r.remove());
    const n = giftNum(ev.gift);
    const g = state.game;
    const next = !g ? ''
      : g.phase === 'over' ? 'That was the last move — game over!'
      : g.phase === 'final' ? `Every gift is open. Final round: <b>${esc(pName(g.active))}</b> may swap.`
      : g.active ? `Up next: <b>${esc(pName(g.active))}</b>` : '';
    const el = document.createElement('div');
    el.className = 'reveal';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', `Gift ${n} revealed: ${giftLabel(gift.id)}`);
    el.innerHTML = `
      <canvas class="confetti" aria-hidden="true"></canvas>
      <div class="reveal-stage">
        <div class="reveal-kicker">${esc(pName(ev.by))} is unwrapping gift #${n}…</div>
        <div class="flip"><div class="flip-inner">
          <div class="face front">${boxMedia(gift, 'rv')}</div>
          <div class="face back">${giftMedia(gift, true)}</div>
        </div></div>
        <div class="reveal-caption">
          <div class="reveal-what">${esc(giftLabel(gift.id))}</div>
          <div class="reveal-who">for ${esc(pName(ev.by))}</div>
          ${next ? `<div class="reveal-next">${next}</div>` : ''}
        </div>
        <button class="btn primary lg reveal-continue">Continue</button>
      </div>`;
    document.body.appendChild(el);

    let stage = 0;
    const born = Date.now();
    const timers = [];
    const reveal = () => {
      if (stage >= 2) return;
      stage = 2;
      timers.forEach(clearTimeout);
      el.classList.remove('shaking');
      el.classList.add('flipped');
      timers.push(setTimeout(() => {
        el.classList.add('revealed');
        confetti($('canvas', el));
        $('.reveal-continue', el)?.focus({ preventScroll: true });
      }, REDUCED ? 0 : 650));
    };
    const close = () => {
      timers.forEach(clearTimeout);
      document.removeEventListener('keydown', onKey, true);
      el.classList.add('closing');
      setTimeout(() => el.remove(), 220);
    };
    const advance = () => { if (Date.now() - born < 350) return; if (stage < 2) reveal(); else close(); };
    function onKey(e) {
      if (!el.isConnected) return document.removeEventListener('keydown', onKey, true);
      if (['Enter', ' ', 'Escape'].includes(e.key)) { e.preventDefault(); e.stopPropagation(); advance(); }
    }
    document.addEventListener('keydown', onKey, true);
    el.addEventListener('click', advance);

    if (REDUCED) { reveal(); return; }
    requestAnimationFrame(() => {
      el.classList.add('shaking');
      stage = 1;
      timers.push(setTimeout(reveal, 1150));
    });
  }

  function confetti(canvas) {
    if (REDUCED || !canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = (canvas.width = innerWidth * dpr);
    const H = (canvas.height = innerHeight * dpr);
    const colors = ['#e9b949', '#d9454f', '#3fae7a', '#f4efe6', '#6aa8ff', '#f2a7b5'];
    const parts = Array.from({ length: 190 }, () => ({
      x: W / 2 + (Math.random() - 0.5) * W * 0.25,
      y: H * 0.48,
      vx: (Math.random() - 0.5) * 26 * dpr,
      vy: (-Math.random() * 22 - 6) * dpr,
      w: (6 + Math.random() * 8) * dpr,
      h: (4 + Math.random() * 6) * dpr,
      r: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.35,
      c: colors[(Math.random() * colors.length) | 0],
    }));
    const start = performance.now();
    (function frame(now) {
      if (!canvas.isConnected) return;
      ctx.clearRect(0, 0, W, H);
      let alive = 0;
      for (const p of parts) {
        p.vx *= 0.985; p.vy = p.vy * 0.985 + 0.5 * dpr;
        p.x += p.vx; p.y += p.vy; p.r += p.vr;
        if (p.y < H + 40) alive++;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.r);
        ctx.fillStyle = p.c;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.r * 2)) + 1);
        ctx.restore();
      }
      if (alive && now - start < 6000) requestAnimationFrame(frame);
      else ctx.clearRect(0, 0, W, H);
    })(start);
  }

  // ---------------------------------------------------------------- setup actions
  function addPlayers(raw) {
    const names = String(raw).split(/[\n,;\t]+/).map((s) => s.trim()).filter(Boolean).slice(0, 100);
    if (!names.length) return;
    const existing = new Set(state.participants.map((p) => p.name.trim().toLowerCase()));
    const dupes = names.filter((n) => existing.has(n.toLowerCase()));
    const added = names.map((name) => ({ id: uid(), name: name.slice(0, 40) }));
    state.participants.push(...added);
    if (state.game) {
      state.game.order.push(...added.map((p) => p.id));
      if (state.game.phase === 'playing' && !state.game.active) nextTurn();
    }
    draftPlayer = '';
    save();
    render();
    $('#add-player')?.focus();
    if (dupes.length) toast(`Heads up: there’s already a ${dupes[0]}. Add an initial to tell them apart.`);
    else if (added.length > 1) toast(`Added ${added.length} players.`);
  }

  function nextColor() {
    const last = state.gifts[state.gifts.length - 1];
    return last ? ((last.color || 0) + 3) % PALETTE.length : 0;
  }
  function addGift(focus = true) {
    const g = { id: uid(), name: '', color: nextColor() };
    state.gifts.push(g);
    save();
    if (focus) {
      render();
      const input = $(`[data-gift-name="${g.id}"]`);
      input?.scrollIntoView({ block: 'center', behavior: REDUCED ? 'auto' : 'smooth' });
      input?.focus({ preventScroll: true });
    }
    return g;
  }

  async function uploadTo(giftId, kind, file) {
    if (!giftById(giftId)) return;
    try {
      const blob = await processImage(file);
      await saveImage(`${kind}:${giftId}`, blob);
      render();
    } catch (err) {
      toast(err.message || 'Couldn’t use that image.', 'warn');
    }
  }

  const bulkAdd = exclusive(async (files) => {
    const list = Array.from(files || []).filter((f) => /^image\//.test(f.type) || /\.(heic|heif)$/i.test(f.name));
    if (!list.length) return toast('No images found in that selection.');
    let ok = 0;
    for (const f of list) {
      try {
        const blob = await processImage(f);
        const g = addGift(false);
        await saveImage(`box:${g.id}`, blob);
        ok++;
      } catch (err) { toast(err.message, 'warn'); }
    }
    render();
    if (ok) toast(`Added ${plural(ok, 'gift')}. Now add what’s inside each one.`);
  });

  async function removeGiftNow(id) {
    state.gifts = state.gifts.filter((g) => g.id !== id);
    await Promise.all([deleteImage(`box:${id}`), deleteImage(`gift:${id}`)]);
    save();
    render();
  }

  async function exportBackup() {
    try {
      const images = {};
      for (const g of state.gifts) {
        for (const k of [`box:${g.id}`, `gift:${g.id}`]) if (blobs.has(k)) images[k] = await blobToDataURL(blobs.get(k));
      }
      const data = { app: 'white-elephant', v: 1, exportedAt: new Date().toISOString(), state, images };
      const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${slug(state.title)}-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
      toast('Backup downloaded.');
    } catch {
      toast('Export failed.', 'warn');
    }
  }

  async function importBackup(file) {
    let data;
    try { data = JSON.parse(await file.text()); } catch { return toast('That file isn’t a valid backup.', 'warn'); }
    if (!data || data.app !== 'white-elephant' || !data.state) return toast('That file isn’t a White Elephant backup.', 'warn');
    const go = exclusive(async () => {
      try { await idb.clear(); } catch { /* ignore */ }
      for (const k of [...urls.keys()]) dropLocalImage(k);
      for (const [k, d] of Object.entries(data.images || {})) {
        try { const b = await (await fetch(d)).blob(); setLocalImage(k, b); await idb.put(k, b); } catch { /* skip bad image */ }
      }
      const f = freshState();
      state = { ...f, ...data.state, settings: { ...f.settings, ...(data.state.settings || {}) } };
      state.imgRev = (state.imgRev || 0) + 1;
      normalizeGame();
      if (state.game?.lastEvent) seen.add(state.game.lastEvent.id);
      save();
      render();
      toast('Backup imported.');
    });
    if (state.participants.length || state.gifts.length) {
      confirmModal('Replace everything?', 'Importing replaces all players, gifts, photos and game progress in this browser.', 'Import', go, true);
    } else go();
  }

  async function wipe() {
    try { await idb.clear(); } catch { /* ignore */ }
    for (const k of [...urls.keys()]) dropLocalImage(k);
    state = freshState();
    draftPlayer = '';
  }

  const DEMO = {
    title: 'Office Holiday Party',
    players: ['Avery', 'Jordan', 'Sam', 'Priya', 'Marcus', 'Lena', 'Theo', 'Rosa'],
    gifts: [['Fuzzy socks', '🧦'], ['Giant coffee mug', '☕'], ['Board game', '🎲'], ['Scented candle', '🕯️'],
      ['Desk plant', '🪴'], ['Headphones', '🎧'], ['Fancy chocolates', '🍫'], ['1000-piece puzzle', '🧩']],
  };
  function emojiBlob(emoji, tint) {
    const c = document.createElement('canvas');
    c.width = c.height = 640;
    const x = c.getContext('2d');
    const gr = x.createRadialGradient(320, 260, 40, 320, 320, 460);
    gr.addColorStop(0, '#fffaf0');
    gr.addColorStop(1, tint);
    x.fillStyle = gr;
    x.fillRect(0, 0, 640, 640);
    x.font = '340px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillText(emoji, 320, 345);
    return new Promise((r) => c.toBlob(r, 'image/png'));
  }
  const loadDemo = exclusive(async () => {
    const tints = ['#f3d9b1', '#e7d3c0', '#d9e4d2', '#f1d4d4', '#d6e6df', '#dcdcef', '#ecd9c6', '#e6dfcf'];
    const gifts = DEMO.gifts.map(([name], i) => ({ id: uid(), name, color: (i * 3) % PALETTE.length }));
    const pics = await Promise.all(DEMO.gifts.map(([, emoji], i) => emojiBlob(emoji, tints[i % tints.length])));
    const settings = { ...state.settings };
    await wipe();
    // apply everything in one go so nothing can interleave
    state.settings = settings;
    state.title = DEMO.title;
    state.participants = DEMO.players.map((name) => ({ id: uid(), name }));
    state.gifts = gifts;
    gifts.forEach((g, i) => { if (pics[i]) setLocalImage(`gift:${g.id}`, pics[i]); });
    save();
    render();
    await Promise.all(gifts.map((g, i) => (pics[i] ? idb.put(`gift:${g.id}`, pics[i]).catch(() => {}) : null)));
    state.imgRev = (state.imgRev || 0) + 1;
    save();
    toast('Demo party loaded. Head to Play when you’re ready.');
  });

  // ---------------------------------------------------------------- actions table
  const ACTIONS = {
    view: (id) => setView(id),
    fullscreen: () => {
      if (document.fullscreenElement) document.exitFullscreen?.();
      else (document.documentElement.requestFullscreen?.() || Promise.reject()).catch(() => toast('Fullscreen isn’t available in this browser.'));
    },
    pick: (id) => document.getElementById(id)?.click(),
    'add-gift': () => addGift(),
    'remove-gift': (id) => {
      if (state.game) return toast('Reset the game before removing gifts.');
      const hasStuff = giftById(id)?.name || urls.has(`box:${id}`) || urls.has(`gift:${id}`);
      if (!hasStuff) return removeGiftNow(id);
      confirmModal(`Remove gift #${giftNum(id)}?`, 'Its photos and details will be deleted.', 'Remove', () => removeGiftNow(id), true);
    },
    'clear-image': (id, el) => { deleteImage(`${el.dataset.kind}:${id}`).then(render); },
    'move-up': (id) => movePlayer(id, -1),
    'move-down': (id) => movePlayer(id, 1),
    'remove-player': (id) => {
      if (state.game) return toast('Reset the game before removing players.');
      state.participants = state.participants.filter((p) => p.id !== id);
      save(); render();
    },
    shuffle: () => {
      if (state.game) return toast('Turn order is locked while a game is in progress.');
      if (state.participants.length < 2) return;
      shuffleArr(state.participants);
      save(); render();
      toast(`Shuffled! ${pName(state.participants[0].id)} goes first.`);
    },
    start: () => startGame(),
    undo: () => undo(),
    skip: () => {
      const g = state.game;
      if (!g?.active) return;
      confirmModal(`Skip ${esc(pName(g.active))}?`, 'They’ll be passed over without a gift (you can undo this).', 'Skip', () =>
        commit(() => { log(`${pName(g.active)} was skipped`); nextTurn(); }));
    },
    end: () => commit(() => finish()),
    keep: () => {
      const g = state.game;
      commit(() => { log(`${pName(g.active)} kept the ${holdings(g.active).map(giftLabel).join(' + ')}`); finish(); });
      toast('Game over — happy holidays!');
    },
    reset: () => confirmModal('Reset the game?', 'Every gift goes back in its wrapping and nobody holds anything. Players, gifts and photos stay. You can undo this.', 'Reset game',
      () => commit(() => { state.game = null; }), true),
    results: () => results(),
    'make-active': (id) => {
      const g = state.game;
      if (!g || g.phase !== 'playing') return;
      confirmModal(`Give ${esc(pName(id))} the turn?`, 'Use this if the game got out of sync. The normal turn order carries on afterwards.', 'Give them the turn',
        () => commit(() => { g.active = id; g.reason = 'host'; g.blocked = null; log(`Host gave the turn to ${pName(id)}`); }));
    },
    'gift-menu': (id) => giftMenu(id),
    export: () => exportBackup(),
    demo: () => {
      if (state.participants.length || state.gifts.length) {
        confirmModal('Load the demo party?', 'This replaces your current players, gifts, photos and game progress.', 'Load demo', loadDemo, true);
      } else loadDemo();
    },
    'clear-all': () => confirmModal('Clear everything?', 'This deletes all players, gifts, photos and game progress from this browser. It can’t be undone.', 'Clear everything',
      async () => { await wipe(); save(); render(); toast('All cleared.'); }, true),
  };

  function movePlayer(id, dir) {
    if (state.game) return;
    const P = state.participants;
    const i = P.findIndex((p) => p.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= P.length) return;
    [P[i], P[j]] = [P[j], P[i]];
    save();
    render();
    $(`[data-action="${dir < 0 ? 'move-up' : 'move-down'}"][data-id="${id}"]`)?.focus();
  }

  // ---------------------------------------------------------------- events
  document.addEventListener('click', (e) => {
    if (e.target.closest('#modal-root')) {
      const act = e.target.closest('[data-modal-act]');
      if (act && modal) {
        const a = modal.actions[+act.dataset.modalAct];
        const token = modal.token;
        const ret = a && a.onClick ? a.onClick($('#modal-root .modal')) : undefined;
        if (ret !== false && modal && modal.token === token) closeModal();
        return;
      }
      const c = e.target.closest('[data-modal-close]');
      if (c && (!c.classList.contains('modal-backdrop') || e.target === c)) closeModal();
      return;
    }
    const el = e.target.closest('[data-action]');
    if (el && !el.disabled && ACTIONS[el.dataset.action]) {
      e.preventDefault();
      ACTIONS[el.dataset.action](el.dataset.id, el, e);
      return;
    }
    const card = e.target.closest('[data-card]');
    if (card) handleCard(card.dataset.card);
  });

  document.addEventListener('input', (e) => {
    const t = e.target;
    if (t.id === 'add-player') { draftPlayer = t.value; return; }
    if (t.dataset.field === 'title') {
      state.title = t.value;
      const shown = t.value.trim() || 'White Elephant';
      $('#brand-title').textContent = shown;
      document.title = `${shown} · Gift Exchange`;
      return saveSoon();
    }
    if (t.dataset.playerName) { const p = person(t.dataset.playerName); if (p) { p.name = t.value; saveSoon(); } return; }
    if (t.dataset.giftName) { const g = giftById(t.dataset.giftName); if (g) { g.name = t.value; saveSoon(); } return; }
    if (t.dataset.setting === 'maxSteals') { state.settings.maxSteals = Math.max(0, Math.min(20, parseInt(t.value, 10) || 0)); saveSoon(); }
  });

  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t.type === 'checkbox' && t.dataset.setting) { state.settings[t.dataset.setting] = t.checked; save(); return; }
    if (t.dataset.upload && t.files?.[0]) { uploadTo(t.dataset.gift, t.dataset.upload, t.files[0]); t.value = ''; return; }
    if (t.hasAttribute('data-bulk') && t.files?.length) { bulkAdd(t.files); t.value = ''; return; }
    if (t.hasAttribute('data-import') && t.files?.[0]) { importBackup(t.files[0]); t.value = ''; return; }
    if (t.dataset.setting === 'maxSteals') { t.value = state.settings.maxSteals; save(); }
    if (t.dataset.playerName || t.dataset.giftName || t.dataset.field) save();
  });

  document.addEventListener('submit', (e) => {
    if (e.target.dataset.form === 'add-player') {
      e.preventDefault();
      addPlayers($('#add-player').value);
    }
  });

  document.addEventListener('paste', (e) => {
    if (e.target.id !== 'add-player') return;
    const text = e.clipboardData?.getData('text') || '';
    if (/[\n\r]/.test(text)) { e.preventDefault(); addPlayers(text); }
  });

  document.addEventListener('keydown', (e) => {
    if (modal) {
      if (e.key === 'Escape') { e.preventDefault(); closeModal(); }
      else if (e.key === 'Enter' && e.target.matches('.modal input')) { e.preventDefault(); $('#modal-root .modal-actions .btn.primary')?.click(); }
      return;
    }
    const typing = e.target.closest && e.target.closest('input, textarea, select, [contenteditable="true"]');
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'z' && !typing && view === 'play') {
      e.preventDefault();
      undo();
      return;
    }
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('[data-card], li[data-action]')) {
      e.preventDefault();
      e.target.click();
    }
  });

  // drag & drop photos onto gift slots (or onto the add tile for bulk)
  const hasFiles = (e) => Array.from(e.dataTransfer?.types || []).includes('Files');
  document.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    $$('.drag').forEach((d) => d.classList.remove('drag'));
    const t = e.target.closest('.slot-wrap, .add-tile');
    if (t) t.classList.add('drag');
  });
  document.addEventListener('dragleave', (e) => {
    const t = e.target.closest('.slot-wrap, .add-tile');
    if (t && !t.contains(e.relatedTarget)) t.classList.remove('drag');
  });
  document.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    $$('.drag').forEach((d) => d.classList.remove('drag'));
    const files = e.dataTransfer.files;
    const slot = e.target.closest('.slot-wrap');
    if (slot && files[0]) return uploadTo(slot.dataset.id, slot.dataset.slot, files[0]);
    if (e.target.closest('.add-tile') && files.length) bulkAdd(files);
  });

  // keep two windows in sync (e.g. a laptop controlling a projector window)
  window.addEventListener('storage', async (e) => {
    if (e.key !== LS_KEY || !e.newValue || e.newValue === lastSaved) return;
    const prevRev = state.imgRev;
    state = loadState();
    lastSaved = e.newValue;
    if (state.imgRev !== prevRev) await loadImages();
    render();
    const ev = state.game?.lastEvent;
    if (ev && !seen.has(ev.id)) {
      seen.add(ev.id);
      if (Date.now() - ev.at < 20000) playEvent(ev);
    }
  });

  // ---------------------------------------------------------------- boot
  (async function init() {
    if (state.game?.lastEvent) seen.add(state.game.lastEvent.id);
    normalizeGame();
    await Promise.race([loadImages(), new Promise((r) => setTimeout(r, 1500))]);
    render();
  })();
})();
