const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const connectDB = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/webbtl');
        console.log('MongoDB Connected to User App...');
    } catch (err) {
        console.error('❌ Lỗi kết nối MongoDB (User App):', err.message);
        console.error('💡 Hướng dẫn khắc phục: Hãy đảm bảo Docker Desktop đang bật và MongoDB đã chạy.');
        console.error('   Bạn có thể chạy lệnh: docker start mongo1 (hoặc từ thư mục gốc: docker-compose up -d mongo1)');
        process.exit(1);
    }
};

module.exports = connectDB;