# Kết quả kiểm thử Selenium website bán quần áo

Lần chạy Chrome ghi nhận **5 PASS, 3 FAIL và 0 ERROR** trong tám ca UI-01 đến UI-08. Ba ca chưa đạt là UI-03, UI-05 và UI-06. Kết quả được giữ theo những bước đối chiếu đã chạy; không đổi sai lệch của ứng dụng thành PASS.

## 1. Thông tin lần chạy

| Nội dung | Giá trị |
|---|---|
| Mã lần chạy | `2026-10-30T17-32-22-895Z-chrome` |
| Bắt đầu theo GMT+7 | 00:32:22 ngày **31/10/2026** |
| Kết thúc theo GMT+7 | 00:33:23 ngày **31/10/2026** |
| Trình duyệt | Chrome **156.0.8078.74**, chạy headless |
| Trình điều khiển | ChromeDriver **156.0.8078.80** |
| Node.js | **v22.20.0** |
| Môi trường | Hai ứng dụng thật và MongoDB tạm được tạo riêng cho lần chạy |
| Tổng thời gian của bộ chạy | Khoảng 60,3 giây, gồm cả chuẩn bị và thu dọn môi trường |

Mã lần chạy dùng thời gian UTC nên phần ngày trong mã là 30/10, còn thời gian địa phương GMT+7 đã sang ngày 31/10. Thời gian tổng không phải phép đo tốc độ phản hồi hoặc kiểm thử tải của website.

Trong đợt này, mã ứng dụng được giữ nguyên. Các điều chỉnh phục vụ chạy và ghi nhận kết quả nằm trong bộ kiểm thử; không sửa ứng dụng để làm các ca thất bại chuyển thành đạt. Dữ liệu tài khoản, sản phẩm và đơn đều là dữ liệu giả trong MongoDB tạm, không sử dụng database bán hàng đang có của người dùng.

Xem hồ sơ gốc của đúng lần chạy:

- [Báo cáo HTML dễ đọc](../evidence/selenium/2026-10-30T17-32-22-895Z-chrome/report.html).
- [Kết quả và các giá trị đối chiếu trong JSON](../evidence/selenium/2026-10-30T17-32-22-895Z-chrome/results.json).
- [Kết quả JUnit XML](../evidence/selenium/2026-10-30T17-32-22-895Z-chrome/junit.xml).

## 2. Kết quả tám ca

| Mã ca | Nội dung | Trạng thái | Diễn giải ngắn |
|---|---|---|---|
| UI-01 | Đăng nhập đúng tài khoản khách hàng | **PASS** | Hồ sơ đúng khách hàng mẫu; không lộ mật khẩu hoặc giá trị băm trên trang được kiểm tra |
| UI-02 | Đăng nhập sai và mất quyền sau đăng xuất | **PASS** | Lần sai không có quyền xem hồ sơ; sau đăng xuất, các trang riêng tư được thử yêu cầu đăng nhập lại |
| UI-03 | Tìm kiếm kết hợp danh mục và sắp xếp | **FAIL** | Kết quả lẫn sản phẩm ngoài danh mục; điều khiển sắp xếp trong đặc tả đề xuất chưa có trên giao diện |
| UI-04 | Chọn size L và thêm giỏ | **PASS** | Giá, size, số lượng hai chiếc và tiền hàng 300.000 đồng khớp trên giỏ và dữ liệu sau tải lại |
| UI-05 | Sửa số lượng và xóa đúng size | **FAIL** | Tăng ở dòng L nhưng M đổi số lượng; số tiền và dữ liệu còn lại sau xóa không đúng mong đợi |
| UI-06 | Đặt hàng từ giỏ | **FAIL** | Tóm tắt thanh toán dùng giá sai; đơn được tạo đúng size L nhưng tồn kho lại giảm size M |
| UI-07 | Quản trị viên duyệt đơn | **PASS** | Đúng đơn chuyển sang chờ giao, đơn đã giao giữ nguyên và shipper thấy đơn vừa được duyệt |
| UI-08 | Shipper nhận và giao hàng | **PASS** | Người nhận, trạng thái, lịch sử và tiền công 12.000 đồng khớp dữ liệu đối chiếu |

PASS chỉ áp dụng những dữ liệu và điều kiện đã kiểm tra trong ca đó. Nó không chứng minh mọi đầu vào của chức năng đều đúng. Tương tự, 0 ERROR nghĩa bộ chạy không ghi nhận ca lỗi điều kiện chạy trong lần này; ứng dụng vẫn có các sai lệch được đánh dấu FAIL.

