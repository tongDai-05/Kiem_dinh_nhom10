const config = require("../config/config");
const UserModels = require("../models/user-models");
const bcrypt = require("bcrypt");

class AdminService {
  async generate() {
    const adminAccount = config.admin.account;
    const adminPassword = config.admin.password;

    const admin = await UserModels.findOne({ account: adminAccount });
    if (admin && admin.role != "Admin") {
      admin.role = "Admin";
      await admin.save();
      return;
    }
    if (admin) {
      return;
    }

    const hashedPassword = await bcrypt.hash(adminPassword, 10);
    const user = new UserModels({
      account: adminAccount,
      password: hashedPassword,
      role: "Admin",
      name: "Bùi Đăng Vũ",
      phone: "0377787252",
      gmail: "23010042@st.phenikaa-uni.edu.vn",
      address: "Hà Nội",
    });
    await user.save();
  }
}

module.exports = new AdminService();
