# Hướng dẫn chạy toàn bộ kiểm thử và quay video

Tài liệu này dùng cho source trong thư mục:

```text
D:\Kiểm thử\website-ban-quan-ao-main\website-ban-quan-ao-main
```

Các bộ tự động tạo MongoDB tạm, dữ liệu giả và cổng ngẫu nhiên. Chúng không dùng database của website đang chạy ở cổng 3000/3001. Không cần mở Docker và cũng không cần tự khởi động website trước.

## 1. Kết quả đã xác nhận ngày 01/11/2026

| Nhóm kiểm thử | Phạm vi | Kết quả lần chạy mới |
|---|---:|---|
| Jest và độ phủ hộp trắng | 134 ca | 134 đạt, 0 lỗi; 100% dòng trong phạm vi đo |
| Selenium Chrome | 8 ca | 5 đạt, 3 không đạt, 0 lỗi môi trường |
| Selenium Firefox | 8 ca | 5 đạt, 3 không đạt, 0 lỗi môi trường |
| Postman/Newman | 24 ca, 71 yêu cầu | 15 đạt, 9 không đạt, 0 lỗi môi trường |
| Hộp đen mở rộng | 36 ca | 19 đạt, 8 một phần, 9 không đạt, 0 lỗi môi trường |
| Nâng cao | 8 ca | 2 đạt, 6 không đạt, 0 lỗi môi trường |
| Apache JMeter 5.6.3 | 5 mức, 2.610 yêu cầu | 20–200 người dùng đạt; 500 người dùng chưa đạt |

`Không đạt` ở đây là website trả kết quả khác tiêu chí mong đợi, không phải bộ chạy bị hỏng. Những kết quả này cần được giữ nguyên làm minh chứng lỗi.

## 2. Chuẩn bị một lần

Cần Node.js, npm, Chrome và Firefox. Postman Desktop chỉ cần khi muốn quay phần thao tác trực tiếp trong Postman; bộ CLI đã có Newman.

Mở PowerShell trong VS Code và chạy:

```powershell
cd "D:\Kiểm thử\website-ban-quan-ao-main\website-ban-quan-ao-main"
npm.cmd install
npm.cmd install --prefix user
npm.cmd install --prefix admin
```

Lần đầu có thể cần Internet để tải trình điều khiển trình duyệt và MongoDB dùng riêng cho kiểm thử. Những lần sau công cụ dùng bản đã lưu đệm.

## 3. Chạy từng bộ kiểm thử

Nên chạy lần lượt để kết quả dễ theo dõi. Một số lệnh trả mã `1` vì có ca phát hiện lỗi, nhưng vẫn tạo đầy đủ báo cáo HTML và JSON.

### 3.1. Jest và độ phủ mã

```powershell
npm.cmd run test:coverage
```

Kết quả hiện tại:

- Statements: **99,92%** (1.352/1.353).
- Branches: **82,62%** (761/921).
- Functions: **99,44%** (178/179).
- Lines: **100%** (1.253/1.253).
- 134/134 unit test đạt.

Báo cáo dễ đọc: `tests/evidence/unit/coverage/index.html`.

Phạm vi hiện tại gồm toàn bộ controller và middleware của ứng dụng User, cùng toàn bộ controller, middleware và service của ứng dụng Admin. Các controller/middleware/service Admin đạt 100% dòng; middleware User cũng đạt 100% dòng và nhánh.

Lưu ý quan trọng: 100% dòng nghĩa là mọi dòng thực thi trong phạm vi trên đã được chạy ít nhất một lần, không có nghĩa mọi tổ hợp đầu vào trên đời đều đã được thử. Route khai báo, schema/model, EJS, JavaScript phía trình duyệt và thư viện bên thứ ba không được cộng vào chỉ số hộp trắng này. Độ phủ nhánh 82,62% phản ánh vẫn còn các tổ hợp điều kiện logic tương đương hoặc khó đạt trong các biểu thức tùy chọn.

Jest đã đặt ngưỡng chống giảm độ phủ: lines 100%, statements 99%, functions 99% và branches 80%. Lệnh coverage sẽ báo lỗi nếu thay đổi source sau này làm kết quả thấp hơn các ngưỡng này.

### 3.2. Selenium giao diện

Chạy toàn bộ trên Chrome ở chế độ ẩn:

```powershell
npm.cmd run test:selenium -- --browser=chrome
```

