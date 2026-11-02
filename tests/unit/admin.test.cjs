'use strict';

jest.mock('../../admin/src/models/category-models', () => {
  const Model = jest.fn(() => ({ save: jest.fn().mockResolvedValue(undefined) }));
  for (const name of ['findById', 'find', 'findByIdAndDelete', 'aggregate', 'updateOne']) Model[name] = jest.fn();
  return Model;
});
jest.mock('../../admin/src/models/product-models', () => {
  const Model = jest.fn(() => ({ detail: [], save: jest.fn().mockResolvedValue(undefined) }));
  for (const name of ['findById', 'find', 'findOne', 'aggregate', 'deleteMany']) Model[name] = jest.fn();
  return Model;
});
jest.mock('../../admin/src/models/order-models', () => ({ find: jest.fn(), findById: jest.fn(), aggregate: jest.fn() }));
jest.mock('../../admin/src/models/user-models', () => {
  const Model = jest.fn(() => ({ save: jest.fn().mockResolvedValue(undefined) }));
  for (const name of ['find', 'findOne', 'findById', 'findByIdAndDelete']) Model[name] = jest.fn();
  return Model;
});
jest.mock('../../admin/src/service/session/admin-session-models', () => {
  const Model = jest.fn(() => ({ save: jest.fn().mockResolvedValue(undefined) }));
  Model.findOne = jest.fn();
  Model.findOneAndDelete = jest.fn();
  return Model;
});
jest.mock('../../admin/src/config/config', () => ({ admin: { account: 'admin-test', password: 'Admin123!' } }));
jest.mock('../../admin/node_modules/bcrypt', () => ({ compare: jest.fn(), hash: jest.fn() }));

const Category = require('../../admin/src/models/category-models');
const Product = require('../../admin/src/models/product-models');
const Order = require('../../admin/src/models/order-models');
const User = require('../../admin/src/models/user-models');
const AdminSession = require('../../admin/src/service/session/admin-session-models');
const bcrypt = require('../../admin/node_modules/bcrypt');
const popup = require('../../admin/src/service/popup-service');
const sessionService = require('../../admin/src/service/session/session-service');
const authenticationService = require('../../admin/src/service/authentication-service');
const adminService = require('../../admin/src/service/admin-service');
const authenticate = require('../../admin/src/controllers/authenticate-controllers');
const categories = require('../../admin/src/controllers/category-controllers');
const dashboard = require('../../admin/src/controllers/dashboard-controllers');
const orders = require('../../admin/src/controllers/order-controllers');
const products = require('../../admin/src/controllers/product-controllers');
const users = require('../../admin/src/controllers/user-controllers');
const authenticateMiddleware = require('../../admin/src/middleware/authenticate-middleware');
const authorizationMiddleware = require('../../admin/src/middleware/authorization-middleware');

function chain(value) {
  const promise = Promise.resolve(value);
  promise.sort = jest.fn(() => promise);
  return promise;
}

function response() {
  const res = {};
  for (const method of ['status', 'json', 'redirect', 'render', 'send', 'set', 'cookie', 'clearCookie', 'end']) res[method] = jest.fn(() => res);
  return res;
}

function req(overrides = {}) { return { body: {}, params: {}, cookies: {}, file: null, ...overrides }; }
const file = { originalname: 'a.png', mimetype: 'image/png', buffer: Buffer.from('img') };

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
  Category.find.mockResolvedValue([]); Category.findById.mockResolvedValue(null); Category.aggregate.mockResolvedValue([]); Category.updateOne.mockResolvedValue({});
  Product.find.mockResolvedValue([]); Product.findById.mockResolvedValue(null); Product.findOne.mockResolvedValue(null); Product.aggregate.mockResolvedValue([]); Product.deleteMany.mockResolvedValue({});
  Order.find.mockImplementation(() => chain([])); Order.findById.mockResolvedValue(null); Order.aggregate.mockResolvedValue([]);
  User.find.mockResolvedValue([]); User.findOne.mockResolvedValue(null); User.findById.mockResolvedValue(null); User.findByIdAndDelete.mockResolvedValue(null);
  AdminSession.findOne.mockResolvedValue(null); AdminSession.findOneAndDelete.mockResolvedValue(null);
  bcrypt.compare.mockResolvedValue(true); bcrypt.hash.mockResolvedValue('hashed');
});

