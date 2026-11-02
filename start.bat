@echo off
chcp 65001 >nul
echo ===================================================
echo     ĐANG KHỞI ĐỘNG HỆ THỐNG THƯƠNG MẠI ĐIỆN TỬ
echo ===================================================

echo [1/3] Đang khởi động MongoDB Container...
docker start mongo >nul 2>&1
if %errorlevel% neq 0 (
    echo Container mongo chua ton tai, dang tao moi...
    docker run -d --name mongo -p 27017:27017 mongo:latest
)

echo [2/3] Đang mở User App (Port 3000)...
start "User App (Port 3000)" cmd /k "cd user && npm start"

echo [3/3] Đang mở Admin App (Port 3001)...
start "Admin App (Port 3001)" cmd /k "cd admin && npm start"

echo.
echo ===================================================
echo   HỆ THỐNG ĐÃ SẴN SÀNG!
echo   - User App:  http://localhost:3000
echo   - Admin App: http://localhost:3001 (admin / admin)
echo ===================================================
pause
