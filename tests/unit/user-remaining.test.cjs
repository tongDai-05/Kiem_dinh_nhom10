'use strict';

jest.mock('../../user/models/ProductModel', () => {
  const Product = jest.fn();
  for (const name of ['find', 'findById', 'findOne']) Product[name] = jest.fn();
  return Product;
});
jest.mock('../../user/models/CategoryModel', () => ({ find: jest.fn(), findOne: jest.fn(), findById: jest.fn() }));
jest.mock('../../user/models/UserModel', () => ({ find: jest.fn(), findById: jest.fn(), updateOne: jest.fn() }));

const Product = require('../../user/models/ProductModel');
const Category = require('../../user/models/CategoryModel');
const User = require('../../user/models/UserModel');
const page = require('../../user/controllers/pageController');
const product = require('../../user/controllers/productController');
const review = require('../../user/controllers/reviewController');
const auth = require('../../user/middlewares/authMiddleware');

function chain(value) {
  const promise = Promise.resolve(value);
  promise.sort = jest.fn(() => promise);
  promise.limit = jest.fn(() => promise);
  promise.lean = jest.fn(() => promise);
  return promise;
}

function response() {
  const res = {};
  for (const method of ['status', 'json', 'redirect', 'render', 'send', 'sendFile', 'contentType']) res[method] = jest.fn(() => res);
  return res;
}

function req(overrides = {}) {
  return {
    session: {}, query: {}, params: {}, body: {}, headers: { accept: 'text/html' }, xhr: false,
    flash: jest.fn(), ...overrides,
  };
}

const image = { imageType: 'image/png', imageData: Buffer.from('img') };
const baseProduct = (overrides = {}) => ({
  _id: 'p1', name: 'Ao Alpha', description: 'Mo ta', type: 'Den', image,
  detail: [{ size: 'M', price: 100, stock: 2 }], reviewProducts: [{ star: 4, userid: 'u1', commentAt: new Date('2026-01-01') }],
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  Product.find.mockImplementation(() => chain([]));
  Product.findById.mockResolvedValue(null);
  Product.findOne.mockResolvedValue(null);
  Category.find.mockImplementation(() => chain([]));
  Category.findOne.mockResolvedValue(null);
  Category.findById.mockResolvedValue(null);
  User.find.mockImplementation(() => chain([]));
  User.findById.mockResolvedValue(null);
  User.updateOne.mockResolvedValue({ acknowledged: true });
});

