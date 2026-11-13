/* CROWNFALL — Phase 1 — script.js
 * Vanilla JS, không build. Supabase (Auth + API/RLS) qua supabase-js nạp từ CDN (dynamic import).
 * Mọi giá trị trong Config là URL công khai, KHÔNG phải secret. Tuyệt đối không đặt
 * connection string, API key hay mật khẩu database vào file này.
 */
(function () {
  'use strict';

  /* ===================================================================
   * CONFIG — Supabase (khóa publishable là khóa công khai, được phép nằm trong mã phía trình duyệt; dữ liệu được bảo vệ bằng RLS)
   * =================================================================== */
  const Config = Object.freeze({
    SDK_URL: 'https://esm.sh/@supabase/supabase-js@2',
    SUPABASE_URL: 'https://sbgeviczuyybyxsljfxb.supabase.co',
    SUPABASE_KEY: 'sb_publishable_A0U_oBiXCb-2FuvNgkCWRA_G9nzqjH9',
    USERNAME_RE: /^[a-z0-9_]{3,20}$/,
    // Đăng nhập chỉ bằng username + mật khẩu: app tự suy ra một email nội bộ từ username (không gửi/nhận thư thật).
    // Cần TẮT "Confirm email" trong Supabase Auth. Không có quên mật khẩu — mất mật khẩu là mất tài khoản.
    AUTH_EMAIL_DOMAIN: 'crownfall.app',
    PASSWORD_MIN: 8,
    RETRIES_READ: 2,
    PENDING_KEY: 'cf_pending_profile' // sessionStorage; chỉ chứa username/tên hiển thị, không có bí mật
  });

  /* ===================================================================
   * ASSET_CONFIG — toàn bộ ảnh do NGƯỜI DÙNG cung cấp (PNG 400x400 cho quân cờ).
   * !! Mọi tên file bên dưới là TÊN MẪU. Hãy thay bằng tên file thật của bạn,
   * đặt file ảnh cùng thư mục với index.html (basePath rỗng), rồi đổi `enabled` thành true.
   * Khi enabled = false, ảnh thiếu hoặc lỗi tải: hiện khung giữ chỗ có chữ.
   * =================================================================== */
  const ASSET_CONFIG = {
    enabled: true,
    basePath: '',                        // ảnh nằm CHUNG thư mục với index.html (để rỗng); muốn thư mục con thì ghi vd 'assets/'
    logo: 'logo.png',                    // TÊN MẪU
    defaultAvatar: 'avatar-default.png', // TÊN MẪU
    icons: {                             // TÊN MẪU
      'icon-home': 'icon-home.png',
      'icon-profile': 'icon-profile.png',
      'icon-settings': 'icon-settings.png'
    },
    sides: { red: 'Phe Đỏ', blue: 'Phe Xanh' },
    pieces: {                            // nhãn hiển thị (tiếng Việt) cho từng loại quân
      soldier: 'Lính', king: 'Vua', knight: 'Mã', bishop: 'Cận',
      wolf: 'Sói', bear: 'Gấu', ox: 'Ngưu', mage: 'Thuật'
    },
    tierImages: {                        // TÊN MẪU: ảnh bậc rank PNG 400x400, cùng thư mục với index.html (khóa = tên bậc viết thường). BẬC TỰ ĐẶT TÊN: không cần khai báo ở đây — chỉ cần file rank-<tên bỏ dấu, viết thường, không khoảng trắng>.png, vd bậc "Đồng Sắt" → rank-dongsat.png
      bronze: 'rank-bronze.png', silver: 'rank-silver.png', gold: 'rank-gold.png', platinum: 'rank-platinum.png',
      diamond: 'rank-diamond.png', master: 'rank-master.png', grandmaster: 'rank-grandmaster.png'
    },
    pieceImages: {                       // TÊN MẪU cho từng phe × từng quân
      red:  { soldier: 'red-soldier.png',  king: 'red-king.png',  knight: 'red-knight.png',  bishop: 'red-bishop.png',
              wolf: 'red-wolf.png',  bear: 'red-bear.png',  ox: 'red-ox.png',  mage: 'red-mage.png' },
      blue: { soldier: 'blue-soldier.png', king: 'blue-king.png', knight: 'blue-knight.png', bishop: 'blue-bishop.png',
              wolf: 'blue-wolf.png', bear: 'blue-bear.png', ox: 'blue-ox.png', mage: 'blue-mage.png' }
    }
  };

  /* ===================================================================
   * GAME ENGINE — Crownfall Beta 5.1 (thuần logic, không đụng DOM)
   * Quy ước: row/col 0–8 trong code; notation xuất ra 1–9. P1 ở trên, P2 ở dưới, P2 đi trước.
   *
   * ASSUMPTIONS — luật tài liệu chưa nêu rõ. Mỗi mục đã cô lập trong một hàm/hằng để đổi dễ dàng:
   *  A1 Lãnh thổ: P1 = hàng 0–3, P2 = hàng 5–8; hàng 4 (biên giới) không thuộc ai.
   *  A2 Lính: số đồng minh quanh mục tiêu đếm trên bàn TRƯỚC khi đi, tính cả chính Lính bắt nếu đứng kề
   *     (RULES_OPTIONS.SOLDIER_COUNTS_CAPTURER).
   *  A3 Sói: "vùng 5×5" = ô cách Sói tối đa 2 theo Chebyshev, cắt theo mép bàn (WolfRules.zone); nhảy qua quân;
   *     bắt thường = đúng cách 2 ô Chebyshev; có Thuật hỗ trợ = mọi quân địch trong vùng. Đường Cấm chỉ chặn ô đến.
   *  A4 Gấu chỉ bắt được khi đang đứng ở row 4 trước khi đi.
   *  A5 Vua–Thuật đổi chỗ không giới hạn khoảng cách; chỉ kiểm tra đúng các điều kiện tài liệu nêu.
   *  A6 Quân địch đã đứng sẵn trong Đường Cấm khi vùng hình thành vẫn được rời đi / bị bắt.
   *  A7 P1 = phe Xanh, P2 = phe Đỏ (FACTION).
   * =================================================================== */
  const SIZE = 9, BORDER_ROW = 4, SNAPSHOT_VERSION = 1, RULES_ID = 'crownfall-beta-5.1';
  const RULES_OPTIONS = { SOLDIER_COUNTS_CAPTURER: true };
  const FACTION = Object.freeze({ P1: 'blue', P2: 'red' });
  const PIECE_TYPES = Object.freeze({
    L: { key: 'soldier', name: 'Lính' }, V: { key: 'king', name: 'Vua' }, M: { key: 'knight', name: 'Mã' },
    C: { key: 'bishop', name: 'Cận' }, S: { key: 'wolf', name: 'Sói' }, G: { key: 'bear', name: 'Gấu' },
    N: { key: 'ox', name: 'Ngưu' }, T: { key: 'mage', name: 'Thuật' }
  });
  const BACK_RANK = ['T', 'S', 'M', 'C', 'V', 'C', 'N', 'G', 'T'];
  const DIRS_ORTH = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  const DIRS_ALL = DIRS_ORTH.concat([[-1, -1], [-1, 1], [1, -1], [1, 1]]);
  const GEOMETRY = {
    L: { dirs: DIRS_ALL, max: 2 }, V: { dirs: DIRS_ALL, max: 1 }, M: { dirs: DIRS_ALL, max: 8 }, C: { dirs: DIRS_ALL, max: 8 },
    G: { dirs: DIRS_ORTH, max: 1 }, N: { dirs: DIRS_ORTH, max: 2 }, T: { dirs: DIRS_ORTH, max: 1 }
  };
  const other = (o) => (o === 'P1' ? 'P2' : 'P1');
  const ckey = (r, c) => r * SIZE + c;

  const Piece = {
    create(owner, type, n, row, col) { return { id: owner + '-' + type + n, owner, type, row, col }; },
    ownsTerritory(owner, row) { return owner === 'P1' ? row <= 3 : row >= 5; },
    plain(p) { return { id: p.id, type: p.type, owner: p.owner, row: p.row, col: p.col }; }
  };

  const Board = {
    empty() { return Array.from({ length: SIZE }, () => Array(SIZE).fill(null)); },
    inside(r, c) { return r >= 0 && r < SIZE && c >= 0 && c < SIZE; },
    clone(b) { return b.map((row) => row.map((p) => (p ? Object.assign({}, p) : null))); },
    list(b, owner) {
      const out = [];
      for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) { const p = b[r][c]; if (p && (!owner || p.owner === owner)) out.push(p); }
      return out;
    },
    find(b, owner, type) { return Board.list(b, owner).filter((p) => p.type === type); },
    byId(b, id) { return Board.list(b).find((p) => p.id === id) || null; },
    relocate(b, p, r, c) { b[p.row][p.col] = null; p.row = r; p.col = c; b[r][c] = p; }
  };

  const ForbiddenZone = {
    /** Đường Cấm do `owner` tạo: các ô nằm GIỮA Mã và Ngưu cùng hàng/cột. */
    lineFor(board, owner) {
      const m = Board.find(board, owner, 'M')[0], n = Board.find(board, owner, 'N')[0];
      if (!m || !n) return null;
      const cells = [];
      if (m.row === n.row) { for (let c = Math.min(m.col, n.col) + 1; c < Math.max(m.col, n.col); c++) cells.push([m.row, c]); }
      else if (m.col === n.col) { for (let r = Math.min(m.row, n.row) + 1; r < Math.max(m.row, n.row); r++) cells.push([r, m.col]); }
      return cells.length ? { owner, cells } : null;
    },
    lines(board) { return ['P1', 'P2'].map((o) => ForbiddenZone.lineFor(board, o)).filter(Boolean); },
    /** Tập ô bị cấm đối với quân của `owner` (do đối phương tạo). Tính lại mỗi lần gọi => luôn khớp bàn cờ hiện tại. */
    against(board, owner) {
      const set = new Set(); const l = ForbiddenZone.lineFor(board, other(owner));
      if (l) l.cells.forEach(([r, c]) => set.add(ckey(r, c)));
      return set;
    }
  };

  const SpellPair = {
    active(board, owner) { const t = Board.find(board, owner, 'T'); return t.length === 2 && (t[0].row === t[1].row || t[0].col === t[1].col); }
  };
  const SpellSupport = {
    supported(board, p) { return p.type !== 'T' && Board.find(board, p.owner, 'T').some((t) => t.row === p.row || t.col === p.col); }
  };

  const WolfRules = {
    CAPTURE_DISTANCE: 2,
    /** Vùng 5×5 quanh Sói (A3): ô khác chính nó, cách tối đa 2 theo Chebyshev, nằm trong bàn. */
    zone(p) {
      const out = [];
      for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) {
        if ((dr || dc) && Board.inside(p.row + dr, p.col + dc)) out.push([p.row + dr, p.col + dc]);
      }
      return out;
    }
  };

  const CaptureRules = {
    /** Gấu ngoài biên giới bất tử (dựa vào vị trí, không dựa vào chủ sở hữu). */
    isImmune(target) { return target.type === 'G' && target.row !== BORDER_ROW; },
    alliesAround(board, p, r, c) {
      let n = 0;
      for (const [dr, dc] of DIRS_ALL) {
        const q = Board.inside(r + dr, c + dc) ? board[r + dr][c + dc] : null;
        if (q && q.owner === p.owner && (RULES_OPTIONS.SOLDIER_COUNTS_CAPTURER || q.id !== p.id)) n++;
      }
      return n;
    },
    /** Giả định mục tiêu là quân địch, nằm trong phạm vi di chuyển hợp lệ của p. */
    canCapture(board, p, target) {
      if (CaptureRules.isImmune(target)) return false;
      const sup = SpellSupport.supported(board, p);
      switch (p.type) {
        case 'L': return sup || CaptureRules.alliesAround(board, p, target.row, target.col) >= 2;
        case 'V': return sup;
        case 'M': case 'C': case 'N': return true;
        case 'S': return sup || Math.max(Math.abs(target.row - p.row), Math.abs(target.col - p.col)) === WolfRules.CAPTURE_DISTANCE;
        case 'G': return p.row === BORDER_ROW;
        case 'T': return SpellPair.active(board, p.owner);
        default: return false;
      }
    }
  };

  const MovementRules = {
    /** Ô có thể tới theo hình học + vật cản + Đường Cấm (chưa xét luật bắt). Dừng ở quân đầu tiên gặp. */
    reach(board, p) {
      const forb = ForbiddenZone.against(board, p.owner); const out = [];
      if (p.type === 'S') {
        WolfRules.zone(p).forEach(([r, c]) => {
          const q = board[r][c];
          if (!forb.has(ckey(r, c)) && (!q || q.owner !== p.owner)) out.push([r, c]);
        });
        return out;
      }
      const g = GEOMETRY[p.type];
      for (const [dr, dc] of g.dirs) {
        for (let s = 1; s <= g.max; s++) {
          const r = p.row + dr * s, c = p.col + dc * s;
          if (!Board.inside(r, c) || forb.has(ckey(r, c))) break;   // không vào, không đi xuyên Đường Cấm
          const q = board[r][c];
          if (!q) { out.push([r, c]); continue; }
          if (q.owner !== p.owner) out.push([r, c]);
          break;
        }
      }
      return out;
    },
    /** Nước đi giả-hợp-lệ (chưa xét Vua bị chiếu): di chuyển vào ô trống hoặc bắt quân địch đủ điều kiện. */
    moves(board, p) {
      const acts = [];
      for (const [r, c] of MovementRules.reach(board, p)) {
        const q = board[r][c];
        if (q && !CaptureRules.canCapture(board, p, q)) continue;
        acts.push({ action: q ? 'capture' : 'move', pieceId: p.id, pieceType: p.type, player: p.owner,
          fromRow: p.row, fromCol: p.col, toRow: r, toCol: c });
      }
      return acts;
    }
  };

  const Actions = {
    /** Áp dụng lên `board` (đã được clone khi dùng để kiểm tra). Trả về danh sách quân bị loại. */
    applyToBoard(board, a) {
      const p = board[a.fromRow][a.fromCol];
      if (a.action === 'swap') {
        const q = Board.byId(board, a.partnerId);
        const r1 = p.row, c1 = p.col, r2 = q.row, c2 = q.col;
        board[r1][c1] = q; board[r2][c2] = p; p.row = r2; p.col = c2; q.row = r1; q.col = c1;
        return [];
      }
      const captured = []; const t = board[a.toRow][a.toCol];
      if (t) {
        captured.push(Piece.plain(t)); board[t.row][t.col] = null;
        if (t.type === 'T') {   // một Thuật bị bắt => Thuật còn lại bị loại
          const partner = Board.find(board, t.owner, 'T')[0];
          if (partner) { captured.push(Piece.plain(partner)); board[partner.row][partner.col] = null; }
        }
      }
      Board.relocate(board, p, a.toRow, a.toCol);
      return captured;
    }
  };

  const KingCheck = {
    attackers(board, owner) {
      const k = Board.find(board, owner, 'V')[0]; if (!k) return [];
      return Board.list(board, other(owner)).filter((p) =>
        MovementRules.moves(board, p).some((m) => m.action === 'capture' && m.toRow === k.row && m.toCol === k.col));
    },
    isInCheck(board, owner) {
      const k = Board.find(board, owner, 'V')[0]; if (!k) return false;
      return Board.list(board, other(owner)).some((p) =>
        MovementRules.moves(board, p).some((m) => m.action === 'capture' && m.toRow === k.row && m.toCol === k.col));
    }
  };

  const KingSpellSwap = {
    /** Vua đổi chỗ Thuật: Thuật sang ô của Vua phải thuộc lãnh thổ mình, không nằm trong Đường Cấm đối phương; Vua không bị chiếu sau đổi. */
    actions(board, owner) {
      const k = Board.find(board, owner, 'V')[0]; if (!k) return [];
      if (!Piece.ownsTerritory(owner, k.row) || ForbiddenZone.against(board, owner).has(ckey(k.row, k.col))) return [];
      const out = [];
      for (const t of Board.find(board, owner, 'T')) {
        const a = { action: 'swap', pieceId: k.id, pieceType: 'V', player: owner, partnerId: t.id,
          fromRow: k.row, fromCol: k.col, toRow: t.row, toCol: t.col };
        const c = Board.clone(board); Actions.applyToBoard(c, a);
        if (!KingCheck.isInCheck(c, owner)) out.push(a);
      }
      return out;
    }
  };

  const Legal = {
    forPiece(board, p) {
      return MovementRules.moves(board, p).filter((a) => {
        const c = Board.clone(board); Actions.applyToBoard(c, a); return !KingCheck.isInCheck(c, p.owner);
      });
    },
    all(board, owner) {
      const out = [];
      Board.list(board, owner).forEach((p) => out.push(...Legal.forPiece(board, p)));
      return out.concat(KingSpellSwap.actions(board, owner));
    }
  };

  const Notation = {
    coord(r, c) { return (r + 1) + ',' + (c + 1); },
    format(rec) {
      const a = Notation.coord(rec.fromRow, rec.fromCol), b = Notation.coord(rec.toRow, rec.toCol);
      if (rec.actionType === 'swap') return 'V ' + a + '⇄T ' + b;
      return rec.pieceType + ' ' + a + (rec.actionType === 'capture' ? 'x' : '→') + b;
    }
  };

  const VictoryChecker = {
    /** Gọi sau khi đã chuyển lượt. `mover` là người vừa đi. Thắng: bắt Vua, hoặc đối phương hết nước hợp lệ (kể cả đổi Vua–Thuật). */
    evaluate(s, mover) {
      const next = s.turn;
      if (!Board.find(s.board, next, 'V').length) { s.winner = mover; s.winReason = 'king_captured'; s.inCheck = false; s._legal = []; return; }
      s.inCheck = KingCheck.isInCheck(s.board, next);
      const legal = Legal.all(s.board, next);
      if (!legal.length) { s.winner = mover; s.winReason = 'no_legal_moves'; s._legal = []; } else { s._legal = legal; }
    }
  };

  const GameState = {
    fromBoard(board, turn) {
      const s = { board, turn, moveNumber: 0, winner: null, winReason: null, inCheck: false, history: [], initialSnapshot: null, _legal: null };
      s.inCheck = KingCheck.isInCheck(board, turn);
      s.initialSnapshot = GameState.snapshot(s);
      return s;
    },
    /** list: [owner, type, row, col]. Id theo thứ tự xuất hiện: P2-L1, P2-L2… */
    fromPieces(list, turn) {
      const board = Board.empty(), cnt = {};
      list.forEach(([o, t, r, c]) => { const k = o + t; cnt[k] = (cnt[k] || 0) + 1; board[r][c] = Piece.create(o, t, cnt[k], r, c); });
      return GameState.fromBoard(board, turn || 'P2');
    },
    create() {
      const list = [];
      [['P1', 0, 1], ['P2', 8, 7]].forEach(([o, back, front]) => {
        BACK_RANK.forEach((t, c) => list.push([o, t, back, c]));
        for (let c = 0; c < SIZE; c++) list.push([o, 'L', front, c]);
      });
      return GameState.fromPieces(list, 'P2');   // P2 đi trước
    },
    legal(s) { if (s.winner) return []; if (!s._legal) s._legal = Legal.all(s.board, s.turn); return s._legal; },
    apply(s, a) {
      if (s.winner) throw new Error('Ván đấu đã kết thúc');
      const m = GameState.legal(s).find((x) => x.action === a.action && x.pieceId === a.pieceId && x.toRow === a.toRow &&
        x.toCol === a.toCol && (x.partnerId || null) === (a.partnerId || null));
      if (!m) throw new Error('Nước đi không hợp lệ');
      const mover = s.turn; const cap = Actions.applyToBoard(s.board, m);
      s.moveNumber++; s.turn = other(mover); s._legal = null;
      VictoryChecker.evaluate(s, mover);
      const rec = { moveNumber: s.moveNumber, playerId: mover, pieceId: m.pieceId, pieceType: m.pieceType,
        fromRow: m.fromRow, fromCol: m.fromCol, toRow: m.toRow, toCol: m.toCol,
        capturedPiece: cap.length ? Object.assign({}, cap[0], { chain: cap.slice(1) }) : null,
        actionType: m.action, partnerId: m.partnerId || null, createdAt: new Date().toISOString(), notation: '', stateSnapshot: null };
      rec.notation = Notation.format(rec) + (s.winner ? '#' : (s.inCheck ? '+' : ''));
      rec.stateSnapshot = GameState.snapshot(s);
      s.history.push(rec);
      return rec;
    },
    /** Snapshot JSONB có version — dùng lưu DB và khôi phục. */
    snapshot(s) {
      return { version: SNAPSHOT_VERSION, rules: RULES_ID, turn: s.turn, move_number: s.moveNumber, winner: s.winner,
        win_reason: s.winReason, board: Board.list(s.board).map(Piece.plain) };
    },
    fromSnapshot(snap) {
      if (!snap || snap.version !== SNAPSHOT_VERSION || !Array.isArray(snap.board) || !['P1', 'P2'].includes(snap.turn)) throw new Error('Snapshot không hợp lệ');
      const board = Board.empty(), ids = new Set();
      snap.board.forEach((p) => {
        if (!PIECE_TYPES[p.type] || !['P1', 'P2'].includes(p.owner) || !Number.isInteger(p.row) || !Number.isInteger(p.col) ||
          !Board.inside(p.row, p.col) || board[p.row][p.col] || ids.has(p.id)) throw new Error('Snapshot không hợp lệ');
        ids.add(p.id); board[p.row][p.col] = Piece.plain(p);
      });
      const s = GameState.fromBoard(board, snap.turn);
      s.moveNumber = snap.move_number | 0; s.winner = snap.winner || null; s.winReason = snap.win_reason || null;
      s.initialSnapshot = GameState.snapshot(s);
      return s;
    }
  };

  const MoveHistory = {
    list(s) { return s.history; },
    undo(s) {
      if (!s.history.length) return s;
      const hist = s.history.slice(0, -1);
      const n = GameState.fromSnapshot(hist.length ? hist[hist.length - 1].stateSnapshot : s.initialSnapshot);
      n.history = hist; n.initialSnapshot = s.initialSnapshot;
      return n;
    },
    /** Hàng dữ liệu theo contract match_moves (Phase 3 sẽ do database function xác thực và ghi). */
    toRow(rec, matchId) {
      return { match_id: matchId || null, move_number: rec.moveNumber, player_id: rec.playerId, piece_id: rec.pieceId,
        piece_type: rec.pieceType, from_row: rec.fromRow, from_col: rec.fromCol, to_row: rec.toRow, to_col: rec.toCol,
        captured_piece: rec.capturedPiece, action_type: rec.actionType, created_at: rec.createdAt, state_snapshot: rec.stateSnapshot };
    }
  };

  /* ===================================================================
   * TESTS (logic engine) — chạy: Crownfall.Tests.run() trong console, hoặc bằng Node (xem README)
   * =================================================================== */
  const Tests = {
    run() {
      const results = [];
      const t = (name, fn) => { try { results.push({ name, ok: fn() === true }); } catch (e) { results.push({ name, ok: false, detail: e.message }); } };
      const mk = (list, turn) => GameState.fromPieces(list, turn || 'P2');
      const mv = (s, id) => MovementRules.moves(s.board, Board.byId(s.board, id));
      const has = (arr, r, c, act) => arr.some((m) => m.toRow === r && m.toCol === c && (!act || m.action === act));
      const lg = (s, id) => GameState.legal(s).filter((a) => a.pieceId === id);

      t('Đội hình 36 quân (18/phe, đúng số lượng từng loại)', () => {
        const s = GameState.create(); const want = { L: 9, V: 1, M: 1, C: 2, S: 1, G: 1, N: 1, T: 2 };
        return Board.list(s.board).length === 36 && ['P1', 'P2'].every((o) => Board.list(s.board, o).length === 18 &&
          Object.keys(want).every((k) => Board.find(s.board, o, k).length === want[k]));
      });
      t('Đội hình đúng hàng: P1 hàng 0/1, P2 hàng 8/7, hàng giữa trống', () => {
        const s = GameState.create(); const row = (r) => s.board[r].map((p) => (p ? p.type : '.')).join('');
        return row(0) === 'TSMCVCNGT' && row(8) === 'TSMCVCNGT' && row(1) === 'LLLLLLLLL' && row(7) === 'LLLLLLLLL' &&
          [2, 3, 4, 5, 6].every((r) => row(r) === '.........') && s.board[0][0].owner === 'P1' && s.board[8][0].owner === 'P2';
      });
      t('P2 đi trước, sau nước đi đến lượt P1, số nước tăng', () => {
        const s = GameState.create(); if (s.turn !== 'P2') return false;
        const rec = GameState.apply(s, GameState.legal(s)[0]); return s.turn === 'P1' && s.moveNumber === 1 && rec.playerId === 'P2';
      });
      t('Không thể đi sai lượt / nước không hợp lệ', () => {
        const s = GameState.create(); const bad = { action: 'move', pieceId: 'P1-L1', toRow: 2, toCol: 0 };
        try { GameState.apply(s, bad); return false; } catch (e) { return true; }
      });
      t('Lính: 16 ô giữa bàn; bị chặn 1 hướng còn 14', () => {
        const a = mk([['P2', 'L', 4, 4]]), b = mk([['P2', 'L', 4, 4], ['P2', 'L', 3, 4]]);
        return mv(a, 'P2-L1').length === 16 && mv(b, 'P2-L1').length === 14;
      });
      t('Lính đi 2 ô không xuyên quân', () => {
        const s = mk([['P2', 'L', 4, 4], ['P1', 'L', 4, 5]]); const m = mv(s, 'P2-L1');
        return !has(m, 4, 6) && !has(m, 4, 5, 'capture');
      });
      t('Vua đi 8 hướng, 1 ô', () => mv(mk([['P2', 'V', 4, 4]]), 'P2-V1').length === 8);
      t('Mã & Cận: trượt 8 hướng, không xuyên quân', () => {
        const a = mk([['P2', 'M', 4, 4]]), b = mk([['P2', 'C', 4, 4], ['P2', 'L', 4, 6]]);
        return mv(a, 'P2-M1').length === 32 && has(mv(b, 'P2-C1'), 4, 5) && !has(mv(b, 'P2-C1'), 4, 6) && !has(mv(b, 'P2-C1'), 4, 7);
      });
      t('Sói: vùng 5×5 (24 ô) và nhảy qua quân', () => {
        const a = mk([['P2', 'S', 4, 4]]), b = mk([['P2', 'S', 4, 4], ['P2', 'L', 4, 5]]);
        return mv(a, 'P2-S1').length === 24 && mv(b, 'P2-S1').length === 23 && has(mv(b, 'P2-S1'), 4, 6, 'move');
      });
      t('Gấu: 4 hướng, 1 ô; Thuật: 4 hướng, 1 ô', () =>
        mv(mk([['P2', 'G', 4, 4]]), 'P2-G1').length === 4 && mv(mk([['P2', 'T', 4, 4]]), 'P2-T1').length === 4);
      t('Ngưu: ngang/dọc tối đa 2 ô, không xuyên quân', () => {
        const a = mk([['P2', 'N', 4, 4]]), b = mk([['P2', 'N', 4, 4], ['P2', 'L', 3, 4]]);
        return mv(a, 'P2-N1').length === 8 && !has(mv(b, 'P2-N1'), 3, 4) && !has(mv(b, 'P2-N1'), 2, 4);
      });
      t('Lính cần 2 đồng minh quanh mục tiêu để bắt', () => {
        const a = mk([['P2', 'L', 5, 4], ['P1', 'L', 4, 4]]);
        const b = mk([['P2', 'L', 5, 4], ['P2', 'L', 5, 3], ['P1', 'L', 4, 4]]);
        return !has(mv(a, 'P2-L1'), 4, 4, 'capture') && has(mv(b, 'P2-L1'), 4, 4, 'capture');
      });
      t('Vua không bắt thường; bắt được khi Thuật hỗ trợ', () => {
        const a = mk([['P2', 'V', 5, 4], ['P1', 'L', 4, 4]]), b = mk([['P2', 'V', 5, 4], ['P1', 'L', 4, 4], ['P2', 'T', 5, 0]]);
        return !has(mv(a, 'P2-V1'), 4, 4, 'capture') && has(mv(b, 'P2-V1'), 4, 4, 'capture');
      });
      t('Thuật hỗ trợ bỏ điều kiện 2 đồng minh của Lính', () =>
        has(mv(mk([['P2', 'L', 5, 4], ['P1', 'L', 4, 4], ['P2', 'T', 5, 0]]), 'P2-L1'), 4, 4, 'capture'));
      t('Hỗ trợ: cùng hàng/cột với Thuật, không phải Thuật', () => {
        const s = mk([['P2', 'M', 5, 4], ['P2', 'T', 5, 0], ['P2', 'C', 3, 3]]);
        return SpellSupport.supported(s.board, Board.byId(s.board, 'P2-M1')) && !SpellSupport.supported(s.board, Board.byId(s.board, 'P2-C1')) &&
          !SpellSupport.supported(s.board, Board.byId(s.board, 'P2-T1'));
      });
      t('Mã, Cận, Ngưu bắt tự do (và Ngưu bị chặn thì không)', () => {
        const m = mk([['P2', 'M', 6, 4], ['P1', 'L', 3, 4]]), c = mk([['P2', 'C', 6, 6], ['P1', 'L', 3, 3]]);
        const n = mk([['P2', 'N', 5, 4], ['P1', 'L', 3, 4]]), n2 = mk([['P2', 'N', 5, 4], ['P1', 'L', 3, 4], ['P1', 'L', 4, 4]]);
        return has(mv(m, 'P2-M1'), 3, 4, 'capture') && has(mv(c, 'P2-C1'), 3, 3, 'capture') && has(mv(n, 'P2-N1'), 3, 4, 'capture') &&
          !has(mv(n2, 'P2-N1'), 3, 4);
      });
      t('Sói: bắt đúng cách 2 ô, nhảy qua quân; kề thì không bắt (trừ khi có Thuật)', () => {
        const a = mk([['P2', 'S', 4, 4], ['P1', 'L', 4, 6]]), b = mk([['P2', 'S', 4, 4], ['P1', 'L', 4, 5]]);
        const c = mk([['P2', 'S', 4, 4], ['P2', 'L', 4, 5], ['P1', 'L', 4, 6]]), d = mk([['P2', 'S', 4, 4], ['P1', 'L', 5, 5], ['P2', 'T', 4, 0]]);
        return has(mv(a, 'P2-S1'), 4, 6, 'capture') && !has(mv(b, 'P2-S1'), 4, 5, 'capture') && has(mv(c, 'P2-S1'), 4, 6, 'capture') &&
          has(mv(d, 'P2-S1'), 5, 5, 'capture');
      });
      t('Gấu chỉ bắt khi đứng trên biên giới (row 4)', () => {
        const a = mk([['P2', 'G', 4, 4], ['P1', 'L', 4, 5]]), b = mk([['P2', 'G', 5, 4], ['P1', 'L', 4, 4]]);
        return has(mv(a, 'P2-G1'), 4, 5, 'capture') && !has(mv(b, 'P2-G1'), 4, 4, 'capture');
      });
      t('Gấu bất tử ngoài biên (kể cả có Thuật hỗ trợ)', () => {
        const a = mk([['P2', 'M', 6, 4], ['P1', 'G', 2, 4]]);
        const b = mk([['P2', 'L', 3, 4], ['P1', 'G', 2, 4], ['P2', 'T', 3, 0]]);
        return !has(mv(a, 'P2-M1'), 2, 4) && !has(mv(b, 'P2-L1'), 2, 4, 'capture');
      });
      t('Gấu trên biên giới có thể bị bắt (cả Gấu phe nào)', () => {
        const a = mk([['P2', 'M', 6, 4], ['P1', 'G', 4, 4]]), b = mk([['P1', 'M', 2, 4], ['P2', 'G', 4, 4]], 'P1');
        return has(mv(a, 'P2-M1'), 4, 4, 'capture') && has(mv(b, 'P1-M1'), 4, 4, 'capture');
      });
      t('Cặp Thuật: chỉ bắt khi 2 Thuật cùng hàng/cột', () => {
        const a = mk([['P2', 'T', 4, 4], ['P2', 'T', 4, 0], ['P1', 'L', 4, 5]]), b = mk([['P2', 'T', 4, 4], ['P2', 'T', 1, 1], ['P1', 'L', 4, 5]]);
        return SpellPair.active(a.board, 'P2') && has(mv(a, 'P2-T1'), 4, 5, 'capture') && !SpellPair.active(b.board, 'P2') &&
          !has(mv(b, 'P2-T1'), 4, 5, 'capture');
      });
      t('Một Thuật bị bắt thì Thuật còn lại bị loại', () => {
        const s = mk([['P2', 'M', 6, 4], ['P2', 'V', 8, 8], ['P1', 'T', 3, 4], ['P1', 'T', 0, 0], ['P1', 'V', 0, 8]]);
        const rec = GameState.apply(s, { action: 'capture', pieceId: 'P2-M1', toRow: 3, toCol: 4 });
        return Board.find(s.board, 'P1', 'T').length === 0 && rec.capturedPiece.chain.length === 1;
      });
      t('Đường Cấm ngang: địch không vào / không xuyên', () => {
        const s = mk([['P2', 'M', 6, 1], ['P2', 'N', 6, 6], ['P1', 'C', 2, 3]], 'P1'); const m = mv(s, 'P1-C1');
        return ForbiddenZone.lineFor(s.board, 'P2').cells.length === 4 && has(m, 5, 3) && !has(m, 6, 3) && !has(m, 7, 3);
      });
      t('Đường Cấm dọc: địch không đi vào cột cấm', () => {
        const s = mk([['P2', 'M', 2, 1], ['P2', 'N', 6, 1], ['P1', 'C', 4, 0]], 'P1');
        return ForbiddenZone.lineFor(s.board, 'P2').cells.length === 3 && !mv(s, 'P1-C1').some((m) => m.toCol === 1 && m.toRow >= 3 && m.toRow <= 5);
      });
      t('Đường Cấm biến mất rồi xuất hiện lại; nhiều đường cùng lúc; phe mình đi qua được', () => {
        const s = mk([['P2', 'M', 6, 1], ['P2', 'N', 6, 6], ['P1', 'M', 2, 1], ['P1', 'N', 2, 6], ['P2', 'L', 5, 3]]);
        const n = Board.byId(s.board, 'P2-N1'); const two = ForbiddenZone.lines(s.board).length === 2;
        Board.relocate(s.board, n, 5, 6); const gone = !ForbiddenZone.lineFor(s.board, 'P2');
        Board.relocate(s.board, n, 6, 6); const back = !!ForbiddenZone.lineFor(s.board, 'P2');
        return two && gone && back && has(mv(s, 'P2-L1'), 6, 3, 'move');
      });
      t('Vua–Thuật đổi chỗ hợp lệ trong lãnh thổ, tính là một lượt', () => {
        const s = mk([['P2', 'V', 6, 4], ['P2', 'T', 8, 0], ['P1', 'V', 0, 8]]);
        const sw = GameState.legal(s).find((a) => a.action === 'swap'); if (!sw) return false;
        const rec = GameState.apply(s, sw);
        return rec.actionType === 'swap' && s.board[8][0].type === 'V' && s.board[6][4].type === 'T' && s.turn === 'P1';
      });
      t('Không đổi Vua–Thuật khi Vua đứng ngoài lãnh thổ (hàng biên giới)', () =>
        !GameState.legal(mk([['P2', 'V', 4, 4], ['P2', 'T', 8, 0]])).some((a) => a.action === 'swap'));
      t('Không đổi Vua–Thuật nếu sau đổi Vua bị chiếu', () =>
        !GameState.legal(mk([['P2', 'V', 6, 4], ['P2', 'T', 6, 0], ['P1', 'C', 0, 0]])).some((a) => a.action === 'swap'));
      t('Không đổi Vua–Thuật nếu ô mới của Thuật nằm trong Đường Cấm địch', () => {
        const list = [['P2', 'V', 5, 4], ['P2', 'T', 8, 2], ['P2', 'L', 5, 3], ['P1', 'M', 5, 0], ['P1', 'N', 5, 8]];
        const a = mk(list), b = mk(list.slice(0, 4));
        return !GameState.legal(a).some((x) => x.action === 'swap') && GameState.legal(b).some((x) => x.action === 'swap');
      });
      t('Vua không được tự đi vào thế chiếu', () => {
        const s = mk([['P2', 'V', 6, 4], ['P1', 'C', 0, 5], ['P1', 'V', 0, 8]]); const k = lg(s, 'P2-V1');
        return !has(k, 6, 5) && has(k, 6, 3);
      });
      t('Thoát chiếu: đi Vua, chặn đường, đổi Vua–Thuật; nước khác bị loại', () => {
        const s = mk([['P2', 'V', 6, 4], ['P1', 'C', 0, 4], ['P2', 'L', 5, 3], ['P2', 'L', 8, 8], ['P2', 'T', 8, 1]]);
        const L = GameState.legal(s);
        return s.inCheck && has(L.filter((a) => a.pieceId === 'P2-V1'), 6, 3) && has(L.filter((a) => a.pieceId === 'P2-L1'), 5, 4) &&
          L.some((a) => a.action === 'swap') && !has(L.filter((a) => a.pieceId === 'P2-L2'), 7, 8);
      });
      t('Vua bị chiếu không đồng nghĩa thua (ván tiếp tục)', () => {
        const s = mk([['P2', 'V', 6, 4], ['P1', 'C', 0, 4], ['P2', 'L', 5, 3]]); return s.inCheck && !s.winner && GameState.legal(s).length > 0;
      });
      t('Bắt Vua = thắng', () => {
        const s = mk([['P2', 'M', 6, 4], ['P2', 'V', 8, 8], ['P1', 'V', 2, 4]]);
        GameState.apply(s, { action: 'capture', pieceId: 'P2-M1', toRow: 2, toCol: 4 });
        return s.winner === 'P2' && s.winReason === 'king_captured' && GameState.legal(s).length === 0;
      });
      t('Hết nước đi hợp lệ = thua (không hòa)', () => {
        const s = mk([['P1', 'V', 0, 0], ['P2', 'C', 7, 1], ['P2', 'M', 7, 0], ['P2', 'V', 8, 8]], 'P1');
        VictoryChecker.evaluate(s, 'P2'); return s.winner === 'P2' && s.winReason === 'no_legal_moves';
      });
      t('Notation tọa độ 1–9', () => {
        const s = GameState.create(); const rec = GameState.apply(s, GameState.legal(s).find((a) => a.pieceId === 'P2-L1' && a.toRow === 6 && a.toCol === 0));
        return Notation.coord(0, 0) === '1,1' && Notation.coord(8, 8) === '9,9' && rec.notation === 'L 8,1→7,1';
      });
      t('Bản ghi nước đi đủ trường + snapshot có version', () => {
        const s = GameState.create(); const rec = GameState.apply(s, GameState.legal(s)[0]);
        const row = MoveHistory.toRow(rec, 'm1');
        return ['move_number', 'player_id', 'piece_id', 'piece_type', 'from_row', 'from_col', 'to_row', 'to_col', 'captured_piece', 'action_type', 'created_at', 'state_snapshot']
          .every((k) => k in row) && row.state_snapshot.version === 1 && !!rec.createdAt;
      });
      t('Snapshot khôi phục đúng trạng thái và nước đi hợp lệ', () => {
        const s = GameState.create(); GameState.apply(s, GameState.legal(s)[0]);
        const r = GameState.fromSnapshot(JSON.parse(JSON.stringify(GameState.snapshot(s))));
        return JSON.stringify(GameState.snapshot(r)) === JSON.stringify(GameState.snapshot(s)) && GameState.legal(r).length === GameState.legal(s).length;
      });
      t('Snapshot sai version bị từ chối', () => { try { GameState.fromSnapshot({ version: 99, turn: 'P1', board: [] }); return false; } catch (e) { return true; } });
      t('Hoàn tác về từng trạng thái trước', () => {
        let s = GameState.create(); const init = JSON.stringify(GameState.snapshot(s));
        GameState.apply(s, GameState.legal(s)[0]); const one = JSON.stringify(GameState.snapshot(s)); GameState.apply(s, GameState.legal(s)[0]);
        s = MoveHistory.undo(s); const a = JSON.stringify(GameState.snapshot(s)) === one && s.history.length === 1;
        s = MoveHistory.undo(s); return a && JSON.stringify(GameState.snapshot(s)) === init && s.history.length === 0;
      });
      /* --- Phase 3: logic client (không cần mạng/DB; hành vi phía database kiểm bằng cf_selftest() + kịch bản trong README) --- */
      t('P3 mergeMoves: nối thêm / thay toàn bộ / lệch => null', () => {
        const a = [{ move_number: 1 }], b = [{ move_number: 2 }];
        return mergeMoves(a, b, 1, 2).length === 2 && mergeMoves([], [a[0], b[0]], 0, 2).length === 2 && mergeMoves(a, b, 0, 5) === null &&
          mergeMoves(a, b, 3, 2) === null && mergeMoves(a, [], 1, 1).length === 1;
      });
      t('P3 mã lỗi RPC được dịch sang tiếng Việt', () => ['not_your_turn', 'room_full', 'version_conflict', 'invalid_code', 'rematch_declined']
        .every((k) => Utils.mapError({ message: k, code: 'P0001' }) === RPC_ERRORS[k] && RPC_ERRORS[k].length > 5));
      t('P3 Poller: mỗi key đúng một vòng, stop/stopAll dọn sạch', () => {
        const a = Poller.start('__t', () => {}, 50), b = Poller.start('__t', () => {}, 50);
        const ok = Poller.loops.size === 1 && a.stopped === true && b.stopped === false && Poller.loops.get('__t') === b;
        Poller.stopAll(); return ok && Poller.loops.size === 0 && b.stopped;
      });
      t('P3 Clock.fmt', () => Clock.fmt(-5) === '0:00' && Clock.fmt(60000) === '1:00' && Clock.fmt(1) === '0:01' && Clock.fmt(125000) === '2:05');
      t('P3 uuid4 đúng dạng v4', () => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(uuid4()) && uuid4() !== uuid4());
      t('P3 Khán giả/không đúng lượt/đang chờ xác minh không được đi', () => {
        const keep = { d: Match.data, r: Match.role, s: Match.sending, p: Match.pending, b: Match.busy, n: Net.bad };
        try {
          Match.sending = false; Match.pending = null; Match.busy = false; Net.bad = 0;
          Match.data = { status: 'active', turn_side: 'red' };
          Match.role = 'red'; const mine = Match.canMove();
          Match.role = 'blue'; const notMyTurn = Match.canMove();
          Match.role = 'spectator'; const spec = Match.canMove();
          Match.role = 'red'; Match.pending = { cid: 'x', version: 0 }; const pend = Match.canMove(); Match.pending = null;
          Match.data = { status: 'finished', turn_side: 'red' }; const done = Match.canMove();
          return mine === true && notMyTurn === false && spec === false && pend === false && done === false;
        } finally { Match.data = keep.d; Match.role = keep.r; Match.sending = keep.s; Match.pending = keep.p; Match.busy = keep.b; Net.bad = keep.n; }
      });
      t('P3 Snapshot server (có winner do hết giờ/đầu hàng) vẫn đọc được', () => {
        const sn = GameState.snapshot(GameState.create()); sn.winner = 'P1'; sn.win_reason = 'timeout';
        const r = GameState.fromSnapshot(sn); return r.winner === 'P1' && r.winReason === 'timeout' && GameState.legal(r).length === 0;
      });
      const failed = results.filter((r) => !r.ok);
      /* --- Phase 4: logic client (HELO/rank/quyền do database quyết định — kiểm bằng cf_phase4_selftest() + kịch bản README) --- */
      const fakeServer = (seed0, plies) => {
        let seed = seed0; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
        const st = GameState.create(), init = GameState.snapshot(st), moves = []; let caps = 0, swaps = 0;
        for (let i = 0; i < plies && !st.winner; i++) {
          const acts = GameState.legal(st); if (!acts.length) break;
          const rec = GameState.apply(st, acts[Math.floor(rnd() * acts.length)]);
          const row = MoveHistory.toRow(rec, 'm1'); row.side = rec.playerId === 'P2' ? 'red' : 'blue'; moves.push(row);
          if (rec.actionType === 'capture') caps++; if (rec.actionType === 'swap') swaps++;
        }
        return { caps, swaps, final: GameState.snapshot(st), data: { match: { id: '11111111-2222-4333-8444-555555555555', mode: 'quick', ranked: true, winner_side: 'red', end_reason: 'king_captured',
          started_at: '2026-11-12T01:00:00Z', ended_at: '2026-11-12T01:10:00Z', red: { username: 'a', display_name: 'A' }, blue: { username: 'b', display_name: 'B' } }, initial: init, moves, rating: null } };
      };
      t('P4 notation replay 1-based: 1.1 -> 2.2', () => Replay.notation({ from_row: 0, from_col: 0, to_row: 1, to_col: 1 }) === '1.1 -> 2.2' &&
        Replay.notation({ from_row: 8, from_col: 8, to_row: 7, to_col: 8 }) === '9.9 -> 8.9');
      t('P4 Replay.build khớp engine trên ván giả lập (có bắt quân), snapshot cuối trùng engine', () => {
        let caps = 0;
        for (let sd = 1; sd <= 6; sd++) {
          const g = fakeServer(sd * 7919, 120); caps += g.caps; const b = Replay.build(g.data);
          if (b.problems.length || b.frames.length !== g.data.moves.length + 1) return false;
          if (JSON.stringify(b.frames[b.frames.length - 1].board) !== JSON.stringify(g.final.board)) return false;
        }
        return caps > 0;
      });
      t('P4 Replay.build phát hiện snapshot bị sửa / thứ tự nước hỏng', () => {
        const g = fakeServer(4242, 40), bad = JSON.parse(JSON.stringify(g.data));
        bad.moves[5].state_snapshot.board.pop();
        const bad2 = JSON.parse(JSON.stringify(g.data)); bad2.moves[3].move_number = 99;
        return Replay.build(bad).problems.length > 0 && Replay.build(bad2).problems.length > 0 && Replay.build({ initial: null, moves: [] }).frames.length === 0;
      });
      t('P4 xuất TXT: header + mỗi nước một dòng có notation', () => {
        const g = fakeServer(777, 30), txt = Replay.toTxt(g.data), lines = txt.split('\r\n');
        const mvLines = lines.filter((l) => /^\d+\. P[12] /.test(l));
        return txt.includes('Match ID: 11111111-2222-4333-8444-555555555555') && txt.includes('Ranked') && mvLines.length === g.data.moves.length &&
          mvLines.every((l) => /\d\.\d -> \d\.\d/.test(l)) && !txt.includes('undefined');
      });
      t('P4 Ranking.tierOf theo cấu hình (biên 999/1000/1199/1200/1799/1800/2000)', () => {
        const keep = Ranking.tiers;
        Ranking.tiers = [{ name: 'Bronze', min: 0 }, { name: 'Silver', min: 1000 }, { name: 'Gold', min: 1200 }, { name: 'Platinum', min: 1400 }, { name: 'Diamond', min: 1600 }, { name: 'Master', min: 1800 }, { name: 'Grandmaster', min: 2000 }];
        const ok = Ranking.tierOf(999) === 'Bronze' && Ranking.tierOf(1000) === 'Silver' && Ranking.tierOf(1199) === 'Silver' && Ranking.tierOf(1200) === 'Gold' &&
          Ranking.tierOf(1799) === 'Diamond' && Ranking.tierOf(1800) === 'Master' && Ranking.tierOf(2000) === 'Grandmaster' && Ranking.tierOf(5000) === 'Grandmaster';
        Ranking.tiers = null; const none = Ranking.tierOf(1500) === ''; Ranking.tiers = keep; return ok && none;
      });
      t('P4 mã lỗi RPC mới dịch sang tiếng Việt', () => ['replay_unavailable', 'invalid_reason', 'cannot_target_role', 'invalid_setting', 'too_many_reports', 'audit_locked']
        .every((k) => Utils.mapError({ message: k, code: 'P0001' }) === RPC_ERRORS[k] && RPC_ERRORS[k].length > 5));
      t('P4 Fmt: delta / phần trăm / chế độ', () => Fmt.delta(20) === '+20' && Fmt.delta(-5) === '-5' && Fmt.delta(0) === '0' && Fmt.delta(null) === '—' && Fmt.pct(null) === '—' &&
        Fmt.pct(55.5) === '55.5%' && Fmt.mode('quick', true).includes('Ranked') && Fmt.mode('quick', false).includes('không xếp hạng') && Fmt.mode('private', false) === 'Phòng riêng');
      return { total: results.length, passed: results.length - failed.length, failed, results };
    }
  };

  /* ===================================================================
   * UTILS
   * =================================================================== */
  /* Mã lỗi do các hàm RPC trong database.sql ném ra (RAISE EXCEPTION '<mã>') => thông báo tiếng Việt. */
  const RPC_ERRORS = {
    not_authenticated: 'Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.', profile_missing: 'Chưa có hồ sơ người chơi.',
    account_suspended: 'Tài khoản đang bị hạn chế.', invalid_input: 'Dữ liệu không hợp lệ.', invalid_code: 'Mã phòng không hợp lệ (6–8 ký tự chữ/số).',
    room_not_found: 'Không tìm thấy phòng (sai mã hoặc phòng đã đóng).', room_full: 'Phòng đã đủ hai người chơi.',
    room_started: 'Phòng này đã bắt đầu trận.', invite_only: 'Phòng này chỉ vào được bằng lời mời.', not_host: 'Chỉ chủ phòng mới làm được việc này.',
    need_two_players: 'Cần đủ hai người chơi để bắt đầu.', already_in_room: 'Bạn đang ở trong một phòng khác. Hãy rời phòng đó trước.',
    already_in_match: 'Bạn đang có một trận chưa kết thúc.', in_queue: 'Bạn đang trong hàng đợi tìm trận.',
    match_in_progress: 'Trận đang diễn ra — hãy đầu hàng nếu muốn thoát.', match_not_found: 'Không tìm thấy trận.',
    not_allowed: 'Bạn không có quyền xem nội dung này.', not_a_player: 'Chỉ người chơi mới thực hiện được thao tác này.',
    match_finished: 'Trận đã kết thúc.', not_your_turn: 'Chưa đến lượt của bạn.', version_conflict: 'Trạng thái bàn cờ đã thay đổi. Đang đồng bộ lại…',
    illegal_move: 'Nước đi không hợp lệ.', draw_offer_pending: 'Đối phương đã gửi đề nghị hòa — hãy trả lời.', draw_cooldown: 'Hãy đợi thêm vài nước trước khi xin hòa lại.',
    no_draw_offer: 'Không có đề nghị hòa nào.', own_draw_offer: 'Bạn không thể tự trả lời đề nghị của mình.',
    rematch_unavailable: 'Không thể tái đấu (đối thủ đã rời phòng hoặc đã có trận mới).', rematch_declined: 'Đối thủ đã từ chối tái đấu.',
    match_not_finished: 'Trận chưa kết thúc.', spectators_not_allowed: 'Phòng này không cho phép xem.', no_active_match: 'Phòng chưa có trận đang diễn ra.',
    already_player: 'Bạn đang là người chơi của phòng này.', spectators_full: 'Phòng đã đủ người xem.',
    user_not_found: 'Không tìm thấy người dùng này.', cannot_friend_self: 'Bạn không thể kết bạn với chính mình.', already_friends: 'Hai bạn đã là bạn bè.',
    cannot_request: 'Không thể gửi lời mời kết bạn.', request_not_found: 'Lời mời kết bạn không còn.', not_friends: 'Hai bạn chưa là bạn bè.',
    too_many_invites: 'Bạn đang có quá nhiều lời mời chưa được trả lời.', invite_not_found: 'Lời mời không còn hiệu lực.', invite_expired: 'Lời mời đã hết hạn.'
  };

  const Utils = {
    $: (sel, root) => (root || document).querySelector(sel),
    $$: (sel, root) => Array.from((root || document).querySelectorAll(sel)),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    el(tag, attrs, children) {
      const n = document.createElement(tag);
      Object.entries(attrs || {}).forEach(([k, v]) => {
        if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v; else n.setAttribute(k, v);
      });
      [].concat(children || []).forEach((c) => n.append(c));
      return n;
    },
    isHttps(u) { try { return new URL(u).protocol === 'https:'; } catch (_) { return false; } },
    isConfigured() { return /^https:\/\//.test(Config.SUPABASE_URL) && String(Config.SUPABASE_KEY).length > 20; },
    isNetworkError(e) {
      const m = String((e && e.message) || e || '').toLowerCase();
      return navigator.onLine === false || m.includes('failed to fetch') || m.includes('networkerror') || m.includes('network request failed') || m.includes('load failed');
    },
    randomName() { return 'hero_' + Math.random().toString(36).slice(2, 8); },
    mapError(e) {
      const msg = String((e && e.message) || e || '').toLowerCase();
      const code = String((e && (e.code || e.status)) || '').toLowerCase();
      if (Utils.isNetworkError(e)) return 'Mất kết nối tới máy chủ. Kiểm tra mạng rồi thử lại.';
      if (code === 'email_not_confirmed' || msg.includes('email not confirmed')) return 'Supabase đang bắt xác nhận email. Hãy tắt "Confirm email" trong Authentication → Providers → Email.';
      if (code === 'email_address_invalid' || (msg.includes('email address') && msg.includes('invalid'))) return 'Supabase từ chối email nội bộ. Đổi AUTH_EMAIL_DOMAIN trong script.js sang một domain khác.';
      if (code === 'invalid_credentials' || msg.includes('invalid login credentials')) return 'Tên người dùng hoặc mật khẩu không đúng.';
      if (code === 'user_already_exists' || msg.includes('already registered')) return 'Tên người dùng đã có người sử dụng.';
      if (code === 'weak_password' || msg.includes('at least')) return 'Mật khẩu quá yếu hoặc quá ngắn (tối thiểu ' + Config.PASSWORD_MIN + ' ký tự).';
      if (code === 'over_request_rate_limit' || code === 'over_email_send_rate_limit' || msg.includes('rate limit')) return 'Thao tác quá nhiều lần. Vui lòng đợi một lúc.';
      if (code === 'signup_disabled' || msg.includes('signups not allowed')) return 'Đăng ký đang bị tắt trong Supabase Auth.';
      if (e && e.code === 'no_session') return 'Đăng nhập được nhưng không giữ được phiên. Hãy tải lại trang và thử lại.';
      if (code === '23505' || msg.includes('duplicate key') || msg.includes('profiles_username')) return 'Tên người dùng đã có người sử dụng.';
      if (code === '23514' || msg.includes('check constraint')) return 'Dữ liệu không hợp lệ. Hãy kiểm tra lại các trường.';
      if (msg.includes('already exists') || code.includes('user_already')) return 'Tên người dùng đã có người sử dụng.';
      if (msg.includes('invalid email or password') || code.includes('invalid_email_or_password')) return 'Tên người dùng hoặc mật khẩu không đúng.';
      if (msg.includes('too many') || code === '429') return 'Thao tác quá nhiều lần. Vui lòng đợi một lúc.';
      if (msg.includes('password') && (msg.includes('short') || msg.includes('weak'))) return 'Mật khẩu quá yếu hoặc quá ngắn.';
      if (msg.includes('jwt') || code === '401' || code.startsWith('pgrst3')) return 'Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.';
      if (code === '42501' || msg.includes('permission denied') || msg.includes('row-level security')) return 'Bạn không có quyền thực hiện thao tác này.' + (e && e.message ? ' [' + [e.code, e.message].filter(Boolean).join(' | ').slice(0, 200) + ']' : '');
      for (const k of Object.keys(RPC_ERRORS)) if (msg.includes(k)) return RPC_ERRORS[k];
      // [DEBUG TẠM] kèm mã + thông báo gốc để biết lỗi thật; bỏ đoạn này khi đã chạy ổn.
      const raw = [e && (e.status || e.code), e && e.message].filter(Boolean).join(' | ');
      return 'Đã xảy ra lỗi. Vui lòng thử lại.' + (raw ? ' [' + raw.slice(0, 200) + ']' : '');
    }
  };

  /* ===================================================================
   * ASSET (đọc ASSET_CONFIG, tạo <img> hoặc khung giữ chỗ trung tính)
   * =================================================================== */
  const AssetConfig = {
    cfg: ASSET_CONFIG,
    placeholder(label) { return Utils.el('span', { class: 'ph', text: label || '' }); },
    node(file, label, alt) {
      const A = this.cfg;
      if (!A.enabled || !file) return this.placeholder(label);
      const img = Utils.el('img', { src: A.basePath + file, alt: alt || label || '', loading: 'lazy', decoding: 'async', width: '400', height: '400' });
      img.addEventListener('error', () => img.replaceWith(AssetConfig.placeholder(label)), { once: true });
      return img;
    },
    mount(container, file, label, alt) {
      container.replaceChildren(this.node(file, label, alt));
    },
    mountStatics() {
      const A = this.cfg;
      const logo = Utils.$('#brand-logo');
      if (logo) { if (A.enabled && A.logo) AssetConfig.mount(logo, A.logo, '', 'Crownfall'); else logo.replaceChildren(); }
      Utils.$$('[data-slot^="icon-"]').forEach((n) => {
        const f = A.icons[n.dataset.slot];
        if (A.enabled && f) AssetConfig.mount(n, f, '', ''); else n.replaceChildren();
      });
    }
  };

  /* ===================================================================
   * DATABASE (khởi tạo SDK + bọc truy vấn có retry cho thao tác đọc)
   * =================================================================== */
  const Database = {
    client: null,
    async init() {
      if (this.client) return this.client;
      let mod;
      try { mod = await import(Config.SDK_URL); }
      catch (e) { const err = new Error('Không tải được thư viện Supabase từ ' + Config.SDK_URL); err.cause = e; err.code = 'SDK_LOAD'; throw err; }
      const create = mod.createClient || (mod.default && mod.default.createClient);
      if (typeof create !== 'function') { const err = new Error('Thư viện Supabase không có createClient'); err.code = 'SDK_API'; throw err; }
      this.client = create(Config.SUPABASE_URL, Config.SUPABASE_KEY, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }   // phiên lưu ở localStorage: không phụ thuộc cookie bên thứ ba
      });
      return this.client;
    },
    /** fn nhận client, trả về {data, error}. Chỉ retry khi lỗi mạng và thao tác đọc (retries > 0). */
    async run(fn, retries) {
      const max = retries || 0;
      for (let i = 0; ; i++) {
        try {
          const res = await fn(this.client);
          if (res && res.error) throw res.error;
          return res ? res.data : null;
        } catch (e) {
          if (i >= max || !Utils.isNetworkError(e)) throw e;
          await Utils.sleep(400 * Math.pow(2, i));
        }
      }
    }
  };

  /* ===================================================================
   * AUTH
   * =================================================================== */
  const Auth = {
    user: null,
    async restore() {
      const res = await Database.client.auth.getSession();
      if (res && res.error) throw res.error;
      const d = (res && res.data) || {};
      this.user = (d.session && d.session.user) || null;
      return this.user;
    },
    emailOf(username) { return String(username || '').trim().toLowerCase() + '@' + Config.AUTH_EMAIL_DOMAIN; },
    async signIn(username, password) {
      const res = await Database.client.auth.signInWithPassword({ email: this.emailOf(username), password });
      if (res.error) throw res.error;
      this.user = (res.data && res.data.user) || null;
      if (!this.user) { const err = new Error('Không nhận được phiên đăng nhập'); err.code = 'no_session'; throw err; }
    },
    async signUp({ password, username, displayName }) {
      const email = this.emailOf(username);
      sessionStorage.setItem(Config.PENDING_KEY, JSON.stringify({ username, displayName }));
      const res = await Database.client.auth.signUp({ email, password, options: { data: { name: displayName || username } } });
      if (res.error) throw res.error;
      this.user = (res.data && res.data.session && res.data.user) || null;   // session = null nghĩa là Supabase còn bắt xác nhận email
      return { needsVerification: !this.user };
    },
    async signOut() {
      try { await Database.client.auth.signOut(); } finally {
        this.user = null; Profile.reset(); sessionStorage.removeItem(Config.PENDING_KEY);
      }
    },
    uid() { return this.user ? String(this.user.id) : null; }
  };

  /* ===================================================================
   * PROFILE
   * =================================================================== */
  const Profile = {
    data: null, settings: null, rating: null, friends: [], role: 'user',
    notice: '',
    reset() { this.data = this.settings = this.rating = null; this.friends = []; this.notice = ''; this.role = 'user'; },
    isStaff() { return this.role === 'admin' || this.role === 'boss'; },   // chỉ để ẩn/hiện nút; quyền thật do database kiểm tra
    async refreshRating() { try { const r = await Database.run((c) => c.from('rating_profiles').select('*').eq('user_id', Auth.uid()).limit(1), 1); if (r && r[0]) this.rating = r[0]; } catch (_) { /* bỏ qua */ } },
    async ensure() {
      let pending = {};
      try { pending = JSON.parse(sessionStorage.getItem(Config.PENDING_KEY) || '{}'); } catch (_) { /* bỏ qua */ }
      let username = String(pending.username || '').toLowerCase();
      const display = pending.displayName || null;
      if (!Config.USERNAME_RE.test(username)) username = Utils.randomName();
      const call = (u) => Database.run((c) => c.rpc('ensure_profile', { p_username: u, p_display_name: display }), 0);
      let row;
      try { row = await call(username); }
      catch (e) {
        if (!/23505|duplicate/i.test(String(e.code || '') + String(e.message || ''))) throw e;
        const fallback = Utils.randomName();
        row = await call(fallback);
        this.notice = 'Tên "' + username + '" đã bị trùng nên bạn tạm dùng "' + fallback + '". Bạn có thể đổi trong Hồ sơ.';
      }
      sessionStorage.removeItem(Config.PENDING_KEY);
      return Array.isArray(row) ? row[0] : row;
    },
    async load() {
      const uid = Auth.uid();
      if (!uid) return;
      const rows = await Database.run((c) => c.from('profiles').select('*').eq('user_id', uid).limit(1), Config.RETRIES_READ);
      this.data = (rows && rows[0]) || await this.ensure();
      const [st, rt, fr] = await Promise.all([
        Database.run((c) => c.from('user_settings').select('*').eq('user_id', uid).limit(1), Config.RETRIES_READ),
        Database.run((c) => c.from('rating_profiles').select('*').eq('user_id', uid).limit(1), Config.RETRIES_READ),
        Database.run((c) => c.from('friendships').select('id,requester_id,addressee_id').eq('status', 'accepted'), Config.RETRIES_READ)
      ]);
      this.settings = (st && st[0]) || { sound_enabled: true, reduce_motion: false, show_online_status: true };
      this.rating = (rt && rt[0]) || null;
      this.friends = fr || [];
      try {
        const rl = await Database.run((c) => c.from('user_roles').select('role').eq('user_id', uid).limit(1), Config.RETRIES_READ);
        this.role = (rl && rl[0] && ['user', 'admin', 'boss'].includes(rl[0].role)) ? rl[0].role : 'user';
      } catch (_) { this.role = 'user'; }
      // Best-effort: không chặn đăng nhập nếu lỗi
      Ranking.loadConfig(); Replay.loadPrefs();
      Database.run((c) => c.rpc('heartbeat'), 0).catch(() => {});
    },
    validate({ username, display, avatar, bio }) {
      if (!Config.USERNAME_RE.test(username)) return 'Tên người dùng gồm 3–20 ký tự: a–z, 0–9, dấu gạch dưới.';
      if (!display || display.length > 40) return 'Tên hiển thị phải từ 1 đến 40 ký tự.';
      if (!AvatarImage.ok(avatar)) return 'Ảnh đại diện không hợp lệ. Hãy chọn lại ảnh từ thiết bị.';
      if (bio.length > 280) return 'Giới thiệu tối đa 280 ký tự.';
      return '';
    },
    async save(v) {
      const uid = Auth.uid();
      if (v.username !== this.data.username) {
        await Database.run((c) => c.rpc('change_username', { p_username: v.username }), 0);
      }
      const rows = await Database.run((c) => c.from('profiles')
        .update({ display_name: v.display, avatar_url: v.avatar || null, bio: v.bio }).eq('user_id', uid).select(), 0);
      this.data = (rows && rows[0]) || Object.assign({}, this.data, { username: v.username, display_name: v.display, avatar_url: v.avatar || null, bio: v.bio });
    },
    async saveSettings(s) {
      const rows = await Database.run((c) => c.from('user_settings').update(s).eq('user_id', Auth.uid()).select(), 0);
      this.settings = (rows && rows[0]) || Object.assign({}, this.settings, s);
    }
  };

  /* ===================================================================
   * UI
   * =================================================================== */
  /* Ảnh đại diện: đọc file người dùng chọn, cắt vuông + thu nhỏ rồi lưu dạng data URL (không cần link ngoài). */
  const AvatarImage = {
    SIZE: 160,
    async fromFile(file) {
      if (!/^image\/(jpeg|png|webp|gif)$/.test(file.type)) throw new Error('Chỉ nhận ảnh JPG, PNG, WebP hoặc GIF.');
      if (file.size > 10 * 1024 * 1024) throw new Error('Ảnh quá lớn (tối đa 10 MB).');
      const url = URL.createObjectURL(file);
      try {
        const img = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => no(new Error('Không đọc được ảnh này.')); i.src = url; });
        const side = Math.min(img.naturalWidth, img.naturalHeight), cv = document.createElement('canvas'); cv.width = cv.height = this.SIZE;
        cv.getContext('2d').drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, this.SIZE, this.SIZE);
        let out = cv.toDataURL('image/jpeg', 0.85); if (out.length > 90000) out = cv.toDataURL('image/jpeg', 0.6);
        if (out.length > 90000) throw new Error('Ảnh quá nặng sau khi nén, hãy chọn ảnh khác.');
        return out;
      } finally { URL.revokeObjectURL(url); }
    },
    ok(v) { return !v || (/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(v) && v.length <= 100000) || (v.length <= 500 && Utils.isHttps(v)); }
  };

  const UI = {
    screens: ['loading', 'error', 'login', 'register', 'home', 'profile', 'settings', 'play', 'modes', 'lobby', 'queue', 'friends', 'ranking', 'player', 'replay', 'guide', 'admin'],
    toastTimer: null,
    show(name) {
      this.screens.forEach((s) => { const n = Utils.$('#screen-' + s); if (n) n.hidden = s !== name; });
      const bar = Utils.$('#topbar');
      bar.hidden = !(Auth.user && ['home', 'profile', 'settings', 'play', 'modes', 'lobby', 'queue', 'friends', 'ranking', 'player', 'replay', 'guide', 'admin'].includes(name));
      const navKey = { play: 'modes', lobby: 'modes', queue: 'modes', player: 'ranking', replay: 'profile' }[name] || name;
      Utils.$$('#topbar a[data-route]').forEach((a) => {
        if (a.dataset.route === navKey) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
      });
      const t = { login: 'Đăng nhập', register: 'Đăng ký', home: 'Sảnh', profile: 'Hồ sơ', settings: 'Cài đặt', play: 'Bàn cờ', modes: 'Chơi', lobby: 'Phòng chờ', queue: 'Tìm trận', friends: 'Bạn bè', guide: 'Hướng dẫn', ranking: 'Xếp hạng', player: 'Hồ sơ người chơi', replay: 'Replay', admin: 'Quản trị' }[name];
      document.title = t ? t + ' — Crownfall' : 'Crownfall';
      const main = Utils.$('#main'); if (main) main.focus({ preventScroll: true });
      window.scrollTo(0, 0);
    },
    loading(text) { Utils.$('#loading-text').textContent = text || 'Đang triệu tập quân đoàn…'; this.show('loading'); },
    error({ title, message, detail, onRetry, showLogin }) {
      Utils.$('#error-title').textContent = title || 'Có lỗi xảy ra';
      Utils.$('#error-msg').textContent = message || '';
      const d = Utils.$('#error-detail'); d.textContent = detail || ''; d.hidden = !detail;
      const retry = Utils.$('#error-retry'); retry.hidden = !onRetry; retry.onclick = onRetry || null;
      Utils.$('#error-login').hidden = !showLogin;
      this.show('error');
    },
    toast(msg, isErr) {
      const t = Utils.$('#toast'); t.textContent = msg; t.classList.toggle('err', !!isErr); t.hidden = false;
      clearTimeout(this.toastTimer); this.toastTimer = setTimeout(() => { t.hidden = true; }, 4500);
    },
    fieldError(id, msg) { const n = Utils.$('#' + id); n.textContent = msg || ''; n.hidden = !msg; },
    /** Chống bấm lặp: khoá nút submit trong lúc xử lý. */
    async guard(form, fn) {
      const btn = Utils.$('button[type="submit"]', form);
      if (form.dataset.busy === '1') return;
      form.dataset.busy = '1'; btn.disabled = true; btn.setAttribute('aria-busy', 'true');
      try { await fn(); } finally { form.dataset.busy = '0'; btn.disabled = false; btn.removeAttribute('aria-busy'); }
    },
    applySettings() {
      const s = Profile.settings || {};
      document.body.dataset.motion = s.reduce_motion ? 'reduced' : 'full';
    },
    renderAvatar(box, name, url) {
      if (url && (Utils.isHttps(url) || /^data:image\/(jpeg|png|webp);base64,/.test(url))) {
        const img = Utils.el('img', { src: url, alt: '', referrerpolicy: 'no-referrer', loading: 'lazy' });
        img.addEventListener('error', () => box.replaceChildren(String(name || '?').charAt(0).toUpperCase()), { once: true });
        box.replaceChildren(img);
      } else if (ASSET_CONFIG.enabled && ASSET_CONFIG.defaultAvatar) {
        AssetConfig.mount(box, ASSET_CONFIG.defaultAvatar, String(name || '?').charAt(0).toUpperCase(), '');
      } else {
        box.replaceChildren(String(name || '?').charAt(0).toUpperCase());
      }
    },
    renderRoster() {
      const box = Utils.$('#roster'); const A = ASSET_CONFIG; const nodes = [];
      Object.keys(A.sides).forEach((side) => {
        nodes.push(Utils.el('div', { class: 'roster-title ' + side, text: A.sides[side] }));
        Object.keys(A.pieces).forEach((p) => {
          const label = A.pieces[p];
          nodes.push(Utils.el('div', { class: 'slot ' + side }, [
            Utils.el('div', { class: 'slot-box' }, [AssetConfig.node(A.pieceImages[side][p], label, label + ' — ' + A.sides[side])]),
            Utils.el('span', { class: 'slot-name', text: label })
          ]));
        });
      });
      box.replaceChildren(...nodes);
    },
    renderHome() {
      const p = Profile.data;
      Utils.$('#home-greeting').textContent = 'Xin chào, ' + p.display_name;
      Utils.$('#home-rating').textContent = Profile.rating ? Profile.rating.rating : '—';
      Utils.$('#home-games').textContent = Profile.rating ? Profile.rating.games_played : '0';
      const tr = Utils.$('#home-tier'); if (tr) { const tn = Profile.rating ? (Ranking.tierOf(Profile.rating.rating) || '') : ''; tr.replaceChildren(...(tn ? [Ranking.badge(tn, true)] : [])); }
      Utils.$('#home-friends').textContent = String(Profile.friends.length);
      if (Social.loaded) Social.renderHome();
      else {
        const list = Utils.$('#friends-list'); const empty = Utils.$('#friends-empty');
        list.hidden = Profile.friends.length === 0; empty.hidden = Profile.friends.length !== 0;
        list.replaceChildren(...Profile.friends.map(() => Utils.el('li', { text: 'Đồng minh' })));
      }
      this.renderRoster();
    },
    renderProfile() {
      const p = Profile.data;
      Utils.$('#pf-title').textContent = p.display_name + ' (@' + p.username + ')';
      Utils.$('#pf-meta').textContent = 'Tham gia ' + new Date(p.created_at).toLocaleDateString('vi-VN');
      Utils.$('#pf-username').value = p.username; Utils.$('#pf-username').disabled = true; Utils.$('#pf-display').value = p.display_name;
      Utils.$('#pf-avatar-url').value = p.avatar_url || ''; Utils.$('#pf-bio').value = p.bio || '';
      this.renderAvatar(Utils.$('#pf-avatar'), p.display_name, p.avatar_url);
      this.fieldError('pf-error', ''); this.bindAvatar();
    },
    bindAvatar() {
      if (this.avBound) return; this.avBound = true;
      const file = Utils.$('#pf-avatar-file'), url = Utils.$('#pf-avatar-url');
      const preview = () => this.renderAvatar(Utils.$('#pf-avatar'), (Profile.data && Profile.data.display_name) || '?', url.value);
      file.addEventListener('change', async () => {
        const f = file.files && file.files[0]; if (!f) return;
        try { url.value = await AvatarImage.fromFile(f); preview(); this.fieldError('pf-error', ''); UI.toast('Đã chọn ảnh. Nhấn "Lưu hồ sơ" để lưu.'); }
        catch (e) { this.fieldError('pf-error', e.message || 'Không đọc được ảnh.'); }
        file.value = '';
      });
      Utils.$('#pf-avatar-clear').addEventListener('click', () => { url.value = ''; preview(); UI.toast('Đã bỏ ảnh. Nhấn "Lưu hồ sơ" để lưu.'); });
    },
    renderSettings() {
      const s = Profile.settings;
      Utils.$('#st-sound').checked = !!s.sound_enabled;
      Utils.$('#st-motion').checked = !!s.reduce_motion;
      Utils.$('#st-online').checked = !!s.show_online_status;
      Utils.$('#rpp-autoplay').checked = !!Replay.prefs.autoplay; Utils.$('#rpp-coords').checked = !!Replay.prefs.show_coords; Utils.$('#rpp-speed').value = String(Replay.prefs.speed);
      this.fieldError('st-error', ''); this.fieldError('rpp-error', '');
    },
    renderNav() {
      Utils.$('#nav-user').textContent = Profile.data ? '@' + Profile.data.username : '';
      Utils.$('#nav-admin').hidden = !Profile.isStaff(); Utils.$('#nav-boss').hidden = Profile.role !== 'boss';
    }
  };

  /* ===================================================================
   * BOARD UI (chơi thử 2 người trên một máy; không xoay bàn; chưa có multiplayer)
   * Ảnh quân chỉ lấy từ ASSET_CONFIG qua AssetConfig.node; chưa có ảnh => chữ cái quân.
   * =================================================================== */
  const RULE_TEXT = {
    L: 'Đi 1–2 ô mọi hướng, không xuyên quân. Bắt khi có ≥2 đồng minh quanh mục tiêu (hoặc được Thuật hỗ trợ).',
    V: 'Đi 1 ô mọi hướng. Chỉ bắt khi được Thuật hỗ trợ. Không được để Vua bị chiếu.',
    M: 'Trượt không giới hạn mọi hướng, bắt tự do. Cùng hàng/cột với Ngưu tạo Đường Cấm.',
    C: 'Trượt không giới hạn mọi hướng, bắt tự do.',
    S: 'Nhảy trong vùng 5×5. Bắt mục tiêu cách đúng 2 ô; có Thuật hỗ trợ thì bắt mọi mục tiêu trong vùng.',
    G: 'Đi 1 ô ngang/dọc. Ngoài biên giới: bất tử. Trên biên giới (hàng 5): bắt được và bị bắt được.',
    N: 'Đi tối đa 2 ô ngang/dọc, bắt tự do. Cùng hàng/cột với Mã tạo Đường Cấm.',
    T: 'Đi 1 ô ngang/dọc. Bắt khi Cặp Thuật hoạt động (2 Thuật cùng hàng/cột). Mất 1 Thuật thì mất cả hai.'
  };
  const WIN_TEXT = { king_captured: 'bắt được Vua', no_legal_moves: 'đối phương hết nước đi hợp lệ', timeout: 'đối phương hết giờ', resignation: 'đối phương đầu hàng' };

  const BoardUI = {
    state: null, sel: null, cells: [], inited: false, anim: null, mode: 'local', info: null,
    init() {
      if (this.inited) return; this.inited = true;
      const board = Utils.$('#board'); const frag = document.createDocumentFragment();
      for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
        const b = Utils.el('button', { type: 'button', class: 'cell ' + (r === BORDER_ROW ? 'terr-border' : (r < BORDER_ROW ? 'terr-p1' : 'terr-p2')), role: 'gridcell' });
        b.dataset.r = r; b.dataset.c = c; this.cells.push(b); frag.append(b);
      }
      board.append(frag);
      board.addEventListener('click', (e) => { const b = e.target.closest('.cell'); if (b) this.click(+b.dataset.r, +b.dataset.c); });
      Utils.$('#btn-newgame').addEventListener('click', async () => {
        if (this.mode !== 'local') return;
        if (!this.state.history.length || await Modal.confirm({ title: 'Ván mới?', message: 'Ván hiện tại sẽ bị bỏ.', ok: 'Ván mới' })) this.newGame();
      });
      Utils.$('#btn-undo').addEventListener('click', () => { this.state = MoveHistory.undo(this.state); this.sel = null; this.anim = null; this.render(); });
    },
    setMode(m) {
      this.mode = m; Utils.$('#local-actions').hidden = m !== 'local'; Utils.$('#online-panel').hidden = m !== 'online';
      Utils.$('#play-title').textContent = m === 'local' ? 'Chơi 1 máy' : 'Trận trực tuyến';
    },
    enter() { this.init(); const wasLocal = this.mode === 'local'; this.setMode('local'); if (!this.state || !wasLocal) this.newGame(); else this.render(); },
    enterOnline() {
      this.init(); this.setMode('online'); this.state = null; this.sel = null; this.info = null; this.anim = null;
      this.cells.forEach((b) => { b.dataset.sig = ''; const p = b.querySelector('.piece'); if (p) p.remove(); b.className = b.className.replace(/\b(selected|t-move|t-capture|t-swap|zone-p1|zone-p2|supported|in-check|last)\b/g, '').trim(); });
      Utils.$('#history').replaceChildren(); Utils.$('#piece-info').replaceChildren(); Utils.$('#board-banner').hidden = true;
    },
    canSelect() { return this.mode === 'local' || Match.canMove(); },
    newGame() { this.state = GameState.create(); this.sel = null; this.anim = null; this.render(); },
    cellAt(r, c) { return this.cells[r * SIZE + c]; },
    pieceAt(r, c) { return this.state.board[r][c]; },
    actionsForSel() {
      if (!this.sel) return [];
      return GameState.legal(this.state).filter((a) => a.pieceId === this.sel || (a.action === 'swap' && a.partnerId === this.sel));
    },
    click(r, c) {
      const s = this.state; if (!s || s.winner) return;
      if (this.mode === 'online' && !Match.active()) return;
      const p = this.pieceAt(r, c);
      if (this.sel) {
        const act = this.actionsForSel().find((a) => (a.action === 'swap' ? (a.partnerId === this.sel ? a.fromRow === r && a.fromCol === c : a.toRow === r && a.toCol === c) : a.toRow === r && a.toCol === c));
        if (act) return this.mode === 'online' ? Match.submit(act) : this.play(act);   // online: server quyết định, client không tự áp nước đi
      }
      if (p && p.owner === s.turn && this.canSelect()) { this.sel = this.sel === p.id ? null : p.id; this.info = null; }
      else if (p) { this.sel = null; this.info = p.id; }
      else { this.sel = null; this.info = null; }
      this.anim = { select: this.sel };
      this.render();
    },
    play(act) {
      const prev = { fromRow: act.fromRow, fromCol: act.fromCol, toRow: act.toRow, toCol: act.toCol };
      let rec;
      try { rec = GameState.apply(this.state, act); } catch (e) { UI.toast(e.message, true); this.sel = null; return this.render(); }
      this.sel = null; this.info = null;
      this.anim = { move: prev, kind: rec.actionType, check: this.state.inCheck && !this.state.winner, over: !!this.state.winner };
      this.render();
    },
    describe(p) {
      const s = this.state, t = PIECE_TYPES[p.type], f = FACTION[p.owner] === 'red' ? 'Đỏ' : 'Xanh';
      const lines = [t.name + ' — ' + p.owner + ' (Phe ' + f + ')', 'Vị trí: ' + Notation.coord(p.row, p.col), RULE_TEXT[p.type]];
      if (p.type === 'G') lines.push(CaptureRules.isImmune(p) ? 'Đang bất tử (ngoài biên giới).' : 'Đang trên biên giới: có thể bắt và bị bắt.');
      if (p.type === 'T') lines.push(SpellPair.active(s.board, p.owner) ? 'Cặp Thuật: đang hoạt động.' : 'Cặp Thuật: không hoạt động.');
      if (p.type !== 'T') lines.push(SpellSupport.supported(s.board, p) ? 'Được Thuật hỗ trợ.' : 'Không được Thuật hỗ trợ.');
      return lines;
    },
    render() {
      const s = this.state, A = ASSET_CONFIG;
      Utils.$('#board').classList.toggle('flip', this.mode === 'online' && Match.role === 'blue');   // mỗi người luôn thấy phe mình ở dưới
      const acts = this.actionsForSel(); const moveMap = new Map(), swapSet = new Set();
      acts.forEach((a) => {
        if (a.action === 'swap') swapSet.add(a.partnerId === this.sel ? ckey(a.fromRow, a.fromCol) : ckey(a.toRow, a.toCol));
        else moveMap.set(ckey(a.toRow, a.toCol), a.action);
      });
      const zone = new Map(); ForbiddenZone.lines(s.board).forEach((l) => l.cells.forEach(([r, c]) => zone.set(ckey(r, c), l.owner)));
      const king = s.inCheck ? Board.find(s.board, s.turn, 'V')[0] : null;
      const last = s.history[s.history.length - 1];
      for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
        const b = this.cellAt(r, c), p = s.board[r][c], k = ckey(r, c), cl = b.classList;
        const sig = p ? p.id + p.owner : '';
        if (b.dataset.sig !== sig) {
          b.dataset.sig = sig; b.querySelector('.piece') && b.querySelector('.piece').remove();
          if (p) {
            const faction = FACTION[p.owner], tp = PIECE_TYPES[p.type];
            const box = Utils.el('span', { class: 'piece f-' + faction }, [AssetConfig.node(A.pieceImages[faction][tp.key], p.type, tp.name + ' ' + (faction === 'red' ? 'Đỏ' : 'Xanh'))]);
            b.append(box);
          }
        }
        cl.toggle('selected', !!p && p.id === this.sel);
        cl.toggle('t-move', moveMap.get(k) === 'move'); cl.toggle('t-capture', moveMap.get(k) === 'capture'); cl.toggle('t-swap', swapSet.has(k));
        cl.toggle('zone-p1', zone.get(k) === 'P1'); cl.toggle('zone-p2', zone.get(k) === 'P2');
        cl.toggle('supported', !!p && SpellSupport.supported(s.board, p));
        cl.toggle('in-check', !!king && king.row === r && king.col === c);
        cl.toggle('last', !!last && ((last.fromRow === r && last.fromCol === c) || (last.toRow === r && last.toCol === c)));
        cl.remove('anim-move', 'anim-capture', 'anim-swap', 'anim-select');
        b.setAttribute('aria-label', (p ? PIECE_TYPES[p.type].name + ' ' + p.owner + ', ' : 'Ô trống, ') + 'hàng ' + (r + 1) + ' cột ' + (c + 1));
        b.setAttribute('aria-selected', p && p.id === this.sel ? 'true' : 'false');
      }
      // Bảng thông tin
      const fac = (o) => (FACTION[o] === 'red' ? 'Đỏ' : 'Xanh');
      Utils.$('#turn-label').textContent = s.winner ? 'Kết thúc' : 'Lượt: ' + s.turn + ' — Phe ' + fac(s.turn);
      Utils.$('#turn-label').className = 'turn f-' + FACTION[s.turn];
      Utils.$('#check-label').textContent = s.winner ? s.winner + ' (Phe ' + fac(s.winner) + ') thắng: ' + WIN_TEXT[s.winReason] + '.' : (s.inCheck ? 'Vua đang bị chiếu!' : 'Nước thứ ' + (s.moveNumber + 1));
      Utils.$('#check-label').className = s.inCheck || s.winner ? 'check-label alert' : 'check-label muted';
      const sp = this.sel ? Board.byId(s.board, this.sel) : (this.info ? Board.byId(s.board, this.info) : null);
      const box = Utils.$('#piece-info');
      box.replaceChildren(...(sp ? this.describe(sp).map((t, i) => Utils.el(i === 0 ? 'strong' : 'p', { text: t, class: i ? 'small' : '' })) :
        [Utils.el('p', { class: 'muted small', text: 'Chạm vào một quân để xem nước đi.' })]));
      const hist = Utils.$('#history');
      hist.replaceChildren(...s.history.map((h) => Utils.el('li', { text: h.playerId + '  ' + h.notation })));
      hist.scrollTop = hist.scrollHeight;
      Utils.$('#btn-undo').disabled = !s.history.length;
      if (this.mode === 'online') Match.decorate();
      this.animate(last);
    },
    animate(last) {
      const a = this.anim; this.anim = null; if (!a) return;
      const banner = Utils.$('#board-banner');
      if (a.select) { const p = Board.byId(this.state.board, a.select); if (p) this.cellAt(p.row, p.col).classList.add('anim-select'); }
      if (!a.move) { banner.hidden = true; return; }
      const to = this.cellAt(a.move.toRow, a.move.toCol), from = this.cellAt(a.move.fromRow, a.move.fromCol);
      const cw = to.getBoundingClientRect().width;
      const slide = (cell, dr, dc) => { const pc = cell.querySelector('.piece'); if (!pc) return; pc.style.setProperty('--dx', (dc * cw) + 'px'); pc.style.setProperty('--dy', (dr * cw) + 'px'); cell.classList.add('anim-move'); };
      if (a.kind === 'swap') { slide(to, a.move.fromRow - a.move.toRow, a.move.fromCol - a.move.toCol); slide(from, a.move.toRow - a.move.fromRow, a.move.toCol - a.move.fromCol); to.classList.add('anim-swap'); from.classList.add('anim-swap'); }
      else { slide(to, a.move.fromRow - a.move.toRow, a.move.fromCol - a.move.toCol); if (a.kind === 'capture') to.classList.add('anim-capture'); }
      if (a.over) { banner.textContent = this.mode === 'online' ? 'Kết thúc' : this.state.winner + ' chiến thắng!'; banner.className = 'banner banner-over'; banner.hidden = false; }
      else if (a.check) { banner.textContent = 'Chiếu!'; banner.className = 'banner banner-check'; banner.hidden = false; clearTimeout(this.bt); this.bt = setTimeout(() => { banner.hidden = true; }, 1600); }
      else banner.hidden = true;
    }
  };

  /* ===================================================================
   * PHASE 3 — MULTIPLAYER (client)
   * Đồng bộ bằng POLLING qua Supabase (RPC) — KHÔNG phải WebSocket/realtime tức thời.
   * Client chỉ hiển thị; mọi quyết định (lượt, nước đi, thắng thua, hết giờ, hòa, đầu hàng) do database xác nhận.
   * =================================================================== */
  const MP = { POLL_MATCH: 1500, POLL_ROOM: 2000, POLL_QUEUE: 2000, POLL_SOCIAL: 4000, POLL_POSTGAME: 4000,
    POSTGAME_MAX_MS: 180000, HEARTBEAT: 30000, BACKOFF_MAX: 15000 };

  const Rpc = { call(name, args) { return Database.run((c) => c.rpc(name, args || {}), 0); } };
  const rpcCode = (e, code) => String((e && e.message) || e || '').includes(code);
  const uuid4 = () => {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    const b = new Uint8Array(16); crypto.getRandomValues(b); b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  };

  /** Trạng thái kết nối: banner "đang kết nối lại" khi poll lỗi, tự ẩn khi thành công. */
  const Net = {
    bad: 0,
    fail(e, key) {
      this.bad++; console.error('[Crownfall] poll lỗi', key || '', e);
      const b = typeof document !== 'undefined' && document.getElementById('reconnect-banner');
      if (b) {
        if (!b.dataset.base) b.dataset.base = b.textContent;
        // [DEBUG TẠM] hiện lỗi thật để biết RPC nào hỏng; bỏ khi đã chạy ổn.
        const raw = [key, e && (e.status || e.code), e && e.message].filter(Boolean).join(' | ');
        b.textContent = b.dataset.base + (raw ? ' [' + raw.slice(0, 220) + ']' : '');
        b.hidden = false;
      }
    },
    ok() {
      if (!this.bad) return; this.bad = 0;
      const b = typeof document !== 'undefined' && document.getElementById('reconnect-banner'); if (b) b.hidden = true;
      if (typeof document !== 'undefined') UI.toast('Đã kết nối lại.');
    }
  };

  /** Vòng poll: mỗi key đúng MỘT vòng (setTimeout nối tiếp, không setInterval), dừng khi tab ẩn, backoff mũ khi lỗi.
   *  fn() trả: false => dừng; số => khoảng chờ kế tiếp (ms); khác => dùng khoảng mặc định. */
  const Poller = {
    loops: new Map(), bound: false,
    start(key, fn, interval) {
      this.bind(); this.stop(key);
      const L = { key, fn, interval, fails: 0, timer: null, stopped: false, running: false, parked: false };
      this.loops.set(key, L); this.schedule(L, 0); return L;
    },
    schedule(L, ms) { if (L.stopped) return; clearTimeout(L.timer); L.timer = setTimeout(() => this.run(L), ms); },
    halt(L) { L.stopped = true; clearTimeout(L.timer); if (this.loops.get(L.key) === L) this.loops.delete(L.key); },
    async run(L) {
      if (L.stopped || L.running) return;
      if (typeof document !== 'undefined' && document.hidden) { L.parked = true; return; }   // tab ẩn: không poll
      L.parked = false; L.running = true; let next = L.interval, stop = false;
      try {
        const r = await L.fn();
        L.fails = 0; Net.ok();
        if (r === false) stop = true; else if (typeof r === 'number') next = r;
      } catch (e) {
        if (!L.stopped) { L.fails++; Net.fail(e, L.key); next = Math.min(MP.BACKOFF_MAX, L.interval * Math.pow(2, L.fails)); }
      } finally { L.running = false; }
      if (L.stopped) return;
      if (stop) return this.halt(L);
      this.schedule(L, next);
    },
    kick(key) { const L = this.loops.get(key); if (L && !L.running) this.schedule(L, 0); },
    stop(key) { const L = this.loops.get(key); if (L) this.halt(L); },
    stopAll() { Array.from(this.loops.values()).forEach((L) => this.halt(L)); },
    bind() {
      if (this.bound || typeof document === 'undefined') return; this.bound = true;
      document.addEventListener('visibilitychange', () => { if (!document.hidden) this.loops.forEach((L) => { if (L.parked) this.schedule(L, 0); }); });
      window.addEventListener('online', () => this.loops.forEach((L) => this.schedule(L, 0)));
    }
  };

  /** Hộp thoại phong cách fantasy (thay alert/confirm mặc định). */
  const Modal = {
    resolve: null, prev: null, dismissible: true, validate: null, bound: false,
    open({ title, body, actions, dismissible, validate }) {
      this.bind();
      if (this.resolve) this.close(null);
      return new Promise((resolve) => {
        this.resolve = resolve; this.dismissible = dismissible !== false; this.validate = validate || null; this.prev = document.activeElement;
        Utils.$('#modal-title').textContent = title || '';
        Utils.$('#modal-body').replaceChildren(...[].concat(typeof body === 'string' ? [Utils.el('p', { text: body })] : (body || [])));
        const err = Utils.$('#modal-error'); err.hidden = true; err.textContent = '';
        Utils.$('#modal-actions').replaceChildren(...(actions || [{ label: 'Đóng', value: true, kind: 'gold' }]).map((a) => {
          const b = Utils.el('button', { type: 'button', class: 'btn btn-' + (a.kind || 'ghost'), text: a.label });
          if (a.submit) b.dataset.submit = '1';
          b.addEventListener('click', () => this.choose(a)); return b;
        }));
        Utils.$('#modal').hidden = false; document.body.classList.add('modal-open');
        const f = Utils.$('#modal-body input, #modal-body select') || Utils.$('#modal-actions .btn-gold') || Utils.$('#modal-actions .btn');
        (f || Utils.$('.modal-card')).focus();
      });
    },
    choose(a) {
      if (a.submit && this.validate) { const m = this.validate(); if (m) { const e = Utils.$('#modal-error'); e.textContent = m; e.hidden = false; return; } }
      this.close(a.value === undefined ? true : a.value);
    },
    close(v) {
      Utils.$('#modal').hidden = true; document.body.classList.remove('modal-open');
      const r = this.resolve; this.resolve = null; this.validate = null;
      if (this.prev && this.prev.focus) { try { this.prev.focus(); } catch (_) { /* bỏ qua */ } }
      if (r) r(v);
    },
    confirm({ title, message, ok, cancel, danger }) {
      return this.open({ title, body: message, actions: [{ label: cancel || 'Hủy', value: false, kind: 'ghost' }, { label: ok || 'Đồng ý', value: true, kind: danger ? 'red' : 'gold' }] });
    },
    alert(title, message) { return this.open({ title, body: message, actions: [{ label: 'Đóng', value: true, kind: 'gold' }] }); },
    bind() {
      if (this.bound) return; this.bound = true;
      const root = Utils.$('#modal');
      root.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && this.dismissible) { e.preventDefault(); this.close(null); return; }
        if (e.key === 'Enter' && e.target.tagName === 'INPUT') { const b = Utils.$('#modal-actions [data-submit]'); if (b) { e.preventDefault(); b.click(); } return; }
        if (e.key !== 'Tab') return;
        const f = Utils.$$('#modal button, #modal input, #modal select').filter((n) => !n.disabled);
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      });
      root.addEventListener('mousedown', (e) => { if (e.target === root && this.dismissible) this.close(null); });
    }
  };

  /** Chạy fn khi bấm nút, khoá nút trong lúc chờ (chống bấm lặp) và báo lỗi bằng toast. */
  const withBusy = async (btn, fn) => {
    if (btn && btn.dataset.busy === '1') return;
    if (btn) { btn.dataset.busy = '1'; btn.disabled = true; btn.setAttribute('aria-busy', 'true'); }
    try { return await fn(); }
    catch (e) { UI.toast(Utils.mapError(e), true); }
    finally { if (btn) { btn.dataset.busy = '0'; btn.disabled = false; btn.removeAttribute('aria-busy'); } }
  };

  /** Heartbeat hiện diện: RPC `heartbeat` mỗi 30 giây khi tab đang hiển thị. online = false/true chỉ khi có heartbeat hợp lệ. */
  const Presence = {
    timer: null,
    start() {
      this.stop();
      this.timer = setInterval(() => { if (!document.hidden && navigator.onLine && Auth.user) Rpc.call('heartbeat').catch(() => {}); }, MP.HEARTBEAT);
    },
    stop() { clearInterval(this.timer); this.timer = null; }
  };

  const dot = (online) => Utils.el('span', { class: 'dot ' + (online === true ? 'on' : online === false ? 'off' : 'unk'),
    title: online === true ? 'Đang hoạt động' : online === false ? 'Ngoại tuyến' : 'Không rõ', 'aria-label': online === true ? 'Đang hoạt động' : online === false ? 'Ngoại tuyến' : 'Không rõ' });
  const who = (p) => (p ? p.display_name + ' (@' + p.username + ')' : '—');

  /* ---------- Bạn bè & lời mời ---------- */
  const Social = {
    data: { friends: [], requests_in: [], requests_out: [], invites_in: [] }, loaded: false, seen: new Set(),
    start() { Poller.start('social', async () => { await this.refresh(true); }, MP.POLL_SOCIAL); },
    async refresh(notify) {
      this.data = await Rpc.call('get_social'); this.loaded = true;
      if (notify) this.data.invites_in.forEach((i) => { if (!this.seen.has(i.id)) { this.seen.add(i.id); UI.toast('@' + i.from.username + ' mời bạn vào trận.'); } });
      this.render();
    },
    render() {
      const d = this.data, badge = d.requests_in.length + d.invites_in.length;
      const nb = Utils.$('#nav-friends-badge'); if (nb) { nb.textContent = String(badge); nb.hidden = !badge; }
      if (!Utils.$('#screen-friends').hidden) this.renderScreen();
      if (!Utils.$('#screen-home').hidden) this.renderHome();
      if (!Utils.$('#screen-lobby').hidden) Lobby.renderInvite();
    },
    renderHome() {
      const list = Utils.$('#friends-list'), empty = Utils.$('#friends-empty'), f = this.data.friends;
      list.hidden = !f.length; empty.hidden = !!f.length;
      list.replaceChildren(...f.map((x) => Utils.el('li', {}, [dot(x.online), Utils.el('span', { text: who(x) })])));
      Utils.$('#home-friends').textContent = String(f.length);
    },
    renderScreen() {
      const d = this.data;
      const reqs = d.requests_in.map((r) => Utils.el('li', {}, [
        Utils.el('span', { class: 'grow', text: who(r.from) + ' muốn kết bạn' }),
        this.btn('Chấp nhận', 'gold', (b) => withBusy(b, async () => { await Rpc.call('respond_friend_request', { p_friendship: r.id, p_accept: true }); await this.refresh(); })),
        this.btn('Từ chối', 'ghost', (b) => withBusy(b, async () => { await Rpc.call('respond_friend_request', { p_friendship: r.id, p_accept: false }); await this.refresh(); }))]));
      const out = d.requests_out.map((r) => Utils.el('li', {}, [Utils.el('span', { class: 'grow muted', text: 'Đã gửi lời mời kết bạn tới ' + who(r.to) })]));
      Utils.$('#fr-requests').replaceChildren(...reqs, ...out); Utils.$('#fr-requests-box').hidden = !(reqs.length || out.length);
      const inv = d.invites_in.map((i) => Utils.el('li', {}, [
        Utils.el('span', { class: 'grow', text: who(i.from) + ' mời đấu (' + i.turn_seconds + ' giây/lượt)' }),
        this.btn('Vào phòng', 'gold', (b) => withBusy(b, async () => {
          const r = await Rpc.call('respond_friend_invite', { p_invite: i.id, p_accept: true }); Router.go('lobby', { r: r.room.id }); })),
        this.btn('Từ chối', 'ghost', (b) => withBusy(b, async () => { await Rpc.call('respond_friend_invite', { p_invite: i.id, p_accept: false }); await this.refresh(); }))]));
      Utils.$('#fr-invites').replaceChildren(...inv); Utils.$('#fr-invites-box').hidden = !inv.length;
      const fr = d.friends.map((x) => Utils.el('li', {}, [dot(x.online), Utils.el('span', { class: 'grow', text: who(x) }),
        this.btn('Hồ sơ', 'ghost', () => Router.go('player', { u: x.username })),
        this.btn('Mời đấu', 'blue', (b) => withBusy(b, async () => {
          const r = await Rpc.call('invite_friend', { p_username: x.username, p_turn_seconds: 60 }); UI.toast('Đã gửi lời mời cho @' + x.username + '.'); Router.go('lobby', { r: r.room.id }); }))]));
      Utils.$('#fr-list').replaceChildren(...fr); Utils.$('#fr-empty').hidden = !!fr.length;
    },
    btn(label, kind, fn) { const b = Utils.el('button', { type: 'button', class: 'btn btn-' + kind + ' btn-sm', text: label }); b.addEventListener('click', () => fn(b)); return b; }
  };

  /* ---------- Phòng chờ ---------- */
  const Lobby = {
    id: null, room: null, rev: null,
    enter(id) {
      this.id = id; this.room = null; this.rev = null; this.renderLoading();
      Social.refresh().catch(() => {});
      Poller.start('room', () => this.tick(), MP.POLL_ROOM);
    },
    async tick() {
      let res;
      try { res = await Rpc.call('get_room_state', { p_room: this.id, p_known_rev: this.rev }); }
      catch (e) { if (rpcCode(e, 'not_allowed') || rpcCode(e, 'room_not_found')) { UI.toast(Utils.mapError(e), true); Router.go('modes'); return false; } throw e; }
      if (res.closed) { UI.toast('Phòng đã đóng.'); Router.go('modes'); return false; }
      if (res.unchanged) return;
      this.room = res; this.rev = res.rev;
      if (res.match_id && res.status === 'playing') { Router.go('match', { m: res.match_id }); return false; }   // trận đã bắt đầu
      this.render();
    },
    renderLoading() { Utils.$('#lb-code').textContent = '…'; Utils.$('#lb-players').replaceChildren(); Utils.$('#lb-info').textContent = 'Đang tải phòng…'; },
    render() {
      const r = this.room; if (!r) return;
      Utils.$('#lb-code').textContent = r.code;
      Utils.$('#lb-mode').textContent = r.mode === 'friend' ? 'Phòng bạn bè (chỉ vào bằng lời mời)' : 'Phòng riêng (vào bằng mã)';
      const slot = (side) => {
        const p = r.players.find((x) => x.side === side);
        return Utils.el('div', { class: 'lb-slot f-' + side }, [
          Utils.el('span', { class: 'lb-side', text: 'Phe ' + (side === 'red' ? 'Đỏ' : 'Xanh') }),
          p ? Utils.el('span', { class: 'lb-name' }, [dot(p.online), Utils.el('span', { text: who(p) + (p.user_id === r.owner_id ? ' · chủ phòng' : '') })])
            : Utils.el('span', { class: 'muted', text: 'Đang chờ người chơi…' })]);
      };
      Utils.$('#lb-players').replaceChildren(slot('red'), slot('blue'));
      const full = r.players.length === 2;
      Utils.$('#lb-info').textContent = full ? (r.is_host ? 'Đủ hai người. Bạn có thể bắt đầu.' : 'Đủ hai người. Đang chờ chủ phòng bắt đầu.') : 'Đang chờ người chơi thứ hai…';
      Utils.$('#lb-host').hidden = !r.is_host;
      Utils.$('#lb-turn').value = String(r.settings.turn_seconds); Utils.$('#lb-spec').checked = !!r.settings.allow_spectators;
      Utils.$('#lb-turn').disabled = !r.is_host; Utils.$('#lb-spec').disabled = !r.is_host;
      Utils.$('#lb-start').disabled = !(r.is_host && full);
      Utils.$('#lb-spectators').textContent = r.spectators ? r.spectators + ' người đang xem' : '';
      Utils.$('#lb-invite-box').hidden = !(r.is_host && !full);
      this.renderInvite();
    },
    renderInvite() {
      const r = this.room; if (!r || !r.is_host) return;
      const fr = Social.data.friends;
      Utils.$('#lb-friends').replaceChildren(...fr.map((x) => Utils.el('li', {}, [dot(x.online), Utils.el('span', { class: 'grow', text: who(x) }),
        Social.btn('Mời', 'blue', (b) => withBusy(b, async () => { await Rpc.call('invite_friend', { p_username: x.username, p_room: r.id }); UI.toast('Đã gửi lời mời cho @' + x.username + '.'); }))])));
      Utils.$('#lb-friends-empty').hidden = !!fr.length;
    },
    async saveSettings() {
      const r = this.room; if (!r || !r.is_host) return;
      try { this.room = await Rpc.call('update_room_settings', { p_room: r.id, p_turn_seconds: +Utils.$('#lb-turn').value, p_allow_spectators: Utils.$('#lb-spec').checked }); this.rev = this.room.rev; this.render(); }
      catch (e) { UI.toast(Utils.mapError(e), true); this.render(); }
    },
    async start(btn) {
      await withBusy(btn, async () => {
        const res = await Rpc.call('start_match', { p_room: this.id, p_host_side: Utils.$('#lb-side').value });
        Router.go('match', { m: res.match_id });
      });
    },
    async leave(btn) {
      await withBusy(btn, async () => { Poller.stop('room'); await Rpc.call('leave_room', { p_room: this.id }); Router.go('modes'); });
    }
  };

  /* ---------- Quick Match ---------- */
  const Queue = {
    waiting: false, t0: 0, clock: null,
    async enter() {
      this.t0 = Date.now(); this.waiting = true; this.view('search');
      clearInterval(this.clock); this.clock = setInterval(() => { Utils.$('#q-time').textContent = Math.floor((Date.now() - this.t0) / 1000) + ' giây'; }, 500);
      try { if (this.handle(await Rpc.call('join_quick_queue'))) return; }
      catch (e) { this.waiting = false; clearInterval(this.clock); UI.toast(Utils.mapError(e), true); Router.go('modes'); return; }
      Poller.start('queue', async () => (this.handle(await Rpc.call('matchmake_players')) ? false : undefined), MP.POLL_QUEUE);
    },
    view(v) { Utils.$('#q-search').hidden = v !== 'search'; Utils.$('#q-fail').hidden = v !== 'fail'; },
    handle(r) {
      if (r.status === 'matched') { this.waiting = false; clearInterval(this.clock); UI.toast('Đã ghép trận!'); Router.go('match', { m: r.match_id }); return true; }
      if (r.status !== 'waiting') {
        this.waiting = false; clearInterval(this.clock); this.view('fail');
        Utils.$('#q-fail-msg').textContent = r.status === 'expired' ? 'Chưa tìm được đối thủ phù hợp trong 2 phút.' : 'Đã hủy tìm trận.'; return true;
      }
      Utils.$('#q-rating').textContent = String(r.rating); return false;
    },
    async cancel(btn) {
      await withBusy(btn, async () => {
        Poller.stop('queue'); this.waiting = false; clearInterval(this.clock);
        const r = await Rpc.call('cancel_quick_queue');
        if (r.status === 'matched' && r.match_id) { Router.go('match', { m: r.match_id }); return; }   // vừa được ghép trước khi hủy
        Router.go('modes');
      });
    },
    /** Rời màn hình khi đang chờ: hủy hàng đợi (best-effort; heartbeat dừng thì server cũng tự hết hạn sau 15 giây). */
    leave() {
      clearInterval(this.clock);
      if (this.waiting) { this.waiting = false; Rpc.call('cancel_quick_queue').catch(() => {}); }
    }
  };

  /* ---------- Đồng hồ hiển thị (KHÔNG quyết định thắng thua) ---------- */
  const Clock = {
    timer: null,
    fmt(ms) { const s = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); },
    left() { const m = Match.data; return m && m.status === 'active' ? Date.parse(m.turn_deadline_at) - (Date.now() + Match.offset) : null; },
    start() { this.stop(); this.timer = setInterval(() => this.tick(), 250); this.tick(); },
    stop() { clearInterval(this.timer); this.timer = null; },
    tick() {
      const ms = this.left(), m = Match.data;
      Utils.$$('#op-players .clock').forEach((el) => {
        const on = ms !== null && m.turn_side === el.dataset.side;
        el.textContent = on ? this.fmt(ms) : '—'; el.classList.toggle('running', on); el.classList.toggle('urgent', on && ms <= 10000 && ms > 0);
      });
      if (ms !== null && ms <= 0 && Date.now() - Match.expiredPing > 1500) { Match.expiredPing = Date.now(); Poller.kick('match'); }   // chỉ yêu cầu server xác nhận
      Match.renderStatus();
    }
  };

  /** Gộp danh sách nước đi theo p_since_ply; null => cần tải lại đầy đủ. (hàm thuần, có test) */
  const mergeMoves = (have, incoming, since, version) => {
    let out;
    if (since === 0) out = incoming.slice(); else if (since === have.length) out = have.concat(incoming); else return null;
    return out.length === version ? out : null;
  };

  /* ---------- Trận online (người chơi & khán giả) ---------- */
  const END_TEXT = {
    king_captured: ['Bạn đã bắt được Vua.', 'Vua của bạn đã bị bắt.', 'Một Vua đã bị bắt.'],
    no_legal_moves: ['Đối phương hết nước đi hợp lệ.', 'Bạn hết nước đi hợp lệ.', 'Một bên hết nước đi hợp lệ.'],
    timeout: ['Đối phương hết giờ.', 'Bạn đã hết giờ.', 'Một bên hết giờ.'],
    resignation: ['Đối phương đầu hàng.', 'Bạn đã đầu hàng.', 'Một bên đã đầu hàng.'],
    draw_agreement: ['Hai bên đồng ý hòa.', 'Hai bên đồng ý hòa.', 'Hai bên đồng ý hòa.']
  };
  const Match = {
    id: null, data: null, role: null, rev: null, moves: [], rematch: null, offset: 0, sending: false, pending: null, busy: false,
    announced: false, expiredPing: 0, online: { red: null, blue: null }, postgameUntil: 0,
    reset() { this.id = null; this.data = null; this.role = null; this.rev = null; this.moves = []; this.rematch = null; this.sending = false;
      this.pending = null; this.busy = false; this.announced = false; this.online = { red: null, blue: null }; this.postgameUntil = 0; this.rating = null; },
    leave() { Clock.stop(); },
    owner(side) { return side === 'red' ? 'P2' : 'P1'; },
    isPlayer() { return this.role === 'red' || this.role === 'blue'; },
    active() { return !!this.data && this.data.status === 'active'; },
    canMove() { return this.isPlayer() && this.active() && this.data.turn_side === this.role && !this.sending && !this.pending && !this.busy && !Net.bad; },
    async enter(id) {
      this.reset(); this.id = id; BoardUI.enterOnline(); this.renderPanel();
      try { this.apply(await Rpc.call('join_match', { p_match: id }), true); }
      catch (e) { UI.toast(Utils.mapError(e), true); Router.go('modes'); return; }
      Clock.start();
      Poller.start('match', () => this.tick(), MP.POLL_MATCH);
    },
    async tick() {
      let res;
      try { res = await Rpc.call('get_match_state', { p_match: this.id, p_known_rev: this.rev, p_since_ply: this.moves.length }); }
      catch (e) { if (rpcCode(e, 'not_allowed') || rpcCode(e, 'match_not_found')) { UI.toast(Utils.mapError(e), true); Router.go('modes'); return false; } throw e; }
      this.apply(res);
      const d = this.data;
      if (d && d.status !== 'active') {                    // không poll liên tục sau khi kết thúc
        if (!this.isPlayer() || (this.rematch && this.rematch.new_match_id) || Date.now() > this.postgameUntil) return false;
        return MP.POLL_POSTGAME;
      }
    },
    rec(mv) {
      const r = { moveNumber: mv.move_number, playerId: this.owner(mv.side), pieceId: mv.piece_id, pieceType: mv.piece_type, fromRow: mv.from_row,
        fromCol: mv.from_col, toRow: mv.to_row, toCol: mv.to_col, capturedPiece: mv.captured_piece, actionType: mv.action_type };
      r.notation = Notation.format(r); return r;
    },
    /** Áp trạng thái CHÍNH THỨC từ server (không bao giờ tự suy ra nước đi). */
    apply(res, first) {
      if (!res) return;
      this.offset = Date.parse(res.server_time) - Date.now();
      if (res.unchanged) {
        if (this.pending && !this.sending) { this.pending = null; UI.toast('Nước đi vừa rồi chưa được ghi nhận. Hãy đi lại.', true); }
        this.presence(res); this.renderPanel(); return;
      }
      const moves = mergeMoves(this.moves, res.moves, res.moves_since, res.match.version);
      if (!moves) { this.rev = null; this.moves = []; Poller.kick('match'); return; }   // lệch => tải lại đầy đủ
      const grew = moves.length > this.moves.length, prevStatus = this.data && this.data.status;
      if (this.pending) { if (res.match.version > this.pending.version) this.pending = null; else if (!this.sending) { this.pending = null; UI.toast('Nước đi vừa rồi chưa được ghi nhận. Hãy đi lại.', true); } }
      this.moves = moves; this.data = res.match; this.role = res.you; this.rev = res.rev; this.rematch = res.rematch; this.rating = res.rating || null;
      const s = GameState.fromSnapshot(res.state); s.history = moves.map((m) => this.rec(m));
      const last = s.history[s.history.length - 1];
      BoardUI.state = s; BoardUI.sel = null;
      BoardUI.anim = grew && last ? { move: { fromRow: last.fromRow, fromCol: last.fromCol, toRow: last.toRow, toCol: last.toCol }, kind: last.actionType,
        check: !!res.match.in_check && res.match.status === 'active', over: res.match.status !== 'active' } : null;
      this.presence(res);
      if (res.match.status !== 'active' && !this.postgameUntil) this.postgameUntil = Date.now() + MP.POSTGAME_MAX_MS;
      BoardUI.render(); this.renderPanel();
      if (res.rematch && res.rematch.new_match_id && res.match.id === this.id) { UI.toast('Tái đấu bắt đầu!'); Router.go('match', { m: res.rematch.new_match_id }); return; }
      if (res.match.status !== 'active' && !this.announced) {
        this.announced = true;
        if (!first && prevStatus === 'active') { const t = this.resultText(); Modal.alert(t.title, t.sub); }
      }
    },
    presence(res) {
      const d = this.data; if (!d || d.status !== 'active' || !this.isPlayer()) { this.online = { red: res.red_online, blue: res.blue_online }; return; }
      const opp = this.role === 'red' ? 'blue' : 'red', now = res[opp + '_online'], was = this.online[opp];
      if (was === true && now === false) UI.toast('Đối thủ mất kết nối. Đồng hồ vẫn chạy.', true);
      if (was === false && now === true) UI.toast('Đối thủ đã trở lại.');
      this.online = { red: res.red_online, blue: res.blue_online };
    },
    resultText() {
      const d = this.data, i = this.isPlayer() ? (d.winner_side === this.role ? 0 : 1) : 2, e = END_TEXT[d.end_reason] || ['', '', ''];
      if (d.winner_side === 'draw') return { title: 'Hòa', sub: e[0] };
      if (!this.isPlayer()) return { title: 'Phe ' + (d.winner_side === 'red' ? 'Đỏ' : 'Xanh') + ' thắng', sub: e[2] };
      return { title: i === 0 ? 'Bạn đã thắng!' : 'Bạn đã thua.', sub: e[i] };
    },
    async submit(act) {
      if (!this.canMove()) return;
      const cid = uuid4(), version = this.data.version;
      this.sending = true; this.pending = { cid, version }; BoardUI.sel = null; this.renderPanel(); BoardUI.render();
      try {
        const res = await Rpc.call('submit_move', { p_match: this.id, p_expected_version: version, p_client_move_id: cid, p_from_row: act.fromRow,
          p_from_col: act.fromCol, p_to_row: act.toRow, p_to_col: act.toCol, p_action: act.action });
        this.pending = null; this.apply(res);
        if (res.rejected === 'timeout') UI.toast('Hết giờ lượt của bạn.', true);
      } catch (e) {
        if (Utils.isNetworkError(e)) { Net.fail(e); UI.toast('Mất kết nối — đang xác minh nước đi với máy chủ…', true); }   // KHÔNG gửi lại; giữ pending tới khi đọc được trạng thái
        else {
          this.pending = null; UI.toast(Utils.mapError(e), true);
          if (/version_conflict|not_your_turn|match_finished|illegal_move/.test(String(e.message || e))) { this.rev = null; Poller.kick('match'); }
        }
      } finally { this.sending = false; this.renderPanel(); BoardUI.render(); }
    },
    async act(name, args) {
      if (this.busy) return; this.busy = true; this.renderPanel();
      try { this.apply(await Rpc.call(name, args)); }
      catch (e) { UI.toast(Utils.mapError(e), true); this.rev = null; Poller.kick('match'); }
      finally { this.busy = false; this.renderPanel(); }
    },
    async resign() {
      if (!this.isPlayer() || !this.active()) return;
      const ok = await Modal.confirm({ title: 'Đầu hàng?', message: 'Bạn sẽ thua trận này. Không thể hoàn tác.', ok: 'Đầu hàng', cancel: 'Tiếp tục chơi', danger: true });
      if (ok) await this.act('resign_match', { p_match: this.id });
    },
    offerDraw() { return this.act('offer_draw', { p_match: this.id }); },
    respondDraw(accept) { return this.act('respond_draw', { p_match: this.id, p_accept: accept }); },
    rematchYes() { return this.act('request_rematch', { p_match: this.id }); },
    rematchNo() { return this.act('respond_rematch', { p_match: this.id, p_accept: false }); },
    async leaveRoom() {
      const d = this.data; if (!d) return Router.go('modes');
      if (this.isPlayer() && d.status === 'active') return UI.toast('Trận đang diễn ra — hãy đầu hàng nếu muốn thoát.', true);
      try { await Rpc.call(this.isPlayer() ? 'leave_room' : 'leave_spectator', { p_room: d.room_id }); } catch (e) { UI.toast(Utils.mapError(e), true); }
      Router.go('modes');
    },
    /* ----- hiển thị ----- */
    decorate() {   // gọi cuối BoardUI.render() ở chế độ online
      const d = this.data; if (!d) return;
      const tl = Utils.$('#turn-label'), cl = Utils.$('#check-label');
      if (d.status !== 'active') { const t = this.resultText(); tl.textContent = t.title; tl.className = 'turn'; cl.textContent = t.sub; cl.className = 'check-label alert'; return; }
      const mine = this.isPlayer() && d.turn_side === this.role;
      tl.textContent = !this.isPlayer() ? 'Lượt: Phe ' + (d.turn_side === 'red' ? 'Đỏ' : 'Xanh') : (mine ? 'Lượt của bạn' : 'Lượt đối thủ');
      tl.className = 'turn f-' + d.turn_side;
      cl.textContent = d.in_check ? 'Vua đang bị chiếu!' : 'Nước thứ ' + (d.version + 1); cl.className = d.in_check ? 'check-label alert' : 'check-label muted';
    },
    renderStatus() {
      const el = Utils.$('#op-status'), d = this.data; if (!el || !d) return;
      let t = '';
      if (d.status === 'active') {
        const ms = Clock.left();
        if (this.sending) t = 'Đang gửi nước đi…';
        else if (this.pending) t = 'Đang xác minh nước đi với máy chủ…';
        else if (ms !== null && ms <= 0) t = 'Đã hết giờ — đang chờ máy chủ xác nhận…';
        else if (this.isPlayer() && d.turn_side === this.role && ms !== null && ms <= 10000) t = 'Sắp hết giờ!';
        else if (this.isPlayer()) { const opp = this.role === 'red' ? 'blue' : 'red'; if (this.online[opp] === false) t = 'Đối thủ mất kết nối (đồng hồ vẫn chạy).'; }
        else t = 'Bạn đang xem (chỉ đọc).';
      }
      el.textContent = t;
    },
    renderPanel() {
      const d = this.data;
      const pl = Utils.$('#op-players'); if (!pl) return;
      if (!d) { pl.replaceChildren(Utils.el('p', { class: 'muted small', text: 'Đang tải trận…' })); return; }
      const row = (side) => {
        const p = d[side], me = this.role === side, on = this.online[side];
        return Utils.el('div', { class: 'op-row f-' + side + (d.status === 'active' && d.turn_side === side ? ' turn-on' : '') }, [
          dot(on), Utils.el('span', { class: 'grow', text: (p ? p.display_name : '—') + (me ? ' (bạn)' : '') + ' · ' + (side === 'red' ? 'Đỏ' : 'Xanh') }),
          Utils.el('span', { class: 'clock', 'data-side': side, text: '—' })]);
      };
      pl.replaceChildren(row('red'), row('blue'));
      const badge = Utils.$('#op-badge'); badge.textContent = (d.ranked ? 'Xếp hạng' : 'Không xếp hạng') + (this.isPlayer() ? '' : ' · Khán giả');
      const player = this.isPlayer(), active = d.status === 'active';
      Utils.$('#op-actions').hidden = !(player && active);
      Utils.$('#btn-resign').disabled = this.busy; 
      const offerBy = d.draw_offer_by, box = Utils.$('#op-draw'); box.hidden = !(active && offerBy);
      Utils.$('#btn-draw').disabled = this.busy || !!offerBy;
      if (active && offerBy) {
        const mineOffer = offerBy === this.role;
        box.replaceChildren(Utils.el('p', { text: !player ? 'Có đề nghị hòa đang chờ trả lời.' : mineOffer ? 'Bạn đã xin hòa — chờ đối phương trả lời.' : 'Đối phương xin hòa.' }));
        if (player && !mineOffer) {
          const a = Utils.el('button', { type: 'button', class: 'btn btn-gold btn-sm', text: 'Chấp nhận hòa' }), r = Utils.el('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: 'Từ chối' });
          a.disabled = r.disabled = this.busy; a.addEventListener('click', () => this.respondDraw(true)); r.addEventListener('click', () => this.respondDraw(false));
          box.append(Utils.el('div', { class: 'row' }, [a, r]));
        }
      }
      const res = Utils.$('#op-result'); res.hidden = active;
      if (!active) {
        const t = this.resultText(), rm = this.rematch || {}, mine = rm[this.role], theirs = rm[this.role === 'red' ? 'blue' : 'red'];
        Utils.$('#op-result-title').textContent = t.title; Utils.$('#op-result-sub').textContent = t.sub;
        const rb = Utils.$('#btn-rematch'), rn = Utils.$('#btn-rematch-no'), rs = Utils.$('#op-rematch-status');
        rb.hidden = rn.hidden = !player; rs.hidden = !player;
        rb.disabled = this.busy || mine === 'yes' || theirs === 'no'; rn.disabled = this.busy || mine === 'no';
        rb.textContent = d.ranked ? 'Tái đấu (không xếp hạng)' : 'Tái đấu';
        rs.textContent = theirs === 'no' ? 'Đối thủ đã từ chối tái đấu.' : mine === 'no' ? 'Bạn đã từ chối tái đấu.'
          : mine === 'yes' ? 'Đang chờ đối thủ đồng ý…' : theirs === 'yes' ? 'Đối thủ muốn tái đấu.' : 'Cả hai phải đồng ý mới tạo trận mới.';
      }
      Phase4.renderResult(this);
      this.renderStatus(); Clock.tick();
    }
  };

  /* ===================================================================
   * PHASE 4 — Xếp hạng (HELO), hồ sơ công khai, replay, admin / boss (client)
   * Client CHỈ hiển thị và gọi RPC. HELO, rank, role, quyền xem/lưu/xóa replay và mọi thao tác quản trị do DATABASE quyết định.
   * Ẩn nút theo role chỉ để gọn giao diện — không phải cơ chế bảo vệ. Mọi chuỗi từ server đều đi qua textContent (chống XSS).
   * =================================================================== */
  Object.assign(RPC_ERRORS, {
    replay_unavailable: 'Replay này không còn khả dụng (đã bị bỏ, đã ẩn hoặc bạn không có quyền xem).',
    username_locked: 'Tên người dùng là tên đăng nhập nên không đổi được.',
    invalid_reason: 'Lý do cần từ 5 ký tự (tối đa 500; báo cáo tối đa 1000).', target_not_found: 'Không tìm thấy đối tượng.',
    cannot_target_self: 'Không thể thực hiện thao tác này với chính bạn (hoặc báo cáo liên quan tới bạn).',
    cannot_target_role: 'Bạn không đủ quyền tác động lên tài khoản này.', invalid_action: 'Hành động không hợp lệ.',
    invalid_setting: 'Giá trị cấu hình không hợp lệ.', report_not_found: 'Không tìm thấy báo cáo.',
    report_duplicate: 'Bạn đã có một báo cáo đang chờ xử lý về người này.', too_many_reports: 'Bạn đã gửi quá nhiều báo cáo trong 24 giờ.',
    result_locked: 'Kết quả Ranked đã bị khóa, không thể sửa.', audit_locked: 'Dữ liệu Ranked đã bị khóa, không thể sửa hoặc xóa.',
    audit_immutable: 'Audit log không thể sửa hoặc xóa.'
  });

  const Fmt = {
    dt(ts) { if (!ts) return '—'; const d = new Date(ts); return isNaN(d.getTime()) ? '—' : d.toLocaleString('vi-VN'); },
    day(ts) { if (!ts) return '—'; const d = new Date(ts); return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('vi-VN'); },
    delta(n) { return n === null || n === undefined ? '—' : (n > 0 ? '+' + n : String(n)); },
    pct(n) { return n === null || n === undefined ? '—' : n + '%'; },
    result(r) { return { win: 'Thắng', loss: 'Thua', draw: 'Hòa' }[r] || '—'; },
    side(s) { return s === 'red' ? 'Đỏ' : 'Xanh'; },
    mode(m, ranked) { return ranked ? 'Quick Match (Ranked)' : ({ private: 'Phòng riêng', friend: 'Bạn bè', quick: 'Tái đấu từ Ranked (không xếp hạng)' }[m] || String(m || '—')); },
    end(r) { return { king_captured: 'Bắt được Vua', no_legal_moves: 'Hết nước đi hợp lệ', timeout: 'Hết giờ', resignation: 'Đầu hàng', draw_agreement: 'Hai bên đồng ý hòa' }[r] || String(r || '—'); },
    td(text, cls) { return Utils.el('td', { class: cls || '', text: text === null || text === undefined ? '—' : String(text) }); },
    th(text, cls) { return Utils.el('th', { scope: 'col', class: cls || '', text }); },
    link(username, text) { return Utils.el('a', { href: '#/player?u=' + encodeURIComponent(username), text: text || username }); },
    btn(label, kind, fn, small) {
      const b = Utils.el('button', { type: 'button', class: 'btn btn-' + (kind || 'ghost') + (small === false ? '' : ' btn-sm'), text: label });
      b.addEventListener('click', () => fn(b)); return b;
    },
    pill(r) { return Utils.el('span', { class: 'pill pill-' + (r || 'none'), text: Fmt.result(r) }); },
    empty(text) { return Utils.el('p', { class: 'muted small', text }); }
  };

  /** Hộp nhập lý do (5–500 ký tự) cho thao tác quản trị / báo cáo. Trả về chuỗi hoặc null. */
  const askReason = async (title, hint, max) => {
    const ta = Utils.el('textarea', { id: 'reason-input', rows: '3', maxlength: String(max || 500) });
    const v = await Modal.open({ title, body: [Utils.el('p', { class: 'muted small', text: hint }), Utils.el('label', { class: 'field' }, [Utils.el('span', { text: 'Lý do (bắt buộc)' }), ta])],
      validate: () => (ta.value.trim().length >= 5 ? '' : 'Lý do cần ít nhất 5 ký tự.'),
      actions: [{ label: 'Hủy', value: null }, { label: 'Xác nhận', value: 'ok', kind: 'gold', submit: true }] });
    return v === 'ok' ? ta.value.trim() : null;
  };

  const Ranking = {
    tiers: null, tab: 'global', week: 0, offset: 0, rows: [], total: 0, my: null, meta: null, busy: false, bound: false,
    /** Ngưỡng rank lấy từ app_settings.rank_tiers (cấu hình tập trung ở database, Boss sửa) — client không giữ bản sao cứng. */
    async loadConfig() {
      try {
        const rows = await Database.run((c) => c.from('app_settings').select('key,value').eq('key', 'rank_tiers').limit(1), 1);
        const v = rows && rows[0] && rows[0].value;
        if (Array.isArray(v) && v.length) this.tiers = v.slice().sort((a, b) => a.min - b.min);
      } catch (_) { /* best-effort: thiếu cấu hình thì không hiện rank */ }
    },
    tierOf(rating) {
      if (!this.tiers || typeof rating !== 'number') return '';
      let name = ''; for (const t of this.tiers) if (rating >= t.min) name = t.name; return name;
    },
    badge(name, big) {
      const key = String(name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase().replace(/[^a-z0-9]/g, ''), A = ASSET_CONFIG, file = A.enabled && key && (A.tierImages[key] || ('rank-' + key + '.png'));
      const kids = [];
      if (file) { const img = Utils.el('img', { class: 'tier-img', src: A.basePath + file, alt: '', width: '400', height: '400', loading: 'lazy' }); img.addEventListener('error', () => img.remove()); kids.push(img); }
      kids.push(Utils.el('span', { text: name || 'Chưa xếp hạng' }));
      return Utils.el('span', { class: 'tier tier-' + key + (big ? ' tier-big' : '') }, kids);
    },
    bind() {
      if (this.bound) return; this.bound = true;
      const on = (id, ev, fn) => Utils.$('#' + id).addEventListener(ev, fn);
      on('rk-tab-global', 'click', () => { this.tab = 'global'; this.load(true); });
      on('rk-tab-weekly', 'click', () => { this.tab = 'weekly'; this.load(true); });
      on('rk-week', 'change', (e) => { this.week = +e.target.value || 0; this.load(true); });
      on('rk-more', 'click', () => this.load(false));
      on('rk-refresh', 'click', () => this.load(true));
    },
    enter() { this.bind(); this.load(true); },
    async load(reset) {
      if (this.busy) return; this.busy = true;
      const st = Utils.$('#rk-status'); st.textContent = 'Đang tải…'; Utils.$('#rk-more').hidden = true;
      try {
        if (reset) { this.offset = 0; this.rows = []; }
        const res = this.tab === 'global' ? await Rpc.call('get_global_leaderboard', { p_limit: 50, p_offset: this.offset })
          : await Rpc.call('get_weekly_leaderboard', { p_week_offset: this.week, p_limit: 50, p_offset: this.offset });
        this.rows = this.rows.concat(res.rows || []); this.total = res.total || 0; this.my = res.my || null; this.meta = res; this.offset = this.rows.length;
        st.textContent = ''; this.render();
      } catch (e) { st.textContent = Utils.mapError(e); }
      finally { this.busy = false; }
    },
    render() {
      const weekly = this.tab === 'weekly';
      Utils.$('#rk-tab-global').setAttribute('aria-selected', String(!weekly)); Utils.$('#rk-tab-weekly').setAttribute('aria-selected', String(weekly));
      Utils.$('#rk-week-row').hidden = !weekly;
      if (weekly && this.meta) Utils.$('#rk-week-range').textContent = Fmt.day(this.meta.week_start) + ' – ' + Fmt.day(this.meta.week_end) + ' (giờ Việt Nam, thứ Hai 00:00 → Chủ nhật 23:59:59)';
      const cols = weekly ? ['#', 'Người chơi', 'HELO ±', 'Rank', 'HELO', 'Trận', 'T', 'H', 'B'] : ['#', 'Người chơi', 'Rank', 'HELO', 'Trận', 'T', 'H', 'B', 'Tỷ lệ thắng'];
      Utils.$('#rk-head').replaceChildren(Utils.el('tr', {}, cols.map((c, i) => Fmt.th(c, i >= 4 && !(weekly && i === 4) ? 'hide-sm' : ''))));
      const my = Utils.$('#rk-my');
      if (this.my) {
        my.hidden = false;
        my.replaceChildren(Utils.el('strong', { text: 'Vị trí của bạn: #' + this.my.rank + ' · ' + (weekly ? Fmt.delta(this.my.delta) + ' HELO tuần này · ' + this.my.games + ' trận'
          : this.my.rating + ' HELO · ' + this.my.tier + ' · ' + this.my.games + ' trận') }));
      } else { my.hidden = false; my.replaceChildren(Fmt.empty(weekly ? 'Bạn chưa có trận Ranked nào trong tuần này.' : 'Bạn chưa có trận Ranked nào — hãy chơi Tìm trận nhanh để vào bảng xếp hạng.')); }
      const rows = this.rows.map((r) => {
        const av = Utils.el('span', { class: 'avatar avatar-sm', 'aria-hidden': 'true' }); UI.renderAvatar(av, r.display_name, r.avatar_url);
        const who = Utils.el('td', { class: 'who' }, [av, Fmt.link(r.username, r.display_name + ' (@' + r.username + ')')]);
        const tier = Utils.el('td', {}, [Ranking.badge(r.tier)]);
        const tr = Utils.el('tr', { class: r.user_id === Auth.uid() ? 'me' : '' });
        if (weekly) tr.append(Fmt.td(r.rank), who, Fmt.td(Fmt.delta(r.delta), r.delta > 0 ? 'pos' : r.delta < 0 ? 'neg' : ''), tier, Fmt.td(r.rating), Fmt.td(r.games, 'hide-sm'), Fmt.td(r.wins, 'hide-sm'), Fmt.td(r.draws, 'hide-sm'), Fmt.td(r.losses, 'hide-sm'));
        else tr.append(Fmt.td(r.rank), who, tier, Fmt.td(r.rating), Fmt.td(r.games, 'hide-sm'), Fmt.td(r.wins, 'hide-sm'), Fmt.td(r.draws, 'hide-sm'), Fmt.td(r.losses, 'hide-sm'), Fmt.td(Fmt.pct(r.win_rate), 'hide-sm'));
        return tr;
      });
      Utils.$('#rk-body').replaceChildren(...rows);
      Utils.$('#rk-empty').hidden = rows.length > 0;
      Utils.$('#rk-more').hidden = this.rows.length >= this.total;
      Utils.$('#rk-note').textContent = weekly ? 'Xếp theo tổng biến động HELO của các trận Ranked kết thúc trong tuần; bằng điểm thì nhiều trận thắng hơn, rồi nhiều trận Ranked hơn. HELO tổng không bị reset.'
        : 'Chỉ tính trận Ranked (Tìm trận nhanh). Tỷ lệ thắng chỉ hiện khi đã có ít nhất ' + ((this.meta && this.meta.min_games_for_win_rate) || 5) + ' trận.';
    }
  };

  const Player = {
    st: {},
    enterRoute() { const u = Router.param('u'); if (!u) return Router.go('ranking'); this.load('pl-body', u); },
    async load(boxId, username) {
      const box = Utils.$('#' + boxId); box.replaceChildren(Utils.el('p', { class: 'muted', text: 'Đang tải…' }));
      try {
        const d = await Rpc.call('get_player_profile', { p_username: username || null, p_match_offset: 0 });
        this.st[boxId] = { d, matches: d.matches || [], username }; await this.render(boxId);
      } catch (e) { box.replaceChildren(Utils.el('p', { class: 'form-error', text: Utils.mapError(e) })); }
    },
    stat(label, value) { return Utils.el('div', { class: 'stat-mini' }, [Utils.el('span', { class: 'stat-label', text: label }), Utils.el('strong', { text: String(value) })]); },
    async render(boxId) {
      const box = Utils.$('#' + boxId), S = this.st[boxId]; if (!S) return; const d = S.d, r = d.rating;
      const av = Utils.el('div', { class: 'avatar', 'aria-hidden': 'true' }); UI.renderAvatar(av, d.display_name, d.avatar_url);
      const head = Utils.el('div', { class: 'profile-top' }, [av, Utils.el('div', {}, [Utils.el('strong', { text: d.display_name + ' (@' + d.username + ')' }),
        Utils.el('p', { class: 'muted small', text: 'Tham gia ' + Fmt.day(d.joined_at) }), d.bio ? Utils.el('p', { class: 'small', text: d.bio }) : '' ])]);
      const nodes = [head];
      if (!d.is_me) nodes.push(Utils.el('div', { class: 'row' }, [Fmt.btn('Báo cáo người chơi', 'ghost', () => this.report(d))]));
      nodes.push(Utils.el('div', { class: 'stat-grid' }, [this.stat('HELO', r.rating), Utils.el('div', { class: 'stat-mini' }, [Utils.el('span', { class: 'stat-label', text: 'Rank' }), Ranking.badge(r.tier)]),
        this.stat('Thứ hạng', r.position ? '#' + r.position : '—'), this.stat('Trận Ranked', r.games), this.stat('Thắng', r.wins), this.stat('Hòa', r.draws), this.stat('Thua', r.losses),
        this.stat('Tỷ lệ thắng', r.win_rate === null ? '— (cần ≥ 5 trận)' : Fmt.pct(r.win_rate)), this.stat('HELO cao nhất', r.peak)]));
      nodes.push(Utils.el('h2', { text: 'Thành tích' }));
      nodes.push(d.achievements.length ? Utils.el('div', { class: 'chips' }, d.achievements.map((a) => Utils.el('span', { class: 'chip', text: a.label }))) : Fmt.empty('Chưa có thành tích. Thành tích được tính từ số liệu Ranked thật.'));
            nodes.push(Utils.el('h2', { text: '3 trận gần nhất' }), Utils.el('ul', { id: boxId + '-matches', class: 'list match-list' }));
      box.replaceChildren(...nodes);
      this.renderMatches(boxId);
    },
    renderMatches(boxId) {
      const S = this.st[boxId], d = S.d, ul = Utils.$('#' + boxId + '-matches'); if (!ul) return;
      ul.replaceChildren(...(S.matches.length ? S.matches.map((m) => this.matchRow(boxId, d, m)) : [Utils.el('li', {}, [Fmt.empty(d.is_me ? 'Chưa có trận nào kết thúc.' : 'Chưa có trận Ranked công khai.')])]));
    },
    matchRow(boxId, d, m) {
      const acts = [];
      if (m.replay_available) acts.push(Fmt.btn('Xem replay', 'gold', () => Router.go('replay', { m: m.match_id })));
      if (d.is_me && m.replay_available) {
        const reload = () => this.load(boxId, S_USERNAME(this, boxId));
        const call = (name, args, msg) => (b) => withBusy(b, async () => { await Rpc.call(name, args); UI.toast(msg); await reload(); });
        if (m.ranked) {
          acts.push(Fmt.btn(m.saved ? 'Bỏ bookmark' : 'Bookmark', 'ghost', call(m.saved ? 'delete_personal_replay' : 'save_replay', m.saved ? { p_match: m.match_id, p_hide: false } : { p_match: m.match_id }, m.saved ? 'Đã bỏ bookmark.' : 'Đã lưu bookmark.')));
          acts.push(Fmt.btn(m.hidden ? 'Hiện lại' : 'Ẩn khỏi hồ sơ', 'ghost', call(m.hidden ? 'save_replay' : 'delete_personal_replay', m.hidden ? { p_match: m.match_id } : { p_match: m.match_id, p_hide: true }, m.hidden ? 'Đã hiện lại và lưu replay.' : 'Đã ẩn khỏi hồ sơ. Dữ liệu trận Ranked vẫn được giữ.')));
        } else {
          acts.push(Fmt.btn(m.saved ? 'Đã lưu ✓' : 'Lưu replay', 'ghost', call('save_replay', { p_match: m.match_id }, 'Đã lưu replay.')));
          acts.push(Fmt.btn('Bỏ replay của tôi', 'ghost', async (b) => {
            const ok = await Modal.confirm({ title: 'Bỏ replay cá nhân?', message: 'Bạn sẽ không xem lại được replay này. Nếu đối thủ vẫn giữ, bản chung vẫn còn cho họ; chỉ khi cả hai cùng bỏ thì dữ liệu nước đi mới bị xóa.', ok: 'Bỏ replay', cancel: 'Giữ lại', danger: true });
            if (ok) await call('delete_personal_replay', { p_match: m.match_id, p_hide: false }, 'Đã bỏ replay cá nhân.')(b);
          }));
        }
      }
      const opp = m.opponent || {};
      return Utils.el('li', { class: 'match-row' }, [Fmt.pill(m.result), Utils.el('div', { class: 'match-info' }, [
        Utils.el('span', {}, [Fmt.mode(m.mode, m.ranked) + ' · vs ', opp.username ? Fmt.link(opp.username, '@' + opp.username) : '—']),
        Utils.el('span', { class: 'muted small', text: Fmt.dt(m.ended_at) + ' · ' + Fmt.end(m.end_reason) + ' · ' + m.plies + ' nước' + (m.delta !== null && m.delta !== undefined ? ' · HELO ' + Fmt.delta(m.delta) : '') })]),
        Utils.el('div', { class: 'row tight' }, acts)]);
    },
    async more(boxId) {
      const S = this.st[boxId]; if (!S) return;
      const d = await Rpc.call('get_player_profile', { p_username: S.d.username, p_match_offset: S.matches.length });
      S.matches = S.matches.concat(d.matches || []); this.renderMatches(boxId);
      if (!(d.matches || []).length) Utils.$('#' + boxId + '-more').hidden = true;
    },
    async report(d) {
      const reason = await askReason('Báo cáo @' + d.username, 'Mô tả hành vi vi phạm. Báo cáo sẽ được Admin xem xét; báo cáo sai sự thật có thể bị xử lý.', 1000);
      if (!reason) return;
      await withBusy(null, async () => { await Rpc.call('submit_report', { p_target_user: d.user_id, p_match: null, p_reason: reason }); UI.toast('Đã gửi báo cáo. Cảm ơn bạn.'); });
    }
  };
  const S_USERNAME = (self, boxId) => (self.st[boxId] && self.st[boxId].username) || null;

  /* ----- Replay: tái dựng từ nước đi + snapshot do server lưu (không phải animation giả) ----- */
  const Replay = {
    data: null, frames: [], problems: [], idx: 0, timer: null, playing: false, speed: 1, token: 0, inited: false, cells: [], id: null,
    prefs: { autoplay: false, speed: 1, show_coords: true },
    notation(m) { return (m.from_row + 1) + '.' + (m.from_col + 1) + ' -> ' + (m.to_row + 1) + '.' + (m.to_col + 1); },   // 1-based; code dùng 0-based
    async loadPrefs() {
      try {
        const rows = await Database.run((c) => c.from('replay_preferences').select('autoplay,speed,show_coords').eq('user_id', Auth.uid()).limit(1), 1);
        if (rows && rows[0]) this.prefs = { autoplay: !!rows[0].autoplay, speed: [0.5, 1, 2, 4].includes(Number(rows[0].speed)) ? Number(rows[0].speed) : 1, show_coords: rows[0].show_coords !== false };
      } catch (_) { /* best-effort */ }
    },
    /** frames[0] = bàn đầu; frames[i] = snapshot SAU nước i. Mỗi snapshot được đối chiếu với chính nước đi tương ứng. */
    build(data) {
      const problems = [], init = data && data.initial && data.initial.board;
      if (!Array.isArray(init)) return { frames: [], problems: ['Thiếu bàn cờ ban đầu.'] };
      const frames = [{ ply: 0, board: init, move: null }], at = (b, r, c) => b.find((p) => p.row === r && p.col === c);
      const moves = (data.moves || []).slice().sort((a, b) => a.move_number - b.move_number);
      let prev = init;
      moves.forEach((m, i) => {
        const tag = 'Nước ' + m.move_number + ': ', snap = m.state_snapshot; let b = snap && snap.board;
        if (m.move_number !== i + 1) problems.push(tag + 'số thứ tự không liên tục.');
        if (!Array.isArray(b)) { problems.push(tag + 'thiếu snapshot.'); b = prev; }
        else {
          if (snap.move_number !== m.move_number) problems.push(tag + 'snapshot sai số nước.');
          const bf = at(prev, m.from_row, m.from_col), bt = at(prev, m.to_row, m.to_col);
          if (!bf || bf.id !== m.piece_id) problems.push(tag + 'quân đi không khớp trạng thái trước.');
          if (m.action_type === 'swap') {
            const a = at(b, m.to_row, m.to_col), c = at(b, m.from_row, m.from_col);
            if (!bf || !bt || !a || !c || a.id !== bf.id || c.id !== bt.id) problems.push(tag + 'đổi chỗ Vua–Thuật không khớp snapshot.');
            if (b.length !== prev.length) problems.push(tag + 'số quân thay đổi khi đổi chỗ.');
          } else {
            const a = at(b, m.to_row, m.to_col), gone = m.captured_piece ? [m.captured_piece].concat(m.captured_piece.chain || []) : [];
            if (!a || a.id !== m.piece_id) problems.push(tag + 'quân đến ô đích không khớp snapshot.');
            if (m.action_type === 'capture' && !m.captured_piece) problems.push(tag + 'nước bắt quân thiếu quân bị bắt.');
            if (b.length !== prev.length - gone.length) problems.push(tag + 'số quân sau nước đi không khớp.');
            if (gone.some((p) => b.some((q) => q.id === p.id))) problems.push(tag + 'quân bị bắt vẫn còn trên bàn.');
          }
        }
        frames.push({ ply: m.move_number, board: b, move: m }); prev = b;
      });
      return { frames, problems };
    },
    name(p) { return p && p.username ? p.display_name + ' (@' + p.username + ')' : '—'; },
    resultText(m) { return m.winner_side === 'draw' ? 'Hòa' : 'Phe ' + Fmt.side(m.winner_side) + ' thắng — ' + this.name(m.winner_side === 'red' ? m.red : m.blue); },
    capText(m) {
      if (!m.captured_piece) return '';
      const c = m.captured_piece, nm = (p) => (PIECE_TYPES[p.type] ? PIECE_TYPES[p.type].name : p.type) + ' ' + p.id;
      return 'Bắt ' + nm(c) + ((c.chain || []).length ? ' · kèm loại: ' + c.chain.map(nm).join(', ') + ' (Cặp Thuật)' : '');
    },
    toTxt(data, frames) {
      const m = data.match, L = [], fr = frames || this.build(data).frames;
      L.push('CROWNFALL — REPLAY', 'Match ID: ' + m.id, 'Đỏ: ' + this.name(m.red), 'Xanh: ' + this.name(m.blue),
        'Ngày đấu: ' + (m.ended_at || m.started_at || '—'), 'Chế độ: ' + Fmt.mode(m.mode, m.ranked), 'Kết quả: ' + this.resultText(m), 'Lý do: ' + Fmt.end(m.end_reason));
      if (data.rating) L.push('HELO: Đỏ ' + data.rating.red.before + ' → ' + data.rating.red.after + ' (' + Fmt.delta(data.rating.red.delta) + '); Xanh ' + data.rating.blue.before + ' → ' + data.rating.blue.after + ' (' + Fmt.delta(data.rating.blue.delta) + ')');
      L.push('Quy ước tọa độ: hàng.cột, đánh số từ 1 (hàng 1 = phía P1/Xanh, hàng 9 = phía P2/Đỏ).', '');
      (data.moves || []).slice().sort((a, b) => a.move_number - b.move_number).forEach((mv, i) => {
        const who = mv.side === 'red' ? 'P2 (Đỏ)' : 'P1 (Xanh)', pv = fr[i] ? fr[i].board : [];
        let line = mv.move_number + '. ' + who + ' | ' + mv.piece_type + ' ' + this.notation(mv) + ' | ' + mv.action_type;
        if (mv.action_type === 'swap') { const o = pv.find((p) => p.row === mv.to_row && p.col === mv.to_col); line += ' (đổi chỗ Vua–Thuật: ' + mv.piece_id + ' <-> ' + (o ? o.id : '?') + ')'; }
        const cap = this.capText(mv); if (cap) line += ' | ' + cap;
        L.push(line);
      });
      L.push('', 'Tổng số nước: ' + (data.moves || []).length);
      return L.join('\r\n');
    },
    download() {
      if (!this.data) return;
      const blob = new Blob(['\ufeff' + this.toTxt(this.data, this.frames)], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob), a = Utils.el('a', { href: url, download: 'crownfall-' + String(this.data.match.id).slice(0, 8) + '.txt' });
      document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
    },
    initDom() {
      if (this.inited) return; this.inited = true;
      const board = Utils.$('#rp-board'), frag = document.createDocumentFragment();
      for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
        const b = Utils.el('div', { class: 'cell ro ' + (r === BORDER_ROW ? 'terr-border' : (r < BORDER_ROW ? 'terr-p1' : 'terr-p2')), role: 'gridcell' });
        b.dataset.co = (r + 1) + '.' + (c + 1); this.cells.push(b); frag.append(b);
      }
      board.append(frag);
      const on = (id, ev, fn) => Utils.$('#' + id).addEventListener(ev, fn);
      on('rp-first', 'click', () => { this.pause(); this.goTo(0); }); on('rp-prev', 'click', () => { this.pause(); this.goTo(this.idx - 1); });
      on('rp-next', 'click', () => { this.pause(); this.goTo(this.idx + 1); }); on('rp-last', 'click', () => { this.pause(); this.goTo(this.frames.length - 1); });
      on('rp-play', 'click', () => (this.playing ? this.pause() : this.play()));
      on('rp-range', 'input', (e) => { this.pause(); this.goTo(+e.target.value); });
      on('rp-speed', 'change', (e) => { this.speed = +e.target.value || 1; if (this.playing) this.schedule(); });
      on('rp-txt', 'click', () => this.download());
      on('rp-save', 'click', (ev) => withBusy(ev.currentTarget, async () => { await Rpc.call('save_replay', { p_match: this.id }); UI.toast('Đã lưu replay.'); if (this.data.mine) this.data.mine.saved = true; this.renderActions(); }));
      on('rp-remove', 'click', (ev) => withBusy(ev.currentTarget, async () => {
        const ok = await Modal.confirm({ title: 'Bỏ replay cá nhân?', message: 'Bạn sẽ không xem lại được replay này. Chỉ khi cả hai người chơi cùng bỏ thì dữ liệu nước đi mới bị xóa.', ok: 'Bỏ replay', cancel: 'Giữ lại', danger: true });
        if (!ok) return; await Rpc.call('delete_personal_replay', { p_match: this.id, p_hide: false }); UI.toast('Đã bỏ replay cá nhân.'); Router.go('profile');
      }));
      on('rp-back', 'click', () => { if (history.length > 1) history.back(); else Router.go('profile'); });
      document.addEventListener('keydown', (e) => {
        if (Router.current() !== 'replay' || !this.frames.length || /^(INPUT|SELECT|TEXTAREA)$/.test((e.target && e.target.tagName) || '')) return;
        if (e.key === 'ArrowLeft') { e.preventDefault(); this.pause(); this.goTo(this.idx - 1); }
        else if (e.key === 'ArrowRight') { e.preventDefault(); this.pause(); this.goTo(this.idx + 1); }
        else if (e.key === ' ' && !/^BUTTON$/.test((e.target && e.target.tagName) || '')) { e.preventDefault(); this.playing ? this.pause() : this.play(); }
      });
    },
    async enter(id) {
      this.leave(); this.initDom(); const tok = ++this.token;
      if (!/^[0-9a-f-]{36}$/i.test(String(id || ''))) { UI.toast('Thiếu mã trận.', true); return Router.go('profile'); }
      const st = Utils.$('#rp-status'), main = Utils.$('#rp-main'); st.hidden = false; st.textContent = 'Đang tải replay…'; main.hidden = true; this.data = null; this.frames = []; this.id = id;
      let data;
      try { data = await Rpc.call('export_match_notation_data', { p_match: id }); }
      catch (e) { if (tok === this.token) st.textContent = Utils.mapError(e); return; }
      if (tok !== this.token) return;
      const b = this.build(data); this.data = data; this.frames = b.frames; this.problems = b.problems;
      if (!this.frames.length) { st.textContent = 'Replay không có dữ liệu bàn cờ.'; return; }
      st.hidden = true; main.hidden = false; this.speed = this.prefs.speed;
      Utils.$('#rp-speed').value = String(this.speed); Utils.$('#rp-board').classList.toggle('show-co', !!this.prefs.show_coords);
      const w = Utils.$('#rp-warn'); w.hidden = !this.problems.length;
      w.textContent = this.problems.length ? 'Cảnh báo: dữ liệu replay có ' + this.problems.length + ' điểm không khớp (' + this.problems.slice(0, 2).join(' ') + ') — bàn cờ hiển thị đúng như snapshot server lưu.' : '';
      const m = data.match;
      Utils.$('#rp-title').textContent = Fmt.mode(m.mode, m.ranked) + ' · ' + Fmt.dt(m.ended_at);
      Utils.$('#rp-players').replaceChildren(Utils.el('span', { class: 'f-red', text: 'Đỏ: ' + this.name(m.red) }), Utils.el('span', { class: 'f-blue', text: 'Xanh: ' + this.name(m.blue) }));
      Utils.$('#rp-result').textContent = 'Kết quả: ' + this.resultText(m) + ' · ' + Fmt.end(m.end_reason) + (data.rating ? ' · HELO Đỏ ' + Fmt.delta(data.rating.red.delta) + ' / Xanh ' + Fmt.delta(data.rating.blue.delta) : '');
      const range = Utils.$('#rp-range'); range.max = String(this.frames.length - 1); range.value = '0';
      Utils.$('#rp-moves').replaceChildren(...this.frames.slice(1).map((f, i) => {
        const li = Utils.el('li', {}), btn = Utils.el('button', { type: 'button', class: 'mv', text: f.move.move_number + '. ' + (f.move.side === 'red' ? 'Đỏ' : 'Xanh') + ' · ' + f.move.piece_type + ' ' + this.notation(f.move) });
        btn.addEventListener('click', () => { this.pause(); this.goTo(i + 1); }); li.append(btn); return li;
      }));
      this.renderActions(); this.goTo(0);
      if (this.prefs.autoplay && this.frames.length > 1) this.play();
    },
    renderActions() {
      const mine = this.data && this.data.mine, ranked = this.data && this.data.match.ranked;
      Utils.$('#rp-save').hidden = !mine; Utils.$('#rp-save').textContent = mine && mine.saved ? 'Đã lưu ✓' : (ranked ? 'Lưu bookmark' : 'Lưu replay');
      Utils.$('#rp-remove').hidden = !mine || ranked;   // Ranked: không xóa dữ liệu; ẩn/bỏ bookmark làm ở Hồ sơ
    },
    goTo(i) {
      if (!this.frames.length) return;
      this.idx = Math.max(0, Math.min(this.frames.length - 1, i)); this.render();
      if (this.playing && this.idx >= this.frames.length - 1) this.pause();
    },
    play() {
      if (this.frames.length < 2) return; if (this.idx >= this.frames.length - 1) this.goTo(0);
      this.playing = true; Utils.$('#rp-play').textContent = 'Tạm dừng'; this.schedule();
    },
    pause() { this.playing = false; clearTimeout(this.timer); const b = Utils.$('#rp-play'); if (b) b.textContent = 'Phát'; },
    schedule() {
      clearTimeout(this.timer); if (!this.playing) return;
      this.timer = setTimeout(() => { if (!this.playing) return; this.goTo(this.idx + 1); if (this.playing) this.schedule(); }, 1000 / this.speed);
    },
    leave() { this.token++; this.pause(); },
    render() {
      const f = this.frames[this.idx], mv = f.move, map = new Map(); f.board.forEach((p) => map.set(p.row * SIZE + p.col, p));
      const A = ASSET_CONFIG, cap = mv && mv.action_type === 'capture' ? mv : null;
      this.cells.forEach((b, k) => {
        const p = map.get(k), r = Math.floor(k / SIZE), c = k % SIZE, cl = b.classList, sig = p ? p.id + p.owner : '';
        if (b.dataset.sig !== sig) {
          b.dataset.sig = sig; const old = b.querySelector('.piece'); if (old) old.remove();
          if (p) { const fac = FACTION[p.owner], tp = PIECE_TYPES[p.type];
            b.append(Utils.el('span', { class: 'piece f-' + fac }, [AssetConfig.node(A.pieceImages[fac][tp.key], p.type, tp.name + ' ' + (fac === 'red' ? 'Đỏ' : 'Xanh'))])); }
        }
        const isFrom = !!mv && mv.from_row === r && mv.from_col === c, isTo = !!mv && mv.to_row === r && mv.to_col === c;
        cl.toggle('last', isFrom || isTo); cl.toggle('t-capture', !!cap && isTo); cl.toggle('t-swap', !!mv && mv.action_type === 'swap' && (isFrom || isTo));
        b.setAttribute('aria-label', (p ? PIECE_TYPES[p.type].name + ' ' + p.owner + ', ' : 'Ô trống, ') + 'hàng ' + (r + 1) + ' cột ' + (c + 1));
      });
      Utils.$('#rp-range').value = String(this.idx);
      Utils.$$('#rp-moves .mv').forEach((n, i) => { const on = i + 1 === this.idx; n.classList.toggle('cur', on); if (on) { let sc = n.parentElement; while (sc && sc !== document.body && !/(auto|scroll)/.test(getComputedStyle(sc).overflowY)) sc = sc.parentElement; if (sc && sc !== document.body && sc.scrollHeight > sc.clientHeight) sc.scrollTop += n.getBoundingClientRect().top - sc.getBoundingClientRect().top - (sc.clientHeight - n.offsetHeight) / 2; } });
      Utils.$('#rp-pos').textContent = 'Nước ' + this.idx + ' / ' + (this.frames.length - 1);
      const m = this.data.match, box = Utils.$('#rp-info');
      if (!mv) box.replaceChildren(Utils.el('p', { text: 'Vị trí ban đầu.' }));
      else {
        const lines = [Utils.el('strong', { class: mv.side === 'red' ? 'f-red' : 'f-blue', text: 'Nước ' + mv.move_number + ' — ' + this.name(mv.side === 'red' ? m.red : m.blue) }),
          Utils.el('p', { class: 'mono', text: mv.piece_type + ' ' + this.notation(mv) + ' · ' + ({ move: 'đi', capture: 'bắt quân', swap: 'đổi chỗ Vua–Thuật' }[mv.action_type] || mv.action_type) })];
        if (mv.action_type === 'swap') lines.push(Utils.el('p', { class: 'small', text: 'Vua và Thuật hoán đổi vị trí; cả hai ô được đánh dấu.' }));
        const ct = this.capText(mv); if (ct) lines.push(Utils.el('p', { class: 'small neg', text: ct }));
        lines.push(Utils.el('p', { class: 'muted small', text: Fmt.dt(mv.created_at) }));
        if (this.idx === this.frames.length - 1) lines.push(Utils.el('p', { class: 'result-line', text: 'Kết thúc: ' + this.resultText(m) + ' (' + Fmt.end(m.end_reason) + ').' }));
        box.replaceChildren(...lines);
      }
    }
  };

  /* ----- Admin / Boss ----- */
  const Admin = {
    kind: 'admin', d: null, search: '', logs: [], tiers: [],
    isBoss() { return this.kind === 'boss'; },
    async enter(kind) {
      this.kind = kind; const box = Utils.$('#ad-body');
      Utils.$('#ad-title').textContent = kind === 'boss' ? 'Bảng điều khiển Boss' : 'Bảng điều khiển Admin';
      Utils.$('#ad-eyebrow').textContent = kind === 'boss' ? 'Boss — toàn quyền quản trị cấp cao' : 'Quản trị';
      box.replaceChildren(Fmt.empty('Đang tải…'));
      try {
        this.d = kind === 'boss' ? await Rpc.call('get_boss_dashboard') : await Rpc.call('get_admin_dashboard', { p_search: this.search || null });
        this.logs = kind === 'boss' ? (this.d.recent_audit || []) : ((await Rpc.call('get_audit_logs', { p_limit: 20 })).rows || []);
      } catch (e) {
        box.replaceChildren(Utils.el('p', { class: 'form-error', text: Utils.mapError(e) }));
        if (/not_allowed/.test(String((e && e.message) || e))) { UI.toast('Bạn không có quyền truy cập trang này.', true); Router.go('home'); }
        return;
      }
      if (kind === 'boss') this.tiers = ((this.d.settings || {}).rank_tiers || []).map((t) => ({ name: t.name, min: t.min }));
      this.render();
    },
    refresh() { return this.enter(this.kind); },
    stat(label, v) { return Utils.el('div', { class: 'panel stat' }, [Utils.el('span', { class: 'stat-label', text: label }), Utils.el('strong', { text: String(v) })]); },
    table(heads, rows, empty) {
      if (!rows.length) return Fmt.empty(empty);
      return Utils.el('div', { class: 'tbl-wrap' }, [Utils.el('table', { class: 'tbl' }, [Utils.el('thead', {}, [Utils.el('tr', {}, heads.map((h) => Fmt.th(h)))]), Utils.el('tbody', {}, rows)])]);
    },
    section(title, nodes) { return Utils.el('div', { class: 'panel' }, [Utils.el('h2', { text: title }), ...[].concat(nodes)]); },
    render() {
      const d = this.d, boss = this.isBoss(), parts = [];
      const stats = [['Tổng người dùng', d.users_total], ['Người dùng mới (7 ngày)', d.users_new_7d], ['Đang hoạt động (5 phút)', d.users_active_5m], ['Tài khoản bị khóa/cấm', d.users_suspended],
        ['Báo cáo chờ xử lý', d.reports_open], ['Báo cáo đang xem xét', d.reports_reviewing], ['Báo cáo đã xử lý', d.reports_resolved], ['Báo cáo bị bỏ qua', d.reports_dismissed],
        ['Trận đang diễn ra', d.matches_active], ['Trận đã kết thúc', d.matches_finished]];
      if (boss) stats.push(['Số Admin', d.admins_total], ['Trận Ranked đã kết thúc', d.ranked_finished], ['Bản ghi audit', d.audit_total]);
      parts.push(Utils.el('div', { class: 'grid stats stats-wide' }, stats.map(([l, v]) => this.stat(l, v))));
      if ((d.review_queue || []).length) parts.push(this.section('Hành vi cần xem xét', Utils.el('ul', { class: 'list' }, d.review_queue.map((q) => Utils.el('li', {}, [Fmt.link(q.username, '@' + q.username), Utils.el('span', { class: 'muted', text: q.pending_reports + ' báo cáo đang chờ' })])))));
      parts.push(this.section('Báo cáo chờ xử lý', this.table(['Thời gian', 'Người báo cáo', 'Đối tượng', 'Lý do', 'Trận', 'Trạng thái', 'Xử lý'], (d.reports || []).map((r) => {
        const acts = [Fmt.btn('Xem xét', 'ghost', (b) => this.report(b, 'review', r)), Fmt.btn('Đã xử lý', 'gold', (b) => this.report(b, 'resolve', r)), Fmt.btn('Bỏ qua', 'ghost', (b) => this.report(b, 'dismiss', r))];
        if (r.status === 'reviewing') acts.shift();
        return Utils.el('tr', {}, [Fmt.td(Fmt.dt(r.created_at)), Utils.el('td', {}, [Fmt.link(r.reporter, '@' + r.reporter)]), Utils.el('td', {}, [Fmt.link(r.target, '@' + r.target)]),
          Fmt.td(r.reason, 'reason'), Utils.el('td', {}, [r.match_id ? Fmt.btn('Replay', 'ghost', () => Router.go('replay', { m: r.match_id })) : '—']), Fmt.td(r.status), Utils.el('td', {}, [Utils.el('div', { class: 'row tight' }, acts)])]);
      }), 'Không có báo cáo nào đang chờ.')));
      parts.push(this.section('Trận đang diễn ra (theo dõi chỉ-đọc)', this.table(['Chế độ', 'Đỏ', 'Xanh', 'Số nước', 'Bắt đầu', ''], (d.live_matches || []).map((m) => Utils.el('tr', {}, [
        Fmt.td(Fmt.mode(m.mode, m.ranked)), Fmt.td(m.red && m.red.username), Fmt.td(m.blue && m.blue.username), Fmt.td(m.plies), Fmt.td(Fmt.dt(m.started_at)),
        Utils.el('td', {}, [Fmt.btn('Theo dõi', 'ghost', () => Router.go('match', { m: m.match_id }))])])), 'Không có trận nào đang diễn ra.')));
      parts.push(this.usersSection());
      if (boss) { parts.push(this.adminsSection()); parts.push(this.settingsSection()); }
      parts.push(this.auditSection());
      Utils.$('#ad-body').replaceChildren(...parts);
    },
    usersSection() {
      const inp = Utils.el('input', { id: 'ad-search', type: 'search', maxlength: '30', placeholder: 'Tìm theo tên người dùng', value: this.search, autocomplete: 'off' });
      const form = Utils.el('form', { class: 'row search-row', novalidate: 'novalidate' }, [inp, Utils.el('button', { type: 'submit', class: 'btn btn-ghost btn-sm', text: 'Tìm' })]);
      form.addEventListener('submit', (ev) => { ev.preventDefault(); this.search = inp.value.trim().toLowerCase(); withBusy(null, async () => {
        const r = await Rpc.call('get_admin_dashboard', { p_search: this.search || null }); this.d.users = r.users; this.render(); }); });
      const me = Auth.uid(), boss = this.isBoss();
      const rows = (this.d.users || []).map((u) => {
        const acts = [];
        if (u.user_id !== me && u.role !== 'boss' && (u.role !== 'admin' || boss)) {
          if (u.status === 'active') { acts.push(Fmt.btn('Khóa tạm', 'ghost', (b) => this.user(b, 'suspend', u, 'Khóa tạm'))); if (boss) acts.push(Fmt.btn('Cấm', 'red', (b) => this.user(b, 'ban', u, 'Cấm vĩnh viễn'))); }
          else if (u.status === 'suspended' || boss) acts.push(Fmt.btn('Mở khóa', 'gold', (b) => this.user(b, 'restore', u, 'Mở khóa')));
        }
        return Utils.el('tr', {}, [Utils.el('td', {}, [Fmt.link(u.username, '@' + u.username)]), Fmt.td(u.display_name), Fmt.td(u.role), Fmt.td(u.status), Fmt.td(u.rating === null ? '—' : u.rating), Fmt.td(Fmt.day(u.created_at), 'hide-sm'),
          Utils.el('td', {}, [Utils.el('div', { class: 'row tight' }, acts)])]);
      });
      return this.section('Người dùng', [form, this.table(['Username', 'Tên hiển thị', 'Role', 'Trạng thái', 'HELO', 'Tham gia', 'Thao tác'], rows, 'Không tìm thấy người dùng.'),
        Fmt.empty('Hiển thị tối đa 30 tài khoản mới nhất / kết quả tìm kiếm. Mọi thao tác đều ghi audit log kèm lý do.')]);
    },
    adminsSection() {
      const inp = Utils.el('input', { id: 'ad-grant', type: 'text', maxlength: '20', placeholder: 'username cần chỉ định Admin', autocapitalize: 'none', autocomplete: 'off', spellcheck: 'false' });
      const form = Utils.el('form', { class: 'row search-row', novalidate: 'novalidate' }, [inp, Utils.el('button', { type: 'submit', class: 'btn btn-gold btn-sm', text: 'Chỉ định Admin' })]);
      form.addEventListener('submit', (ev) => { ev.preventDefault(); const u = inp.value.trim().toLowerCase(); if (!Config.USERNAME_RE.test(u)) return UI.toast('Tên người dùng không hợp lệ.', true);
        withBusy(ev.submitter || null, async () => {
          const p = await Rpc.call('get_player_profile', { p_username: u, p_match_offset: 0 });
          const reason = await askReason('Chỉ định @' + p.username + ' làm Admin', 'Admin có thể khóa/mở khóa người chơi và xử lý báo cáo, nhưng không sửa được HELO hay kết quả.'); if (!reason) return;
          const r = await Rpc.call('boss_manage_admin', { p_action: 'grant', p_target_user: p.user_id, p_reason: reason }); UI.toast(r.changed ? 'Đã chỉ định Admin.' : 'Người này đã là Admin.'); await this.refresh(); }); });
      const rows = (this.d.admins || []).map((a) => Utils.el('tr', {}, [Utils.el('td', {}, [Fmt.link(a.username, '@' + a.username)]), Fmt.td(a.display_name), Fmt.td(a.status), Fmt.td(Fmt.dt(a.granted_at)),
        Utils.el('td', {}, [Fmt.btn('Thu hồi', 'red', (b) => withBusy(b, async () => {
          const reason = await askReason('Thu hồi quyền Admin của @' + a.username, 'Tài khoản sẽ trở về role user.'); if (!reason) return;
          await Rpc.call('boss_manage_admin', { p_action: 'revoke', p_target_user: a.user_id, p_reason: reason }); UI.toast('Đã thu hồi quyền Admin.'); await this.refresh(); }))])]));
      return this.section('Quản lý Admin', [form, this.table(['Username', 'Tên hiển thị', 'Trạng thái', 'Được cấp', ''], rows, 'Chưa có Admin nào.')]);
    },
    settingsSection() {
      const S = this.d.settings || {}, elo = S.helo_config || {}, num = (id, label, v, min, max) => Utils.el('label', { class: 'field' }, [Utils.el('span', { text: label }), Utils.el('input', { id, type: 'number', min: String(min), max: String(max), step: '1', value: String(v === undefined ? '' : v) })]);
      const eloForm = Utils.el('form', { novalidate: 'novalidate' }, [Utils.el('h3', { text: 'Cấu hình HELO' }), num('cfg-knew', 'K cho giai đoạn đầu (1–100)', elo.k_new, 1, 100), num('cfg-kest', 'K sau giai đoạn đầu (1–100)', elo.k_established, 1, 100),
        num('cfg-prov', 'Số trận Ranked ở giai đoạn đầu (0–200)', elo.provisional_games, 0, 200), Fmt.empty('HELO ban đầu cố định 0 (mặc định của rating_profiles). Chỉ áp dụng cho trận kết thúc SAU khi lưu.'),
        Utils.el('button', { type: 'submit', class: 'btn btn-gold btn-sm', text: 'Lưu cấu hình HELO' })]);
      eloForm.addEventListener('submit', (ev) => { ev.preventDefault(); withBusy(ev.submitter || null, async () => {
        const v = { k_new: +Utils.$('#cfg-knew').value, k_established: +Utils.$('#cfg-kest').value, provisional_games: +Utils.$('#cfg-prov').value };
        const reason = await askReason('Lưu cấu hình HELO', 'Thay đổi được ghi vào audit log.'); if (!reason) return;
        await Rpc.call('boss_update_setting', { p_key: 'helo_config', p_value: v, p_reason: reason }); UI.toast('Đã lưu cấu hình HELO.'); await this.refresh(); }); });
      const turn = Utils.el('select', { id: 'cfg-turn' }, [30, 60, 90, 120].map((n) => { const o = Utils.el('option', { value: String(n), text: n + ' giây / lượt' }); if (n === Number(S.ranked_turn_seconds)) o.selected = true; return o; }));
      const turnForm = Utils.el('form', { novalidate: 'novalidate' }, [Utils.el('h3', { text: 'Thời gian lượt Ranked' }), Utils.el('label', { class: 'field' }, [Utils.el('span', { text: 'Áp dụng cho trận Tìm trận nhanh MỚI' }), turn]),
        Utils.el('button', { type: 'submit', class: 'btn btn-gold btn-sm', text: 'Lưu thời gian lượt' })]);
      turnForm.addEventListener('submit', (ev) => { ev.preventDefault(); withBusy(ev.submitter || null, async () => {
        const reason = await askReason('Lưu thời gian lượt Ranked', 'Thay đổi được ghi vào audit log.'); if (!reason) return;
        await Rpc.call('boss_update_setting', { p_key: 'ranked_turn_seconds', p_value: +turn.value, p_reason: reason }); UI.toast('Đã lưu thời gian lượt.'); await this.refresh(); }); });
      const tiersBox = Utils.el('div', { id: 'cfg-tiers' }); this.renderTiers(tiersBox);
      const tierForm = Utils.el('form', { novalidate: 'novalidate' }, [Utils.el('h3', { text: 'Ngưỡng rank (HELO tối thiểu)' }), tiersBox,
        Utils.el('div', { class: 'row' }, [Fmt.btn('Thêm hạng', 'ghost', () => { this.tiers.push({ name: '', min: (this.tiers.length ? this.tiers[this.tiers.length - 1].min : 0) + 100 }); this.renderTiers(tiersBox); }),
          Utils.el('button', { type: 'submit', class: 'btn btn-gold btn-sm', text: 'Lưu ngưỡng rank' })]), Fmt.empty('Hạng đầu tiên phải có HELO tối thiểu 0; ngưỡng tăng dần; tên không trùng (tối đa 20 ký tự).')]);
      tierForm.addEventListener('submit', (ev) => { ev.preventDefault(); withBusy(ev.submitter || null, async () => {
        const v = this.tiers.map((t) => ({ name: String(t.name).trim(), min: Number(t.min) }));
        const reason = await askReason('Lưu ngưỡng rank', 'Rank mọi người chơi sẽ được tính lại theo HELO hiện tại; HELO không đổi.'); if (!reason) return;
        await Rpc.call('boss_update_setting', { p_key: 'rank_tiers', p_value: v, p_reason: reason }); await Ranking.loadConfig(); UI.toast('Đã lưu ngưỡng rank.'); await this.refresh(); }); });
      return this.section('Cấu hình hệ thống', [Utils.el('div', { class: 'grid two' }, [Utils.el('div', {}, [eloForm, turnForm]), tierForm])]);
    },
    renderTiers(box) {
      box.replaceChildren(...this.tiers.map((t, i) => {
        const n = Utils.el('input', { type: 'text', maxlength: '20', value: t.name, placeholder: 'Tên hạng', 'aria-label': 'Tên hạng ' + (i + 1) });
        const m = Utils.el('input', { type: 'number', min: '0', max: '99999', step: '1', value: String(t.min), 'aria-label': 'HELO tối thiểu hạng ' + (i + 1) });
        n.addEventListener('input', () => { t.name = n.value; }); m.addEventListener('input', () => { t.min = m.value; });
        return Utils.el('div', { class: 'tier-row' }, [n, m, Fmt.btn('Xóa', 'ghost', () => { this.tiers.splice(i, 1); this.renderTiers(box); })]);
      }));
    },
    auditSection() {
      const rows = this.logs.map((l) => Utils.el('tr', {}, [Fmt.td(Fmt.dt(l.created_at)), Fmt.td('@' + l.actor + ' (' + (l.actor_role || '?') + ')'), Fmt.td(l.action),
        Fmt.td((l.target_name ? '@' + l.target_name : (l.target_id || '—')) + (l.target_type ? ' [' + l.target_type + ']' : '')), Fmt.td(l.reason, 'reason'),
        Fmt.td(l.before || l.after ? JSON.stringify(l.before) + ' → ' + JSON.stringify(l.after) : '—', 'mono small')]));
      const more = Fmt.btn('Tải thêm', 'ghost', (b) => withBusy(b, async () => {
        const last = this.logs[this.logs.length - 1]; const r = await Rpc.call('get_audit_logs', { p_limit: 50, p_before: last ? last.id : null });
        if (!(r.rows || []).length) UI.toast('Đã hết audit log.'); this.logs = this.logs.concat(r.rows || []); const s = this.auditSection(); Utils.$('#ad-audit').replaceWith(s); }));
      const sec = this.section('Audit log (chỉ đọc, không xóa/sửa được)', [this.table(['Thời gian', 'Người thực hiện', 'Hành động', 'Đối tượng', 'Lý do', 'Trước → sau'], rows, 'Chưa có bản ghi audit.'), Utils.el('div', { class: 'row' }, [more])]);
      sec.id = 'ad-audit'; return sec;
    },
    user(btn, action, u, label) {
      return withBusy(btn, async () => {
        const reason = await askReason(label + ' @' + u.username, 'Lý do sẽ được ghi vào audit log.'); if (!reason) return;
        const r = await Rpc.call('admin_user_action', { p_action: action, p_target_user: u.user_id, p_report: null, p_reason: reason });
        UI.toast(r.changed ? 'Đã cập nhật tài khoản.' : 'Không có thay đổi.'); await this.refresh();
      });
    },
    report(btn, action, r) {
      const label = { review: 'Xem xét báo cáo', resolve: 'Đánh dấu đã xử lý', dismiss: 'Bỏ qua báo cáo' }[action];
      return withBusy(btn, async () => {
        const reason = await askReason(label, 'Ghi chú xử lý (ghi vào audit log).'); if (!reason) return;
        const res = await Rpc.call('admin_user_action', { p_action: action, p_target_user: null, p_report: r.id, p_reason: reason });
        UI.toast(res.changed ? 'Đã cập nhật báo cáo.' : 'Báo cáo đã được xử lý trước đó.'); await this.refresh();
      });
    }
  };

  /** Màn kết quả trận: HELO, liên kết replay. Số liệu lấy từ server (get_match_state.rating / update_ratings). */
  const Phase4 = {
    rated: new Set(),
    renderResult(M) {
      const d = M.data, box = Utils.$('#op-rating'), acts = Utils.$('#op-replay-actions'); if (!d || d.status === 'active' || !box) return;
      const player = M.isPlayer(); acts.hidden = !player;
      if (!player) { box.hidden = true; return; }
      box.hidden = false;
      if (!d.ranked) { box.textContent = 'Trận không xếp hạng — không cộng/trừ HELO.'; return; }
      const mine = M.rating && M.rating[M.role];
      if (mine) { box.textContent = 'HELO ' + mine.before + ' → ' + mine.after + ' (' + Fmt.delta(mine.delta) + ') · Rank ' + mine.tier; return; }
      box.textContent = 'Đang cập nhật HELO…'; this.ensureRating(M, d.id);
    },
    async ensureRating(M, id) {
      if (this.rated.has(id)) return; this.rated.add(id);
      try {
        const r = await Rpc.call('update_ratings', { p_match: id });   // idempotent: không bao giờ cộng lặp; không nhận số điểm từ client
        if (M.id !== id) return;
        if (r && r.rating) { M.rating = r.rating; this.renderResult(M); Profile.refreshRating(); }
        else { const box = Utils.$('#op-rating'); if (box) box.textContent = 'HELO chưa được cập nhật cho trận này.'; }
      } catch (e) { this.rated.delete(id); const box = Utils.$('#op-rating'); if (box) box.textContent = 'Chưa cập nhật được HELO (' + Utils.mapError(e) + ').'; }
    }
  };

  /* ===================================================================
   * ROUTER (hash). Trang cần đăng nhập bị chặn khi chưa có phiên.
   * =================================================================== */
  /* ===================================================================
   * HƯỚNG DẪN — bàn cờ minh họa + hoạt ảnh dựng bằng code (không video, không AI)
   * Mỗi bước (step) là một "khung hình" đầy đủ: quân + ô nổi bật. Tự lặp lại khi đang ở màn hình này.
   * Khóa đánh dấu: mv=ô đi được, cp=ô ăn được, bad=không hợp lệ, fb=Đường Cấm, ln=đường hỗ trợ/liên kết,
   *                sp=quân được tô sáng, sw=hai quân đổi chỗ, ck=Vua bị chiếu, a=ô đến (trượt), x=ô quân bị bắt (nháy).
   * ASSUMPTION: lãnh thổ P1 = hàng 1–4, P2 = hàng 6–9, hàng 5 là biên giới (A1 của engine).
   * =================================================================== */
  const Guide = (() => {
    const P = (t, s, r, c) => ({ t, s: s === 'R' ? 'red' : 'blue', r, c });
    const inb = (r, c) => r >= 0 && r < SIZE && c >= 0 && c < SIZE;
    const ring = (r, c, n) => { const o = []; for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) if ((i || j) && inb(r + i, c + j)) o.push([r + i, c + j]); return o; };
    const D8 = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]], D4 = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    const slide = (pcs, p, dirs, max) => {
      const mv = [], cp = [], at = (r, c) => pcs.find((q) => q.r === r && q.c === c);
      dirs.forEach(([dr, dc]) => { for (let k = 1; k <= max; k++) { const r = p.r + dr * k, c = p.c + dc * k; if (!inb(r, c)) break; const q = at(r, c); if (q) { if (q.s !== p.s) cp.push([r, c]); break; } mv.push([r, c]); } });
      return { mv, cp };
    };
    const not = (list, ...cells) => list.filter(([r, c]) => !cells.some(([a, b]) => a === r && b === c));
    const row = (r, c1, c2) => { const o = []; for (let c = c1; c <= c2; c++) o.push([r, c]); return o; };
    const SC = {};
    const slider = (t, extra) => { const m = P(t, 'R', 6, 4), al = P('L', 'R', 6, 6), en = P('L', 'B', 3, 4), all = [m, al, en];
      return [{ p: [m], ...slide([m], m, D8, 9), cap: 'Đi nhiều ô theo một đường thẳng: ngang, dọc hoặc chéo.' },
        { p: all, ...slide(all, m, D8, 9), cap: 'Không xuyên qua quân khác; gặp quân địch thì được ăn tại ô đó.' },
        { p: [P(t, 'R', 3, 4), al], f: [6, 4], a: [3, 4], x: [[3, 4]], cap: extra }]; };
    SC.M = slider('M', 'Mã ăn quân tại ô đến. Mã và Ngưu cùng hàng/cột tạo Đường Cấm (xem bài Đường Cấm).');
    SC.C = slider('C', 'Cận ăn quân tại ô đến hợp lệ.');
    { const L = P('L', 'R', 6, 4), blk = P('L', 'R', 5, 4), a1 = P('L', 'R', 5, 3), a2 = P('L', 'R', 5, 5), e = P('M', 'B', 4, 4);
      SC.L = [{ p: [L], mv: ring(6, 4, 2), cap: 'Lính đi tối đa 2 ô theo ngang, dọc hoặc chéo.' },
        { p: [L, blk], ...slide([L, blk], L, D8, 2), cap: 'Không được xuyên qua quân khác: phía trên bị chặn.' },
        { p: [L, a1, a2, e], sp: [[5, 3], [5, 5]], cp: [[4, 4]], cap: 'Mục tiêu có ít nhất 2 đồng minh xung quanh → Lính được ăn.' },
        { p: [P('L', 'R', 4, 4), a1, a2], f: [6, 4], a: [4, 4], x: [[4, 4]], cap: 'Lính ăn quân; quân bị bắt biến mất.' },
        { p: [L, a1, e], sp: [[5, 3]], bad: [[4, 4]], cap: 'Chỉ có 1 đồng minh quanh mục tiêu → chưa được ăn (trừ khi có Thuật hỗ trợ).' }]; }
    { const V = P('V', 'R', 7, 4), e = P('L', 'B', 6, 4), t = P('T', 'R', 7, 6);
      SC.V = [{ p: [V], mv: ring(7, 4, 1), cap: 'Vua đi 1 ô theo 8 hướng.' },
        { p: [V, e], mv: not(ring(7, 4, 1), [6, 4]), bad: [[6, 4]], cap: 'Bình thường Vua không thể ăn quân.' },
        { p: [V, e, t], sp: [[7, 4], [7, 6]], ln: [[7, 5]], mv: not(ring(7, 4, 1), [6, 4]), cp: [[6, 4]], cap: 'Có Thuật hỗ trợ (cùng hàng), Vua ăn được trong phạm vi 1 ô.' },
        { p: [V], ck: [[7, 4]], cap: 'Vua bị bắt đồng nghĩa với thua cuộc. Hãy bảo vệ Vua!' }]; }
    { const S = P('S', 'R', 6, 4), e1 = P('L', 'B', 5, 4), e2 = P('L', 'B', 4, 4);
      SC.S = [{ p: [S], mv: ring(6, 4, 2), cap: 'Sói đi trong vùng 5×5 quanh nó và có thể nhảy qua quân khác.' },
        { p: [S, e1, e2], mv: not(ring(6, 4, 2), [5, 4], [4, 4]), cp: [[4, 4]], bad: [[5, 4]], cap: 'Bình thường Sói chỉ ăn quân cách đúng 2 ô; quân sát bên không ăn được.' },
        { p: [P('S', 'R', 4, 4), e1], f: [6, 4], a: [4, 4], x: [[4, 4]], cap: 'Sói nhảy qua quân chắn và ăn mục tiêu cách 2 ô.' }]; }
    { const G = P('G', 'R', 4, 4), e = P('L', 'B', 4, 5);
      SC.G = [{ p: [G], mv: [[3, 4], [5, 4], [4, 3], [4, 5]], cap: 'Gấu đi 1 ô ngang hoặc dọc.' },
        { p: [G, e], mv: [[3, 4], [5, 4], [4, 3]], cp: [[4, 5]], cap: 'Đứng ở hàng biên giới, Gấu được ăn quân.' },
        { p: [P('G', 'R', 4, 5)], f: [4, 4], a: [4, 5], x: [[4, 5]], cap: 'Gấu ăn quân ngay trên hàng biên giới.' },
        { p: [P('G', 'R', 6, 4), P('L', 'B', 5, 4)], mv: [[7, 4], [6, 3], [6, 5]], bad: [[5, 4]], cap: 'Rời biên giới: Gấu không thể ăn (và cũng không thể bị bắt).' }]; }
    { const N = P('N', 'R', 6, 4), blk = P('L', 'R', 5, 4), e = P('L', 'B', 6, 6), all = [N, blk, e];
      SC.N = [{ p: [N], ...slide([N], N, D4, 2), cap: 'Ngưu đi tối đa 2 ô ngang hoặc dọc.' },
        { p: all, ...slide(all, N, D4, 2), cap: 'Không xuyên qua quân khác; ăn quân ở ô đến hợp lệ.' },
        { p: [P('N', 'R', 6, 6), blk], f: [6, 4], a: [6, 6], x: [[6, 6]], cap: 'Ngưu ăn quân. Ngưu phối hợp với Mã để tạo Đường Cấm.' }]; }
    { const T = P('T', 'R', 7, 3), t2 = P('T', 'R', 7, 6);
      SC.T = [{ p: [T], mv: [[6, 3], [8, 3], [7, 2], [7, 4]], cap: 'Thuật đi 1 ô ngang hoặc dọc, chỉ trong lãnh thổ phe mình.' },
        { p: [P('T', 'R', 5, 3)], mv: [[6, 3], [5, 2], [5, 4]], bad: [[4, 3]], cap: 'Không được bước ra hàng biên giới hay lãnh thổ địch.' },
        { p: [T, t2], sp: [[7, 3], [7, 6]], ln: row(7, 4, 5), cap: 'Hai Thuật cùng hàng hoặc cột tạo thành Cặp Thuật.' }]; }
    { const M = P('M', 'R', 6, 2), N = P('N', 'R', 6, 6), e = P('C', 'B', 3, 4), z = [[6, 3], [6, 4], [6, 5]];
      SC.FB = [{ p: [M, N], sp: [[6, 2], [6, 6]], fb: z, cap: 'Mã và Ngưu cùng hàng: các ô giữa hai quân là Đường Cấm.' },
        { p: [M, N, e], sp: [[6, 2], [6, 6]], fb: z, mv: [[4, 4], [5, 4]], bad: [[6, 4]], cap: 'Đối phương không thể đi vào hay xuyên qua Đường Cấm.' },
        { p: [P('M', 'R', 5, 2), N, e], f: [6, 2], a: [5, 2], mv: [[4, 4], [5, 4], [6, 4], [7, 4], [8, 4]], cap: 'Mã rời hàng → Đường Cấm biến mất, quân địch đi qua được.' },
        { p: [M, N, e], f: [5, 2], a: [6, 2], sp: [[6, 2], [6, 6]], fb: z, bad: [[6, 4]], cap: 'Mã quay lại cùng hàng → Đường Cấm xuất hiện lại.' }]; }
    { const bd = row(4, 0, 8);
      SC.BG = [{ p: [P('G', 'R', 6, 4), P('C', 'B', 6, 7)], bad: [[6, 4]], ln: bd, cap: 'Gấu ngoài biên giới không thể bị ăn: Cận địch không bắt được.' },
        { p: [P('G', 'R', 4, 4), P('C', 'B', 4, 8)], ln: bd, cp: [[4, 4]], mv: [[4, 5], [4, 6], [4, 7]], cap: 'Đứng trên biên giới, Gấu có thể bị ăn.' },
        { p: [P('G', 'R', 4, 4), P('L', 'B', 4, 3)], ln: bd, cp: [[4, 3]], cap: 'Đứng trên biên giới, Gấu cũng có thể ăn quân.' }]; }
    { const t1 = P('T', 'R', 7, 2), t2 = P('T', 'R', 7, 6), e = P('L', 'B', 6, 2), c = P('C', 'B', 3, 2), ln = row(7, 3, 5);
      SC.PT = [{ p: [t1, t2], sp: [[7, 2], [7, 6]], ln, cap: 'Hai Thuật cùng hàng: Cặp Thuật hoạt động.' },
        { p: [t1, t2, e, c], sp: [[7, 2], [7, 6]], ln, cp: [[6, 2]], cap: 'Cặp Thuật cho phép Thuật ăn quân.' },
        { p: [P('T', 'R', 6, 2), t2, c], f: [7, 2], a: [6, 2], x: [[6, 2]], cap: 'Thuật ăn quân đối phương.' },
        { p: [P('C', 'B', 6, 2)], f: [3, 2], a: [6, 2], x: [[6, 2], [7, 6]], cap: 'Một Thuật bị bắt → Thuật còn lại cùng phe cũng bị loại bỏ.' }]; }
    { const T = P('T', 'R', 7, 4), l = P('L', 'R', 7, 1), v = P('V', 'R', 7, 7), s = P('S', 'R', 5, 4), ln = [[7, 2], [7, 3], [7, 5], [7, 6], [6, 4]], em = P('M', 'B', 5, 3);
      SC.SUP = [{ p: [T, l, v, s], sp: [[7, 1], [7, 7], [5, 4]], ln, cap: 'Thuật hỗ trợ quân đồng minh nằm cùng hàng hoặc cùng cột.' },
        { p: [T, l, em], sp: [[7, 1]], ln: row(7, 2, 3), cp: [[5, 3]], cap: 'Lính được hỗ trợ: bỏ qua điều kiện 2 đồng minh quanh mục tiêu.' },
        { p: [T, P('L', 'R', 5, 3)], f: [7, 1], a: [5, 3], x: [[5, 3]], cap: 'Lính ăn quân dù chỉ có một mình.' },
        { p: [T, v, P('L', 'B', 6, 7)], sp: [[7, 7]], ln: row(7, 5, 6), cp: [[6, 7]], cap: 'Vua được hỗ trợ có thể ăn quân trong phạm vi 1 ô.' },
        { p: [T, s, P('L', 'B', 5, 5)], sp: [[5, 4]], ln: [[6, 4]], cp: [[5, 5]], cap: 'Sói được hỗ trợ ăn mọi ô trong phạm vi, không cần cách đúng 2 ô.' },
        { p: [T, v, P('L', 'B', 5, 7)], sp: [[7, 7]], ln: row(7, 5, 6), bad: [[5, 7]], cap: 'Thuật không làm tăng phạm vi di chuyển: Vua vẫn chỉ với tới 1 ô.' }]; }
    { const V = P('V', 'R', 7, 4), T = P('T', 'R', 6, 4);
      SC.SW = [{ p: [V, T], sw: [[7, 4], [6, 4]], cap: 'Vua và Thuật cùng phe có thể đổi chỗ — tính là một lượt.' },
        { p: [P('V', 'R', 6, 4), P('T', 'R', 7, 4)], sw: [[7, 4], [6, 4]], sa: 1, cap: 'Hai quân hoán vị. Hợp lệ vì Thuật vẫn nằm trong lãnh thổ và Vua không bị chiếu.' },
        { p: [P('V', 'R', 4, 4), T], sw: [[4, 4], [6, 4]], bad: [[4, 4]], cap: 'Không hợp lệ: Thuật sẽ phải đứng ngoài lãnh thổ (hàng biên giới).' },
        { p: [V, P('T', 'R', 7, 1), P('C', 'B', 3, 1)], sw: [[7, 4], [7, 1]], bad: [[7, 1]], ln: [[4, 1], [5, 1], [6, 1]], cap: 'Không hợp lệ: sau khi đổi, Vua đứng cùng cột với Cận địch và vẫn bị chiếu.' }]; }
    const startPieces = () => { const o = []; try { const b = GameState.create().board; for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) { const p = b[r][c]; if (p) o.push({ t: p.type, s: FACTION[p.owner] || (p.owner === 'P1' ? 'blue' : 'red'), r, c }); } } catch (e) { /* bỏ qua */ } return o; };
    const scene = (k) => (k === 'START' ? [{ p: startPieces(), ln: row(4, 0, 8), cap: 'Bàn cờ 9×9. Hàng giữa là biên giới; mỗi phe giữ một nửa bàn.' }] : SC[k]);
    const PI = {
      L: ['Lính', ['Quân tiên phong, cần đồng đội để ăn.', 'Đi tối đa 2 ô: ngang, dọc, chéo; không xuyên quân.', 'Ăn khi có ≥ 2 đồng minh quanh mục tiêu.', 'Có Thuật hỗ trợ: bỏ điều kiện 2 đồng minh.']],
      V: ['Vua', ['Quân quyết định thắng thua.', 'Đi 1 ô theo 8 hướng.', 'Bình thường không ăn quân; có Thuật hỗ trợ thì ăn được.', 'Vua bị bắt = thua.']],
      M: ['Mã', ['Quân trượt xa.', 'Đi nhiều ô theo đường thẳng (ngang, dọc, chéo), không xuyên quân.', 'Ăn quân tại ô đến hợp lệ.', 'Cùng hàng/cột với Ngưu → Đường Cấm.']],
      C: ['Cận', ['Quân trượt xa.', 'Đi nhiều ô theo đường thẳng (ngang, dọc, chéo), không xuyên quân.', 'Ăn quân tại ô đến hợp lệ.']],
      S: ['Sói', ['Quân nhảy.', 'Đi trong vùng 5×5, nhảy qua quân khác.', 'Thường chỉ ăn quân cách đúng 2 ô (theo hàng/cột lớn nhất).', 'Có Thuật hỗ trợ: ăn mọi ô hợp lệ trong vùng.']],
      G: ['Gấu', ['Quân biên giới.', 'Đi 1 ô ngang hoặc dọc.', 'Chỉ ăn và chỉ bị ăn khi đứng ở hàng biên giới.']],
      N: ['Ngưu', ['Quân tiến nhanh.', 'Đi tối đa 2 ô ngang hoặc dọc, không xuyên quân.', 'Ăn quân tại ô đến hợp lệ.', 'Phối hợp với Mã tạo Đường Cấm.']],
      T: ['Thuật', ['Quân hỗ trợ.', 'Đi 1 ô ngang hoặc dọc, chỉ trong lãnh thổ phe mình.', 'Hai Thuật cùng hàng/cột = Cặp Thuật (Thuật được ăn quân).', 'Một Thuật bị bắt → Thuật còn lại bị loại.', 'Hỗ trợ đồng minh cùng hàng/cột.']]
    };
    const LS = { FB: ['Đường Cấm', ['Mã và Ngưu cùng hàng/cột → các ô giữa là Đường Cấm.', 'Đối phương không đi vào hay xuyên qua được.']], BG: ['Biên giới Gấu', ['Ngoài biên giới: Gấu không ăn, không bị ăn.', 'Trên biên giới: ăn được và bị ăn được.']],
      PT: ['Cặp Thuật', ['Hai Thuật cùng hàng/cột cho phép Thuật ăn quân.', 'Một Thuật bị bắt → Thuật còn lại cũng bị loại.']], SUP: ['Thuật hỗ trợ', ['Hỗ trợ đồng minh cùng hàng/cột.', 'Không tăng phạm vi di chuyển.']],
      SW: ['Đổi chỗ Vua–Thuật', ['Vua và Thuật cùng phe hoán đổi vị trí.', 'Không hợp lệ nếu Thuật ra ngoài lãnh thổ hoặc Vua vẫn bị chiếu.']] };
    const cnt = () => { const m = {}; startPieces().filter((p) => p.s === 'red').forEach((p) => { m[p.t] = (m[p.t] || 0) + 1; }); return Object.keys(PI).filter((k) => m[k]).map((k) => PI[k][0] + ' ×' + m[k]).join(', '); };
    const GS = [
      ['Mục tiêu', 'Bắt Vua đối phương, hoặc khiến đối phương không còn nước đi hợp lệ.', 'START', 0],
      ['Bàn cờ', 'Bàn 9×9. Mỗi phe giữ một lãnh thổ, hàng giữa là biên giới.', 'START', 0],
      ['Quân cờ', 'Mỗi phe có 8 loại quân: ', 'START', 0],
      ['Bắt đầu ván', 'Phe 2 (Đỏ) đi trước, sau đó hai phe luân phiên.', 'START', 0],
      ['Thực hiện lượt', 'Mỗi lượt: di chuyển một quân, ăn quân nếu đủ điều kiện, hoặc đổi chỗ Vua–Thuật.', 'SW', 0],
      ['Di chuyển', 'Mỗi quân có phạm vi và quy tắc đường đi riêng. Ví dụ: Mã trượt thẳng, không xuyên quân.', 'M', 0],
      ['Ăn quân', 'Điều kiện ăn khác nhau theo từng quân. Ví dụ: Lính cần ≥ 2 đồng minh quanh mục tiêu.', 'L', 2],
      ['Luật đặc biệt', 'Đường Cấm, Biên giới Gấu, Cặp Thuật, Thuật hỗ trợ và đổi chỗ Vua–Thuật. Chọn từng bài ở trên.', 'FB', 0],
      ['Chiếu & bảo vệ Vua', 'Không được đi nước khiến Vua phe mình bị chiếu — kể cả khi đổi chỗ Vua–Thuật.', 'SW', 3],
      ['Kết thúc', 'Ván kết thúc khi Vua bị bắt hoặc bên đến lượt không còn nước đi hợp lệ.', 'V', 3]
    ];
    const TIPS = ['Dùng Mã và Ngưu để kiểm soát ô bằng Đường Cấm.', 'Dùng Thuật hỗ trợ Lính, Vua và Sói.', 'Dùng Gấu để kiểm soát hàng biên giới.', 'Bảo vệ cả hai Thuật để giữ Cặp Thuật.', 'Cân nhắc vị trí Vua–Thuật để tận dụng việc đổi chỗ.'];
    const MK = { mv: 't-move', cp: 't-capture', bad: 'g-bad', fb: 'g-forbid', ln: 'g-line', sp: 'supported', sw: 't-swap', ck: 'in-check' };
    const G = { cells: [], steps: [], idx: 0, timer: null, playing: true, inited: false, gi: 0,
      init() {
        if (this.inited) return; this.inited = true;
        const board = Utils.$('#gd-board'), frag = document.createDocumentFragment();
        for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) { const b = Utils.el('div', { class: 'cell ro', role: 'gridcell' }); b.dataset.co = (r + 1) + '.' + (c + 1); this.cells.push(b); frag.append(b); }
        board.append(frag);
        const A = ASSET_CONFIG, pb = Utils.$('#gd-pieces');
        Object.keys(PI).forEach((k) => { const tp = PIECE_TYPES[k];
          const b = Utils.el('button', { type: 'button', class: 'gd-piece', 'aria-pressed': 'false', 'data-k': k }, [Utils.el('span', { class: 'piece f-red' }, [AssetConfig.node(A.pieceImages.red[tp.key], k, tp.name)]), Utils.el('strong', { text: tp.name }), Utils.el('small', { text: '(' + k + ')' })]);
          b.addEventListener('click', () => this.pick(k, PI[k][0] + ' (' + k + ')', PI[k][1], b)); pb.append(b); });
        const lb = Utils.$('#gd-lessons');
        Object.keys(LS).forEach((k) => { const b = Utils.el('button', { type: 'button', class: 'btn btn-ghost', 'aria-pressed': 'false', text: LS[k][0] }); b.addEventListener('click', () => this.pick(k, LS[k][0], LS[k][1], b)); lb.append(b); });
        Utils.$('#gd-tips').replaceChildren(...TIPS.map((t) => Utils.el('li', { text: t })));
        const on = (id, fn) => Utils.$('#' + id).addEventListener('click', fn);
        on('gd-prev', () => { this.stop(); this.show(this.idx - 1); }); on('gd-next', () => { this.stop(); this.show(this.idx + 1); });
        on('gd-play', () => (this.playing ? this.stop() : this.start())); on('gd-restart', () => { this.idx = 0; this.show(0); this.start(); });
        on('gd-gprev', () => this.guide(this.gi - 1)); on('gd-gnext', () => this.guide(this.gi + 1));
      },
      mark(btn) { Utils.$$('#gd-pieces .gd-piece, #gd-lessons .btn').forEach((b) => b.setAttribute('aria-pressed', b === btn ? 'true' : 'false')); },
      pick(k, title, rules, btn) { this.mark(btn); this.load(k, title, rules, 0); },
      guide(i) {
        this.gi = Math.max(0, Math.min(GS.length - 1, i)); const g = GS[this.gi]; this.mark(null);
        Utils.$('#gd-step-title').textContent = 'Bước ' + (this.gi + 1) + '/' + GS.length + ' · ' + g[0];
        Utils.$('#gd-step-text').textContent = g[1] + (this.gi === 2 ? cnt() + '.' : ''); Utils.$('#gd-gpos').textContent = (this.gi + 1) + ' / ' + GS.length;
        this.load(g[2], 'Bước ' + (this.gi + 1) + ': ' + g[0], [g[1] + (this.gi === 2 ? cnt() + '.' : '')], g[3]);
      },
      load(k, title, rules, at) {
        this.steps = scene(k) || []; this.idx = 0; Utils.$('#gd-title').textContent = title;
        Utils.$('#gd-rules').replaceChildren(...rules.map((t) => Utils.el('li', { text: t })));
        this.idx = at || 0; this.show(this.idx); this.start();
      },
      fx(s, prev, at) {
        if (!prev || window.matchMedia('(prefers-reduced-motion: reduce)').matches || (Profile.settings && Profile.settings.reduce_motion)) return;
        const glide = (to, from) => { const el = at(to[0], to[1]).querySelector('.piece'); if (!el) return; const a = at(from[0], from[1]).getBoundingClientRect(), b = at(to[0], to[1]).getBoundingClientRect();
          el.style.zIndex = 6; el.animate([{ transform: 'translate(' + (a.left - b.left) + 'px,' + (a.top - b.top) + 'px)' }, { transform: 'none' }], { duration: 850, easing: 'ease-in-out' }); };
        if (s.f && s.a) glide(s.a, s.f);
        if (s.sa && s.sw) { glide(s.sw[0], s.sw[1]); glide(s.sw[1], s.sw[0]); }
        (s.x || []).forEach(([r, c]) => { const q = (prev.p || []).find((p) => p.r === r && p.c === c); if (!q) return; const tp = PIECE_TYPES[q.t];
          const gh = Utils.el('span', { class: 'piece f-' + q.s + ' gd-ghost' }, [AssetConfig.node(ASSET_CONFIG.pieceImages[q.s][tp.key], q.t, tp.name)]); at(r, c).append(gh);
          gh.animate([{ opacity: 1, transform: 'scale(1)' }, { opacity: 1, transform: 'scale(1)', offset: 0.55 }, { opacity: 0, transform: 'scale(.4)' }], { duration: 1000, fill: 'forwards' }).onfinish = () => gh.remove(); });
      },
      show(i) {
        if (!this.steps.length) return; const prevIdx = this.idx, prevSteps = this.steps; this.idx = (i + this.steps.length) % this.steps.length; const s = this.steps[this.idx];
        this.cells.forEach((b, n) => { const r = Math.floor(n / SIZE); b.className = 'cell ro ' + (r === BORDER_ROW ? 'terr-border' : (r < BORDER_ROW ? 'terr-p1' : 'terr-p2')); b.replaceChildren(); });
        const at = (r, c) => this.cells[r * SIZE + c], A = ASSET_CONFIG;
        (s.p || []).forEach((p) => { const tp = PIECE_TYPES[p.t]; at(p.r, p.c).append(Utils.el('span', { class: 'piece f-' + p.s }, [AssetConfig.node(A.pieceImages[p.s][tp.key], p.t, tp.name + ' ' + (p.s === 'red' ? 'Đỏ' : 'Xanh'))])); });
        Object.keys(MK).forEach((k) => (s[k] || []).forEach(([r, c]) => at(r, c).classList.add(MK[k])));
        if (s.a) at(s.a[0], s.a[1]).classList.add('anim-move'); (s.x || []).forEach(([r, c]) => at(r, c).classList.add('g-flash'));
        if (s.sa) (s.sw || []).forEach(([r, c]) => at(r, c).classList.add('anim-swap'));
        this.fx(s, this.idx === prevIdx + 1 && prevSteps === this.steps ? prevSteps[prevIdx] : null, at);
        const bar = Utils.$('#gd-bar-fill'); if (bar) bar.style.width = ((this.idx + 1) / this.steps.length * 100) + '%';
        Utils.$('#gd-cap').textContent = s.cap || ''; Utils.$('#gd-pos').textContent = 'Bước ' + (this.idx + 1) + ' / ' + this.steps.length + (this.playing ? ' · tự động lặp lại' : ' · đã tạm dừng');
        Utils.$('#gd-play').textContent = this.playing ? 'Tạm dừng' : 'Phát';
      },
      start() { this.stop(true); this.playing = true; Utils.$('#gd-play').textContent = 'Tạm dừng'; const t = () => { this.timer = setTimeout(() => { this.show(this.idx + 1); t(); }, this.idx === this.steps.length - 1 ? 3000 : 2600); }; if (this.steps.length > 1) t(); },
      stop(keep) { clearTimeout(this.timer); this.timer = null; if (!keep) { this.playing = false; Utils.$('#gd-play').textContent = 'Phát'; Utils.$('#gd-pos').textContent = 'Bước ' + (this.idx + 1) + ' / ' + this.steps.length + ' · đã tạm dừng'; } },
      enter() { this.init(); this.guide(0); },
      leave() { clearTimeout(this.timer); this.timer = null; }
    };
    return G;
  })();

  const Router = {
    PUBLIC: ['login', 'register'], PROTECTED: ['home', 'profile', 'settings', 'play', 'modes', 'lobby', 'queue', 'friends', 'match', 'ranking', 'player', 'replay', 'guide', 'admin', 'boss'],
    current() { const r = (location.hash || '').replace(/^#\/?/, '').split(/[?#]/)[0]; return r || ''; },
    param(k) { const q = (location.hash.split('?')[1] || '').split('#')[0]; return new URLSearchParams(q).get(k); },
    go(route, params) {
      const qs = params ? '?' + new URLSearchParams(params).toString() : '';
      const target = '#/' + route + qs;
      if (location.hash === target) this.render(); else location.hash = target;
    },
    render() {
      if (!App.ready) return;
      let r = this.current();
      const authed = !!(Auth.user && Profile.data);
      if (!this.PUBLIC.includes(r) && !this.PROTECTED.includes(r)) r = authed ? 'home' : 'login';
      if (this.PROTECTED.includes(r) && !authed) r = 'login';
      if (this.PUBLIC.includes(r) && authed) r = 'home';
      if (this.current() !== r) { history.replaceState(null, '', '#/' + r); }
      if ((r === 'admin' && authed && !Profile.isStaff()) || (r === 'boss' && authed && Profile.role !== 'boss')) r = 'home';   // chỉ tiện UI; RPC vẫn kiểm role ở database
      Poller.stopAll(); Queue.leave(); Match.leave(); Replay.leave(); Guide.leave();   // mỗi màn hình tự bật vòng poll của nó; không bao giờ có vòng trùng
      if (r === 'home') UI.renderHome();
      if (r === 'profile') UI.renderProfile();
      if (r === 'settings') UI.renderSettings();
      if (authed) UI.renderNav();
      UI.show(r === 'match' ? 'play' : (r === 'boss' ? 'admin' : r));
      if (r === 'boss') Utils.$$('#nav a').forEach((a) => { if (a.dataset.route === 'boss') a.setAttribute('aria-current', 'page'); else if (a.dataset.route === 'admin') a.removeAttribute('aria-current'); });
      if (r === 'play') BoardUI.enter();
      if (authed) {
        if (r === 'profile') Player.load('pf-stats', null);
        if (r === 'ranking') Ranking.enter();
        if (r === 'player') Player.enterRoute();
        if (r === 'replay') Replay.enter(this.param('m'));
        if (r === 'guide') Guide.enter();
        if (r === 'admin' || r === 'boss') Admin.enter(r);
        if (r === 'home' || r === 'friends' || r === 'modes') Social.start();
        if (r === 'modes') App.showResume();
        if (r === 'friends') Social.renderScreen();
        if (r === 'lobby') { const id = this.param('r'); if (id) Lobby.enter(id); else this.go('modes'); }
        if (r === 'queue') Queue.enter();
        if (r === 'match') { const id = this.param('m'); if (id) Match.enter(id); else this.go('modes'); }
      }
    },
    start() { window.addEventListener('hashchange', () => this.render()); this.render(); }
  };

  /* ===================================================================
   * APP
   * =================================================================== */
  /** Gắn icon vào mọi nút .btn/.tab theo nội dung chữ (kể cả nút do JS tạo sau này). */
  const Icons = {
    rules: [
      [/mở khóa|mở khoá/, 'unlock'], [/khóa|khoá|cấm/, 'lock'], [/đăng nhập|vào chiến trường/, 'in'], [/đăng xuất/, 'out'], [/đăng ký|tạo tài khoản|kết bạn|thêm bạn|lời mời kết/, 'userplus'],
      [/tìm trận/, 'bolt'], [/tạo phòng|thêm|xem thêm/, 'plus'], [/vào bằng mã|vào phòng/, 'key'], [/xem bằng mã|xem trận/, 'eye'], [/replay|phát/, 'play'], [/tạm dừng|dừng/, 'pause'],
      [/xuất|tải về|tải xuống/, 'download'], [/lưu/, 'save'], [/xóa|xoá|bỏ replay/, 'trash'], [/hủy|huỷ|từ chối|đóng/, 'x'], [/chấp nhận|đồng ý|xác nhận|áp dụng/, 'check'],
      [/thử lại|làm mới|tải lại|ván mới|tái đấu|tìm lại/, 'refresh'], [/quay lại|rời|thoát|về /, 'back'], [/sao chép/, 'copy'], [/đầu hàng/, 'flag'], [/hòa/, 'equal'], [/hoàn tác/, 'undo'],
      [/gửi|mời/, 'send'], [/bắt đầu|chơi/, 'play'], [/bạn bè/, 'users'], [/lùi/, 'back'], [/tiến/, 'next'], [/toàn cầu|theo tuần/, 'trophy']
    ],
    pick(text) { const t = String(text || '').toLowerCase().trim(); if (!t) return null; for (const [re, n] of this.rules) if (re.test(t)) return n; return null; },
    run() {
      document.querySelectorAll('.btn, .tab').forEach((b) => {
        if (b.querySelector(':scope > .ico') || b.dataset.noico) return;
        const name = this.pick(b.textContent); if (!name) return;
        const NS = 'http://www.w3.org/2000/svg', svg = document.createElementNS(NS, 'svg'), use = document.createElementNS(NS, 'use');
        svg.setAttribute('class', 'ico'); svg.setAttribute('aria-hidden', 'true'); use.setAttribute('href', '#i-' + name); svg.append(use); b.prepend(svg);
      });
    },
    init() {
      let queued = false; const go = () => { queued = false; this.run(); };
      new MutationObserver(() => { if (!queued) { queued = true; requestAnimationFrame(go); } }).observe(document.body, { childList: true, subtree: true });
      this.run();
    }
  };

  /** Khoá phóng to/thu nhỏ trang và (nếu trình duyệt cho phép) khoá xoay ngang. */
  function lockViewport() {
    const stop = (e) => e.preventDefault();
    ['gesturestart', 'gesturechange', 'gestureend'].forEach((t) => document.addEventListener(t, stop, { passive: false }));
    window.addEventListener('wheel', (e) => { if (e.ctrlKey) e.preventDefault(); }, { passive: false });
    window.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && ['+', '=', '-', '_', '0'].includes(e.key)) e.preventDefault(); });
    try { if (screen.orientation && screen.orientation.lock) screen.orientation.lock('portrait').catch(() => {}); } catch (_) { /* chỉ chạy được khi cài như app/toàn màn hình */ }
  }

  const App = {
    ready: false, started: false, locked: false,
    async boot() {
      if (!this.locked) { this.locked = true; lockViewport(); Icons.init(); }
      UI.loading();
      AssetConfig.mountStatics();
      if (!Utils.isConfigured()) {
        return UI.error({
          title: 'Chưa cấu hình Supabase',
          message: 'Ứng dụng chưa sẵn sàng. Vui lòng quay lại sau.',
          onRetry: null
        });
      }
      try {
        await Database.init();
        await Auth.restore();
        if (Auth.user) { await Profile.load(); UI.applySettings(); }
      } catch (e) {
        console.error('[Crownfall] boot', e);
        const sdk = e && (e.code === 'SDK_LOAD' || e.code === 'SDK_API');
        return UI.error({
          title: sdk ? 'Không tải được thư viện Supabase' : 'Không thể khởi động',
          message: sdk ? 'Kiểm tra kết nối mạng hoặc SDK_URL trong Config.' : Utils.mapError(e),
          detail: (e && e.message) || '',
          onRetry: () => App.boot(),
          showLogin: !sdk && !!Auth.user
        });
      }
      this.ready = true;
      if (Auth.user) Presence.start();
      if (!this.started) { this.started = true; Router.start(); } else { Router.render(); }
      if (Auth.user && ['', 'home'].includes(Router.current())) this.resume();
      if (Profile.notice) { UI.toast(Profile.notice); Profile.notice = ''; }
    },
    /** Hỏi server tài khoản đang ở đâu (trận / phòng chờ / hàng đợi) rồi đưa người dùng quay lại. */
    async resume() {
      try {
        const st = await Rpc.call('get_my_status');
        if (st.match_id) return Router.go('match', { m: st.match_id });
        if (st.room_id) return Router.go('lobby', { r: st.room_id });
        if (st.queue) return Router.go('queue');
      } catch (_) { /* best-effort */ }
    },
    async showResume() {
      const box = Utils.$('#m-resume'); box.hidden = true;
      try {
        const st = await Rpc.call('get_my_status'); if (Router.current() !== 'modes') return;
        if (!st.match_id && !st.room_id && !st.queue) return;
        Utils.$('#m-resume-text').textContent = st.match_id ? 'Bạn đang có một trận chưa kết thúc.' : st.room_id ? 'Bạn đang ở phòng ' + st.room_code + '.' : 'Bạn đang trong hàng đợi tìm trận.';
        box.hidden = false; Utils.$('#m-resume-go').onclick = () => this.resume();
      } catch (_) { /* bỏ qua */ }
    },
    bindMultiplayer(on) {
      on('m-quick', 'click', () => Router.go('queue'));
      on('m-local', 'click', () => Router.go('play'));
      on('m-friends', 'click', () => Router.go('friends'));
      on('m-create', 'click', (ev) => withBusy(ev.currentTarget, async () => {
        const turn = Utils.el('select', { id: 'cr-turn' }, [30, 60, 90, 120].map((n) => { const o = Utils.el('option', { value: String(n), text: n + ' giây / lượt' }); if (n === 60) o.selected = true; return o; }));
        const spec = Utils.el('input', { id: 'cr-spec', type: 'checkbox' }); spec.checked = true;
        const ok = await Modal.open({ title: 'Tạo phòng riêng', body: [
          Utils.el('label', { class: 'field' }, [Utils.el('span', { text: 'Thời gian mỗi lượt' }), turn]),
          Utils.el('label', { class: 'toggle' }, [spec, Utils.el('span', { text: 'Cho phép người xem (khán giả)' })]),
          Utils.el('p', { class: 'muted small', text: 'Phòng riêng không xếp hạng. Bạn sẽ nhận một mã mời để gửi cho người chơi kia.' })],
          actions: [{ label: 'Hủy', value: false }, { label: 'Tạo phòng', value: true, kind: 'gold', submit: true }] });
        if (!ok) return;
        const room = await Rpc.call('create_room', { p_turn_seconds: +turn.value, p_allow_spectators: spec.checked });
        Router.go('lobby', { r: room.id });
      }));
      const codeDialog = (title, hint, okLabel) => {
        const inp = Utils.el('input', { id: 'code-input', type: 'text', maxlength: '8', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', placeholder: 'VD: K7M2QXA' });
        return Modal.open({ title, body: [Utils.el('p', { class: 'muted small', text: hint }), Utils.el('label', { class: 'field' }, [Utils.el('span', { text: 'Mã phòng' }), inp])],
          validate: () => (/^[A-Za-z0-9]{6,8}$/.test(inp.value.trim()) ? '' : 'Mã phòng gồm 6–8 ký tự chữ/số.'),
          actions: [{ label: 'Hủy', value: null }, { label: okLabel, value: 'ok', kind: 'gold', submit: true }] }).then((v) => (v === 'ok' ? inp.value.trim().toUpperCase() : null));
      };
      on('m-join', 'click', (ev) => withBusy(ev.currentTarget, async () => {
        const code = await codeDialog('Vào phòng', 'Nhập mã mời do chủ phòng gửi.', 'Vào phòng'); if (!code) return;
        const room = await Rpc.call('join_room', { p_code: code }); Router.go('lobby', { r: room.id });
      }));
      on('m-spectate', 'click', (ev) => withBusy(ev.currentTarget, async () => {
        const code = await codeDialog('Xem trận', 'Nhập mã phòng của trận đang diễn ra. Khán giả chỉ xem, không can thiệp được.', 'Xem trận'); if (!code) return;
        const r = await Rpc.call('join_spectator', { p_code: code }); Router.go('match', { m: r.match_id });
      }));
      on('q-cancel', 'click', (ev) => Queue.cancel(ev.currentTarget));
      on('q-retry', 'click', () => Queue.enter());
      on('q-back', 'click', () => Router.go('modes'));
      on('lb-start', 'click', (ev) => Lobby.start(ev.currentTarget));
      on('lb-leave', 'click', (ev) => Lobby.leave(ev.currentTarget));
      on('lb-turn', 'change', () => Lobby.saveSettings());
      on('lb-spec', 'change', () => Lobby.saveSettings());
      on('lb-copy', 'click', async () => {
        const code = Utils.$('#lb-code').textContent;
        try { await navigator.clipboard.writeText(code); UI.toast('Đã sao chép mã phòng.'); } catch (_) { UI.toast('Mã phòng: ' + code); }
      });
      on('btn-replay', 'click', () => { if (Match.data) Router.go('replay', { m: Match.data.id }); });
      on('btn-save-replay', 'click', (ev) => withBusy(ev.currentTarget, async () => { await Rpc.call('save_replay', { p_match: Match.id }); UI.toast('Đã lưu replay.'); }));
      on('form-replay-prefs', 'submit', (ev) => {
        ev.preventDefault();
        UI.guard(ev.currentTarget, async () => {
          UI.fieldError('rpp-error', '');
          const v = { autoplay: Utils.$('#rpp-autoplay').checked, speed: +Utils.$('#rpp-speed').value, show_coords: Utils.$('#rpp-coords').checked };
          if (![0.5, 1, 2, 4].includes(v.speed)) return UI.fieldError('rpp-error', 'Tốc độ không hợp lệ.');
          try {
            const rows = await Database.run((c) => c.from('replay_preferences').update(v).eq('user_id', Auth.uid()).select(), 0);
            if (!rows || !rows.length) return UI.fieldError('rpp-error', 'Chưa có bản ghi tùy chọn replay cho tài khoản này.');
            Replay.prefs = v; UI.toast('Đã lưu tùy chọn replay.');
          } catch (e) { UI.fieldError('rpp-error', Utils.mapError(e)); }
        });
      });
      on('btn-resign', 'click', () => Match.resign());
      on('btn-draw', 'click', () => Match.offerDraw());
      on('btn-rematch', 'click', () => Match.rematchYes());
      on('btn-rematch-no', 'click', () => Match.rematchNo());
      on('btn-leave-match', 'click', () => Match.leaveRoom());
      on('form-friend-add', 'submit', (ev) => {
        ev.preventDefault();
        UI.guard(ev.currentTarget, async () => {
          UI.fieldError('fr-error', '');
          const u = Utils.$('#fr-username').value.trim().toLowerCase();
          if (!Config.USERNAME_RE.test(u)) return UI.fieldError('fr-error', 'Tên người dùng gồm 3–20 ký tự: a–z, 0–9, dấu gạch dưới.');
          try {
            const r = await Rpc.call('send_friend_request', { p_username: u });
            Utils.$('#fr-username').value = ''; UI.toast(r.status === 'accepted' ? 'Hai bạn đã là bạn bè.' : 'Đã gửi lời mời kết bạn.'); await Social.refresh();
          } catch (e) { UI.fieldError('fr-error', Utils.mapError(e)); }
        });
      });
    },
    bind() {
      const on = (id, ev, fn) => Utils.$('#' + id).addEventListener(ev, fn);
      const sync = () => { Utils.$('#offline-banner').hidden = navigator.onLine; };
      window.addEventListener('online', sync); window.addEventListener('offline', sync); sync();

      on('btn-play', 'click', () => Router.go('play'));
      on('btn-modes', 'click', () => Router.go('modes'));
      on('btn-friends-link', 'click', () => Router.go('friends'));
      this.bindMultiplayer(on);
      on('error-login', 'click', async () => { try { await Auth.signOut(); } catch (_) { /* bỏ qua */ } App.boot(); });

      on('form-login', 'submit', (ev) => {
        ev.preventDefault();
        UI.guard(ev.currentTarget, async () => {
          UI.fieldError('login-error', '');
          const email = Utils.$('#login-username').value.trim().toLowerCase(); const pw = Utils.$('#login-password').value;
          if (!Config.USERNAME_RE.test(email)) return UI.fieldError('login-error', 'Tên người dùng gồm 3–20 ký tự: a–z, 0–9, dấu gạch dưới.');
          if (!pw) return UI.fieldError('login-error', 'Vui lòng nhập mật khẩu.');
          if (!navigator.onLine) return UI.fieldError('login-error', Utils.mapError(new Error('network')));
          try {
            await Auth.signIn(email, pw);
            await Profile.load(); UI.applySettings(); Presence.start();
            Utils.$('#login-password').value = '';
            Router.go('home'); App.resume();
            if (Profile.notice) { UI.toast(Profile.notice); Profile.notice = ''; }
          } catch (e) { console.error('[Crownfall] login', e); Auth.user = null; Profile.reset(); UI.fieldError('login-error', Utils.mapError(e)); }
        });
      });

      on('form-register', 'submit', (ev) => {
        ev.preventDefault();
        UI.guard(ev.currentTarget, async () => {
          UI.fieldError('reg-error', ''); UI.fieldError('reg-info', '');
          const v = {
            username: Utils.$('#reg-username').value.trim().toLowerCase(),
            displayName: Utils.$('#reg-display').value.trim(), password: Utils.$('#reg-password').value
          };
          const pw2 = Utils.$('#reg-password2').value;
          if (!Config.USERNAME_RE.test(v.username)) return UI.fieldError('reg-error', 'Tên người dùng gồm 3–20 ký tự: a–z, 0–9, dấu gạch dưới.');
          if (v.displayName.length > 40) return UI.fieldError('reg-error', 'Tên hiển thị tối đa 40 ký tự.');
          if (v.password.length < Config.PASSWORD_MIN) return UI.fieldError('reg-error', 'Mật khẩu tối thiểu ' + Config.PASSWORD_MIN + ' ký tự.');
          if (v.password !== pw2) return UI.fieldError('reg-error', 'Hai mật khẩu không khớp.');
          if (!navigator.onLine) return UI.fieldError('reg-error', Utils.mapError(new Error('network')));
          try {
            const r = await Auth.signUp(v);
            if (r.needsVerification) {
              return UI.fieldError('reg-info', 'Đã tạo tài khoản nhưng Supabase đang bắt xác nhận email. Hãy tắt "Confirm email" trong Authentication → Providers → Email, rồi đăng nhập.');
            }
            await Profile.load(); UI.applySettings(); Presence.start();
            ['reg-password', 'reg-password2'].forEach((id) => { Utils.$('#' + id).value = ''; });
            Router.go('home');
            if (Profile.notice) { UI.toast(Profile.notice); Profile.notice = ''; }
          } catch (e) { console.error('[Crownfall] register', e); UI.fieldError('reg-error', Utils.mapError(e)); }
        });
      });

      on('form-profile', 'submit', (ev) => {
        ev.preventDefault();
        UI.guard(ev.currentTarget, async () => {
          UI.fieldError('pf-error', '');
          const v = { username: Utils.$('#pf-username').value.trim().toLowerCase(), display: Utils.$('#pf-display').value.trim(),
            avatar: Utils.$('#pf-avatar-url').value.trim(), bio: Utils.$('#pf-bio').value.trim() };
          const bad = Profile.validate(v); if (bad) return UI.fieldError('pf-error', bad);
          try { await Profile.save(v); UI.renderProfile(); UI.renderNav(); UI.toast('Đã lưu hồ sơ.'); }
          catch (e) { UI.fieldError('pf-error', Utils.mapError(e)); }
        });
      });

      on('form-settings', 'submit', (ev) => {
        ev.preventDefault();
        UI.guard(ev.currentTarget, async () => {
          UI.fieldError('st-error', '');
          try {
            await Profile.saveSettings({ sound_enabled: Utils.$('#st-sound').checked, reduce_motion: Utils.$('#st-motion').checked,
              show_online_status: Utils.$('#st-online').checked });
            UI.applySettings(); UI.toast('Đã lưu cài đặt.');
          } catch (e) { UI.fieldError('st-error', Utils.mapError(e)); }
        });
      });

      on('btn-logout', 'click', async (ev) => {
        const b = ev.currentTarget; if (b.disabled) return; b.disabled = true;
        Poller.stopAll(); Presence.stop(); Social.loaded = false; Social.data = { friends: [], requests_in: [], requests_out: [], invites_in: [] };
        try { await Auth.signOut(); } catch (e) { UI.toast(Utils.mapError(e), true); }
        finally { b.disabled = false; }
        UI.applySettings(); Router.go('login');
      });
    }
  };

  const root = typeof window !== 'undefined' ? window : globalThis;
  root.Crownfall = Object.freeze({ App, Config, AssetConfig, Auth, Database, Profile, Router, UI, Utils, BoardUI,
    Multiplayer: { MP, Net, Poller, Modal, Presence, Social, Lobby, Queue, Clock, Match, Rpc, mergeMoves, RPC_ERRORS },
    Engine: { GameState, Board, Piece, MovementRules, CaptureRules, ForbiddenZone, SpellPair, SpellSupport, KingCheck, KingSpellSwap, VictoryChecker, MoveHistory, Notation, WolfRules, RULES_OPTIONS },
    Phase4: { Fmt, Ranking, Player, Replay, Admin, Phase4 },
    Tests });
  if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', () => { App.bind(); App.boot(); });
})();