describe('Dịch vụ và middleware Admin', () => {
  test('PopupService ghi đủ hai cookie có thuộc tính an toàn', () => {
    const res = response(); popup.message(req(), res, 'success', 'OK');
    expect(res.cookie).toHaveBeenCalledTimes(2);
    expect(res.cookie).toHaveBeenCalledWith('icon', 'success', expect.objectContaining({ sameSite: 'strict' }));
  });

  test('AuthenticationService bao phủ thiếu cookie, không thấy session và đúng quyền', async () => {
    expect(await authenticationService.hasAuthenticate(req(), response())).toBe(0);
    expect(await authenticationService.isAdmin(req(), response())).toBe(0);
    AdminSession.findOne.mockResolvedValueOnce(null);
    expect(await authenticationService.hasAuthenticate(req({ cookies: { AdminSession: 'x' } }), response())).toBe(0);
    AdminSession.findOne.mockResolvedValueOnce({ role: 'User' });
    expect(await authenticationService.isAdmin(req({ cookies: { AdminSession: 'x' } }), response())).toBe(0);
    AdminSession.findOne.mockResolvedValueOnce({ role: 'Admin' });
    expect(await authenticationService.isAdmin(req({ cookies: { AdminSession: 'x' } }), response())).toBe(1);
    AdminSession.findOne.mockResolvedValueOnce({});
    expect(await authenticationService.hasAuthenticate(req({ cookies: { AdminSession: 'x' } }), response())).toBe(1);
  });

  test('hai middleware cho phép và từ chối đúng', async () => {
    const hasSpy = jest.spyOn(authenticationService, 'hasAuthenticate').mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    let next = jest.fn(), res = response(); await authenticateMiddleware(req(), res, next); expect(next).toHaveBeenCalled();
    next = jest.fn(); res = response(); await authenticateMiddleware(req(), res, next); expect(res.redirect).toHaveBeenCalledWith('/login');
    hasSpy.mockRestore();
    const adminSpy = jest.spyOn(authenticationService, 'isAdmin').mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    next = jest.fn(); res = response(); await authorizationMiddleware(req(), res, next); expect(next).toHaveBeenCalled();
    next = jest.fn(); res = response(); await authorizationMiddleware(req(), res, next); expect(res.redirect).toHaveBeenCalledWith('/login');
    adminSpy.mockRestore();
  });

  test('SessionService tạo, xóa, bỏ qua cookie rỗng và xóa theo account', async () => {
    User.findOne.mockResolvedValue({ account: 'admin', name: 'A', role: 'Admin' });
    const session = { save: jest.fn() }; AdminSession.mockImplementationOnce(() => session);
    let res = response(); await sessionService.setSession(req({ body: { account: 'admin' } }), res); expect(session.save).toHaveBeenCalled(); expect(res.cookie).toHaveBeenCalledWith('AdminSession', expect.any(String), expect.any(Object));
    await sessionService.clearSession(req(), res); expect(res.clearCookie).not.toHaveBeenCalled();
    res = response(); await sessionService.clearSession(req({ cookies: { AdminSession: 's1' } }), res); expect(AdminSession.findOneAndDelete).toHaveBeenCalledWith({ sessionID: 's1' });
    await sessionService.deleteOneSession('admin'); expect(AdminSession.findOneAndDelete).toHaveBeenCalledWith({ account: 'admin' });
  });

  test('SessionService giữ lỗi nội bộ trong set/clear để ứng dụng không sập', async () => {
    User.findOne.mockRejectedValueOnce(new Error('DB'));
    await expect(sessionService.setSession(req({ body: { account: 'a' } }), response())).resolves.toBeUndefined();
    AdminSession.findOneAndDelete.mockRejectedValueOnce(new Error('DB'));
    await expect(sessionService.clearSession(req({ cookies: { AdminSession: 's' } }), response())).resolves.toBeUndefined();
  });

  test('AdminService nâng quyền, bỏ qua admin sẵn có và tạo mới', async () => {
    const existing = { role: 'User', save: jest.fn() }; User.findOne.mockResolvedValueOnce(existing); await adminService.generate(); expect(existing.role).toBe('Admin');
    User.findOne.mockResolvedValueOnce({ role: 'Admin', save: jest.fn() }); await adminService.generate(); expect(bcrypt.hash).toHaveBeenCalledTimes(0);
    const created = { save: jest.fn() }; User.findOne.mockResolvedValueOnce(null); User.mockImplementationOnce(() => created); await adminService.generate(); expect(bcrypt.hash).toHaveBeenCalledWith('Admin123!', 10); expect(created.save).toHaveBeenCalled();
  });
});