Chạy trên Firefox:

```powershell
npm.cmd run test:selenium -- --browser=firefox
```

Khi quay video, nên chạy một ca có cửa sổ Chrome để người xem thấy thao tác thật:

```powershell
npm.cmd run test:selenium:headed -- --browser=chrome --case=UI-04
```

Minh chứng nằm tại `tests/evidence/selenium/<mã-lượt-chạy>/report.html` và thư mục `screenshots` bên cạnh.

### 3.3. Postman/Newman

Chạy đủ 24 ca bằng CLI:

```powershell
npm.cmd run test:postman
```

Minh chứng: `tests/evidence/postman/<mã-lượt-chạy>/report.html`.

Muốn quay trực tiếp trong Postman Desktop, ví dụ ca API-13:

```powershell
npm.cmd run postman:local -- --case=API-13
```

Giữ Terminal đang chạy, đợi dòng `GUI_READY`, sau đó:

1. Import `tests/postman/WebsiteQuanAo.postman_collection.json`.
2. Import `tests/postman/ACTIVE_LOCAL.postman_environment.json`.
3. Chọn environment `LOCAL POSTMAN API-13`.
4. Chạy đúng thư mục API-13, một iteration.
5. Trở lại Terminal, nhập `verify` để đối chiếu database.
6. Nhập `stop` khi quay xong.

### 3.4. Kiểm thử hộp đen 36 ca

```powershell
npm.cmd run test:blackbox
```

Chạy riêng một ca và mở Chrome để quay:

```powershell
npm.cmd run test:blackbox -- --headed --case=BB-34
```

Minh chứng: `tests/evidence/blackbox/<mã-lượt-chạy>/report.html`.

Ý nghĩa trạng thái:

- `PASS`: ca đã chạy đủ phạm vi tự động hóa và các đối chiếu đều đúng.
- `PARTIAL`: phần đã tự động hóa chạy đúng nhưng phạm vi ca vẫn còn bước chưa bao quát.
- `FAIL`: có ít nhất một đối chiếu sai.
- `ERROR`: ca không hoàn tất vì môi trường hoặc công cụ.

### 3.5. Kiểm thử nâng cao

```powershell
npm.cmd run test:advanced
```

Bộ này kiểm tra mua/nhận/giao đồng thời, giao lặp, dữ liệu bất thường, phân quyền, yêu cầu khác nguồn, Chrome–Firefox và ba kích thước màn hình. Thời gian chạy dài hơn vì ADV-07 tự chạy Selenium trên cả Chrome và Firefox.

Minh chứng: `tests/evidence/advanced/<mã-lượt-chạy>/report.html`.

### 3.6. Apache JMeter: 20, 50, 100, 200 và 500 người dùng

```powershell
npm.cmd run test:jmeter
```

Lệnh dùng Apache JMeter 5.6.3 tại `D:\Jmeter\apache-jmeter-5.6.3`. Synchronizing Timer buộc các luồng cùng bắt đầu tại từng bước. Mỗi người dùng thực hiện ba bước: trang chủ, danh sách sản phẩm và chi tiết sản phẩm. Tổng cộng là 2.610 yêu cầu. Tiêu chí của mỗi mức là 0% yêu cầu lỗi và p95 không quá 5.000 ms.

| Người dùng đồng thời | Thành công | Lỗi | Tỷ lệ lỗi | p95 | Thông lượng | Kết luận |
|---:|---:|---:|---:|---:|---:|---|
| 20 | 60/60 | 0 | 0% | 225 ms | 120,24 req/s | Đạt |
| 50 | 150/150 | 0 | 0% | 475 ms | 141,24 req/s | Đạt |
| 100 | 300/300 | 0 | 0% | 783 ms | 157,48 req/s | Đạt |
| 200 | 600/600 | 0 | 0% | 1.433 ms | 171,82 req/s | Đạt |
| 500 | 1.240/1.500 | 260 | 17,33% | 2.437 ms | 226,14 req/s | Chưa đạt |

Ở mức 500, JMeter ghi 260 lỗi `HttpHostConnectException`, tương đương 17,33%. Các mức 20–200 có 0% lỗi. Vì vậy, với cấu hình máy và một tiến trình web trong phép thử này, mức cao nhất đã xác nhận không lỗi là **200 người dùng đồng thời**. Không được suy rộng kết quả này thành năng lực của máy chủ production khác cấu hình.