## 3. Chi tiết ba ca chưa đạt

### UI-03 Kết hợp tìm kiếm với danh mục

**Dữ liệu:** từ khóa “Alpha”, danh mục “Áo Selenium”. Dữ liệu mẫu có “Áo Selenium Alpha” trong danh mục này và “Quần Selenium Alpha” ở danh mục khác.

| Nội dung đối chiếu | Mong đợi | Thực tế |
|---|---|---|
| Danh sách khi kết hợp từ khóa và danh mục | Chỉ có Áo Selenium Alpha | Có cả Quần Selenium Alpha và Áo Selenium Alpha |
| Điều khiển sắp xếp giá tăng dần | Có theo đặc tả ca đề xuất | Không tìm thấy trên giao diện |

Việc lọc lẫn sản phẩm ngoài danh mục là sai lệch hành vi so với quy tắc kết hợp đã nêu trong ca. Riêng sắp xếp cần được hiểu là **chức năng trong đặc tả đề xuất chưa có điều khiển trên giao diện**; không kết luận một điều khiển sắp xếp đang tồn tại đã hoạt động sai.

Nhánh từ khóa không có sản phẩm khớp trong cùng ca đã trả danh sách rỗng và không gặp trang lỗi máy chủ ở lần chạy này. Không gộp nó với sai lệch bộ lọc.

![Kết quả đang chứa cả Áo Selenium Alpha và Quần Selenium Alpha](../evidence/selenium/2026-10-30T17-32-22-895Z-chrome/screenshots/UI-03-02-ui03-ten-va-gia-hai-san-pham.png)

Ảnh trên ghi rõ tên và giá hai sản phẩm. Điều kiện danh mục, từ khóa và danh sách tên đã đọc được lưu trong báo cáo HTML/JSON; cần đối chiếu cùng các dữ liệu đó để xác nhận sai lệch bộ lọc.

### UI-05 Thay đổi nhầm size trong giỏ

**Dữ liệu ban đầu:** cùng một áo màu Đen có M một chiếc giá 120.000 đồng và L một chiếc giá 150.000 đồng. Bộ test nhấn nút tăng trong đúng dòng L rồi tải lại giỏ để đọc kết quả.

| Nội dung đối chiếu | Mong đợi | Thực tế |
|---|---|---|
| Số lượng sau khi tăng L | M = 1; L = 2 | M = 2; L = 1 |
| Tiền hàng sau tăng | 420.000 đồng | 390.000 đồng |
| Giỏ sau khi xóa riêng L | Còn M một chiếc | Còn M hai chiếc |
| Tiền hàng còn lại | 120.000 đồng | 240.000 đồng |

Kết quả được ghi nhận từ cả giao diện sau tải lại và dữ liệu giỏ. Bộ test xác định nút tăng theo dòng có size L; không thấy thao tác kiểm thử nhấn nhầm dòng M. Việc xóa đúng dòng L có hoạt động, nhưng dữ liệu M đã bị tăng sai từ bước trước nên kết quả cuối vẫn không đạt.

![Giỏ sau khi nhấn tăng size L: M thành hai chiếc, L vẫn một chiếc](../evidence/selenium/2026-10-30T17-32-22-895Z-chrome/screenshots/UI-05-02-02-sau-tang-size-L.png)

### UI-06 Giá trên thanh toán và size bị trừ kho không nhất quán

**Dữ liệu ban đầu:** giỏ có L hai chiếc, mỗi chiếc 150.000 đồng; tiền hàng 300.000 đồng. Tồn kho M là 5, L là 3.

| Nội dung đối chiếu | Mong đợi | Thực tế |
|---|---|---|
| Tóm tắt trước khi đặt | Thể hiện size L, hai chiếc, 300.000 đồng | Không thể hiện size L; hiển thị 240.000 đồng |
| Đơn sau khi đặt | Một đơn L hai chiếc, tiền hàng 300.000 đồng | Đã tạo đúng một đơn L hai chiếc, tổng 300.000 đồng |
| Tồn size L | Giảm từ 3 xuống 1 | Vẫn là 3 |
| Tồn size M | Giữ nguyên 5 | Giảm từ 5 xuống 3 |
| Tổng trước và sau đặt | Nhất quán 300.000 đồng | Trước đặt 240.000 đồng, đơn lưu 300.000 đồng |