describe('Authenticate controller Admin', () => {
  test('hiển thị form, tài khoản thiếu, mật khẩu sai, thành công và lỗi', async () => {
    let res = response(); authenticate.showLoginForm(req(), res); expect(res.render).toHaveBeenCalledWith('authenticate/login');
    User.findOne.mockResolvedValueOnce(null); res = response(); await authenticate.handleLogin(req({ body: { account: 'x', password: 'p' } }), res); expect(res.redirect).toHaveBeenCalledWith('/login');
    User.findOne.mockResolvedValueOnce({ password: 'h' }); bcrypt.compare.mockResolvedValueOnce(false); res = response(); await authenticate.handleLogin(req({ body: { account: 'x', password: 'p' } }), res); expect(res.redirect).toHaveBeenCalledWith('/login');
    const sessionSpy = jest.spyOn(sessionService, 'setSession').mockResolvedValueOnce(); User.findOne.mockResolvedValueOnce({ password: 'h' }); res = response(); await authenticate.handleLogin(req({ body: { account: 'x', password: 'p' } }), res); expect(res.redirect).toHaveBeenCalledWith('/dashboard'); sessionSpy.mockRestore();
    User.findOne.mockRejectedValueOnce(new Error('DB')); res = response(); await authenticate.handleLogin(req({ body: {} }), res); expect(res.redirect).toHaveBeenCalledWith('/login');
  });

  test('đăng xuất xóa phiên và chuyển trang', async () => {
    const spy = jest.spyOn(sessionService, 'clearSession').mockResolvedValueOnce(); const res = response(); await authenticate.handleLogout(req(), res); expect(spy).toHaveBeenCalled(); expect(res.redirect).toHaveBeenCalledWith('/'); spy.mockRestore();
  });
});

