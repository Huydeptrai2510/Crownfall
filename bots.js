/* CROWNFALL — bots.js — module MỞ RỘNG (nạp SAU script.js). Không sửa mã đang chạy trong script.js:
 *  - Boss: mục "Quản lý BOT" trong trang Boss (tạo/sửa/bật-tắt/chạy thử, thư viện engine).
 *  - Người chơi: "Luyện tập với BOT" ở mục Chơi (#/bots).
 *  - Tìm trận Rank: loading động, giai đoạn tìm kiếm, màn "đã tìm thấy đối thủ", phân biệt BOT.
 *  - Trận đấu với BOT: tự gọi Edge Function khi đến lượt bot, ẩn xin hòa/tái đấu, hiển thị "BOT đang suy nghĩ".
 * Mọi thao tác bot đi qua Edge Function `bot-gateway-a` (service_role nằm ở server). Không có khóa bí mật ở file này.
 */
(function () {
  'use strict';
  const C = window.Crownfall;
  if (!C || !C.Multiplayer || !C.Phase4) { console.error('[bots.js] Cần nạp sau script.js'); return; }
  const { Utils, UI, Router, Database, Auth, Profile } = C;
  const { Poller, Rpc, Match, Queue, RPC_ERRORS } = C.Multiplayer;
  const { Fmt, Ranking, Admin } = C.Phase4;
  const $ = Utils.$, $$ = Utils.$$, el = Utils.el;
  const GATEWAY = 'bot-gateway-a';

  // CSS riêng (cùng thư mục với index.html)
  const css = el('link', { rel: 'stylesheet', href: 'bots.css' }); document.head.append(css);

  Object.assign(RPC_ERRORS, {
    bot_not_found: 'Không tìm thấy bot.', bot_unavailable: 'Bot này hiện không khả dụng.', bot_no_algorithm: 'Bot chưa có thuật toán nên chưa bật được.',
    bot_test_failed: 'Thuật toán không vượt qua bài chạy thử.', bot_error: 'Thuật toán bot gặp lỗi khi chạy.', bot_timeout: 'Thuật toán bot chạy quá thời gian.',
    bot_bad_move: 'Bot trả nước đi sai định dạng.', draw_not_allowed_vs_bot: 'Không thể xin hòa với BOT.', gateway_unreachable: 'Không kết nối được máy chủ BOT.',
    not_boss: 'Chỉ Boss mới dùng được chức năng này.', unknown_action: 'Chức năng chưa được triển khai trên máy chủ.'
  });

  /* ---------- Fmt.mode: nhãn cho trận bot ---------- */
  const origMode = Fmt.mode;
  Fmt.mode = function (m, ranked) {
    if (m === 'bot_practice') return 'Luyện tập với BOT (không tính HELO)';
    if (m === 'bot_rank') return 'Quick Match với BOT (không tính HELO)';
    return origMode.call(this, m, ranked);
  };

  /* ---------- Gateway ---------- */
  const Gw = {
    async call(action, payload) {
      const { data, error } = await Database.client.functions.invoke(GATEWAY, { body: Object.assign({ action }, payload || {}) });
      if (error) {
        let j = null; try { j = await error.context.json(); } catch (_) { /* không có body */ }
        const e = new Error((j && j.error) || error.message || 'gateway_error'); e.detail = j && j.detail; throw e;
      }
      if (data && data.error) { const e = new Error(data.error); e.detail = data.detail; throw e; }
      return data;
    }
  };
  const gwMsg = (e) => Utils.mapError(e) + (e && e.detail ? ' — ' + String(e.detail).slice(0, 240) : '');
  async function busy(btn, fn) {
    if (btn.dataset.busy === '1') return; btn.dataset.busy = '1'; btn.disabled = true; btn.setAttribute('aria-busy', 'true');
    try { return await fn(); } catch (e) { UI.toast(gwMsg(e), true); } finally { btn.dataset.busy = '0'; btn.disabled = false; btn.removeAttribute('aria-busy'); }
  }
  const panel = (title, nodes) => el('div', { class: 'panel' }, [el('h2', { text: title })].concat(nodes));
  const btn = (label, kind, fn) => Fmt.btn(label, kind, fn);

  /* ---------- Giao diện gắn thêm vào trang ---------- */
  function inject() {
    // 1) Mục "Luyện tập với BOT" trong màn Chơi (trước nhóm "Chơi 1 máy")
    const modes = $('#screen-modes');
    if (modes && !$('#m-bot')) {
      const groups = $$('h2.group', modes), last = groups[groups.length - 1];
      const head = el('h2', { class: 'group', text: 'Luyện tập' });
      const card = el('div', { class: 'panel mode' }, [
        el('h2', { text: 'Luyện tập với BOT' }),
        el('p', { class: 'muted', text: 'Chọn một BOT theo độ mạnh để luyện tập. Trận luyện tập không tính HELO và không ảnh hưởng thứ hạng.' }),
        el('button', { id: 'm-bot', class: 'btn btn-gold', type: 'button', text: 'Chọn BOT' })]);
      if (last) { last.before(head, card); } else modes.append(head, card);
      $('#m-bot').addEventListener('click', () => Router.go('bots'));
    }
    // 2) Màn danh sách bot
    if (!$('#screen-bots')) {
      const sec = el('section', { id: 'screen-bots', class: 'screen', hidden: '' }, [
        el('div', { class: 'page-head' }, [el('p', { class: 'eyebrow', text: 'Luyện tập' }), el('h1', { text: 'Luyện tập với BOT' })]),
        el('div', { class: 'panel' }, [
          el('p', { class: 'muted', text: 'Trận luyện tập theo đúng luật Crownfall, không tính HELO, không xuất hiện trong bảng xếp hạng.' }),
          el('div', { class: 'grid two' }, [
            el('label', { class: 'field' }, [el('span', { text: 'Bạn chơi phe' }), el('select', { id: 'bt-side' }, [
              el('option', { value: 'random', text: 'Ngẫu nhiên' }), el('option', { value: 'red', text: 'Đỏ (đi trước)' }), el('option', { value: 'blue', text: 'Xanh' })])]),
            el('label', { class: 'field' }, [el('span', { text: 'Thời gian mỗi lượt' }), el('select', { id: 'bt-turn' }, [
              el('option', { value: '30', text: '30 giây' }), el('option', { value: '60', text: '60 giây' }), el('option', { value: '90', text: '90 giây', selected: '' }), el('option', { value: '120', text: '120 giây' })])])])]),
        el('div', { id: 'bt-list', class: 'bt-grid' }),
        el('div', { class: 'row' }, [el('button', { id: 'bt-back', class: 'btn btn-ghost', type: 'button', text: 'Quay lại' })])]);
      $('#main').append(sec);
      $('#bt-back').addEventListener('click', () => Router.go('modes'));
    }
    // 3) Màn tìm trận: tiến trình + "đã tìm thấy"
    const qs = $('#q-search');
    if (qs && !$('#q-phase')) {
      const loader = $('.loader', qs);
      const radar = el('div', { class: 'q-radar', 'aria-hidden': 'true' }, [el('i'), el('i'), el('i')]);
      if (loader) loader.replaceWith(radar); else qs.prepend(radar);
      const h1 = $('h1', qs); const phase = el('p', { id: 'q-phase', class: 'q-phase', role: 'status', 'aria-live': 'polite', text: 'Đang vào hàng chờ…' });
      h1.after(phase);
    }
    const qscreen = $('#screen-queue');
    if (qscreen && !$('#q-found')) {
      qscreen.append(el('div', { id: 'q-found', class: 'panel panel-narrow state-box q-found', hidden: '' }, [
        el('p', { class: 'eyebrow', text: 'Đã ghép trận' }), el('h1', { id: 'q-found-title', text: 'Đã tìm thấy đối thủ!' }),
        el('p', { id: 'q-found-name', class: 'q-found-name' }), el('p', { id: 'q-found-note', class: 'muted small' })]));
    }
  }
  inject();

  /* ---------- Router / UI.show ---------- */
  UI.screens.push('bots'); Router.PROTECTED.push('bots');
  const origShow = UI.show;
  UI.show = function (name) {
    origShow.call(this, name);
    if (name === 'bots') {
      $('#topbar').hidden = !Auth.user;
      $$('#topbar a[data-route]').forEach((a) => { if (a.dataset.route === 'modes') a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
      document.title = 'Luyện tập với BOT — Crownfall';
    }
  };
  const origRender = Router.render;
  Router.render = function () {
    origRender.apply(this, arguments);
    if (this.current() === 'bots' && Auth.user && Profile.data) BotsUI.enter();
  };

  /* ---------- Luyện tập với BOT (người chơi) ---------- */
  const BotsUI = {
    async enter() {
      const box = $('#bt-list'); box.replaceChildren(el('p', { class: 'muted', text: 'Đang tải danh sách BOT…' }));
      try {
        const bots = await Rpc.call('list_practice_bots');
        if (!bots.length) { box.replaceChildren(el('div', { class: 'empty' }, [el('p', { text: 'Hiện chưa có BOT nào đang hoạt động.' })])); return; }
        box.replaceChildren(...bots.map((b) => this.card(b)));
      } catch (e) { box.replaceChildren(el('p', { class: 'form-error', text: Utils.mapError(e) })); }
    },
    card(b) {
      const go = el('button', { type: 'button', class: 'btn btn-gold btn-sm', text: 'Đấu với BOT này' });
      go.addEventListener('click', () => busy(go, async () => {
        const r = await Rpc.call('start_bot_practice', { p_bot: b.id, p_side: $('#bt-side').value, p_turn_seconds: +$('#bt-turn').value });
        Router.go('match', { m: r.match_id });
      }));
      return el('div', { class: 'panel bot-card' }, [
        el('div', { class: 'bot-head' }, [el('span', { class: 'bot-tag', text: 'BOT' }), el('strong', { text: b.name })]),
        el('div', { class: 'row tight' }, [Ranking.badge(b.tier), el('span', { class: 'chip', text: 'Elo ' + b.elo })]),
        el('p', { class: 'muted small', text: b.description || 'Chưa có mô tả.' }), go]);
    },
    /* ----- tìm trận ----- */
    queuePhase(r) {
      const p = $('#q-phase'); if (!p) return;
      p.textContent = (r.phase === 'widening' ? 'Đang mở rộng phạm vi tìm kiếm' : 'Đang tìm đối thủ có Elo tương đương') + ' (±' + (r.range || 0) + ' Elo)…';
    },
    queueFound(r) {
      const o = r.opponent || {}, bot = !!r.vs_bot;
      $('#q-found-title').textContent = bot ? 'Đã tìm thấy đối thủ: BOT' : 'Đã tìm thấy đối thủ!';
      $('#q-found-name').textContent = (o.display_name || 'Đối thủ') + (r.opponent_elo !== undefined && r.opponent_elo !== null ? ' · Elo ' + r.opponent_elo : '');
      $('#q-found-note').textContent = bot ? 'Đây là BOT, không phải người chơi thật. Trận này không cộng/trừ HELO.' : 'Trận xếp hạng với người chơi thật.';
    }
  };

  const origView = Queue.view;
  Queue.view = function (v) { origView.call(this, v); const f = $('#q-found'); if (f) f.hidden = v !== 'found'; };
  const origHandle = Queue.handle;
  Queue.handle = function (r) {
    if (r && r.status === 'waiting') BotsUI.queuePhase(r);
    if (r && r.status === 'matched' && !this._foundShown) {
      this._foundShown = true; clearInterval(this.clock);
      BotsUI.queueFound(r); this.view('found');
      setTimeout(() => { this._foundShown = false; origHandle.call(this, r); }, 1500);   // chỉ để người chơi kịp đọc; việc ghép đã xong ở server
      return true;
    }
    const res = origHandle.call(this, r);
    if (r && r.status === 'expired') { const m = $('#q-fail-msg'); if (m) m.textContent = 'Hiện chưa có đối thủ hoặc BOT phù hợp. Hãy thử lại sau.'; }
    return res;
  };

  /* ---------- Trận đấu với BOT ---------- */
  const botSideOf = (d) => (d && d.red && d.red.is_bot ? 'red' : d && d.blue && d.blue.is_bot ? 'blue' : null);
  const BotDriver = {
    busy: false, key: '', at: 0,
    /** Đến lượt bot => nhờ máy chủ tính & áp nước đi (máy chủ tự kiểm luật và dùng nước dự phòng nếu bot lỗi). */
    maybe() {
      const d = Match.data; if (!d || d.status !== 'active' || !Match.isPlayer()) return;
      const bs = botSideOf(d); if (!bs || d.turn_side !== bs) return;
      const key = d.id + ':' + d.version, now = Date.now();
      if (this.busy || (this.key === key && now - this.at < 3000)) return;
      this.busy = true; this.key = key; this.at = now;
      Gw.call('move', { match_id: d.id }).catch((e) => console.warn('[bots.js] bot move', e && e.message))
        .finally(() => { this.busy = false; Match.rev = null; Poller.kick('match'); });
    }
  };
  const origApply = Match.apply;
  Match.apply = function () { const r = origApply.apply(this, arguments); try { BotDriver.maybe(); } catch (_) { /* bỏ qua */ } return r; };

  const origPresence = Match.presence;
  Match.presence = function (res) {
    const d = this.data;
    if (d && this.isPlayer() && botSideOf(d)) { this.online = { red: res.red_online, blue: res.blue_online }; return; }   // không báo "mất kết nối" cho bot
    return origPresence.apply(this, arguments);
  };

  const origPanel = Match.renderPanel;
  Match.renderPanel = function () {
    const r = origPanel.apply(this, arguments);
    try { decorateBotMatch(); } catch (_) { /* bỏ qua */ }
    return r;
  };
  const origStatus = Match.renderStatus;
  Match.renderStatus = function () {
    const r = origStatus.apply(this, arguments);
    const d = this.data, el0 = $('#op-status');
    if (d && el0 && botSideOf(d)) {
      if (d.status === 'active' && d.turn_side === botSideOf(d) && !this.sending) el0.textContent = 'BOT đang suy nghĩ…';
      else if (/mất kết nối/.test(el0.textContent)) el0.textContent = '';
    }
    return r;
  };
  function decorateBotMatch() {
    const d = Match.data; if (!d) return;
    const bs = botSideOf(d), draw = $('#btn-draw'); if (draw) draw.hidden = !!bs;
    if (!bs) return;
    ['btn-rematch', 'btn-rematch-no', 'op-rematch-status'].forEach((id) => { const n = $('#' + id); if (n) n.hidden = true; });
    const badge = $('#op-badge'); if (badge) badge.textContent = (d.mode === 'bot_practice' ? 'Luyện tập với BOT' : 'Xếp hạng · đấu BOT') + ' · không tính HELO' + (Match.isPlayer() ? '' : ' · Khán giả');
    $$('#op-players .op-row').forEach((row, i) => {
      const side = i === 0 ? 'red' : 'blue', dot = $('.dot', row);
      if (d[side] && d[side].is_bot) { if (dot) dot.className = 'dot on'; if (!$('.bot-tag', row)) row.insertBefore(el('span', { class: 'bot-tag', text: 'BOT' }), row.children[1]); }
    });
  }

  /* ---------- Quản lý BOT (Boss) ---------- */
  const BotAdmin = {
    host: null, bots: [], editor: null,
    async mount(host) {
      this.host = host; host.replaceChildren(panel('Quản lý BOT', [Fmt.empty('Đang tải…')]));
      try { const r = await Gw.call('admin_list'); this.bots = r.bots || []; this.render(); }
      catch (e) { host.replaceChildren(panel('Quản lý BOT', [el('p', { class: 'form-error', text: gwMsg(e) + ' — đã deploy Edge Function ' + GATEWAY + ' chưa?' })])); }
    },
    render() {
      const rows = this.bots.map((b) => el('tr', {}, [
        Fmt.td(b.name), Fmt.td(b.elo), Fmt.td('v' + b.algorithm_version), Fmt.td(b.enabled ? 'Đang bật' : 'Tắt', b.enabled ? 'pos' : ''),
        Fmt.td((b.allow_practice ? 'Luyện tập ' : '') + (b.allow_rank_fill ? 'Rank' : ''), 'hide-sm'), Fmt.td(b.finished + '/' + b.matches, 'hide-sm'), Fmt.td(b.bot_wins, 'hide-sm'),
        el('td', {}, [el('div', { class: 'row tight' }, [
          btn('Sửa', 'ghost', (x) => busy(x, () => this.edit(b))),
          btn(b.enabled ? 'Tắt' : 'Bật', b.enabled ? 'ghost' : 'gold', (x) => busy(x, async () => { await Gw.call('admin_toggle', { id: b.id, enabled: !b.enabled }); UI.toast('Đã cập nhật trạng thái bot.'); await this.mount(this.host); }))])])]));
      const table = rows.length ? el('div', { class: 'tbl-wrap' }, [el('table', { class: 'tbl' }, [
        el('thead', {}, [el('tr', {}, ['Tên', 'Elo', 'Thuật toán', 'Trạng thái', 'Dùng cho', 'Trận xong/tổng', 'Bot thắng', ''].map((h) => Fmt.th(h)))]), el('tbody', {}, rows)])]) : Fmt.empty('Chưa có bot nào.');
      this.editor = el('div', { id: 'bt-editor' });
      this.host.replaceChildren(panel('Quản lý BOT', [
        el('div', { class: 'row' }, [btn('Tạo bot mới', 'gold', (x) => busy(x, () => this.edit(null))), btn('Thư viện engine', 'ghost', (x) => busy(x, () => this.lib()))]),
        table, this.editor,
        Fmt.empty('Bot chỉ chạy ở server (sandbox QuickJS trên Supabase B). Bot chỉ bật được khi đã có thuật toán và đã vượt qua bài chạy thử. Trận với bot không tính HELO.')]));
    },
    async edit(b) {
      let code = '', note = '';
      if (b) { const r = await Gw.call('admin_code', { id: b.id }); code = r.code || ''; }
      const f = (id, label, node) => el('label', { class: 'field' }, [el('span', { text: label }), node]);
      const name = el('input', { id: 'bt-f-name', type: 'text', maxlength: '30', value: b ? b.name : '' });
      const desc = el('textarea', { id: 'bt-f-desc', rows: '2', maxlength: '500' }); desc.value = b ? b.description : '';
      const elo = el('input', { id: 'bt-f-elo', type: 'number', min: '0', max: '4000', step: '1', value: String(b ? b.elo : 800) });
      const pr = el('input', { type: 'checkbox' }); pr.checked = b ? b.allow_practice : true;
      const rk = el('input', { type: 'checkbox' }); rk.checked = b ? b.allow_rank_fill : true;
      const ta = el('textarea', { id: 'bt-f-code', class: 'code-area', rows: '16', spellcheck: 'false', autocapitalize: 'none', placeholder: 'function chooseMove(input) {\n  // trả về { from_row, from_col, to_row, to_col, action }\n}' });
      ta.value = code;
      const noteIn = el('input', { type: 'text', maxlength: '300', placeholder: 'Ghi chú phiên bản (tuỳ chọn)', value: note });
      const out = el('pre', { class: 'detail', hidden: '' });
      const test = btn('Chạy thử', 'ghost', (x) => busy(x, async () => {
        out.hidden = false; out.textContent = 'Đang chạy thử trên thế cờ ban đầu…';
        try { const r = await Gw.call('admin_test', b && ta.value === code ? { id: b.id } : { code: ta.value });
          out.textContent = (r.ok ? 'ĐẠT' : 'KHÔNG ĐẠT') + ' — ' + r.ms + ' ms — nước: ' + JSON.stringify(r.move) + ' — hợp lệ: ' + r.legal + ' (' + r.legal_count + ' nước hợp lệ)' + (r.engine_lib ? ' — có thư viện engine' : ' — CHƯA có thư viện engine'); }
        catch (e) { out.textContent = gwMsg(e); } }));
      const save = btn('Lưu bot', 'gold', (x) => busy(x, async () => {
        const payload = { id: b ? b.id : undefined, name: name.value.trim(), description: desc.value.trim(), elo: +elo.value, allow_practice: pr.checked, allow_rank_fill: rk.checked, note: noteIn.value.trim() };
        if (!b || ta.value !== code) payload.code = ta.value;
        const r = await Gw.call('admin_save', payload); UI.toast('Đã lưu bot' + (r.version ? ' (thuật toán v' + r.version + ')' : '') + '.'); await this.mount(this.host);
      }));
      this.editor.replaceChildren(el('hr', { class: 'rule' }), el('h3', { text: b ? 'Sửa bot: ' + b.name : 'Tạo bot mới' }),
        f('bt-f-name', 'Tên bot (2–30 ký tự)', name), f('bt-f-desc', 'Mô tả / đặc điểm', desc), f('bt-f-elo', 'Elo công bố (dùng để ghép theo Elo)', elo),
        el('label', { class: 'toggle' }, [pr, el('span', { text: 'Cho phép luyện tập' })]), el('label', { class: 'toggle' }, [rk, el('span', { text: 'Cho phép lấp hàng chờ Rank khi vắng người' })]),
        f('bt-f-code', 'Code thuật toán (JavaScript, định nghĩa hàm chooseMove(input))', ta), noteIn, out,
        el('div', { class: 'row' }, [test, save, btn('Đóng', 'ghost', () => this.editor.replaceChildren())]));
      this.editor.scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
    async lib() {
      const r = await Gw.call('admin_lib_get');
      const ta = el('textarea', { class: 'code-area', rows: '12', spellcheck: 'false' }); ta.value = r.code || '';
      this.editor.replaceChildren(el('hr', { class: 'rule' }), el('h3', { text: 'Thư viện engine (nạp trước mọi bot, đặt tên toàn cục Crownfall)' }),
        el('p', { class: 'muted small', text: 'Tạo bằng:  node tools/make_engine_lib.js script.js > engine_lib.js  rồi dán nội dung vào đây. Hiện tại: ' + (r.version ? 'v' + r.version : 'chưa có') + '.' }), ta,
        el('div', { class: 'row' }, [btn('Lưu thư viện engine', 'gold', (x) => busy(x, async () => { const s = await Gw.call('admin_lib_save', { code: ta.value }); UI.toast('Đã lưu thư viện engine v' + s.version + '.'); })),
          btn('Đóng', 'ghost', () => this.editor.replaceChildren())]));
    }
  };
  const origAdminRender = Admin.render;
  Admin.render = function () {
    origAdminRender.apply(this, arguments);
    if (this.isBoss()) { const host = el('div', { id: 'ad-bots' }); $('#ad-body').append(host); BotAdmin.mount(host); }
  };

  window.CrownfallBots = Object.freeze({ Gw, BotsUI, BotDriver, BotAdmin });
})();