Minh chứng tải gồm:

- `tests/evidence/jmeter/<mã-lượt-chạy>/report.html`: bảng tổng hợp dễ đọc.
- `results.json`: toàn bộ số liệu và tiêu chí.
- `level-20`, `level-50`, `level-100`, `level-200`, `level-500`: kết quả từng mức.
- `level-*/results.jtl`: từng yêu cầu, thời gian, trạng thái và lỗi do JMeter ghi.
- `level-*/dashboard/index.html`: dashboard HTML gốc do Apache JMeter sinh.
- `user-app.log`: log của ứng dụng trong lần tải.

## 4. Các minh chứng mới nhất đã có sẵn

Các tên thư mục dùng thời gian UTC; nội dung báo cáo có thời gian địa phương GMT+7.

- Apache JMeter: `tests/evidence/jmeter/2026-10-31T17-57-25-288Z/report.html`.
- Postman: `tests/evidence/postman/2026-10-31T17-14-38-435Z/report.html`.
- Selenium Chrome: `tests/evidence/selenium/2026-10-31T17-21-15-025Z-chrome/report.html`.
- Selenium Firefox: `tests/evidence/selenium/2026-10-31T17-22-23-978Z-firefox/report.html`.
- Nâng cao: `tests/evidence/advanced/2026-10-31T17-20-56-716Z/report.html`.
- Hộp đen: `tests/evidence/blackbox/2026-10-31T17-25-29-374Z-chrome/report.html`.
- Độ phủ: `tests/evidence/unit/coverage/index.html`.

## 5. Thứ tự quay video đề xuất

Không cần chạy lại mọi bộ dài trong lúc quay. Có thể trình bày kết quả đầy đủ đã lưu và chỉ chạy trực tiếp một vài lệnh tiêu biểu.

1. Mở `package.json`, giới thiệu các lệnh kiểm thử.
2. Chạy `npm.cmd run test:coverage`, cho thấy 134/134 ca, 100% dòng và bảng độ phủ.
3. Chạy một ca Selenium có cửa sổ bằng lệnh UI-04 ở trên; sau đó mở báo cáo Chrome đủ 8 ca và ảnh minh chứng.
4. Mở Postman, chạy API-13 theo hướng dẫn GUI và nhập `verify` trong Terminal.
5. Mở báo cáo hộp đen, chỉ rõ `PASS`, `PARTIAL`, `FAIL` và ảnh của một ca.
6. Chạy `npm.cmd run test:jmeter`. Mở báo cáo tổng hợp và một dashboard gốc trong thư mục `level-*`; nhấn mạnh 20–200 đạt, 500 chưa đạt.
7. Mở báo cáo nâng cao, nêu các lỗi đồng thời/phân quyền. Kết thúc bằng bảng tổng hợp ở đầu tài liệu này.

Khi thuyết trình, không nên nói “toàn bộ website đạt”. Cách nói chính xác là: **toàn bộ các bộ kiểm thử đã chạy xong và có minh chứng; một số ca không đạt đã phát hiện lỗi cần sửa trong các vòng tiếp theo**.

## 6. Những phần cần cải thiện sau kiểm thử

Ưu tiên sửa theo ảnh hưởng:

1. Tranh chấp đồng thời khi mua chiếc cuối, nhận đơn và xác nhận giao.
2. Phân quyền xem trang xác nhận đơn và bảo vệ yêu cầu thay đổi từ nguồn khác.
3. Giảm tồn kho, hoàn tác khi đặt giỏ thất bại, tổng tiền theo đúng size.
4. Cập nhật đúng dòng size trong giỏ và từ chối số lượng vượt kho/số lẻ.
5. Tìm kiếm kết hợp danh mục, đường tìm kiếm cũ và điều khiển sắp xếp.
6. Validation sản phẩm có giá âm/tồn âm.
7. Tối ưu khả năng tiếp nhận kết nối hoặc triển khai nhiều tiến trình/reverse proxy trước khi đặt mục tiêu 500 người dùng đồng thời.
8. Nếu cần tuyên bố độ phủ toàn dự án thay vì phạm vi nghiệp vụ, tiếp tục đo route, schema/model, EJS và JavaScript phía trình duyệt; đồng thời bổ sung các tổ hợp để nâng branch coverage trên 82,62%.
