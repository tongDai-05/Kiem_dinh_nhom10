const SessionService = require("../service/session/session-service");
const PopupService = require("../service/popup-service");
const UserModels = require("../models/user-models");
const bcrypt = require("bcrypt");

class AuthenticateControllers {
  //showLoginForm
  showLoginForm(req, res) {
    res.render("authenticate/login");
  }
  //handleLogin
  async handleLogin(req, res) {
    try {
      const body = req.body;
      const inputAccount = body?.account;
      const inputPassword = body?.password;

      const user = await UserModels.findOne({ account: inputAccount });
      //User does not exist
      if (!user) {
        PopupService.message(req, res, "error", "Tài Khoản Không Tồn Tại 😔");
        return res.redirect("/login");
      }
      //Incorrect password
      const match = await bcrypt.compare(inputPassword, user.password);
      if (!match) {
        PopupService.message(req, res, "error", "Sai mật khẩu 😔");
        return res.redirect("/login");
      }
      // Mật khẩu đúng → đăng nhập thành công
      await SessionService.setSession(req, res);
      PopupService.message(req, res, "success", "Đăng Nhập Thành Công 😊");
      //
      return res.redirect("/dashboard");
    } catch (error) {
      //log và thông báo về lỗi
      console.error("Error in handleLogin:", error);
      return res.redirect("/login");
    }
  }
  //handleLogout
  async handleLogout(req, res) {
    await SessionService.clearSession(req, res);
    PopupService.message(req, res, "success", "Đã đăng xuất!");
    res.redirect("/");
  }
}

module.exports = new AuthenticateControllers();