describe('Middleware xác thực User - mọi nhánh phản hồi', () => {
  test.each([
    ['isLoggedIn', { session: { user: { role: 'User' } } }],
    ['isLoggedOut', { session: {} }],
    ['isUser', { session: { user: { role: 'USER' } } }],
    ['isShipper', { session: { user: { role: 'shipper' } } }],
    ['isAdmin', { session: { user: { role: 'Admin' } } }],
  ])('%s cho phép đúng điều kiện', (method, input) => {
    const next = jest.fn();
    auth[method](req(input), response(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  test.each(['isLoggedIn', 'isUser', 'isShipper', 'isAdmin'])('%s từ chối JSON', method => {
    const res = response();
    auth[method](req({ headers: { accept: 'application/json' } }), res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(method === 'isLoggedIn' ? 401 : 403);
  });

  test('isLoggedOut từ chối JSON khi đã đăng nhập', () => {
    const res = response();
    auth.isLoggedOut(req({ session: { user: {} }, xhr: true }), res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('các nhánh HTML chuyển hướng đúng', () => {
    let res = response(); auth.isLoggedIn(req(), res, jest.fn()); expect(res.redirect).toHaveBeenCalledWith('/auth/login');
    res = response(); auth.isLoggedOut(req({ session: { user: {} } }), res, jest.fn()); expect(res.redirect).toHaveBeenCalledWith('/');
    res = response(); auth.isUser(req(), res, jest.fn()); expect(res.redirect).toHaveBeenCalledWith('/');
    res = response(); auth.isShipper(req(), res, jest.fn()); expect(res.redirect).toHaveBeenCalledWith('/auth/login');
    res = response(); auth.isShipper(req({ session: { user: { role: 'User' } } }), res, jest.fn()); expect(res.redirect).toHaveBeenCalledWith('/');
    res = response(); auth.isAdmin(req(), res, jest.fn()); expect(res.redirect).toHaveBeenCalledWith('/');
  });
});

describe('Page controller', () => {
  test('trang chủ gộp biến thể, giá, tồn kho, đánh giá và số giỏ', async () => {
    Product.find.mockImplementation(() => chain([
      baseProduct(), baseProduct({ _id: 'p2', type: 'Trang', image: null, detail: [{ price: 90, stock: 0 }], reviewProducts: [{ star: 5 }] }),
      baseProduct({ _id: 'p3', name: 'Quan', detail: [{ price: 0, stock: 0 }], reviewProducts: [] }),
    ]));
    Category.find.mockResolvedValue([{ name: 'Ao' }]);
    User.findById.mockResolvedValue({ wishlist: ['Ao Alpha'], carts: [{ orderNumber: 2 }, { orderNumber: 0 }] });
    const res = response();
    await page.getHomePage(req({ session: { user: { _id: 'u1' } } }), res, jest.fn());
    expect(res.render).toHaveBeenCalledWith('pages/index', expect.objectContaining({ wishlistCount: 1, cartCount: 2 }));
    const data = res.render.mock.calls[0][1].popularProducts;
    expect(data).toHaveLength(2);
    expect(data[0]).toEqual(expect.objectContaining({ price: 100, ratingCount: 2, isOutOfStock: false }));
    expect(data[1].isOutOfStock).toBe(true);
  });

  test('trang chủ chuyển lỗi cho middleware', async () => {
    Product.find.mockImplementation(() => ({ sort: jest.fn().mockRejectedValue(new Error('DB')) }));
    const next = jest.fn(); await page.getHomePage(req(), response(), next); expect(next).toHaveBeenCalledWith(expect.any(Error));
  });

  test('giỏ session hiển thị và xử lý lỗi', async () => {
    let res = response();
    await page.getCartPage(req({ session: { cart: { items: ['x'] }, user: { _id: 'u1' } }, user: { name: 'A' } }), res);
    expect(res.render).toHaveBeenCalledWith('cart', expect.objectContaining({ cart: { items: ['x'] } }));
    User.findById.mockRejectedValueOnce(new Error('DB'));
    res = response(); await page.getCartPage(req({ session: { user: { _id: 'u1' } } }), res); expect(res.status).toHaveBeenCalledWith(500);
  });

  test.each([['getContactPage', 'pages/contact'], ['getAboutPage', 'pages/about']])('%s hiển thị và xử lý số đếm', async (method, view) => {
    User.findById.mockResolvedValue({ wishlist: ['x'], carts: [{ orderNumber: 3 }] });
    const res = response(); await page[method](req({ session: { user: { _id: 'u1' } } }), res, jest.fn());
    expect(res.render).toHaveBeenCalledWith(view, expect.objectContaining({ wishlistCount: 1, cartCount: 3 }));
  });

  test('about chuyển lỗi cho middleware', async () => {
    Category.find.mockRejectedValueOnce(new Error('DB'));
    const next = jest.fn(); await page.getAboutPage(req(), response(), next); expect(next).toHaveBeenCalled();
  });

  test('contact chuyển lỗi, elements chuyển trang', async () => {
    Category.find.mockRejectedValueOnce(new Error('DB'));
    const next = jest.fn(); await page.getContactPage(req(), response(), next); expect(next).toHaveBeenCalled();
    const res = response(); await page.getElementsPage(req(), res); expect(res.redirect).toHaveBeenCalledWith('/');
  });

  test('đăng ký nhận tin có và thiếu email', async () => {
    let res = response(); await page.handleSubscription(req({ body: { email: 'a@test.local' } }), res, jest.fn()); expect(res.status).toHaveBeenCalledWith(200);
    res = response(); await page.handleSubscription(req(), res, jest.fn()); expect(res.status).toHaveBeenCalledWith(400);
  });

  test('đăng ký nhận tin chuyển lỗi phản hồi cho middleware', async () => {
    const res = response(); res.status.mockImplementation(() => { throw new Error('send'); });
    const next = jest.fn(); await page.handleSubscription(req({ body: { email: 'a@x' } }), res, next); expect(next).toHaveBeenCalled();
  });

  test('wishlist chặn guest, giữ thứ tự và chuyển lỗi', async () => {
    let res = response(); await page.getWishlistPage(req(), res, jest.fn()); expect(res.redirect).toHaveBeenCalledWith('/auth/login');
    User.findById.mockResolvedValue({ wishlist: ['B', 'A'], carts: [{ orderNumber: 2 }] });
    Product.find.mockResolvedValue([{ name: 'A' }, { name: 'B' }]);
    res = response(); await page.getWishlistPage(req({ session: { user: { _id: 'u1' } } }), res, jest.fn());
    expect(res.render.mock.calls[0][1].products.map(item => item.name)).toEqual(['B', 'A']);
    User.findById.mockRejectedValueOnce(new Error('DB'));
    const next = jest.fn(); await page.getWishlistPage(req({ session: { user: { _id: 'u1' } } }), response(), next); expect(next).toHaveBeenCalled();
  });
});

describe('Product controller', () => {
  test.each(['price_asc', 'price_desc', 'name_asc', 'name_desc', 'latest'])('danh sách xử lý sắp xếp %s', async sort => {
    Product.find.mockImplementation(() => chain([baseProduct()]));
    Category.find.mockImplementation(() => chain([]));
    const res = response(); await product.getProductListPage(req({ query: { sort } }), res, jest.fn());
    expect(res.render).toHaveBeenCalledWith('pages/product_list', expect.objectContaining({ products: expect.any(Array) }));
  });

  test('danh sách kết hợp category, keyword, đánh giá và user', async () => {
    Category.findOne.mockResolvedValue({ _id: 'c1', name: 'Ao', products: [{ name: 'Ao Alpha' }] });
    Category.find.mockImplementation(() => chain([{ name: 'Ao' }]));
    Product.find.mockImplementation(() => chain([baseProduct(), baseProduct({ type: 'Trang', image: null, reviewProducts: [] })]));
    User.findById.mockResolvedValue({ wishlist: ['Ao Alpha'], carts: [{ orderNumber: 1 }] });
    const res = response();
    await product.getProductListPage(req({ query: { category: 'Ao', keyword: 'Alpha' }, session: { user: { _id: 'u1' } } }), res, jest.fn());
    expect(res.render).toHaveBeenCalledWith('pages/product_list', expect.objectContaining({ currentCategory: 'Ao', wishlistCount: 1 }));
  });

  test('danh sách giữ giá dương nhưng đánh dấu hết kho', async () => {
    Product.find.mockImplementation(() => chain([baseProduct({ detail: [{ price: 90, stock: 0 }] })]));
    Category.find.mockImplementation(() => chain([]));
    const res = response(); await product.getProductListPage(req(), res, jest.fn());
    expect(res.render.mock.calls[0][1].products[0]).toEqual(expect.objectContaining({ price: 90, isOutOfStock: true }));
  });

  test('danh sách chuyển lỗi', async () => {
    Product.find.mockImplementation(() => ({ sort: jest.fn().mockRejectedValue(new Error('DB')) }));
    const next = jest.fn(); await product.getProductListPage(req(), response(), next); expect(next).toHaveBeenCalled();
  });

  test('chi tiết báo 404 và hiển thị đầy đủ biến thể', async () => {
    let next = jest.fn(); await product.getProductDetailPage(req({ params: { name: 'X' } }), response(), next); expect(next.mock.calls[0][0].status).toBe(404);
    Product.find.mockResolvedValue([baseProduct(), baseProduct({ _id: 'p2', type: 'Trang', image: null, detail: [{ price: 0, stock: 0 }], reviewProducts: [] })]);
    User.findById.mockResolvedValue({ wishlist: ['Ao Alpha'], carts: [{ orderNumber: 2 }] });
    const res = response();
    await product.getProductDetailPage(req({ params: { name: 'Ao Alpha' }, session: { user: { _id: 'u1' } } }), res, jest.fn());
    expect(res.render.mock.calls[0][1].product).toEqual(expect.objectContaining({ ratingCount: 1, isOutOfStock: false }));
  });

  test('chi tiết chuyển lỗi truy vấn cho middleware', async () => {
    Product.find.mockRejectedValueOnce(new Error('DB'));
    const next = jest.fn(); await product.getProductDetailPage(req({ params: { name: 'A' } }), response(), next); expect(next).toHaveBeenCalled();
  });

  test('ảnh sản phẩm: placeholder, ảnh chính, ảnh cũ và lỗi', async () => {
    let res = response(); await product.getProductImage(req({ params: { id: 'x' } }), res, jest.fn()); expect(res.status).toHaveBeenCalledWith(404);
    Product.findById.mockResolvedValueOnce({ image }); res = response(); await product.getProductImage(req({ params: { id: 'x' } }), res, jest.fn()); expect(res.send).toHaveBeenCalledWith(image.imageData);
    Product.findById.mockResolvedValueOnce({ images: [image] }); res = response(); await product.getProductImage(req({ params: { id: 'x' } }), res, jest.fn()); expect(res.contentType).toHaveBeenCalledWith('image/png');
    Product.findById.mockRejectedValueOnce(new Error('DB')); const next = jest.fn(); await product.getProductImage(req(), response(), next); expect(next).toHaveBeenCalled();
  });

  test('tìm kiếm có từ khóa, rỗng, user và lỗi', async () => {
    const found = baseProduct({ toObject() { return { ...this, toObject: undefined }; } });
    Product.find.mockImplementation(() => chain([found])); Category.find.mockImplementation(() => chain([]));
    User.findById.mockResolvedValue({ wishlist: [], carts: [{ orderNumber: 2 }] });
    let res = response(); await product.searchProductsPage(req({ query: { query: 'Ao' }, session: { user: { _id: 'u1' } } }), res, jest.fn()); expect(res.render.mock.calls[0][1].products[0].price).toBe(100);
    res = response(); await product.searchProductsPage(req({ query: { query: '' } }), res, jest.fn()); expect(res.render.mock.calls[0][1].title).toContain('Vui lòng');
    Category.find.mockImplementation(() => ({ sort: jest.fn().mockRejectedValue(new Error('DB')) })); const next = jest.fn(); await product.searchProductsPage(req({ query: { query: '' } }), response(), next); expect(next).toHaveBeenCalled();
  });

  test('wishlist bao phủ guest, thiếu tên, user thiếu, thêm, xóa và lỗi', async () => {
    let res = response(); await product.toggleWishlist(req(), res); expect(res.status).toHaveBeenCalledWith(401);
    res = response(); await product.toggleWishlist(req({ session: { user: { _id: 'u1' } } }), res); expect(res.status).toHaveBeenCalledWith(400);
    User.findById.mockResolvedValueOnce(null); res = response(); await product.toggleWishlist(req({ session: { user: { _id: 'u1' } }, body: { productName: 'A' } }), res); expect(res.status).toHaveBeenCalledWith(404);
    User.findById.mockResolvedValueOnce({ wishlist: [] }).mockResolvedValueOnce({ wishlist: ['A'] }); res = response(); await product.toggleWishlist(req({ session: { user: { _id: 'u1' } }, body: { productName: 'A' } }), res); expect(res.json).toHaveBeenCalledWith({ success: true, action: 'added', wishlistCount: 1 });
    User.findById.mockResolvedValueOnce({ wishlist: ['A'] }).mockResolvedValueOnce({ wishlist: [] }); res = response(); await product.toggleWishlist(req({ session: { user: { _id: 'u1' } }, body: { productName: 'A' } }), res); expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ action: 'removed' }));
    User.findById.mockRejectedValueOnce(new Error('DB')); res = response(); await product.toggleWishlist(req({ session: { user: { _id: 'u1' } }, body: { productName: 'A' } }), res); expect(res.status).toHaveBeenCalledWith(500);
  });

  test('category báo 404, fallback và render gộp', async () => {
    let res = response(); await product.getCategoryProductsPage(req({ params: { id: 'c1' } }), res, jest.fn()); expect(res.status).toHaveBeenCalledWith(404);
    const category = { _id: 'c1', name: 'Ao', products: [baseProduct()] };
    Category.findById.mockResolvedValue(category); Product.find.mockResolvedValue([]); Category.find.mockResolvedValue([category]);
    res = response(); await product.getCategoryProductsPage(req({ params: { id: 'c1' } }), res, jest.fn()); expect(res.render.mock.calls[0][1].products).toHaveLength(1);
    Product.find.mockRejectedValueOnce(new Error('DB')); const next = jest.fn(); await product.getCategoryProductsPage(req({ params: { id: 'c1' } }), response(), next); expect(next).toHaveBeenCalled();
  });

  test('category bao phủ giá còn hiệu lực khi hết kho và số đếm user', async () => {
    const category = { _id: 'c1', name: 'Ao', products: [] };
    Category.findById.mockResolvedValue(category); Category.find.mockResolvedValue([category]);
    Product.find.mockResolvedValue([baseProduct({ detail: [{ price: 90, stock: 0 }] })]);
    User.findById.mockResolvedValue({ wishlist: ['Ao Alpha'], carts: [{ orderNumber: 2 }] });
    const res = response();
    await product.getCategoryProductsPage(req({ params: { id: 'c1' }, session: { user: { _id: 'u1' } } }), res, jest.fn());
    expect(res.render.mock.calls[0][1]).toEqual(expect.objectContaining({ wishlistCount: 1, cartCount: 2 }));
    expect(res.render.mock.calls[0][1].products[0]).toEqual(expect.objectContaining({ price: 90, isOutOfStock: true }));
  });

  test('gợi ý bỏ từ ngắn và trả tối đa kết quả tìm thấy', async () => {
    let res = response(); await product.suggestProducts(req({ query: { q: 'a' } }), res); expect(res.json).toHaveBeenCalledWith([]);
    Product.find.mockImplementation(() => chain([baseProduct(), baseProduct({ name: 'B', image: null })]));
    res = response(); await product.suggestProducts(req({ query: { q: 'ao' } }), res); expect(res.json.mock.calls[0][0]).toHaveLength(2);
  });
});

describe('Review controller', () => {
  test('đọc review theo id, lọc type, gắn tên và sắp xếp', async () => {
    Product.findById.mockReturnValue(chain(baseProduct({ reviewProducts: [
      { star: 3, userid: { toString: () => 'u1' }, commentAt: new Date('2025-01-01') },
      { star: 5, userid: null, commentAt: new Date('2026-01-01') },
    ] })));
    User.find.mockReturnValue(chain([{ _id: { toString: () => 'u1' }, name: 'Khach A' }]));
    const res = response(); await review.getReviews(req({ params: { productId: 'p1' }, query: { type: 'Den' } }), res);
    expect(res.json.mock.calls[0][0].reviews[1].username).toBe('Khach A');
  });

  test('đọc review theo tên và xử lý lỗi', async () => {
    Product.find.mockReturnValue(chain([baseProduct()])); let res = response(); await review.getReviews(req({ params: { productName: 'Ao' } }), res); expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    Product.find.mockImplementationOnce(() => ({ lean: jest.fn().mockRejectedValue(new Error('DB')) })); res = response(); await review.getReviews(req({ params: { productName: 'Ao' } }), res); expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
  });

  test('thêm review bao phủ xác thực, dữ liệu, không tìm thấy, id, name và lỗi', async () => {
    let res = response(); await review.addReview(req(), res); expect(res.status).toHaveBeenCalledWith(401);
    res = response(); await review.addReview(req({ session: { user: { _id: 'u1' } } }), res); expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
    Product.findOne.mockResolvedValueOnce(null); res = response(); await review.addReview(req({ session: { user: { _id: 'u1' } }, params: { productId: 'p1' }, body: { type: 'Den', star: 5, comment: 'Tot' } }), res); expect(res.json.mock.calls[0][0].message).toContain('Không tìm thấy');
    const stored = { reviewProducts: null, save: jest.fn() }; Product.findOne.mockResolvedValueOnce(stored); res = response(); await review.addReview(req({ session: { user: { _id: 'u1' } }, params: { productId: 'p1' }, body: { type: 'Den', star: '5', comment: 'Tot' } }), res); expect(stored.save).toHaveBeenCalled();
    Product.findOne.mockResolvedValueOnce({ reviewProducts: [], save: jest.fn() }); res = response(); await review.addReview(req({ session: { user: { _id: 'u1' } }, params: { productName: 'Ao' }, body: { type: 'Den', star: 4, comment: 'OK' } }), res); expect(res.json).toHaveBeenCalledWith({ success: true });
    Product.findOne.mockRejectedValueOnce(new Error('DB')); res = response(); await review.addReview(req({ session: { user: { _id: 'u1' } }, params: { productId: 'p1' }, body: { type: 'Den', star: 5, comment: 'X' } }), res); expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
  });
});
