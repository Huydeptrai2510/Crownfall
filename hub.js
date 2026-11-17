/* CROWNFALL — hub.js — Esports Hub ở Sảnh, @username bấm được, "Trận hiện tại" ở hồ sơ, gỡ giao diện Admin/Audit (nạp SAU script.js và bots.js).
 * Chỉ dùng RPC/bảng đã có trong mã hiện tại (get_global_leaderboard, get_weekly_leaderboard, get_player_profile, list_practice_bots).
 * Không thêm khóa bí mật, không tự quyết kết quả trận hay HELO.
 */
(function () {
  'use strict';
  const C = window.Crownfall;
  if (!C || !C.Phase4 || !C.Multiplayer) { console.error('[hub.js] Cần nạp sau script.js'); return; }
  const { Utils, UI, Router, Database } = C;
  const { Rpc } = C.Multiplayer;
  const { Fmt, Ranking, Player, Admin } = C.Phase4;
  const $ = Utils.$, $$ = Utils.$$, el = Utils.el;
  const uname = (u) => (u ? Fmt.link(u, '@' + u) : el('span', { class: 'muted', text: 'Ẩn danh' }));
  const empty = (t) => el('div', { class: 'empty' }, [el('p', { class: 'muted small', text: t })]);

  /* ---------- Dữ liệu ---------- */
  async function featured() {
    const lb = await Rpc.call('get_global_leaderboard', { p_limit: 3, p_offset: 0 });
    const rows = ((lb && lb.rows) || []).slice(0, 3), out = [];
    await Promise.all(rows.map(async (p) => {
      try {
        const d = await Rpc.call('get_player_profile', { p_username: p.username, p_match_offset: 0 });
        const m = (d.matches || []).find((x) => x.ranked && x.replay_available);
        if (m) out.push({ p, m });
      } catch (_) { /* bỏ qua: hồ sơ không xem được */ }
    }));
    return out.sort((a, b) => rows.indexOf(a.p) - rows.indexOf(b.p));
  }
  /** Trận đang diễn ra. Truy vấn bảng `matches` qua RLS hiện có; nếu không đọc được thì trả rỗng (không bịa dữ liệu). */
  async function fetchLive() {
    const c = Database.client; if (!c) return [];
    let res; try { res = await c.from('matches').select('*').eq('status', 'active').limit(12); } catch (_) { return []; }
    if (!res || res.error || !Array.isArray(res.data)) return [];
    const pick = (r, s) => r[s + '_user_id'] || r[s + '_player_id'] || r[s + '_id'] || null;
    const ids = []; res.data.forEach((r) => ['red', 'blue'].forEach((s) => { const v = pick(r, s); if (v) ids.push(v); }));
    const names = {};
    if (ids.length) { try { const pr = await c.from('profiles').select('user_id,username').in('user_id', ids); (pr.data || []).forEach((p) => { names[p.user_id] = p.username; }); } catch (_) { /* bỏ qua */ } }
    return res.data.map((r) => ({ id: r.id, mode: r.mode, ranked: !!r.ranked, red: names[pick(r, 'red')] || null, blue: names[pick(r, 'blue')] || null }));
  }
  async function bots() {
    const list = (await Rpc.call('list_practice_bots')) || [];
    const s = list.slice().sort((a, b) => a.elo - b.elo);
    if (s.length <= 3) return s;
    return [s[0], s[Math.floor(s.length / 2)], s[s.length - 1]];
  }
  async function weekly() { const r = await Rpc.call('get_weekly_leaderboard', { p_week_offset: 0, p_limit: 5, p_offset: 0 }); return (r && r.rows) || []; }

  /* ---------- Hiển thị ---------- */
  const Hub = {
    at: 0, busy: false, data: {},
    mount() {
      if (!$('#hub')) return;
      if (!this.at) { ['hub-feat', 'hub-live', 'hub-bots', 'hub-explore'].forEach((id) => $('#' + id).replaceChildren(el('p', { class: 'muted small', text: 'Đang tải…' }))); }
      if (Date.now() - this.at < 15000) { this.paint(); return; }
      this.refresh();
    },
    async refresh() {
      if (this.busy) return; this.busy = true;
      const [f, l, b, w] = await Promise.allSettled([featured(), fetchLive(), bots(), weekly()]);
      const v = (r) => (r.status === 'fulfilled' ? r.value : null);
      this.data = { feat: v(f), live: v(l), bots: v(b), weekly: v(w) };
      this.at = Date.now(); this.busy = false; this.paint();
    },
    paint() {
      const d = this.data;
      // Featured
      const feat = $('#hub-feat');
      if (feat) feat.replaceChildren(!d.feat ? empty('Không tải được dữ liệu.') : !d.feat.length ? empty('Chưa có trận Ranked nổi bật có thể xem.') :
        el('div', { class: 'fm-list' }, d.feat.map((x, i) => this.featCard(x, i === 0))));
      // Live
      const lv = $('#hub-live');
      if (lv) lv.replaceChildren(!d.live || !d.live.length ? empty('Hiện chưa có trận nào đang diễn ra (hoặc bạn chưa có quyền xem danh sách).') :
        el('ul', { class: 'lv-list' }, d.live.map((m) => this.liveRow(m))));
      // Bots
      const bt = $('#hub-bots'), BU = window.CrownfallBots && window.CrownfallBots.BotsUI;
      if (bt) bt.replaceChildren(!d.bots ? empty('Không tải được danh sách BOT.') : !d.bots.length ? empty('Hiện chưa có BOT nào đang hoạt động.') :
        !BU ? empty('Module BOT chưa được nạp.') : el('div', { class: 'bt-grid' }, d.bots.map((b) => BU.card(b))));
      // Explore
      const ex = $('#hub-explore');
      if (ex) {
        const top = d.weekly || [];
        ex.replaceChildren(
          el('p', { class: 'eyebrow', text: 'HELO tuần này' }),
          top.length ? el('ol', { class: 'ex-list' }, top.map((r) => el('li', {}, [el('span', { class: 'ex-rank', text: '#' + r.rank }), uname(r.username),
            el('span', { class: 'grow' }), el('span', { class: r.delta > 0 ? 'pos' : r.delta < 0 ? 'neg' : '', text: Fmt.delta(r.delta) })]))) : empty('Chưa có trận Ranked nào trong tuần này.'),
          el('div', { class: 'ex-links' }, [
            Fmt.btn('Bảng xếp hạng', 'ghost', () => Router.go('ranking')), Fmt.btn('Luyện tập với BOT', 'ghost', () => Router.go('bots')), Fmt.btn('Hướng dẫn', 'ghost', () => Router.go('guide'))]));
      }
    },
    featCard({ p, m }, hero) {
      const opp = m.opponent || {};
      return el('div', { class: 'fm-card' + (hero ? ' fm-hero' : '') }, [
        el('div', { class: 'fm-vs' }, [uname(p.username), el('span', { class: 'vs', text: 'VS' }), uname(opp.username)]),
        el('div', { class: 'fm-meta' }, [Ranking.badge(p.tier), el('span', { class: 'chip', text: 'HELO ' + p.rating }), Fmt.pill(m.result)]),
        el('p', { class: 'muted small', style: 'text-align:center;margin:0', text: m.plies + ' nước · ' + Fmt.end(m.end_reason) + ' · ' + Fmt.dt(m.ended_at) }),
        el('div', { class: 'row' }, [Fmt.btn('Xem replay', 'gold', () => Router.go('replay', { m: m.match_id }))])]);
    },
    liveRow(m) {
      const watch = Fmt.btn('Xem trận', 'gold', () => Router.go('match', { m: m.id }));
      return el('li', { class: 'lv-row' }, [el('span', { class: 'live-dot', 'aria-hidden': 'true' }),
        el('div', { class: 'grow' }, [el('span', {}, [uname(m.red), ' vs ', uname(m.blue)]), el('span', { class: 'muted small', text: Fmt.mode(m.mode, m.ranked) })]), watch]);
    },
    /** Hồ sơ người chơi: nếu đang trong một trận thì cho theo dõi (chỉ xem — vai trò khán giả do Match/RPC kiểm soát). */
    async playerLive(boxId) {
      const box = $('#' + boxId), S = Player.st[boxId]; if (!box || !S) return;
      const sec = el('div', { class: 'pl-live' }, [el('h2', {}, [el('span', { class: 'live-dot', 'aria-hidden': 'true' }), 'Trận hiện tại']), el('p', { class: 'muted small', text: 'Đang kiểm tra…' })]);
      const anchor = $('.stat-grid', box); if (anchor) anchor.before(sec); else box.append(sec);
      let list = []; try { list = await fetchLive(); } catch (_) { /* bỏ qua */ }
      if (!box.contains(sec)) return;
      const m = list.find((x) => x.red === S.d.username || x.blue === S.d.username);
      sec.replaceChildren(el('h2', {}, [el('span', { class: 'live-dot', 'aria-hidden': 'true' }), 'Trận hiện tại']),
        m ? el('div', { class: 'lv-row' }, [el('div', { class: 'grow' }, [el('span', {}, [uname(m.red), ' vs ', uname(m.blue)]), el('span', { class: 'muted small', text: Fmt.mode(m.mode, m.ranked) + ' · khán giả chỉ xem, không thao tác được' })]),
          Fmt.btn('Theo dõi trận', 'gold', () => Router.go('match', { m: m.id }))]) : el('p', { class: 'muted small', text: 'Người chơi này hiện không thi đấu (hoặc bạn không có quyền xem trận).' }));
    }
  };

  /* ---------- Gắn vào code hiện có (không sửa script.js) ---------- */
  UI.renderRoster = function () { /* Khu "Binh đoàn" đã được thay bằng Esports Hub */ };
  const oRenderHome = UI.renderHome;
  UI.renderHome = function () { oRenderHome.apply(this, arguments); try { Hub.mount(); } catch (e) { console.warn('[hub.js]', e); } };
  const oPlayerRender = Player.render;
  Player.render = async function (boxId) { const r = await oPlayerRender.apply(this, arguments); if (boxId === 'pl-body') { try { await Hub.playerLive(boxId); } catch (e) { console.warn('[hub.js]', e); } } return r; };

  /* ---------- Chỉ gỡ khung "Audit log" khỏi trang Admin/Boss (RPC, bảng log và function bảo mật ở backend giữ nguyên) ----------
   * Mọi khu khác của Admin/Boss (báo cáo, người dùng, trận đang diễn ra, cấu hình, quản lý BOT) vẫn hoạt động như cũ. */
  const oAdminRender = Admin.render;
  Admin.render = function () {
    oAdminRender.apply(this, arguments);
    const body = $('#ad-body'); if (!body) return;
    Array.from(body.children).forEach((ch) => {
      const h = ch.querySelector && ch.querySelector(':scope > h2');
      if (h && /^Audit log/.test(h.textContent)) ch.remove();
    });
  };

  /* ---------- @username bấm được (bạn bè, phòng chờ, bảng xếp hạng) ---------- */
  const SEL = '#friends-list span, #fr-list .grow, #fr-requests .grow, #fr-invites .grow, #lb-players .lb-name span, #lb-friends .grow';
  function linkify() {
    $$(SEL).forEach((s) => {
      if (s.children.length) return;
      const m = /^([\s\S]*?)\(@([a-z0-9_]{3,20})\)([\s\S]*)$/.exec(s.textContent); if (!m) return;
      const a = el('a', { href: '#/player?u=' + encodeURIComponent(m[2]), class: 'u-link', text: '@' + m[2] });
      s.textContent = ''; s.append(m[1], a, m[3]);
    });
    $$('#rk-body td.who a').forEach((a) => {
      const m = /^(.*) \(@([a-z0-9_]+)\)$/.exec(a.textContent); if (!m) return;
      a.textContent = '@' + m[2]; a.classList.add('u-link'); a.after(el('span', { class: 'who-name', text: m[1] }));
    });
  }
  let queued = false;
  const main = $('#main');
  if (main) new MutationObserver(() => { if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; linkify(); }); } }).observe(main, { childList: true, subtree: true });
})();
