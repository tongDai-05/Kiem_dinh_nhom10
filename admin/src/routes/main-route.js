const authenticateRoutes = require("./authenticate-routes");
const userRoutes = require("./user-routes");
const productRoutes = require("./product-routes");
const dashboardRoutes = require("./dashboard-route");
const categoryRoutes = require("./category-routes");
const orderRoutes = require("./oder-route");

function mainRoutes(app) {
  app.use(authenticateRoutes);
  app.use("/users", userRoutes);
  app.use("/products", productRoutes);
  app.use("/dashboard", dashboardRoutes);
  app.use("/categories", categoryRoutes);
  app.use("/orders", orderRoutes);
}

module.exports = mainRoutes;