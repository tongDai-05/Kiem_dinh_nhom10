# CHANGELOG - retest-final

## 01/11/2026 - Tái kiểm thử cuối

### Mã kiểm thử

- Mở rộng BB-02 đủ biên tên đăng nhập 2/3/4, mật khẩu 5/6/7, email sai, xác nhận lệch và họ tên rỗng/dấu cách.
- Mở rộng BB-23 với đơn shipping, cancelled, hủy lặp và đối chiếu kho/tiền công.
- Mở rộng BB-26 với thiếu trường, trùng tên/màu, giá/tồn âm, tồn lẻ, giá/tồn 0 và dữ liệu chữ.
- Mở rộng BB-29 với tạo tài khoản Shipper, trùng tài khoản, xác nhận mật khẩu sai và kiểm tra mật khẩu băm.
- Mở rộng BB-30 với duyệt lặp, duyệt sai trạng thái và ma trận hủy pending/shipping/delivered/cancelled.
- Mở rộng BB-33 với shipping/cancelled và đủ phiên guest/User/Shipper.
- Mở rộng BB-35 bằng hai yêu cầu giao đồng thời thật trong cùng phiên trình duyệt.
- Mở rộng BB-36 với nhân viên thứ hai hủy sai chủ; sửa bộ đọc JSON để tương thích trình xem JSON của Firefox.
- Thêm công cụ chỉ đọc để kiểm kê kết quả, sao chép minh chứng, kết xuất DB tạm và chụp báo cáo HTML.

### Kết quả

- Tái kiểm thử 8 ca BB trên Chrome 156 và Firefox 159; chạy lại ADV-07.
- BB-02 và BB-26: Chưa đạt. BB-02 tạo BUG-13; BB-26 tái hiện BUG-11.
- BB-23, BB-29, BB-30, BB-33, BB-35, BB-36 và ADV-07: Đạt.
- Jest cuối: 134/134; 100% dòng, 99,92% câu lệnh, 99,44% hàm, 82,62% nhánh.
- Newman bổ sung hình tổng hợp: 24 ca, 15 Đạt, 9 Chưa đạt, 0 lỗi thực thi.
- Tổng sau chuẩn hóa: 64/94 Đạt, 30/94 Chưa đạt.

### Phạm vi thay đổi

Không sửa mã nguồn website trong `admin/` hoặc `user/`. Chỉ thay đổi mã kiểm thử, công cụ kết xuất, dữ liệu tạm và tệp báo cáo/minh chứng.

### Giới hạn công cụ

- Graphviz 16.1.0 và LibreOffice không cài được trong phiên; chi tiết ghi trong `evidence/00_moi_truong.md`.
- Không có mongosh/Compass; ảnh collections được kết xuất trực tiếp từ MongoDB tạm bằng MongoDB Node.js client và ghi rõ trên minh chứng.

### Hoàn thiện báo cáo v2

- Tạo `Báo cáo/kiem_dinh_full_v2.docx` ở thư mục cha, giữ nguyên `Kiểm định full.docx` (SHA-256 bản gốc: `31a5406ec4a922705f4c8311055e9825a707a110d14e518f4479aadfafdbbccc`).
- Chuẩn hóa 94 ca về hai trạng thái, bổ sung nguyên nhân loại a/b cho đủ 30 ca Chưa đạt và cập nhật các bảng tổng hợp.
- Bổ sung BUG-13 đến BUG-17 để mọi sai lệch sản phẩm đều có mã theo dõi; BUG-13 phát sinh từ lượt tái kiểm thử BB-02, BUG-14 đến BUG-17 chuẩn hóa các phát hiện ADV cũ chưa có mã riêng.
- Thêm mục lục tự động, Heading 1-3, đánh số hình/bảng liên tục, rút nội dung còn 29.993 từ sau khi Word cập nhật mục lục và chèn phần tái kiểm thử cuối.
- Tách 76 ảnh minh chứng cũ từ DOCX sang `evidence/images/`; bổ sung script kiểm tra tự động và báo cáo `evidence/report-validation.*`.
- Không sửa mã nguồn website trong quá trình biên tập báo cáo.
