/* CROWNFALL — fx.js — hiệu ứng quân cờ (nạp SAU script.js). Chỉ VẼ, không đọc/ghi trạng thái bàn cờ.
 *  Ăn quân (chỉ khi nước đi đã được engine/máy chủ xác nhận):
 *   Lính: 2 kiếm · Vua: lóa sáng + hạt sáng · Mã: bùng nổ · Gấu: sóng nâu 3×3 · Sói: 3 vết cào · Ngưu: cặp mắt
 *  Di chuyển: Cận: tia sét vàng nhỏ, nằm gọn trong ô xuất phát và ô đến.
 *  Buff (Thuật hỗ trợ): ánh "enchant" lấp lánh chạy trên hình quân (mặt nạ theo ảnh PNG), bám class .supported do engine bật.
 *  Đường Cấm: một khung chữ nhật liền mạch, viền gradient xanh biển nhạt–trắng chuyển động, bám class zone-p1/zone-p2 do engine bật.
 */
(function () {
  'use strict';
  const C = window.Crownfall;
  if (!C || !C.BoardUI) { console.error('[fx.js] Cần nạp sau script.js'); return; }
  const B = C.BoardUI, SIZE = 9, MAX_LIVE = 14;
  let layer = null, live = 0;

  const motionOff = () => document.body.dataset.motion === 'reduced' || (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const boardEl = () => document.getElementById('board');
  const flipped = () => { const b = boardEl(); return !!b && b.classList.contains('flip'); };
  const cellXY = (r, c) => { const f = flipped(); return { x: (f ? SIZE - 1 - c : c) + 0.5, y: (f ? SIZE - 1 - r : r) + 0.5 }; };
  const rnd = (a, b) => a + Math.random() * (b - a);
  const clamp = (v) => Math.max(10, Math.min(90, v));

  function getLayer() {
    const b = boardEl(); if (!b || !b.parentElement) return null;
    const wrap = b.parentElement;
    if (!layer || layer.parentElement !== wrap) { layer = document.createElement('div'); layer.className = 'fx-layer'; layer.setAttribute('aria-hidden', 'true'); wrap.append(layer); }
    return layer;
  }
  function add(node, ms) {
    const L = getLayer(); if (!L || live >= MAX_LIVE) return;
    live++; L.append(node);
    setTimeout(() => { node.remove(); live = Math.max(0, live - 1); }, ms + 120);
  }
  function spot(r, c, cls, html, ms) {
    const p = cellXY(r, c), n = document.createElement('div');
    n.className = 'fx-spot ' + cls;
    n.style.left = (p.x / SIZE * 100) + '%'; n.style.top = (p.y / SIZE * 100) + '%';
    n.style.setProperty('--cw', (boardEl().getBoundingClientRect().width / SIZE) + 'px');
    n.innerHTML = html;   // chỉ chuỗi SVG/HTML tĩnh do file này tạo
    add(n, ms);
  }
  const moveAngle = (l) => { const f = flipped() ? -1 : 1; return Math.atan2(f * (l.toRow - l.fromRow), f * (l.toCol - l.fromCol)) * 180 / Math.PI; };

  const BLADE = '<path d="M50 4 L57 60 L50 68 L43 60Z" fill="#eafff5"/><path d="M50 8 L50 66" stroke="#7fbfa0" stroke-width="2"/><rect x="33" y="62" width="34" height="7" rx="3.5" fill="#ffd23f"/><rect x="46.5" y="69" width="7" height="18" rx="3.5" fill="#c58a1b"/>';

  const CAPTURE = {
    L(r, c) { spot(r, c, 'fx-swords', '<svg viewBox="0 0 100 100"><g transform="rotate(45 50 50)">' + BLADE + '</g><g transform="rotate(-45 50 50)">' + BLADE + '</g></svg>', 720); },
    V(r, c) {
      let h = '<b class="flare"></b><b class="cross"></b>';
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2 + rnd(0, 0.4), d = rnd(0.5, 1.25);
        h += '<i style="--dx:' + (Math.cos(a) * d).toFixed(2) + ';--dy:' + (Math.sin(a) * d).toFixed(2) + ';--s:' + rnd(0.7, 1.4).toFixed(2) + ';--t:' + Math.round(rnd(0, 180)) + 'ms">' + (i % 3 ? '✦' : '✧') + '</i>';
      }
      spot(r, c, 'fx-stars', h, 1250);
    },
    M(r, c) {
      let rays = ''; for (let i = 0; i < 8; i++) rays += '<line x1="50" y1="50" x2="50" y2="10" transform="rotate(' + (i * 45) + ' 50 50)"/>';
      spot(r, c, 'fx-burst', '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="24" class="b-core"/><g class="b-rays">' + rays + '</g></svg>', 540);
    },
    G(r, c) { spot(r, c, 'fx-quake', '<i></i><i></i><i></i>', 950); },
    S(r, c, last) {
      const id = 'sg' + Math.floor(Math.random() * 1e6);
      const slash = (y, d, w) => '<path class="sl" style="--d:' + d + 'ms" fill="url(#' + id + ')" d="M4 ' + (y + 12) + ' Q50 ' + (y - 18 - w) + ' 96 ' + (y + 6) + ' Q50 ' + (y - 9) + ' 4 ' + (y + 12) + 'Z"/>';
      let sp = ''; for (let i = 0; i < 7; i++) { const a = rnd(-0.7, 0.7), d = rnd(26, 46); sp += '<circle class="sp" cx="50" cy="50" r="' + rnd(1.2, 2.4).toFixed(1) + '" style="--x:' + (Math.cos(a) * d).toFixed(0) + 'px;--y:' + (Math.sin(a) * d).toFixed(0) + 'px;--d:' + Math.round(rnd(60, 200)) + 'ms"/>'; }
      spot(r, c, 'fx-claws', '<svg viewBox="0 0 100 100" style="transform:rotate(' + moveAngle(last).toFixed(0) + 'deg) scale(1.25)"><defs><linearGradient id="' + id + '" x1="0" x2="1">' +
        '<stop offset="0" stop-color="#ff2d55" stop-opacity=".1"/><stop offset=".45" stop-color="#ffffff"/><stop offset=".75" stop-color="#ff5c73"/><stop offset="1" stop-color="#b3122f" stop-opacity=".2"/></linearGradient></defs>' +
        '<circle class="flash" cx="50" cy="50" r="30"/>' + slash(26, 0, 4) + slash(50, 70, 6) + slash(74, 140, 4) + sp + '</svg>', 850);
    },
    N(r, c) {
      spot(r, c, 'fx-eyes', '<svg viewBox="0 0 100 100"><g class="eye"><path d="M12 50 Q29 33 46 50 Q29 67 12 50Z"/><circle cx="29" cy="50" r="5"/></g>' +
        '<g class="eye"><path d="M54 50 Q71 33 88 50 Q71 67 54 50Z"/><circle cx="71" cy="50" r="5"/></g></svg>', 680);
    }
  };

  /** Tia sét vàng nhỏ, tỏa ngắn quanh tâm ô: luôn nằm TRONG ô (toạ độ bị kẹp 10..90 trên khung 100). */
  function zap(r, c, branches) {
    let d = '';
    for (let k = 0; k < branches; k++) {
      const base = rnd(0, Math.PI * 2); let x = 50, y = 50; d += ' M50 50';
      for (let s = 0; s < 3; s++) { const a = base + rnd(-0.55, 0.55), len = rnd(10, 16); x = clamp(x + Math.cos(a) * len); y = clamp(y + Math.sin(a) * len); d += ' L' + x.toFixed(1) + ' ' + y.toFixed(1); }
    }
    spot(r, c, 'fx-zap', '<svg viewBox="0 0 100 100"><path class="glow" d="' + d + '"/><path class="core" d="' + d + '"/></svg>', 430);
  }

  function play(last) {
    if (!last || motionOff() || !boardEl()) return;
    if (last.pieceType === 'C' && last.actionType !== 'swap') { zap(last.fromRow, last.fromCol, 3); setTimeout(() => zap(last.toRow, last.toCol, 5), 150); }
    if (last.actionType === 'capture' && CAPTURE[last.pieceType]) setTimeout(() => { try { CAPTURE[last.pieceType](last.toRow, last.toCol, last); } catch (e) { console.warn('[fx.js]', e); } }, 140);
  }

  const orig = B.animate;
  B.animate = function (last) {
    const a = this.anim;   // chỉ có giá trị khi nước đi đã được xác nhận (engine / máy chủ)
    const r = orig.apply(this, arguments);
    try { if (a && a.move && last) play(last); } catch (e) { console.warn('[fx.js]', e); }
    return r;
  };

  /* ---------- Buff: gắn mặt nạ theo ảnh quân để ánh enchant chỉ chạy trên hình quân ---------- */
  function syncGlint(board) {
    board.querySelectorAll('.cell.supported .piece').forEach((p) => {
      const img = p.querySelector('img'), src = img && img.getAttribute('src'); if (!src) return;
      p.style.setProperty('--glint-mask', 'url("' + src.replace(/["\\\n\r]/g, '') + '")');
      if (!p.classList.contains('has-glint')) p.classList.add('has-glint');
    });
  }

  /* ---------- Đường Cấm: gộp các ô liền kề của cùng một đường thành MỘT khung chữ nhật ---------- */
  function syncZones(board) {
    const cells = Array.from(board.querySelectorAll(':scope > .cell')), groups = {};
    cells.forEach((cell, i) => {
      const cl = cell.classList, k = cl.contains('zone-p1') ? 'p1' : cl.contains('zone-p2') ? 'p2' : cl.contains('g-forbid') ? 'g' : null; if (!k) return;
      const r = Math.floor(i / SIZE), c = i % SIZE, g = groups[k] || (groups[k] = { r0: r, r1: r, c0: c, c1: c });
      g.r0 = Math.min(g.r0, r); g.r1 = Math.max(g.r1, r); g.c0 = Math.min(g.c0, c); g.c1 = Math.max(g.c1, c);
    });
    const sig = JSON.stringify(groups);
    if (board.dataset.fzSig === sig) return;
    board.dataset.fzSig = sig;
    board.querySelectorAll(':scope > .fz:not(.fz-out)').forEach((o) => { o.classList.add('fz-out'); setTimeout(() => o.remove(), 280); });
    Object.keys(groups).forEach((k) => {
      const g = groups[k], n = document.createElement('div'), w = g.c1 - g.c0 + 1, h = g.r1 - g.r0 + 1;
      n.className = 'fz' + (h > w ? ' fz-v' : ''); n.setAttribute('aria-hidden', 'true');
      n.style.left = (g.c0 / SIZE * 100) + '%'; n.style.top = (g.r0 / SIZE * 100) + '%'; n.style.width = (w / SIZE * 100) + '%'; n.style.height = (h / SIZE * 100) + '%';
      board.append(n);
    });
  }

  let queued = false;
  const boards = () => Array.from(document.querySelectorAll('.board'));
  const run = () => { queued = false; boards().forEach((b) => { try { syncGlint(b); syncZones(b); } catch (e) { console.warn('[fx.js]', e); } }); };
  const obs = new MutationObserver(() => { if (!queued) { queued = true; requestAnimationFrame(run); } });
  boards().forEach((b) => obs.observe(b, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] }));
  run();
  window.CrownfallFx = Object.freeze({ play });
})();
