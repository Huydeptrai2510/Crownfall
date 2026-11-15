// Trích engine luật từ script.js thành thư viện nạp vào sandbox bot.
// Dùng:  node tools/make_engine_lib.js script.js > engine_lib.js   (rồi dán vào Boss → Quản lý BOT → Thư viện engine)
const fs = require('fs');
const src = fs.readFileSync(process.argv[2] || 'script.js', 'utf8');
const a = src.indexOf('const SIZE = 9, BORDER_ROW = 4');
const t = src.indexOf('TESTS (logic engine)');
const b = t < 0 ? -1 : src.lastIndexOf('/*', t);
if (a < 0 || b < a) { console.error('Không tìm thấy mốc engine trong script.js'); process.exit(1); }
process.stdout.write('/* Crownfall engine — trích tự động từ script.js (rules ' + 'crownfall-beta-5.1' + ') */\n' + src.slice(a, b) +
  '\nconst Crownfall = { SIZE, BORDER_ROW, SNAPSHOT_VERSION, RULES_ID, FACTION, PIECE_TYPES, GameState, Board, Piece, MovementRules, CaptureRules, ForbiddenZone, SpellPair, SpellSupport, KingCheck, KingSpellSwap, VictoryChecker, Legal, Actions, Notation, MoveHistory, WolfRules, other, ckey };\n');
