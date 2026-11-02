# Kiểm thử đơn vị bằng Jest

Chạy `npm run test:unit` để kiểm tra các quy tắc giỏ hàng, hủy đơn và tiền công shipper.
Chạy `npm run test:coverage` để tạo báo cáo độ phủ tại `tests/evidence/unit/coverage/index.html`.

Các ca dùng `test.failing` là yêu cầu đúng nhưng mã hiện tại chưa đáp ứng. Jest chỉ coi lượt chạy thành công khi các ca này thực sự thất bại như dự kiến; vì vậy chúng vừa giữ được bằng chứng lỗi vừa không làm mất tín hiệu của những lỗi mới ngoài dự kiến.
