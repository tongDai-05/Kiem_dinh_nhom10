# Kết quả kiểm thử Postman

Ngày chạy: 31/10/2026 (GMT+7).

## Kết quả chính

- Tổng số ca API: 24.
- Đạt: 15.
- Không đạt: 9.
- Lỗi thực thi bộ kiểm thử: 0.
- Tổng số yêu cầu HTTP: 71.
- Đối chiếu phản hồi Postman: 174/181 đúng.
- Đối chiếu database: 55/68 đúng.
- Các ca không đạt: API-08, API-09, API-11, API-12, API-13, API-14, API-15, API-18 và API-20.

Các ca không đạt phản ánh sai lệch của website so với kết quả mong đợi, không phải lỗi cài đặt Postman. Ví dụ: nối chuỗi số lượng thành 12, sửa nhầm biến thể trong giỏ, chấp nhận giá hoặc tồn kho âm, tin giá do khách gửi, giảm sai kho và lộ thông tin xác nhận đơn cho người không phải chủ đơn.

## Hồ sơ minh chứng

- Lượt chạy đầy đủ bằng Newman: `tests/evidence/postman/2026-10-31T11-07-58-777Z/`.
- Kết quả tổng hợp: `tests/evidence/postman/2026-10-31T11-07-58-777Z/results.json`.
- Báo cáo xem bằng trình duyệt: `tests/evidence/postman/2026-10-31T11-07-58-777Z/report.html`.
- Lượt minh họa API-13 bằng Postman Desktop: `tests/evidence/postman/2026-10-31T10-37-07-849Z/`.
- Ảnh Runner và phản hồi thực tế: thư mục `screenshots` trong lượt Postman Desktop.
- Đối chiếu database sau lượt Desktop: `desktop-db-evidence.json`.

Ảnh Postman Desktop chỉ minh họa riêng API-13 với hai yêu cầu và năm đối chiếu phản hồi đúng. API-13 vẫn được xếp Không đạt vì database cho thấy kho M giảm từ 5 xuống 3 và kho L không giảm, trái với mong đợi giữ M ở 5 và giảm L xuống 1.

## Chạy lại

Xem hướng dẫn ngắn tại `tests/postman/README.md`.

Từ thư mục dự án có `package.json`, chạy toàn bộ bộ kiểm thử bằng:

```text
npm run test:postman
```

Bộ chạy tạo MongoDB tạm, mở hai ứng dụng trên cổng riêng và khôi phục dữ liệu giữa các ca. Không dùng bộ dữ liệu website đang chạy ở cổng 3000 hoặc 3001.