describe('Category controller Admin', () => {
  test('ảnh, danh sách, form và chỉnh sửa', async () => {
    let res = response(); await categories.getImage(req({ params: { id: 'c1' } }), res); expect(res.status).toHaveBeenCalledWith(404);
    Category.findById.mockResolvedValueOnce({ image: { imageType: 'image/png', imageData: Buffer.from('x') } }); res = response(); await categories.getImage(req({ params: { id: 'c1' } }), res); expect(res.set).toHaveBeenCalledWith('Content-Type', 'image/png');
    res = response(); await categories.index(req(), res); expect(res.render).toHaveBeenCalledWith('categories/index', expect.any(Object));
    res = response(); await categories.create(req(), res); expect(res.render).toHaveBeenCalledWith('categories/create', expect.any(Object));
    Category.findById.mockResolvedValueOnce({ name: 'Ao' }); res = response(); await categories.edit(req({ params: { id: 'c1' } }), res); expect(res.render).toHaveBeenCalledWith('categories/edit', expect.any(Object));
  });

  test('store từ chối thiếu và lưu hợp lệ', async () => {
    let res = response(); await categories.store(req({ body: {} }), res); expect(res.redirect).toHaveBeenCalledWith('/categories/create');
    const saved = { save: jest.fn() }; Category.mockImplementationOnce(() => saved); res = response(); await categories.store(req({ body: { name: 'Ao' }, file }), res); expect(saved.image.imageType).toBe('image/png'); expect(saved.save).toHaveBeenCalled();
  });

  test('update thiếu, có và không có ảnh; destroy', async () => {
    let res = response(); await categories.update(req({ body: {} }), res); expect(res.redirect).toHaveBeenCalledWith('/categories/create');
    const category = { image: 'old', save: jest.fn() }; Category.findById.mockResolvedValue(category); res = response(); await categories.update(req({ body: { id: 'c1', name: 'Moi' } }), res); expect(category.image).toBe('old');
    res = response(); await categories.update(req({ body: { id: 'c1', name: 'Moi' }, file }), res); expect(category.image.imageName).toBe('a.png');
    res = response(); await categories.destroy(req({ params: { id: 'c1' } }), res); expect(Category.findByIdAndDelete).toHaveBeenCalledWith('c1');
  });

  test('assign, assignHandler thiếu/hợp lệ, show và unassign', async () => {
    Product.aggregate.mockResolvedValueOnce([{ name: 'A' }]); let res = response(); await categories.assign(req(), res); expect(res.render).toHaveBeenCalledWith('categories/assign', expect.any(Object));
    Category.findById.mockResolvedValueOnce(null); res = response(); await categories.assignHandler(req({ body: { categoryID: 'c1' } }), res); expect(res.redirect).toHaveBeenCalledWith('/categories/assign');
    const category = { products: [{ id: 'p1' }], save: jest.fn() }; Category.findById.mockResolvedValueOnce(category); Product.find.mockResolvedValueOnce([{ id: 'p1' }, { id: 'p2' }]); res = response(); await categories.assignHandler(req({ body: { categoryID: 'c1', productName: 'A' } }), res); expect(category.products).toHaveLength(2);
    Category.aggregate.mockResolvedValueOnce([]); res = response(); await categories.show(req({ params: { id: '507f1f77bcf86cd799439011' } }), res); expect(res.render).toHaveBeenCalledWith('categories/show', expect.any(Object));
    res = response(); await categories.unassign(req({ body: { categoryID: 'c1', productName: 'A' } }), res); expect(Category.updateOne).toHaveBeenCalled();
  });
});

