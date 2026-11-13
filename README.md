# CROWNFALL

Game cờ chiến thuật 9×9 cho hai người. Web tĩnh (HTML/CSS/JS thuần, không build), backend **Supabase** (Auth + Postgres + RLS), chạy được trên GitHub Pages.

Gồm đúng 5 file: `index.html`, `style.css`, `script.js`, `database.sql`, `README.md` (+ các ảnh PNG, xem mục 5).

## 1. Cài đặt Supabase (làm một lần)

1. **SQL Editor** → dán toàn bộ `database.sql` → Run. Sau đó chạy:
   ```sql
   select public.cf_selftest();
   select public.cf_phase4_selftest();
   ```
   Cả hai phải trả về `"ok": true`.
2. **Authentication → Providers → Email**: **tắt "Confirm email"** (app dùng email nội bộ `username@crownfall.app`, không gửi thư thật). Giữ bật "Allow new users to sign up".
3. **Authentication → URL Configuration**: đặt Site URL là địa chỉ trang của bạn (vd `https://huydeptrai2510.github.io/Crownfall/`).
4. `script.js` đã điền sẵn `SUPABASE_URL` và `SUPABASE_KEY` (khóa **publishable**, công khai theo thiết kế). **Không** đưa khóa `secret` / `service_role` vào mã phía trình duyệt.

Phiên đăng nhập lưu ở localStorage của trình duyệt nên không phụ thuộc cookie bên thứ ba.

## 2. Chạy thử trên máy

```
python -m http.server 8000
```
Mở `http://localhost:8000`. Test logic không cần mạng: `Crownfall.Tests.run()` trong Console (53 test).

## 3. Chế độ chơi

- **Chơi 1 máy**: hai người luân phiên trên cùng thiết bị, không lưu, không tính điểm.
- **Xếp hạng**: chỉ ghép với người lạ qua "Tìm trận", tính HELO, 60 giây/lượt.
- **Phòng riêng / Bạn bè / Xem trận**: không tính điểm.
- Online: mỗi người luôn thấy phe của mình ở dưới (phe Xanh được xoay 180°), bố cục và chiều quân giống nhau.

## 4. HELO và bậc rank

HELO là điểm xếp hạng. **Người mới bắt đầu ở 0**, không xuống dưới 0. Công thức Elo chuẩn, K = 40 (20 trận đầu) rồi 32. Bậc mặc định (Boss sửa được trong trang Boss):

| Bậc | HELO tối thiểu |
|---|---|
| Bronze | 0 |
| Silver | 100 |
| Gold | 250 |
| Platinum | 450 |
| Diamond | 700 |
| Master | 1000 |
| Grandmaster | 1400 |

## 5. Ảnh PNG (400×400, cùng thư mục với `index.html`)

Đặt file ảnh cạnh `index.html`, rồi đổi `enabled: false` thành `true` trong `ASSET_CONFIG` (`script.js`). Thiếu ảnh nào thì chỗ đó hiện chữ thay thế.

- Quân cờ: `red-soldier.png`, `red-king.png`, `red-knight.png`, `red-bishop.png`, `red-wolf.png`, `red-bear.png`, `red-ox.png`, `red-mage.png` và 8 file tương ứng `blue-*.png`.
- Bậc rank: `rank-bronze.png`, `rank-silver.png`, `rank-gold.png`, `rank-platinum.png`, `rank-diamond.png`, `rank-master.png`, `rank-grandmaster.png`.
- Khác: `logo.png`, `avatar-default.png`.

Muốn đổi tên file thì sửa trong `ASSET_CONFIG`.

## 6. Cấp quyền Boss (chỉ làm bằng SQL)

Tài khoản phải đăng nhập ít nhất một lần. Thay `TEN_USERNAME`:
```sql
do $$
declare uid text;
begin
  select user_id into uid from public.profiles where username = 'TEN_USERNAME';
  if uid is null then raise exception 'Không tìm thấy username'; end if;
  update public.user_roles set role = 'boss', granted_at = now() where user_id = uid;
  if not found then raise exception 'Chưa có dòng user_roles'; end if;
  insert into public.admin_logs (admin_id, actor_role, action, target_type, target_id, reason, details)
  values (uid, 'boss', 'bootstrap_boss', 'user', uid, 'Bootstrap thủ công trong SQL Editor', '{"via":"sql_editor"}'::jsonb);
end $$;
```
Đăng xuất rồi đăng nhập lại để thấy mục Boss. Tài khoản Boss đã có dòng trong `admin_logs` thì không xóa được nữa.

## 7. Xem và xóa tài khoản (SQL Editor)

Xem:
```sql
select u.id, u.email, p.username, p.display_name, rp.rating
from auth.users u
left join public.profiles p on p.user_id = u.id::text
left join public.rating_profiles rp on rp.user_id = p.user_id
order by u.created_at;
```
Xóa 2 tài khoản `muhh` và `muhhh` (chạy trọn vẹn hoặc không chạy gì; lỗi khóa ngoại nghĩa là tài khoản đã có trận hoặc là admin):
```sql
do $$
declare ids text[];
begin
  select array_agg(user_id) into ids from public.profiles where username in ('muhh','muhhh');
  if ids is null or array_length(ids,1) <> 2 then
    raise exception 'Mong đợi đúng 2 tài khoản, tìm thấy %', coalesce(array_length(ids,1),0);
  end if;
  delete from public.profiles where user_id = any(ids);
  delete from auth.users where id::text = any(ids);
end $$;
```

## 8. Xử lý lỗi thường gặp

| Thông báo | Cách xử lý |
|---|---|
| Supabase đang bắt xác nhận email | Tắt "Confirm email" (mục 1, bước 2). |
| Supabase từ chối email nội bộ | Đổi `AUTH_EMAIL_DOMAIN` trong `script.js`. |
| Tên người dùng hoặc mật khẩu không đúng | Sai thông tin, hoặc tài khoản chưa được tạo. |
| Lỗi có mã `PGRST202` / hàm không tồn tại | `database.sql` chưa chạy xong; chạy lại rồi `select public.cf_selftest();`. |
| Banner "Đang kết nối lại…" kèm tên vòng poll | Đọc nội dung trong ngoặc `[…]`; thường là RPC lỗi hoặc thiếu quyền. |

## 9. Bảo mật

Mọi bảng bật RLS. Danh tính lấy từ `auth.uid()` qua `public.cf_uid()`, không RPC nào nhận `user_id`, người thắng hay role từ client. HELO chỉ do `cf_finish_match` tính một lần mỗi trận. Người chưa đăng nhập (`anon`) không đọc hay gọi được gì. Phóng to/thu nhỏ trang và xoay ngang bị khóa trên điện thoại.
