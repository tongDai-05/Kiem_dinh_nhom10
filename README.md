# WEBSITE BÁN QUẦN ÁO TRỰC TUYẾN

Đây là mã nguồn Website bán quần áo trực tuyến được xây dựng bằng Node.js, Express, EJS và MongoDB. Hệ thống gồm ba nhóm người dùng: khách hàng, quản trị viên và nhân viên giao hàng.

## Cấu trúc chính

```text
Kiem_dinh_nhom10/
├── admin/                                  # Ứng dụng quản trị
├── user/                                   # Ứng dụng khách hàng và giao hàng
├── tests/                                  # Mã nguồn các bộ kiểm thử
├── minh-chung/                             # Ảnh minh chứng kiểm thử
├── package.json                            # Lệnh chạy ở cấp dự án
├── docker-compose.yml                      # Cấu hình MongoDB bằng Docker
├── products.json                           # Dữ liệu sản phẩm mẫu
├── KE_HOACH_KIEM_THU.md                    # Kế hoạch và kết quả kiểm thử
└── HUONG_DAN_CHAY_TOAN_BO_KIEM_THU.md      # Hướng dẫn chạy kiểm thử
```

## Cài đặt

Yêu cầu: Node.js, npm và MongoDB hoặc Docker Desktop.

```powershell
git clone https://github.com/tongDai-05/Kiem_dinh_nhom10.git
cd Kiem_dinh_nhom10

Copy-Item user/.env.example user/.env
Copy-Item admin/.env.example admin/.env

npm.cmd install
npm.cmd install --prefix user
npm.cmd install --prefix admin
```

## Khởi động dự án

Khởi động MongoDB:

```powershell
docker-compose up -d
```

Chạy ứng dụng khách hàng và nhân viên giao hàng:

```powershell
npm.cmd run user
```

Chạy ứng dụng quản trị trong một Terminal khác:

```powershell
npm.cmd run admin
```

- Ứng dụng khách hàng và nhân viên giao hàng: `http://localhost:3000`.
- Ứng dụng quản trị: `http://localhost:3001`.

## Tài liệu kiểm thử

- [Kế hoạch, kết quả và minh chứng kiểm thử](KE_HOACH_KIEM_THU.md)
- [Hướng dẫn chạy toàn bộ kiểm thử](HUONG_DAN_CHAY_TOAN_BO_KIEM_THU.md)
