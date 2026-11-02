# Kiểm thử giao diện website bán quần áo bằng Selenium

Bộ kiểm thử gồm tám ca UI-01 đến UI-08, đi từ đăng nhập và chọn sản phẩm đến duyệt đơn, nhận và giao hàng. Các mã ca và mã yêu cầu được giữ theo báo cáo để dễ đối chiếu.

Đã chạy kiểm chứng trên Chrome ngày **31/10/2026**: **5 PASS, 3 FAIL, 0 ERROR**. Xem [biên bản kết quả và liên kết minh chứng](KET_QUA_SELENIUM.md) để biết chính xác các ca đạt và các sai lệch được ghi nhận.

Bộ này dùng **JavaScript trên Node.js và Selenium WebDriver**. Việc tổ chức tiếp nối bài thực hành Selenium trước: mỗi ca có điều kiện ban đầu, thao tác, các bước kiểm tra kết quả và ảnh minh chứng. Không cần chuyển website sang Java để kiểm thử giao diện.

## 1. Chuẩn bị lần đầu

Cần có Node.js, npm và ít nhất một trong hai trình duyệt **Chrome** hoặc **Microsoft Edge**. Chrome là lựa chọn mặc định. Nếu máy chỉ có Edge, dùng tùy chọn ở phần 3.

Mở PowerShell hoặc Terminal của VS Code, vào đúng thư mục dự án bên trong rồi cài thư viện:

```powershell
cd "D:\Kiểm thử\website-ban-quan-ao-main\website-ban-quan-ao-main"
npm.cmd install
npm.cmd install --prefix user
npm.cmd install --prefix admin
```

Các lệnh dùng `npm.cmd` để tránh trường hợp PowerShell chặn `npm.ps1`. Khi chạy lại trên máy đã cài đủ thư viện và không thay đổi các gói phụ thuộc, không cần cài lại mỗi lần.

Lần chạy đầu cần Internet để công cụ tải trình điều khiển trình duyệt phù hợp và chương trình MongoDB từ nguồn phân phối chính thức. Các thành phần đã tải có thể được lưu đệm để dùng lại. Nếu tải không thành công hoặc công cụ yêu cầu một phiên bản khác chưa có trong bộ nhớ đệm, cần khôi phục kết nối trước khi chạy tiếp.

## 2. Chạy tám ca với Chrome

Trong đúng thư mục ở trên, chạy một trong hai lệnh tương đương:

```powershell
npm.cmd test
```

```powershell
npm.cmd run test:selenium
```

Mặc định, Chrome chạy ở chế độ **headless**: vẫn thực hiện thao tác và chụp ảnh nhưng không mở cửa sổ trình duyệt để quan sát trực tiếp.

Muốn nhìn thấy Chrome thao tác:

```powershell
npm.cmd run test:selenium:headed
```

**Không cần mở Docker hoặc tự khởi động hai ứng dụng.** Bộ chạy tự tạo MongoDB tạm, tạo dữ liệu mẫu và mở ứng dụng khách hàng cùng ứng dụng quản trị trên các cổng riêng được chọn khi chạy. Cấu hình được truyền riêng cho hai tiến trình; không cần sửa các file `.env` và không dùng database bán hàng đang có của bạn.

Mỗi ca bắt đầu với một phiên trình duyệt mới và dữ liệu kiểm thử được chuẩn bị cho tình huống đó. Không phải tự đăng ký hoặc đăng nhập trước. Sau khi kết thúc, bộ chạy đóng trình duyệt, dừng các tiến trình ứng dụng do nó mở và dừng MongoDB tạm.

## 3. Chọn Edge hoặc chạy riêng một ca

Chạy toàn bộ bằng Edge:

```powershell
npm.cmd run test:selenium -- --browser=edge
```

Mở cửa sổ Edge để quan sát:

```powershell
npm.cmd run test:selenium:headed -- --browser=edge
```

