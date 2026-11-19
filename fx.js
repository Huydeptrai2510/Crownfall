/* CROWNFALL — fx.js — hiệu ứng quân cờ (nạp SAU script.js). Chỉ VẼ, không đọc/ghi trạng thái bàn cờ.
 *  Ăn quân (chỉ khi nước đi đã được engine/máy chủ xác nhận):
 *   Lính: 2 kiếm · Vua: lóa sáng + hạt sáng · Mã: bùng nổ · Gấu: sóng nâu 3×3 · Sói: 3 vết cào · Ngưu: cặp mắt
 *  Di chuyển: Cận: tia sét vàng mảnh kéo từ ô đi tới ô đến.
 *  Buff (Thuật hỗ trợ): ánh bóng tím lấp lánh chạy chậm trên hình quân (mặt nạ theo ảnh PNG), bám class .supported do engine bật.
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
    /* Sói — vết cào hoang dã: 3 vết thon (đầu dày, đuôi nhọn, mép răng cưa), cong nhẹ, chém chéo rất nhanh rồi mờ dần (build-up → đỉnh → dư âm),
       chớp va chạm + rung nhẹ, giọt máu và tia lửa văng THEO HƯỚNG chém (theo các hướng dẫn VFX: hạt kế thừa hướng và tốc độ của vệt chém). */
    S(r, c) {
      const id = 'sg' + Math.floor(Math.random() * 1e6), ang = 38 + rnd(-12, 12);
      const path = (L, w, curv) => {
        const n = 14, top = [], bot = [];
        for (let i = 0; i <= n; i++) {
          const t = i / n, wd = w * Math.sin(Math.PI * Math.pow(t, 0.65)) * (1 - 0.25 * t) + 0.4, cv = curv * Math.sin(Math.PI * t), j = i % 2 ? rnd(-0.7, 0.7) : 0;
          top.push([L * t, cv - wd / 2 + j]); bot.push([L * t, cv + wd / 2 - j]);
        }
        return 'M' + top.concat(bot.reverse()).map((p) => p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' L') + 'Z';
      };
      let g = '';
      [{ o: -17, L: 84, w: 7, cv: -3, d: 0 }, { o: 0, L: 102, w: 9, cv: -4, d: 70 }, { o: 17, L: 80, w: 6.5, cv: -3, d: 140 }].forEach((k) => {
        const p = path(k.L, k.w, k.cv);
        g += '<g transform="translate(' + (50 - k.L / 2).toFixed(1) + ' ' + (50 + k.o) + ')"><path class="sl gl" style="--d:' + k.d + 'ms" d="' + p + '"/>' +
          '<path class="sl" style="--d:' + k.d + 'ms" fill="url(#' + id + ')" d="' + p + '"/><path class="sl core" style="--d:' + k.d + 'ms" d="' + path(k.L * 0.92, k.w * 0.32, k.cv) + '"/></g>';
      });
      let pt = '';
      for (let i = 0; i < 16; i++) {
        const a = ang * Math.PI / 180 + rnd(-0.6, 0.6), d = rnd(24, 54), blood = i < 10, x = Math.cos(a) * d, y = Math.sin(a) * d;
        pt += '<circle class="' + (blood ? 'bl' : 'sk') + '" cx="50" cy="50" r="' + (blood ? rnd(1, 2.6) : rnd(0.8, 1.5)).toFixed(1) + '" style="--x:' + x.toFixed(0) + 'px;--y:' + y.toFixed(0) + 'px;--d:' + Math.round(rnd(60, 220)) + 'ms"/>';
      }
      spot(r, c, 'fx-claws', '<svg viewBox="0 0 100 100"><defs><linearGradient id="' + id + '" x1="0" x2="1"><stop offset="0" stop-color="#ffe3dc"/><stop offset=".28" stop-color="#ff5c6c"/>' +
        '<stop offset=".72" stop-color="#cf1230"/><stop offset="1" stop-color="#6e0716" stop-opacity=".25"/></linearGradient>' +
        '<radialGradient id="' + id + 'f"><stop offset="0" stop-color="#fff"/><stop offset=".4" stop-color="#ff6a7a" stop-opacity=".85"/><stop offset="1" stop-color="#ff2d55" stop-opacity="0"/></radialGradient></defs>' +
        '<circle class="flash" cx="50" cy="50" r="30" fill="url(#' + id + 'f)"/><g transform="rotate(' + ang.toFixed(0) + ' 50 50)">' + g + '</g>' + pt + '</svg>', 900);
    },
    N(r, c) {
      spot(r, c, 'fx-eyes', '<svg viewBox="0 0 100 100"><g class="eye"><path d="M12 50 Q29 33 46 50 Q29 67 12 50Z"/><circle cx="29" cy="50" r="5"/></g>' +
        '<g class="eye"><path d="M54 50 Q71 33 88 50 Q71 67 54 50Z"/><circle cx="71" cy="50" r="5"/></g></svg>', 680);
    }
  };

  /** Tia sét vàng kéo từ ô xuất phát tới ô đến (chỉ Cận). Mảnh; nhánh ít, ngắn và chỉ nằm trong các ô mà đường đi thực sự đi qua. */
  function bolt(l) {
    const a = cellXY(l.fromRow, l.fromCol), b = cellXY(l.toRow, l.toCol);
    const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len, segs = Math.max(5, Math.round(len * 3.2));
    const path = new Set(); for (let i = 0; i <= 48; i++) { const t = i / 48; path.add(Math.floor(a.x + dx * t) + ',' + Math.floor(a.y + dy * t)); }
    const inPath = (x, y) => path.has(Math.floor(x) + ',' + Math.floor(y));
    const pts = [[a.x, a.y]];
    for (let i = 1; i < segs; i++) { const t = i / segs, bx = a.x + dx * t, by = a.y + dy * t; let o = rnd(-0.2, 0.2); if (!inPath(bx + nx * o, by + ny * o)) o = 0; pts.push([bx + nx * o, by + ny * o]); }
    pts.push([b.x, b.y]);
    const f = (v) => v.toFixed(2);
    let d = 'M' + pts.map((p) => f(p[0]) + ' ' + f(p[1])).join(' L');
    const want = Math.random() < 0.5 ? 1 : 2; let made = 0;
    for (let tries = 0; tries < 10 && made < want && pts.length > 3; tries++) {
      const p = pts[1 + Math.floor(Math.random() * (pts.length - 2))], ang = Math.atan2(dy, dx) + (Math.random() < 0.5 ? -1 : 1) * rnd(0.7, 1.2), ln = rnd(0.16, 0.34);
      const q1 = [p[0] + Math.cos(ang) * ln * 0.5 + rnd(-0.04, 0.04), p[1] + Math.sin(ang) * ln * 0.5 + rnd(-0.04, 0.04)], q2 = [p[0] + Math.cos(ang) * ln, p[1] + Math.sin(ang) * ln];
      if (!inPath(q1[0], q1[1]) || !inPath(q2[0], q2[1])) continue;
      d += ' M' + f(p[0]) + ' ' + f(p[1]) + ' L' + f(q1[0]) + ' ' + f(q1[1]) + ' L' + f(q2[0]) + ' ' + f(q2[1]); made++;
    }
    const n = document.createElement('div'); n.className = 'fx-bolt';
    n.innerHTML = '<svg viewBox="0 0 9 9" preserveAspectRatio="none"><path class="glow" d="' + d + '"/><path class="core" d="' + d + '"/></svg>';
    add(n, 420);
  }

  function play(last) {
    if (!last || motionOff() || !boardEl()) return;
    if (last.pieceType === 'C' && last.actionType !== 'swap') bolt(last);
    if (last.actionType === 'capture' && CAPTURE[last.pieceType]) setTimeout(() => { try { CAPTURE[last.pieceType](last.toRow, last.toCol, last); } catch (e) { console.warn('[fx.js]', e); } }, 140);
  }

  const orig = B.animate;
  B.animate = function (last) {
    const a = this.anim;   // chỉ có giá trị khi nước đi đã được xác nhận (engine / máy chủ)
    const r = orig.apply(this, arguments);
    try { if (a && a.move && last) play(last); } catch (e) { console.warn('[fx.js]', e); }
    return r;
  };

  /* ---------- Buff: "chrome lỏng ánh cầu vồng" — lớp .lq (mặt nạ theo ảnh PNG) chứa các mảng màu trôi/uốn/biến dạng NGẪU NHIÊN riêng từng quân ---------- */
  const R = (a, b) => (a + Math.random() * (b - a)).toFixed(2);
  function syncGlint(board) {
    board.querySelectorAll('.cell.supported .piece').forEach((p) => {
      const img = p.querySelector('img'), src = img && img.getAttribute('src'); if (!src) return;
      p.style.setProperty('--glint-mask', 'url("' + src.replace(/["\\\n\r]/g, '') + '")');
      if (!p.classList.contains('has-glint')) p.classList.add('has-glint');
      if (!p.querySelector(':scope > .lq')) {
        const q = document.createElement('span'); q.className = 'lq'; q.setAttribute('aria-hidden', 'true'); q.innerHTML = '<i></i><i></i><i></i><i></i>';
        const d = [R(8, 14), R(10, 17), R(6, 11), R(9, 16)];
        d.forEach((v, i) => { q.style.setProperty('--d' + (i + 1), v + 's'); q.style.setProperty('--o' + (i + 1), '-' + R(0, parseFloat(v)) + 's'); });
        q.style.setProperty('--a0', Math.round(Math.random() * 360) + 'deg');
        p.append(q);
      }
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
