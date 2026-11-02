# Kiểm thử tải bằng Apache JMeter 5.6.3

Chạy đủ năm mức 20, 50, 100, 200 và 500 người dùng:

```powershell
npm.cmd run test:jmeter
```

Bộ chạy mặc định tìm JMeter tại `D:\Jmeter\apache-jmeter-5.6.3`. Nếu cài ở nơi khác, đặt biến `JMETER_HOME` trước khi chạy.

File `website-load-test.jmx` dùng Synchronizing Timer để đồng bộ tất cả người dùng tại từng bước. Mỗi người dùng mở trang chủ, danh sách sản phẩm và chi tiết sản phẩm. Môi trường dùng MongoDB tạm, dữ liệu giả và cổng ngẫu nhiên; không dùng database website đang mở.

Kết quả được lưu tại `tests/evidence/jmeter/<mã-lượt-chạy>/`:

- `report.html`: tổng hợp năm mức tải.
- `results.json`: số liệu có cấu trúc.
- `level-*/results.jtl`: kết quả yêu cầu gốc.
- `level-*/dashboard/index.html`: dashboard gốc do JMeter sinh.
- `level-*/jmeter.log.txt`: log lệnh JMeter.

Lệnh trả mã 1 nếu ít nhất một mức không đạt tiêu chí 0% lỗi và p95 không quá 5.000 ms. Đây là kết quả kiểm thử, không đồng nghĩa bộ chạy bị lỗi.