Chỉ chạy ca đăng nhập UI-01 với Chrome:

```powershell
npm.cmd run test:selenium -- --case=UI-01
```

Kết hợp chọn trình duyệt, ca và chế độ hiển thị:

```powershell
npm.cmd run test:selenium:headed -- --browser=edge --case=UI-05
```

Dấu `--` sau tên lệnh npm dùng để chuyển các lựa chọn tiếp theo cho bộ chạy. Tên ca phải đúng dạng `UI-01` đến `UI-08`.

## 4. Tám ca và yêu cầu liên quan

| Mã ca | Công việc kiểm tra | Kết quả cần đối chiếu | Truy vết yêu cầu |
|---|---|---|---|
| UI-01 | Đăng nhập đúng tài khoản khách hàng | Mở được thông tin cá nhân của đúng khách hàng mẫu | REQ-AUTH-01, REQ-SEC-01 |
| UI-02 | Đăng nhập sai, sau đó đăng nhập đúng và đăng xuất | Lần sai không có quyền; sau đăng xuất không tiếp tục xem trang riêng tư | REQ-AUTH-01, REQ-SEC-01 |
| UI-03 | Tìm kiếm kết hợp danh mục và sắp xếp | Tên sản phẩm, danh mục và thứ tự giá đúng dữ liệu chuẩn bị | REQ-PROD-01 |
| UI-04 | Chọn size L và thêm vào giỏ | Lưu đúng màu, size, số lượng và giá của size L | REQ-PROD-01, REQ-CART-01 |
| UI-05 | Thay đổi số lượng rồi xóa một size trong giỏ | Chỉ dòng được chọn thay đổi; dòng size khác giữ nguyên; tổng tiền hàng đúng | REQ-CART-01 |
| UI-06 | Đặt hàng từ giỏ | Đúng đơn, khách hàng, size, số lượng, giá; tồn kho và giỏ sau đặt nhất quán | REQ-ORDER-01, REQ-CART-01, REQ-PROD-01 |
| UI-07 | Quản trị viên duyệt đơn | Đúng đơn từ chờ duyệt sang chờ giao; đơn khác giữ nguyên | REQ-ADMIN-01, REQ-ORDER-01 |
| UI-08 | Shipper nhận đơn rồi xác nhận giao | Đúng người nhận và trạng thái; lịch sử, ngày giao và tiền công đúng | REQ-SHIP-01, REQ-ORDER-01 |

Các ca dùng dữ liệu giả được tạo trong database tạm. Không so sánh kết quả với sản phẩm hoặc tài khoản của database bạn đang sử dụng để chạy website thông thường.

Một ca có thể có nhiều bước kiểm tra. Ví dụ, thông báo thêm giỏ thành công chưa đủ để ca UI-04 đạt: còn phải đối chiếu đúng sản phẩm, size, số lượng và giá. Tương tự, giao hàng phải được kiểm tra qua cả trạng thái đơn và tiền công, không chỉ nhìn nút giao hàng biến mất.

## 5. Xem kết quả và ảnh minh chứng

Mỗi lần chạy tạo một thư mục riêng theo mã lần chạy trong cây sau:

```text
tests/
  evidence/
    selenium/
      latest.json
      <run-id>/
        report.html
        results.json
        junit.xml
        screenshots/
        ... các tệp log ứng dụng
```

- `latest.json`: chỉ tới lần chạy mới nhất để tìm đúng thư mục kết quả.
- `report.html`: báo cáo dễ đọc bằng trình duyệt, gồm trạng thái ca và thông tin minh chứng.
- `results.json`: dữ liệu kết quả chi tiết để đối chiếu hoặc xử lý tiếp.
- `junit.xml`: kết quả theo định dạng JUnit XML để công cụ khác đọc; tên định dạng này không có nghĩa bộ chạy dùng Java.
- `screenshots`: ảnh được lưu ở các bước cần ghi nhận.
- Các tệp log ứng dụng: hỗ trợ tìm nguyên nhân khi khởi động hoặc thao tác gặp lỗi.

