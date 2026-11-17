/* CROWNFALL — fx.js — hiệu ứng ăn quân / di chuyển (nạp SAU script.js).
 * Chỉ VẼ: không đọc/ghi trạng thái bàn cờ. Hiệu ứng chỉ phát khi BoardUI.animate được gọi với một nước đi
 * đã được engine (chơi 1 máy) hoặc máy chủ (trực tuyến) xác nhận (BoardUI.anim.move tồn tại).
 *  Lính: 2 kiếm bắt chéo · Vua: hạt sáng · Mã: bùng nổ · Gấu: sóng 3×3 · Sói: 3 vết cào · Ngưu: cặp mắt · Cận: tia sét khi DI CHUYỂN.
 */
(function () {
  'use strict';
  const C = window.Crownfall;
  if (!C || !C.BoardUI) { console.error('[fx.js] Cần nạp sau script.js'); return; }
  const B = C.BoardUI, SIZE = 9, MAX_LIVE = 12;
  let layer = null, live = 0;

  const motionOff = () => document.body.dataset.motion === 'reduced' || (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const boardEl = () => document.getElementById('board');
  const flipped = () => { const b = boardEl(); return !!b && b.classList.contains('flip'); };
  /** Tâm ô (đơn vị ô, 0..9) theo hướng nhìn thực tế (bàn có thể xoay 180° cho phe Xanh). */
  const cellXY = (r, c) => { const f = flipped(); return { x: (f ? SIZE - 1 - c : c) + 0.5, y: (f ? SIZE - 1 - r : r) + 0.5 }; };
  const rnd = (a, b) => a + Math.random() * (b - a);

  function getLayer() {
    const b = boardEl(); if (!b || !b.parentElement) return null;
    const wrap = b.parentElement;
    if (!layer || layer.parentElement !== wrap) {
      layer = document.createElement('div'); layer.className = 'fx-layer'; layer.setAttribute('aria-hidden', 'true'); wrap.append(layer);
    }
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
    n.innerHTML = html;   // chỉ chuỗi SVG/HTML tĩnh do file này tạo, không có dữ liệu người dùng
    add(n, ms);
  }
  const moveAngle = (l) => { const f = flipped() ? -1 : 1; return Math.atan2(f * (l.toRow - l.fromRow), f * (l.toCol - l.fromCol)) * 180 / Math.PI; };

  const BLADE = '<path d="M50 4 L57 60 L50 68 L43 60Z" fill="#eafff5"/><path d="M50 8 L50 66" stroke="#7fbfa0" stroke-width="2"/><rect x="33" y="62" width="34" height="7" rx="3.5" fill="#ffd23f"/><rect x="46.5" y="69" width="7" height="18" rx="3.5" fill="#c58a1b"/>';

  const CAPTURE = {
    L(r, c) { spot(r, c, 'fx-swords', '<svg viewBox="0 0 100 100"><g transform="rotate(45 50 50)">' + BLADE + '</g><g transform="rotate(-45 50 50)">' + BLADE + '</g></svg>', 720); },
    V(r, c) {
      let h = '';
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2 + rnd(0, 0.5), d = rnd(0.45, 1.0);
        h += '<i style="--dx:' + (Math.cos(a) * d).toFixed(2) + ';--dy:' + (Math.sin(a) * d).toFixed(2) + ';--s:' + rnd(0.6, 1.2).toFixed(2) + ';--t:' + Math.round(rnd(0, 160)) + 'ms">' + (i % 3 ? '✦' : '•') + '</i>';
      }
      spot(r, c, 'fx-stars', h, 1000);
    },
    M(r, c) {
      let rays = ''; for (let i = 0; i < 8; i++) rays += '<line x1="50" y1="50" x2="50" y2="10" transform="rotate(' + (i * 45) + ' 50 50)"/>';
      spot(r, c, 'fx-burst', '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="24" class="b-core"/><g class="b-rays">' + rays + '</g></svg>', 540);
    },
    G(r, c) { spot(r, c, 'fx-quake', '<i></i><i></i><i></i>', 950); },
    S(r, c, last) {
      const p = (y, d) => '<path pathLength="100" class="claw" style="--d:' + d + 'ms" d="M20 ' + (y + 8) + ' Q55 ' + (y - 14) + ' 96 ' + (y + 10) + '"/>';
      spot(r, c, 'fx-claws', '<svg viewBox="0 0 100 100" style="transform:rotate(' + moveAngle(last).toFixed(0) + 'deg)">' + p(26, 0) + p(48, 80) + p(70, 160) + '</svg>', 900);
    },
    N(r, c) {
      spot(r, c, 'fx-eyes', '<svg viewBox="0 0 100 100"><g class="eye"><path d="M12 50 Q29 33 46 50 Q29 67 12 50Z"/><circle cx="29" cy="50" r="5"/></g>' +
        '<g class="eye"><path d="M54 50 Q71 33 88 50 Q71 67 54 50Z"/><circle cx="71" cy="50" r="5"/></g></svg>', 680);
    }
  };

  /** Tia sét phân nhánh từ ô đi tới ô đến (chỉ Cận, hiệu ứng DI CHUYỂN). */
  function bolt(l) {
    const a = cellXY(l.fromRow, l.fromCol), b = cellXY(l.toRow, l.toCol);
    const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len, segs = Math.max(5, Math.round(len * 3.2));
    const pts = [[a.x, a.y]];
    for (let i = 1; i < segs; i++) { const t = i / segs, o = rnd(-0.26, 0.26); pts.push([a.x + dx * t + nx * o, a.y + dy * t + ny * o]); }
    pts.push([b.x, b.y]);
    const f = (v) => v.toFixed(2);
    let d = 'M' + pts.map((p) => f(p[0]) + ' ' + f(p[1])).join(' L');
    for (let k = 0; k < 3; k++) {
      const p = pts[1 + Math.floor(Math.random() * (pts.length - 2))], ang = Math.atan2(dy, dx) + (Math.random() < 0.5 ? -1 : 1) * rnd(0.6, 1.1), ln = rnd(0.5, 1.1);
      const q1 = [p[0] + Math.cos(ang) * ln * 0.5 + rnd(-0.08, 0.08), p[1] + Math.sin(ang) * ln * 0.5 + rnd(-0.08, 0.08)], q2 = [p[0] + Math.cos(ang) * ln, p[1] + Math.sin(ang) * ln];
      d += ' M' + f(p[0]) + ' ' + f(p[1]) + ' L' + f(q1[0]) + ' ' + f(q1[1]) + ' L' + f(q2[0]) + ' ' + f(q2[1]);
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
  window.CrownfallFx = Object.freeze({ play });
})();
