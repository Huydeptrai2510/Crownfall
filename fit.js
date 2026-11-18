/* CROWNFALL — fit.js — "barem" cho từng khung: mỗi nút / tab / nhãn điều hướng nằm trong một khung có kích thước riêng.
 * Script ĐO chữ so với khung (scrollWidth vs clientWidth); nếu tràn thì thu nhỏ cỡ chữ từng bước 6% (tối thiểu 65%) cho vừa khung.
 * Đo lại khi: đổi kích thước/xoay màn hình, đổi trang, nội dung đổi (trừ bàn cờ/đồng hồ để không gây lag). Chỉ đổi cách hiển thị.
 */
(function () {
  'use strict';
  const SEL = '.btn, .tab, .nav a, .pill';      // thêm selector vào đây để áp "barem" cho thành phần khác
  const STEP = 0.06, MIN = 0.65;
  const IGNORE = '#board, #rp-board, #gd-board, #op-players, #op-status, #history, #toast, .fx-layer, .clock';
  let timer = null;

  function shrink(el) {
    const base = parseFloat(getComputedStyle(el).fontSize); let f = 1;
    while (el.scrollWidth > el.clientWidth + 1 && f > MIN) { f = Math.round((f - STEP) * 100) / 100; el.style.fontSize = (base * f).toFixed(2) + 'px'; }
    el.dataset.fitScaled = String(f);
    if (el.scrollWidth > el.clientWidth + 1 && !el.title) { el.title = el.textContent.trim(); el.dataset.fitTitle = '1'; }   // vẫn chật: cho xem đủ chữ bằng tooltip
  }
  function run() {
    timer = null;
    const els = Array.from(document.querySelectorAll(SEL)).filter((e) => e.getClientRects().length);   // bỏ phần tử đang ẩn
    els.forEach((e) => { if (!e.classList.contains('fit')) e.classList.add('fit'); if (e.style.fontSize) e.style.fontSize = ''; });
    const over = els.filter((e) => e.scrollWidth > e.clientWidth + 1);
    els.forEach((e) => { if (over.indexOf(e) < 0 && e.dataset.fitScaled) { delete e.dataset.fitScaled; if (e.dataset.fitTitle) { e.removeAttribute('title'); delete e.dataset.fitTitle; } } });
    over.forEach(shrink);
  }
  const schedule = (ms) => { clearTimeout(timer); timer = setTimeout(run, ms === undefined ? 120 : ms); };

  const relevant = (muts) => muts.some((m) => { const t = m.target.nodeType === 1 ? m.target : m.target.parentElement; return t && !(t.closest && t.closest(IGNORE)); });
  const obs = new MutationObserver((muts) => { if (relevant(muts)) schedule(); });
  ['main', 'topbar', 'modal'].forEach((id) => { const n = document.getElementById(id); if (n) obs.observe(n, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['hidden'] }); });
  window.addEventListener('resize', () => schedule(150));
  window.addEventListener('orientationchange', () => schedule(250));
  window.addEventListener('hashchange', () => { schedule(80); setTimeout(() => schedule(0), 400); });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => schedule(0));
  schedule(300);
  window.CrownfallFit = Object.freeze({ run: () => schedule(0) });
})();