describe('Dashboard và Order controller Admin', () => {
  test('dashboard render, tổng doanh thu rỗng/có và đủ 12 tháng', async () => {
    let res = response(); dashboard.index(req(), res); expect(res.render).toHaveBeenCalledWith('dashboard/dashboard');
    res = response(); await dashboard.priceTotal(req(), res); expect(res.json).toHaveBeenCalledWith({ totalAmount: 0 });
    Order.aggregate.mockResolvedValueOnce([{ totalRevenue: 500 }]); res = response(); await dashboard.priceTotal(req(), res); expect(res.json).toHaveBeenCalledWith({ totalAmount: 500 });
    Order.aggregate.mockResolvedValueOnce([{ month: 2, total: 200 }]); res = response(); await dashboard.totalMonth(req(), res); expect(res.json.mock.calls[0][0].monthlyTotals).toHaveLength(12); expect(res.json.mock.calls[0][0].monthlyTotals[1]).toBe(200);
  });

  test('orders danh sách, duyệt sai/đúng và chi tiết', async () => {
    let res = response(); await orders.index(req(), res); expect(res.render).toHaveBeenCalledWith('orders/index', expect.any(Object));
    Order.findById.mockResolvedValueOnce({ status: 'waiting' }); res = response(); await orders.approved(req({ body: { id: 'o1' } }), res); expect(res.redirect).toHaveBeenCalledWith('/orders');
    const order = { status: 'pending', save: jest.fn() }; Order.findById.mockResolvedValueOnce(order); res = response(); await orders.approved(req({ body: { id: 'o1' } }), res); expect(order.status).toBe('waiting');
    Order.findById.mockResolvedValueOnce(order); res = response(); await orders.detail(req({ body: { id: 'o1' } }), res); expect(res.render).toHaveBeenCalledWith('orders/detail', expect.any(Object));
  });

  test.each(['delivered', 'cancelled'])('không hủy order %s', async status => {
    Order.findById.mockResolvedValue({ status }); const res = response(); await orders.cancelled(req({ body: { id: 'o1' } }), res); expect(res.status).toHaveBeenCalledWith(500);
  });

  test('hủy order hợp lệ và xử lý lỗi', async () => {
    const order = { status: 'waiting', save: jest.fn() }; Order.findById.mockResolvedValueOnce(order); let res = response(); await orders.cancelled(req({ body: { id: 'o1' } }), res); expect(order.status).toBe('cancelled'); expect(res.status).toHaveBeenCalledWith(204);
    Order.findById.mockRejectedValueOnce(new Error('DB')); res = response(); await orders.cancelled(req({ body: { id: 'o1' } }), res); expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe('Product controller Admin', () => {
  test('ảnh thiếu/có, index, create, show, edit', async () => {
    let res = response(); await products.getImage(req({ params: { id: 'p1' } }), res); expect(res.status).toHaveBeenCalledWith(404);
    Product.findById.mockResolvedValueOnce({ image: { imageType: 'image/png', imageData: Buffer.from('x') } }); res = response(); await products.getImage(req({ params: { id: 'p1' } }), res); expect(res.send).toHaveBeenCalled();
    res = response(); await products.index(req(), res); expect(res.render).toHaveBeenCalledWith('products/index', expect.any(Object));
    res = response(); await products.create(req(), res); expect(res.render).toHaveBeenCalledWith('products/create', expect.any(Object));
    res = response(); await products.show(req(), res); expect(res.send).toHaveBeenCalled();
    res = response(); await products.edit(req({ params: { id: 'Ao' } }), res); expect(res.render).toHaveBeenCalledWith('products/edit', expect.any(Object));
  });

  test('store thiếu, trùng và hợp lệ với giá/kho rỗng', async () => {
    let res = response(); await products.store(req({ body: {} }), res); expect(res.redirect).toHaveBeenCalledWith('/products/create');
    Product.findOne.mockResolvedValueOnce({}); res = response(); await products.store(req({ body: { name: 'A', type: 'Den' } }), res); expect(res.redirect).toHaveBeenCalledWith('/products/create');
    const stored = { detail: [], save: jest.fn() }; Product.mockImplementationOnce(() => stored); Product.findOne.mockResolvedValueOnce(null); res = response(); await products.store(req({ body: { name: 'A', type: 'Den', price: { M: '', L: 20 }, stock: { M: '', L: 2 } }, file }), res); expect(stored.detail).toEqual([{ size: 'M', price: 0, stock: 0 }, { size: 'L', price: 20, stock: 2 }]);
  });

  test('update thiếu, không thấy, hợp lệ không/có ảnh và destroy', async () => {
    let res = response(); await products.update(req({ body: { redirect: 'A' } }), res); expect(res.redirect).toHaveBeenCalled();
    Product.findById.mockResolvedValueOnce(null); res = response(); await products.update(req({ body: { id: 'p1', name: 'A', type: 'Den', redirect: 'A' } }), res); expect(res.redirect).toHaveBeenCalled();
    const stored = { detail: [], image: 'old', save: jest.fn() }; Product.findById.mockResolvedValue(stored); res = response(); await products.update(req({ body: { id: 'p1', name: 'A', type: 'Den', price: { M: '' }, stock: { M: '' } } }), res); expect(stored.image).toBe('old');
    res = response(); await products.update(req({ body: { id: 'p1', name: 'A', type: 'Den', price: { M: 10 }, stock: { M: 1 } }, file }), res); expect(stored.image.imageName).toBe('a.png');
    res = response(); await products.destroy(req({ params: { id: 'A' } }), res); expect(Product.deleteMany).toHaveBeenCalledWith({ name: 'A' });
  });
});

describe('User controller Admin', () => {
  test('index thành công/lỗi, create, show thành công/lỗi và edit', async () => {
    let res = response(); await users.index(req(), res); expect(res.render).toHaveBeenCalledWith('users/index', expect.any(Object));
    User.find.mockRejectedValueOnce(new Error('DB')); res = response(); await users.index(req(), res); expect(res.status).toHaveBeenCalledWith(500);
    res = response(); await users.create(req(), res); expect(res.render).toHaveBeenCalledWith('users/create', expect.any(Object));
    User.findById.mockResolvedValueOnce({ name: 'A' }); res = response(); await users.show(req({ params: { id: 'u1' } }), res); expect(res.render).toHaveBeenCalledWith('users/show', expect.any(Object));
    User.findById.mockRejectedValueOnce(new Error('DB')); res = response(); await users.show(req({ params: { id: 'u1' } }), res); expect(res.status).toHaveBeenCalledWith(500);
    User.findById.mockResolvedValueOnce({}); res = response(); await users.edit(req({ params: { id: 'u1' } }), res); expect(res.render).toHaveBeenCalledWith('users/edit', expect.any(Object));
  });

  test('store thiếu, trùng, mật khẩu lệch, hợp lệ/default role và lỗi', async () => {
    let res = response(); await users.store(req({ body: {} }), res); expect(res.redirect).toHaveBeenCalledWith('/users/create');
    User.findOne.mockResolvedValueOnce({}); res = response(); await users.store(req({ body: { account: 'a', password: 'p', passwordConfirm: 'p' } }), res); expect(res.redirect).toHaveBeenCalledWith('/users/create');
    User.findOne.mockResolvedValueOnce(null); res = response(); await users.store(req({ body: { account: 'a', password: 'p', passwordConfirm: 'x' } }), res); expect(res.redirect).toHaveBeenCalledWith('/users/create');
    const stored = { save: jest.fn() }; User.findOne.mockResolvedValueOnce(null); User.mockImplementationOnce(() => stored); res = response(); await users.store(req({ body: { account: 'a', password: 'p', passwordConfirm: 'p', role: 'Sai' } }), res); expect(stored.role).toBe('User'); expect(stored.save).toHaveBeenCalled();
    User.findOne.mockRejectedValueOnce(new Error('DB')); res = response(); await users.store(req({ body: { account: 'a', password: 'p', passwordConfirm: 'p' } }), res); expect(res.status).toHaveBeenCalledWith(500);
  });

  test('destroy có/không user và lỗi', async () => {
    const deleteSpy = jest.spyOn(sessionService, 'deleteOneSession').mockResolvedValue();
    User.findByIdAndDelete.mockResolvedValueOnce({ account: 'a' }); let res = response(); await users.destroy(req({ body: { id: 'u1' } }), res); expect(deleteSpy).toHaveBeenCalledWith('a');
    User.findByIdAndDelete.mockResolvedValueOnce(null); res = response(); await users.destroy(req({ body: { id: 'u1' } }), res); expect(res.status).toHaveBeenCalledWith(204);
    User.findByIdAndDelete.mockRejectedValueOnce(new Error('DB')); res = response(); await users.destroy(req({ body: { id: 'u1' } }), res); expect(res.status).toHaveBeenCalledWith(500); deleteSpy.mockRestore();
  });

  test('update thiếu, mật khẩu lệch, hợp lệ Admin/User và lỗi', async () => {
    const base = { id: 'u1', account: 'a', name: 'A', phone: '1', gmail: 'a@x', address: 'D', password: '', passwordConfirm: '' };
    let res = response(); await users.update(req({ body: { id: 'u1' } }), res); expect(res.redirect).toHaveBeenCalledWith('/users/edit/u1');
    res = response(); await users.update(req({ body: { ...base, password: 'a', passwordConfirm: 'b' } }), res); expect(res.redirect).toHaveBeenCalledWith('/users/edit/u1');
    const stored = { save: jest.fn() }; User.findById.mockResolvedValue(stored); res = response(); await users.update(req({ body: { ...base, role: 'Admin', password: 'p', passwordConfirm: 'p' } }), res); expect(stored.password).toBe('hashed');
    const deleteSpy = jest.spyOn(sessionService, 'deleteOneSession').mockResolvedValue(); res = response(); await users.update(req({ body: { ...base, role: 'User' } }), res); expect(deleteSpy).toHaveBeenCalledWith('a'); deleteSpy.mockRestore();
    User.findById.mockRejectedValueOnce(new Error('DB')); res = response(); await users.update(req({ body: { ...base, role: 'User' } }), res); expect(res.status).toHaveBeenCalledWith(500);
  });
});
