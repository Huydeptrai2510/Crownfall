// Bot MẪU để kiểm tra đường ống (không phải thuật toán chơi cờ): ưu tiên nước ăn quân, còn lại ngẫu nhiên.
// Không cần thư viện engine vì input.legal_moves đã có sẵn.
function chooseMove(input) {
  const L = input.legal_moves;
  const caps = L.filter((m) => m.action === 'capture');
  const pool = caps.length ? caps : L;
  const m = pool[Math.floor(Math.random() * pool.length)];
  return { from_row: m.from_row, from_col: m.from_col, to_row: m.to_row, to_col: m.to_col, action: m.action };
}