Đơn mới, phương thức thanh toán khi nhận hàng và thông tin người nhận đã được lưu; giỏ được xóa sau đặt. Các phần đó không loại trừ sai lệch giá ở trang thanh toán hoặc việc giảm nhầm tồn kho. Bộ test dùng đúng giỏ L đã chuẩn bị riêng, đọc lại toàn bộ hai size trước sau và nhận được kết quả nêu trên.

![Tóm tắt trước khi đặt hiển thị 240.000 đồng cho hai chiếc trong giỏ size L](../evidence/selenium/2026-10-30T17-32-22-895Z-chrome/screenshots/UI-06-02-UI-06-02-thong-tin-va-tom-tat-truoc-dat.png)

[Ảnh đơn mới trong lịch sử sau đặt](../evidence/selenium/2026-10-30T17-32-22-895Z-chrome/screenshots/UI-06-04-UI-06-04-don-moi-trong-lich-su.png) hỗ trợ đối chiếu với tóm tắt trước đặt. Thay đổi tồn kho được xác nhận bằng các giá trị dữ liệu trước sau trong JSON, không suy ra chỉ từ ảnh trang lịch sử.

## 4. Kiểm tra tính đầy đủ của hồ sơ

- Tám trạng thái ca khớp các bước đối chiếu đã ghi: năm ca PASS không có bước sai; ba ca FAIL có ít nhất một bước sai.
- Có **110 bước đối chiếu**, gồm 94 bước đúng và 16 bước không khớp mong đợi. Nhiều bước sai có thể thuộc cùng một nguyên nhân; không diễn giải 16 bước sai thành 16 lỗi riêng.
- Có **31 tệp ảnh PNG** được kết quả tham chiếu; đã kiểm tra tệp tồn tại và đúng định dạng. Ảnh đại diện UI-03, UI-05 và UI-06 đã được xem để đối chiếu nội dung.
- JUnit XML đọc được, có **8 testcase, 3 failure và 0 error**, khớp kết quả JSON.
- Các giá trị kiểm tra SHA-256 của **12 tệp ứng dụng và bộ kiểm thử** trong hồ sơ Chrome khớp bản tệp tại thời điểm rà soát.
- Không có lỗi thu dọn môi trường được ghi trong kết quả lần chạy.

Các kiểm tra hồ sơ giúp đối chiếu đúng bằng chứng của lần chạy, không thay thế việc phân tích nghiệp vụ hoặc chứng minh tất cả ảnh đều bao trùm toàn bộ nội dung trang.

## 5. Kiểm tra bổ sung trên Edge

Lần chạy `2026-10-30T17-24-32-411Z-edge` bắt đầu lúc **00:24:32 ngày 31/10/2026 GMT+7**, kết thúc lúc **00:24:42**. Microsoft Edge **156.0.4314.50** và trình điều khiển **156.0.4314.50** ghi nhận **UI-01 PASS**, với tám bước đối chiếu và hai ảnh. Node.js là **v22.20.0**.

- [Báo cáo Edge cho UI-01](../evidence/selenium/2026-10-30T17-24-32-411Z-edge/report.html).
- [Dữ liệu kết quả Edge](../evidence/selenium/2026-10-30T17-24-32-411Z-edge/results.json).
- [JUnit XML của lần chạy Edge](../evidence/selenium/2026-10-30T17-24-32-411Z-edge/junit.xml).

Đây là một lần kiểm tra riêng được thực hiện trước lần Chrome đầy đủ nêu trên. **Chỉ UI-01 đã chạy trên Edge**; bảy ca còn lại chưa có kết quả Edge. Không dùng kết quả này để kết luận toàn bộ bộ kiểm thử đã đạt trên nhiều trình duyệt hoặc mọi thay đổi của bộ chạy cuối đã được chạy lại trên Edge.

## 6. Giới hạn và việc tiếp theo

Kết quả này là kiểm thử giao diện và đối chiếu dữ liệu trên MongoDB tạm; chưa đo độ bao phủ mã nguồn, tải hệ thống hoặc độ an toàn tổng thể.

Cần xử lý việc kết hợp bộ lọc, sửa đúng dòng size trong giỏ, giá tóm tắt thanh toán và size bị giảm kho. Điều khiển sắp xếp cần được thống nhất và triển khai nếu chấp nhận đặc tả đề xuất. Sau các thay đổi, chạy lại những ca FAIL và bộ hồi quy, giữ nguyên hồ sơ cũ để so sánh. Không sửa điều kiện mong đợi hoặc bỏ bước kiểm tra chỉ để chuyển các ca thành PASS.

Tài liệu này là biên bản riêng của bộ Selenium. Các kết quả chưa được tự động cập nhật vào báo cáo Word.
