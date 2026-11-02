const CategoryModels = require("../models/category-models");
const PopupService = require("../service/popup-service");
const ProductModels = require("../models/product-models");
const mongoose = require("mongoose");

class CategoryControllers {
  async getImage(req, res) {
    const category = await CategoryModels.findById(req.params.id);
    if (!category) return res.status(404).send("Product not found");
    res.set("Content-Type", category.image.imageType);
    res.send(category.image.imageData);
  }
  async index(req, res) {
    const nameTable = "Danh sách danh mục";
    const categories = await CategoryModels.find({});
    return res.render("categories/index", { nameTable, categories });
  }
  async create(req, res) {
    const nameForm = "Thêm danh mục mới";
    return res.render("categories/create", { nameForm });
  }
  async store(req, res) {
    const body = req.body;
    const inputName = body.name;
    const file = req.file;
    const inputImage = {
      imageName: file?.originalname,
      imageType: file?.mimetype,
      imageData: file?.buffer,
    };
    //--------------------------------
    if (!inputName || !file) {
      PopupService.message(req, res, "error", "Thiếu dữ liệu 😔");
      return res.redirect("/categories/create");
    }
    //Lưu data
    const newCategory = new CategoryModels({});
    newCategory.name = inputName;
    newCategory.image = inputImage;
    await newCategory.save();
    PopupService.message(req, res, "success", "Thêm thành công");
    return res.redirect("/categories/create");
  }
  async edit(req, res) {
    const id = req.params.id;
    const category = await CategoryModels.findById(id);
    const nameForm = "Chỉnh sửa danh mục";
    return res.render("categories/edit", { nameForm, category });
  }
  async update(req, res) {
    const body = req.body;
    const inputName = body.name;
    const id = body.id;
    const file = req.file;
    const inputImage = {
      imageName: file?.originalname,
      imageType: file?.mimetype,
      imageData: file?.buffer,
    };
    //--------------------------------
    if (!inputName) {
      PopupService.message(req, res, "error", "Thiếu dữ liệu 😔");
      return res.redirect("/categories/create");
    }
    //Lưu data
    const category = await CategoryModels.findById(id);
    category.name = inputName;
    //hasImage
    if (req.file) {
      category.image = inputImage;
    }
    await category.save();
    PopupService.message(req, res, "success", "Lưu thành công");
    return res.redirect("/categories/create");
  }
  async destroy(req, res) {
    const id = req.params.id;
    const category = await CategoryModels.findByIdAndDelete(id);
    PopupService.message(req, res, "success", "Xóa thành công");
    return res.redirect("/categories");
  }
  async assign(req, res) {
    const products = await ProductModels.aggregate([
      { $unwind: "$detail" }, // Tách từng phần tử trong mảng detail
      {
        $sort: {
          name: 1,
          "detail.price": 1, // Ưu tiên giá thấp nhất
        },
      },
      {
        $group: {
          _id: "$name",
          doc: { $first: "$$ROOT" }, // Lấy sản phẩm đầu tiên theo giá
        },
      },
      {
        $replaceRoot: { newRoot: "$doc" }, // Đưa document về gốc
      },
      { $sort: { createdAt: -1 } },
    ]);
    // const products = await ProductModels.find({});
    const categories = await CategoryModels.find({});
    const nameTable = "Phân loại sản phẩm vào danh mục";
    res.render("categories/assign", { nameTable, products, categories });
  }
  async assignHandler(req, res) {
    const body = req.body;
    const categoryID = body.categoryID;
    const productName = body.productName;
    //------------------------------

    const category = await CategoryModels.findById(categoryID);
    if (!category) {
      PopupService.message(req, res, "error", "Hãy lựa chọn danh mục!");
      return res.redirect("/categories/assign");
    }
    const products = await ProductModels.find({ name: productName });
    products.forEach((item) => {
      if (!category.products.some((p) => p.id == item.id)) {
        category.products.push(item);
      }
    });
    await category.save();

    PopupService.message(req, res, "success", "Success");
    return res.redirect("/categories/assign");
  }
  async show(req, res) {
    const categoryID = new mongoose.Types.ObjectId(req.params.id);
    const products = await CategoryModels.aggregate([
      // 1. Lọc theo category ID
      { $match: { _id: categoryID } },

      // 2. Tách từng product
      { $unwind: "$products" },

      // 3. Tách từng chi tiết (để lấy giá rẻ nhất)
      { $unwind: "$products.detail" },

      // 4. Sắp xếp theo tên + giá tăng dần
      { $sort: { "products.name": 1, "products.detail.price": 1 } },

      // 5. Gom nhóm theo tên sản phẩm, lấy bản rẻ nhất
      {
        $group: {
          _id: "$products.name",
          product: { $first: "$products" },
        },
      },

      // 6. Sắp xếp tiếp theo ngày tạo mới nhất
      { $sort: { "product.createdAt": -1 } },

      // 7. Trả về product ra ngoài document
      { $replaceRoot: { newRoot: "$product" } },
    ]);
    const nameTable = "Chi tiết danh mục";
    return res.render("categories/show", { nameTable, categoryID, products });
  }
  async unassign(req, res) {
    const body = req.body;
    const categoryID = body.categoryID;
    const productName = body.productName;
    //Gỡ
    await CategoryModels.updateOne(
      { _id: categoryID },
      {
        $pull: {
          products: { name: productName },
        },
      }
    );

    PopupService.message(req, res, "success", "Gỡ sản phẩm thành công");
    return res.redirect(`/categories/show/${categoryID}`);
  }
}

module.exports = new CategoryControllers();
