# Kiểm thử nâng cao

Chạy bộ tám ca ADV-01 đến ADV-08 bằng lệnh:

```text
npm run test:advanced
```

Bộ chạy tạo MongoDB tạm, mở ứng dụng User và Admin trên cổng ngẫu nhiên rồi khôi phục dữ liệu giữa các ca. Bộ chạy không kết nối tới database của website đang mở ở cổng 3000 hoặc 3001.

Các nhóm kiểm tra:

- ADV-01: hai khách cùng mua sản phẩm cuối.
- ADV-02: hai shipper cùng nhận một đơn.
- ADV-03: xác nhận giao lặp tuần tự, đồng thời và sai chủ sở hữu.
- ADV-04: dữ liệu rỗng, sai kiểu, số âm, số lẻ, mã sai, chuỗi dài và dấu HTML bất hoạt.
- ADV-05: vai trò, chủ sở hữu và phiên sau đăng xuất.
- ADV-06: yêu cầu thay đổi từ một trang kiểm thử khác trong trình duyệt.
- ADV-07: chạy cùng tám ca Selenium trên Chrome và Firefox rồi so sánh từng phép đối chiếu.
- ADV-08: thao tác danh sách, chi tiết, giỏ và thanh toán ở 1366 x 768, 768 x 1024 và 375 x 812.

Mỗi lượt tạo `results.json`, `report.html`, log ứng dụng và ảnh giao diện trong `tests/evidence/advanced/<thời điểm>/`.

Nếu Firefox chưa có và Selenium Manager không thể tải trình duyệt hoặc driver, ADV-07 được ghi `BLOCKED`, không tự đổi sang Edge và không ghi Đạt.