Để mở báo cáo từ **Explorer của VS Code**:

1. Mở lần lượt `tests` → `evidence` → `selenium`.
2. Mở `latest.json` để biết mã thư mục lần chạy mới nhất.
3. Tìm `report.html` trong thư mục đó.
4. Nhấn chuột phải vào `report.html`, chọn **Reveal in File Explorer** hoặc **Hiển thị trong File Explorer**.
5. Trong cửa sổ Windows vừa mở, nhấp đúp `report.html` để xem bằng trình duyệt.

Khi đọc một ca, đối chiếu kết quả mong đợi, kết quả thực tế và bước kiểm tra không thỏa mãn. Ảnh chỉ minh chứng trạng thái tại thời điểm chụp; một ảnh không tự chứng minh toàn bộ ca đã đạt. Các bước khẳng định kết quả trong bộ test mới xác định ca có thỏa các điều kiện được kiểm tra hay không.

## 6. Hiểu PASS, FAIL và ERROR

| Trạng thái | Ý nghĩa | Việc cần làm |
|---|---|---|
| PASS | Tất cả bước kiểm tra của ca đã thực hiện và thỏa điều kiện mong đợi | Giữ lại báo cáo và ảnh của đúng lần chạy |
| FAIL | Một hoặc nhiều kết quả quan sát không khớp điều kiện mong đợi của ca | Đọc bước thất bại, ảnh và dữ liệu; nếu là lỗi ứng dụng thì ghi nhận và giữ nguyên kết quả để sửa, sau đó chạy lại |
| ERROR | Không hoàn tất việc chạy do môi trường, trình duyệt, tải thành phần hoặc chuẩn bị dữ liệu gặp lỗi | Khắc phục điều kiện chạy rồi thử lại; không tự quy thành lỗi nghiệp vụ của website |

Nếu website đang có lỗi, `npm test` có thể kết thúc với ca FAIL. Không sửa kết quả mong đợi, bỏ bước kiểm tra hoặc đổi FAIL thành PASS chỉ để báo cáo toàn màu xanh. Cần giữ lần thất bại làm bằng chứng, sửa đúng nguyên nhân và có một lần chạy lại để xác nhận.

Chưa chạy không đồng nghĩa PASS. Chạy riêng một ca không chứng minh bảy ca còn lại đã đạt. Kết quả trên Chrome cũng không tự chứng minh kết quả trên Edge; mỗi trình duyệt cần một lần chạy được lưu riêng.

## 7. Khi không chạy được

- **Không tìm thấy trình duyệt:** kiểm tra Chrome đã được cài, hoặc chuyển sang `--browser=edge` nếu máy có Edge.
- **Không tải được trình điều khiển hoặc MongoDB tạm:** kiểm tra Internet, xem log và chạy lại sau khi điều kiện tải đã hoạt động.
- **Chỉ thấy trình duyệt chạy ẩn:** dùng `test:selenium:headed` để quan sát cửa sổ.
- **Báo không tìm thấy lệnh npm:** kiểm tra Node.js và npm đã được cài, rồi mở Terminal mới.
- **Một ca báo sai giá, size, giỏ hoặc trạng thái:** xem báo cáo của ca đó trước; đây có thể là vấn đề của ứng dụng cần được giữ lại để kiểm tra, không mặc nhiên là lỗi cài Selenium.

## 8. Bài thực hành tham khảo

[Repository Selenium của bài thực hành trước](https://github.com/tongDai-05/Selenium) là nguồn tham khảo về cách tổ chức phiên trình duyệt riêng, kiểm tra kết quả và lưu ảnh. Bộ kiểm thử trong dự án này dùng JavaScript để phù hợp môi trường Node.js của website, và kiểm tra trực tiếp website bán quần áo cục bộ.
