// dsh-simple-pin — ghim workspace / session lên đầu danh sách trong sidebar.
//
//   - Pin workspace  → workspace đó lên ĐẦU danh sách workspace.
//   - Pin session    → session đó lên ĐẦU danh sách session TRONG workspace của nó.
//   - Pin/Unpin nằm trong menu "…" native của row (cạnh Fork / Rename / …),
//     KHÔNG thêm nút icon nào cả.
//
// Cấu trúc DOM thật (đã dump 2026-08-26):
//   LIST (div con chung, ví dụ .qDHVXG_list)
//     └ SECTION (mỗi workspace một cái, vd .qDHVXG_groupSection)
//         ├ WRAPPER(span) ─ treeitem.YDXeBa_projectRow   (workspace, CÓ aria-expanded)
//         └ WRAPPER(span) ─ treeitem (session, KHÔNG aria-expanded) × N
//   → sort cấp 1: các SECTION trong LIST (pin workspace).
//   → sort cấp 2: các WRAPPER chứa session trong từng SECTION (pin session).
//
// Vẫn viết bằng selector cấu trúc (role/class-check), không bám class hash.
//
//   - MutationObserver (debounce rAF + cờ `mutating`) sort lại sau mỗi lần
//     React re-render; chỉ đụng DOM khi thứ tự thực sự khác.
//   - Menu "…": nghe pointerdown capture để nhớ row vừa bấm "…", khi portal
//     `div[role="menu"]` hiện ra thì chèn thêm `button[role="menuitem"]`
//     📌 Pin / 📌 Unpin (copy class item kế bên để ăn theo style), bấm xong
//     gửi Escape để đóng menu. Không đụng React state.
//   - Key của row = leaf-span DÀI NHẤT (span icon/status thì rỗng!) đã cắt
//     thời gian tương đối ("5m","2h","now"…) — đổi tên session sẽ mất pin,
//     chấp nhận cho bản đơn giản.
//   - Lưu pin: HOST-SIDE qua route `/__dsh-simple-pin` (GET đọc, POST ghi) ghi
//     ~/.dsh/simple-pin.json — dùng chung mọi máy/browser. localStorage chỉ là
//     cache hiển thị tức thời + offline fallback.
//     Format v9: {"workspaces":[workspaceId...],"sessions":["session-<uuid>"...]}
//     — pin theo ID THẬT lấy từ /api/workspace.list & /api/session.list,
//     match row qua title -> id map (refresh 60s + trước mỗi toggle). Đổi tên
//     session/workspace KHÔNG mất pin. Key title (store cũ) được tự migrate.
//
// Install: dsh plugin --profile web add @phuongncn/dsh-simple-pin

import { readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'

const STORE_FILE = `${homedir()}/.dsh/simple-pin.json`
const MAX_BODY_BYTES = 65536

function defaultState() {
  return { workspaces: [], sessions: [] }
}

function isValidState(s) {
  return !!s && Array.isArray(s.workspaces) && Array.isArray(s.sessions)
}

function readState() {
  try {
    const s = JSON.parse(readFileSync(STORE_FILE, 'utf8'))
    return isValidState(s) ? s : defaultState()
  } catch {
    return defaultState()
  }
}

function writeState(s) {
  writeFileSync(STORE_FILE, JSON.stringify(s), 'utf8')
}

export const name = 'dsh-simple-pin'
export const inject = ['webServer']

const CLIENT_JS = String.raw`(function () {
  if (window.__dshSimplePin) return;
  window.__dshSimplePin = true;

  var STORE_KEY = 'dsh.simple-pin.v1';
  var API = '/__dsh-simple-pin';

  var CSS = [
    // Marker nhỏ trước nội dung row đang pin.
    'div[role="treeitem"][data-simple-pin="1"] > span:first-child::before',
    '{content:"\\1F4CC ";font-size:11px}',
    '[data-simple-menu-item]{cursor:pointer}'
  ].join('');

  // ---------- store ----------
  function validState(s) {
    return s && Array.isArray(s.workspaces) && Array.isArray(s.sessions);
  }
  function load() {
    try {
      var s = JSON.parse(localStorage.getItem(STORE_KEY));
      if (validState(s)) return s;
    } catch (e) {}
    return { workspaces: [], sessions: [] };
  }
  function saveLocal() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) {}
  }
  function pushHost() {
    fetch(API, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(state)
    }).catch(function () {});
  }
  function pullHost() {
    fetch(API).then(function (r) { return r.ok ? r.json() : null; }).then(function (s) {
      if (!validState(s)) return;
      state = s;
      saveLocal();
      scheduleSort();
    }).catch(function () {});
  }

  var state = load();

  // ---- title -> id map (pin lưu theo ID THẬT, không phải title) ----
  // API envelope: {type:"client-request",rpcId,method,payload}
  //   session.list  -> result.value.items[]: {sessionId, projections.values.title}
  //   workspace.list-> result.value.items[]: {workspaceId, title}
  var tmap = { workspaces: {}, sessions: {} };

  function rpcList(method, payload) {
    return fetch('/api/' + method, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'simple', method: method, payload: payload || {} })
    }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
  }
  function refreshMap(kind) {
    var method = kind === 'workspaces' ? 'workspace.list' : 'session.list';
    return rpcList(method).then(function (res) {
      var items = res && res.result && res.result.ok && res.result.value &&
        res.result.value.items;
      if (!items) return;
      var map = {};
      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        var id = it.sessionId || it.workspaceId;
        var title = it.title != null ? it.title
          : (it.projections && it.projections.values && it.projections.values.title);
        if (id && title) map[cleanLabel(String(title))] = id;
      }
      tmap[kind] = map;
    });
  }
  function refreshAllMaps() {
    return Promise.all([refreshMap('workspaces'), refreshMap('sessions')]).then(migrateStore);
  }
  function resolveId(kind, titleKey) { return tmap[kind][titleKey] || null; }

  function isPinned(kind, titleKey) {
    var id = resolveId(kind, titleKey);
    return state[kind].indexOf(id) !== -1 || state[kind].indexOf(titleKey) !== -1;
  }
  function togglePin(kind, titleKey) {
    var id = resolveId(kind, titleKey);
    var key = id || titleKey;
    var arr = state[kind];
    var wasPinned = isPinned(kind, titleKey);
    // xoá cả bản ghi id lẫn title (nếu có)
    for (var i = arr.length - 1; i >= 0; i--) {
      if (arr[i] === key || arr[i] === titleKey) arr.splice(i, 1);
    }
    // đang pin -> chỉ xoá (UNPIN); chưa pin -> ghim lên đầu
    if (!wasPinned) arr.unshift(key);
    saveLocal();
    pushHost();
    scheduleSort();
  }
  // Store cũ lưu theo title — nâng cấp lên id nếu title khớp map hiện tại.
  function migrateStore() {
    var changed = false;
    ['workspaces', 'sessions'].forEach(function (kind) {
      for (var i = 0; i < state[kind].length; i++) {
        var id = resolveId(kind, state[kind][i]);
        if (id && id !== state[kind][i]) { state[kind][i] = id; changed = true; }
      }
    });
    if (changed) { saveLocal(); pushHost(); scheduleSort(); }
  }

  // ---------- row helpers ----------
  function isEl(n) { return n && n.nodeType === 1; }
  function isWsRow(n) {
    return isEl(n) && n.tagName === 'DIV' && n.getAttribute('role') === 'treeitem' &&
      n.hasAttribute('aria-expanded');
  }
  function isSessRow(n) {
    return isEl(n) && n.tagName === 'DIV' && n.getAttribute('role') === 'treeitem' &&
      !n.hasAttribute('aria-expanded');
  }

  function cleanLabel(t) {
    return (t || '').replace(/\bnow\b|\b\d+\s*(s|m|h|d|w|min|hr)s?\b/gi, '')
      .replace(/\s+/g, ' ').trim().slice(0, 120);
  }
  // Leaf-span ĐẦU TIÊN thường là icon/status (rỗng) — lấy leaf-span DÀI NHẤT.
  function rowKey(row) {
    var best = '';
    var spans = row.querySelectorAll('span');
    for (var i = 0; i < spans.length; i++) {
      if (!spans[i].querySelector('span')) {
        var t = cleanLabel(spans[i].textContent);
        if (t.length > best.length) best = t;
      }
    }
    if (!best) best = cleanLabel(row.textContent);
    return best;
  }

  // ---------- sorting ----------
  var mutating = false;
  var scheduled = false;

  // Sắp lại các node trong "parent": những node có key được pin (theo thứ tự
  // trong pins[]) đứng trước, còn lại giữ nguyên thứ tự tương đối.
  // LƯU Ý: pins[] chứa ID thật (v9) — key của node phải qua resolveId trước.
  function pinKey(kind, titleKey) { return resolveId(kind, titleKey) || titleKey; }
  function partitionSort(parent, nodes, keysOf, kind) {
    if (nodes.length < 2) return false;
    var pins = state[kind];
    var keys = nodes.map(function (n) { return pinKey(kind, keysOf(n)); });
    var idx = nodes.map(function (_, i) { return i; });
    idx.sort(function (a, b) {
      var ia = pins.indexOf(keys[a]), ib = pins.indexOf(keys[b]);
      if (ia === -1 && ib === -1) return 0;
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    });
    var changed = false;
    for (var j = 0; j < idx.length; j++) if (idx[j] !== j) { changed = true; break; }
    if (!changed) return false;
    var ref = nodes[nodes.length - 1].nextSibling;
    for (var k = 0; k < idx.length; k++) parent.insertBefore(nodes[idx[k]], ref);
    return true;
  }

  // Tổ tiên chung của mọi row (nếu văng lên body/html thì bỏ qua — DOM lạ).
  function commonAncestor(rows) {
    function contains(a, n) {
      while (n) { if (n === a) return true; n = n.parentNode; }
      return false;
    }
    var anc = rows[0];
    outer: while (anc && anc !== document.body && anc !== document.documentElement) {
      anc = anc.parentNode;
      for (var i = 0; i < rows.length; i++) {
        if (!contains(anc, rows[i])) continue outer;
      }
      return anc;
    }
    return null;
  }

  function sortAll() {
    var rows = [];
    var all = document.querySelectorAll('div[role="treeitem"]');
    for (var i = 0; i < all.length; i++) {
      if (isWsRow(all[i]) || isSessRow(all[i])) rows.push(all[i]);
    }
    if (rows.length < 2) return;
    var list = commonAncestor(rows);
    if (!list || list === document.body) return;

    // SECTION của mỗi row = tổ tiên trực tiếp dưới LIST.
    var secs = [], secByKey = {};
    var secOfRow = new Map();
    for (var r = 0; r < rows.length; r++) {
      var s = rows[r];
      while (s.parentNode !== list && s.parentNode) s = s.parentNode;
      secOfRow.set(rows[r], s);
      if (!secByKey[s.__simpleSecId]) { secByKey[s.__simpleSecId = Math.random()] = s; secs.push(s); }
    }

    // Cấp 1: pin workspace = sort SECTION theo key của workspace row đầu tiên.
    var moved = partitionSort(list, secs, function (sec) {
      var w = null;
      for (var i = 0; i < sec.querySelectorAll('div[role="treeitem"]').length; i++) {
        var t = sec.querySelectorAll('div[role="treeitem"]')[i];
        if (isWsRow(t)) { w = t; break; }
      }
      if (!w) w = sec.querySelector('div[role="treeitem"]');
      return w ? rowKey(w) : '';
    }, 'workspaces');

    // Cấp 2: pin session = trong từng SECTION, sort các con CHỨA session row.
    for (var v = 0; v < secs.length; v++) {
      var sec = secs[v], nodes = [], skeys = {};
      var kids = sec.children;
      for (var c = 0; c < kids.length; c++) {
        var sr = kids[c].querySelector('div[role="treeitem"]:not([aria-expanded])');
        if (sr) { nodes.push(kids[c]); skeys[sr.__simpleK || (sr.__simpleK = Math.random())] = rowKey(sr); }
      }
      if (nodes.length >= 2) {
        moved = partitionSort(sec, nodes, function (n) {
          var sr = n.querySelector('div[role="treeitem"]:not([aria-expanded])');
          return sr ? skeys[sr.__simpleK] : '';
        }, 'sessions') || moved;
      }
    }

    // Marker 📌 cho mọi row.
    for (var m = 0; m < rows.length; m++) {
      var kind = isWsRow(rows[m]) ? 'workspaces' : 'sessions';
      if (isPinned(kind, rowKey(rows[m]))) rows[m].setAttribute('data-simple-pin', '1');
      else rows[m].removeAttribute('data-simple-pin');
    }
  }

  function scheduleSort() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(function () {
      scheduled = false;
      mutating = true;
      try { sortAll(); } catch (e) { console.log('[simple] sort error', e && e.message); }
      mutating = false;
    });
  }

  // ---------- native "…" menu ----------
  var menuCtx = { row: null, kind: null };

  document.addEventListener('pointerdown', function (e) {
    menuCtx.row = null;
    menuCtx.kind = null;
    var row = e.target.closest && e.target.closest('div[role="treeitem"]');
    if (!row) return;
    menuCtx.row = row;
    menuCtx.kind = isWsRow(row) ? 'workspaces' : 'sessions';
  }, true);

  function closeMenu() {
    // Radix-style menus đóng trên Escape ở mức document.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  }

  function ensureMenuItem(menu) {
    if (!menuCtx.row || menu.querySelector('[data-simple-menu-item]')) return;
    // Chốt kind/key NGAY LÚC MỞ MENU: pointerdown trên chính menu item (portal,
    // ngoài treeitem) sẽ reset menuCtx trước khi event click kịp chạy.
    var kind = menuCtx.kind;
    var key = rowKey(menuCtx.row);
    var pinned = isPinned(kind, key);
    var sample = menu.querySelector('[role="menuitem"]');
    var b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'menuitem');
    b.setAttribute('data-simple-menu-item', '1');
    if (sample && sample.className) b.className = sample.className;
    b.textContent = pinned ? '📌 Unpin' : '📌 Pin';
    b.addEventListener('click', function (ev) {
      ev.stopPropagation();
      // refresh map trước để resolve id mới nhất (session vừa rename vẫn khớp)
      refreshAllMaps().then(function () { togglePin(kind, key); closeMenu(); });
    });
    menu.appendChild(b);
  }

  // ---------- boot ----------
  function boot() {
    if (!document.body) { document.addEventListener('DOMContentLoaded', boot); return; }
    if (!document.querySelector('style[data-plugin-css="dsh-simple-pin"]')) {
      var style = document.createElement('style');
      style.setAttribute('data-plugin-css', 'dsh-simple-pin');
      style.textContent = CSS;
      document.head.appendChild(style);
    }
    scheduleSort();   // sort ngay theo localStorage cho không nhấp nháy
    pullHost();       // lấy dữ liệu host (nguồn chân lý chung mọi máy)
    refreshAllMaps(); // nạp title -> id map rồi migrate store cũ (title-key) sang id
    setInterval(refreshAllMaps, 60000); // làm mới map định kỳ (rename, session mới…)
    new MutationObserver(function (muts) {
      if (mutating) return;
      for (var i = 0; i < muts.length; i++) {
        var added = muts[i].addedNodes;
        for (var j = 0; j < added.length; j++) {
          var n = added[j];
          if (isEl(n) && n.getAttribute && n.getAttribute('role') === 'menu') { ensureMenuItem(n); return; }
          if (isEl(n) && n.querySelector) {
            var menu = n.querySelector('div[role="menu"]');
            if (menu) { ensureMenuItem(menu); return; }
          }
        }
      }
      scheduleSort();
    }).observe(document.body, { childList: true, subtree: true });
  }
  boot();
})();`

function injectClient(html) {
  if (html.includes('data-dsh-simple-pin')) return html
  const script = `<script data-dsh-simple-pin>${CLIENT_JS}</script>`
  if (html.includes('<head>')) return html.replace('<head>', `<head>${script}`)
  const tagged = html.replace(/<head(\s[^>]*)>/i, `<head$1>${script}`)
  return tagged === html ? script + html : tagged
}

async function handleStore(req, res) {
  if (req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(readState()))
    return
  }
  if (req.method !== 'POST') {
    res.writeHead(405, { allow: 'GET, POST' })
    res.end()
    return
  }
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) {
      res.writeHead(413)
      res.end()
      return
    }
    chunks.push(chunk)
  }
  try {
    const s = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (!isValidState(s)) throw new Error('bad shape')
    writeState({ workspaces: s.workspaces.map(String), sessions: s.sessions.map(String) })
    res.writeHead(204)
    res.end()
  } catch {
    res.writeHead(400)
    res.end()
  }
}

export function apply(ctx, config) {
  const webServer = ctx.get('webServer')
  if (webServer === undefined) return
  console.log(`[dsh-simple-pin] plugin loaded v1.0.0 (store: ${STORE_FILE})`)
  ctx.effect(() => webServer.tapIndex(injectClient), 'dsh-simple-pin: client injection')
  ctx.effect(
    () => webServer.register({ kind: 'exact', path: '/__dsh-simple-pin', handler: handleStore }),
    'dsh-simple-pin: store route',
  )
}
