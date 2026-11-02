# Kiểm thử API website quần áo bằng Postman

Bộ kiểm thử gồm 24 ca API-01 đến API-24, tổng cộng 71 yêu cầu HTTP. Collection có các phép kiểm tra phản hồi bằng Postman. Bộ chạy Newman thực hiện thêm đối chiếu dữ liệu lưu trong MongoDB tạm. Mỗi ca tự khôi phục dữ liệu riêng; không sử dụng database website ở cổng 3000/3001.

## Chạy toàn bộ và xem kết quả

Tại thư mục dự án có package.json, chạy:

```powershell
npm run test:postman
```

Kết quả được lưu trong `tests/evidence/postman/<mã-lượt-chạy>/`: `report.html` để đọc, `results.json` để đối chiếu và các tệp Newman/JUnit gốc. Ca không đạt làm lệnh trả mã 1; điều đó khác với lỗi không khởi động được bộ chạy. Giữ nguyên kết quả không đạt để sửa website và chạy hồi quy.

## Chạy một ca ngay trong Postman Desktop

Ví dụ với ca đặt hàng API-13:

```powershell
npm run postman:local -- --case=API-13
```

Giữ cửa sổ lệnh này hoạt động. Khi hiện GUI_READY:

1. Trong Postman, chọn Import và nhập `WebsiteQuanAo.postman_collection.json` cùng `ACTIVE_LOCAL.postman_environment.json` trong thư mục này.
2. Chọn environment `LOCAL POSTMAN API-13` ở góc trên.
3. Chọn **đúng thư mục API-13** trong collection rồi Run, một iteration. Các yêu cầu trong ca phải chạy theo thứ tự, gồm đăng nhập trước thao tác chính.
4. Trong cửa sổ lệnh đang giữ môi trường tạm, nhập `verify` để đối chiếu database sau khi chạy. Nhập `reset` trước khi chạy lại ca; cookie cũ có thể hết hiệu lực nên vẫn chạy lại cả thư mục từ đăng nhập.
5. Khi hoàn tất, nhập `stop` để đóng ứng dụng và database do bộ kiểm thử tạo.

Muốn thử ca khác, dừng phiên hiện tại rồi khởi động lại với mã ca đó và nhập lại environment mới. Cổng và mã dữ liệu thay đổi ở mỗi phiên; environment cũ không dùng cho phiên mới.

Collection chặn yêu cầu khi mã thư mục khác `active_case` hoặc URL không phải địa chỉ local hợp lệ. Chỉ dùng environment do bộ chạy tự sinh; không sửa URL sang website đang dùng hoặc database thật. Template mặc định dùng cổng 0 để tránh chạy nhầm khi chưa chuẩn bị môi trường.

## Cách đọc kết quả

- API trả HTML, JSON và chuyển hướng tùy chức năng. Bộ test giữ phản hồi 302 ban đầu để đối chiếu `Location`; không ép mọi yêu cầu phải trả 200/JSON.
- Đăng nhập dùng cookie, không dùng Bearer token. Cả hai ứng dụng có cơ chế phiên riêng.
- Phản hồi thành công chưa chứng minh dữ liệu đúng. Ví dụ API-13 có thể trả 200 và tạo đơn đúng tiền nhưng vẫn không đạt vì giảm nhầm kho.
- Kết quả Newman và ảnh Postman Desktop phải ghi riêng đúng nguồn. 24 ca trong báo cáo tổng hợp là lượt Newman; ảnh Desktop ghi lượt minh họa thực hiện trong ứng dụng.
- Các tệp Newman gốc có thể chứa cookie và mật khẩu **dữ liệu thử tạm thời**. Bản tổng hợp đã bỏ header phiên và không đưa mật khẩu vào báo cáo Word. Không dùng tệp chứa phiên còn hiệu lực của hệ thống thật để chia sẻ.
- Chưa bao quát kiểm thử tải, truy cập đồng thời, mọi kiểu dữ liệu sai hoặc chứng nhận bảo mật.

## Tài liệu chính thức

- [Nhập dữ liệu vào Postman](https://learning.postman.com/docs/getting-started/importing-and-exporting/importing-data)
- [Chạy collection bằng Newman](https://learning.postman.com/docs/collections/using-newman-cli/newman-options)
- [Bỏ qua yêu cầu bằng script](https://learning.postman.com/docs/tests-and-scripts/write-scripts/postman-sandbox-reference/pm-execution)
