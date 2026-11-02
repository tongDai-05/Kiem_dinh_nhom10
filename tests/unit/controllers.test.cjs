'use strict';

jest.mock('../../user/models/UserModel', () => {
  const User = jest.fn();
  User.findById = jest.fn();
  User.findOne = jest.fn();
  return User;
});
jest.mock('../../user/models/ProductModel', () => ({ findById: jest.fn(), findOneAndUpdate: jest.fn() }));
jest.mock('../../user/models/ShipperModel', () => ({ findOne: jest.fn(), updateOne: jest.fn() }));
jest.mock('../../user/models/CategoryModel', () => ({ find: jest.fn() }));
jest.mock('../../user/node_modules/bcryptjs', () => ({ compare: jest.fn(), hash: jest.fn() }));
jest.mock('../../user/node_modules/express-validator', () => ({ validationResult: jest.fn() }));
jest.mock('../../user/models/OrderModel', () => {
  const Order = jest.fn();
  Order.findById = jest.fn();
  Order.find = jest.fn();
  Order.countDocuments = jest.fn();
  return Order;
});

const User = require('../../user/models/UserModel');
const Product = require('../../user/models/ProductModel');
const Shipper = require('../../user/models/ShipperModel');
const Category = require('../../user/models/CategoryModel');
const bcrypt = require('../../user/node_modules/bcryptjs');
const { validationResult } = require('../../user/node_modules/express-validator');
const Order = require('../../user/models/OrderModel');
const authController = require('../../user/controllers/authController');
const cartController = require('../../user/controllers/cartController');
const orderController = require('../../user/controllers/orderController');
const shipperController = require('../../user/controllers/shipperController');

function response() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  res.redirect = jest.fn(() => res);
  res.render = jest.fn(() => res);
  return res;
}

function request({ userId = 'u1', body = {}, headers = { accept: 'application/json' } } = {}) {
  return { session: userId ? { user: { _id: userId } } : {}, body, headers, xhr: false };
}

function cartUser(quantity = 2) {
  return {
    carts: [{ productID: { toString: () => 'p1' }, type: 'Den', size: 'M', orderNumber: quantity }],
    save: jest.fn().mockResolvedValue(undefined),
  };
}

function orderRecord({ owner = 'u1', status = 'pending', amount = 300000, shipper = 's1' } = {}) {
  return {
    _id: 'o1', user: owner, status, totalAmount: amount, shiperID: shipper,
    save: jest.fn().mockResolvedValue(undefined),
  };
}

function populated(value) {
  return { populate: jest.fn().mockResolvedValue(value) };
}

function populatedLean(value) {
  return { populate: jest.fn(() => ({ lean: jest.fn().mockResolvedValue(value) })) };
}

function lean(value) {
  return { lean: jest.fn().mockResolvedValue(value) };
}

beforeEach(() => {
  jest.restoreAllMocks();
  jest.resetAllMocks();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  validationResult.mockReturnValue({ isEmpty: () => true, array: () => [] });
  Category.find.mockResolvedValue([]);
  bcrypt.compare.mockResolvedValue(true);
  bcrypt.hash.mockResolvedValue('hashed');
  User.mockImplementation(data => ({ ...data, save: jest.fn().mockResolvedValue(undefined) }));
  Order.mockImplementation(data => ({ ...data, _id: 'new-order', save: jest.fn().mockResolvedValue(undefined) }));
  Shipper.findOne.mockResolvedValue(null);
  Shipper.updateOne.mockResolvedValue({ acknowledged: true });
});

describe('WB-04 đến WB-10 - cập nhật số lượng giỏ hàng', () => {
  test('từ chối khi chưa đăng nhập', async () => {
    const res = response();
    await cartController.updateCartItem(request({ userId: null, body: { productId: 'p1', qty: 2 } }), res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
    expect(User.findById).not.toHaveBeenCalled();
  });

  test.each([
    ['thiếu mã sản phẩm', { qty: 2 }],
    ['số lượng bằng 0', { productId: 'p1', qty: 0 }],
    ['số lượng âm', { productId: 'p1', qty: -1 }],
  ])('%s bị từ chối', async (_label, body) => {
    const res = response();
    await cartController.updateCartItem(request({ body }), res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
  });

  test('từ chối khi sản phẩm không có trong giỏ', async () => {
    User.findById.mockResolvedValue({ carts: [], save: jest.fn() });
    const res = response();
    await cartController.updateCartItem(request({ body: { productId: 'p1', qty: 2 } }), res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
  });

  test('lưu số lượng nguyên dương hợp lệ', async () => {
    const user = cartUser();
    User.findById.mockResolvedValue(user);
    const res = response();
    await cartController.updateCartItem(request({ body: { productId: 'p1', qty: 3 } }), res);
    expect(user.carts[0].orderNumber).toBe(3);
    expect(user.save).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });

  test('trả lỗi có kiểm soát khi lưu thất bại', async () => {
    const user = cartUser();
    user.save.mockRejectedValue(new Error('Loi DB gia lap'));
    User.findById.mockResolvedValue(user);
    const res = response();
    await cartController.updateCartItem(request({ body: { productId: 'p1', qty: 2 } }), res);
    expect(res.json).toHaveBeenCalledWith({ success: false, message: 'Loi DB gia lap' });
  });

  test.failing('phải từ chối số lượng lẻ', async () => {
    const user = cartUser();
    User.findById.mockResolvedValue(user);
    const res = response();
    await cartController.updateCartItem(request({ body: { productId: 'p1', qty: 1.5 } }), res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
  });

  test.failing('phải từ chối chuỗi không phải số', async () => {
    const user = cartUser();
    User.findById.mockResolvedValue(user);
    const res = response();
    await cartController.updateCartItem(request({ body: { productId: 'p1', qty: 'abc' } }), res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
  });
});

describe('WB-11 đến WB-17 - hủy đơn và quyền sở hữu', () => {
  test('thiếu người dùng hoặc mã đơn trả 400', async () => {
    const res = response();
    await orderController.cancelOrder(request({ userId: null, body: {} }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('không tìm thấy đơn trả 404', async () => {
    Order.findById.mockResolvedValue(null);
    const res = response();
    await orderController.cancelOrder(request({ body: { orderId: 'o1' } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('khác chủ sở hữu trả 403', async () => {
    Order.findById.mockResolvedValue(orderRecord({ owner: 'u2' }));
    const res = response();
    await orderController.cancelOrder(request({ body: { orderId: 'o1' } }), res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test.each(['shipping', 'delivered', 'cancelled'])('không cho hủy trạng thái %s', async status => {
    Order.findById.mockResolvedValue(orderRecord({ status }));
    const res = response();
    await orderController.cancelOrder(request({ body: { orderId: 'o1' } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test.each(['pending', 'waiting'])('hủy được trạng thái %s', async status => {
    const order = orderRecord({ status });
    Order.findById.mockResolvedValue(order);
    const res = response();
    await orderController.cancelOrder(request({ body: { orderId: 'o1' } }), res);
    expect(order.status).toBe('cancelled');
    expect(order.save).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });

  test('lỗi đọc đơn trả 500 có kiểm soát', async () => {
    Order.findById.mockRejectedValue(new Error('Loi DB gia lap'));
    const res = response();
    await orderController.cancelOrder(request({ body: { orderId: 'o1' } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe('WB-01 đến WB-03 - tính tiền công qua nghiệp vụ giao thành công', () => {
  test.each([
    [0, 7500],
    [300000, 12000],
    [33.333, 7500],
    [33.334, 7501],
  ])('đơn %s đồng tạo tiền công %s đồng', async (amount, expected) => {
    const order = orderRecord({ status: 'shipping', amount });
    Order.findById.mockResolvedValue(order);
    const res = response();
    await shipperController.deliverOrder(request({ userId: 's1', body: { orderId: 'o1' } }), res);
    expect(Shipper.updateOne).toHaveBeenCalledWith(
      { user: 's1' },
      expect.objectContaining({ $inc: { totalEarnings: expected } }),
      { upsert: true },
    );
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });
});

describe('WB-18 - nhiều sản phẩm và hoàn tác tồn kho', () => {
  test.failing('nếu sản phẩm thứ hai hết hàng thì phải hoàn tác lần giảm thứ nhất', async () => {
    const productA = { _id: 'p1', name: 'Ao A', type: 'Den', detail: [{ size: 'M', price: 100, stock: 2 }] };
    const productB = { _id: 'p2', name: 'Ao B', type: 'Trang', detail: [{ size: 'L', price: 200, stock: 0 }] };
    const user = {
      carts: [
        { productID: productA, type: 'Den', size: 'M', orderNumber: 1 },
        { productID: productB, type: 'Trang', size: 'L', orderNumber: 1 },
      ],
      orders: [], save: jest.fn(),
    };
    User.findById.mockReturnValue({ populate: jest.fn().mockResolvedValue(user) });
    Product.findOneAndUpdate.mockResolvedValueOnce(productA).mockResolvedValueOnce(null);
    const res = response();
    await orderController.quickOrder(request({ body: { firstName: 'A', lastName: 'B' } }), res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(Product.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ _id: 'p1' }),
      { $inc: { 'detail.$.stock': 1 } },
      expect.any(Object),
    );
  });
});

describe('Các nhánh HTML và lỗi còn lại của giỏ/đặt hàng', () => {
  test('checkoutCart chuyển hướng guest và giỏ rỗng ở chế độ HTML', async () => {
    let res = response();
    await cartController.checkoutCart(request({ userId: null, headers: { accept: 'text/html' } }), res, jest.fn());
    expect(res.redirect).toHaveBeenCalledWith('/auth/login');
    User.findById.mockReturnValue(populated({ carts: [], orders: [], save: jest.fn() }));
    res = response();
    await cartController.checkoutCart(request({ headers: { accept: 'text/html' } }), res, jest.fn());
    expect(res.redirect).toHaveBeenCalledWith('/cart');
  });

  test('checkoutCart HTML thành công có ảnh và chuyển trang', async () => {
    const image = { imageName: 'a.png', imageType: 'image/png', imageData: Buffer.from('x') };
    const user = {
      carts: [{ productID: { _id: 'p1', name: 'Ao', detail: [{ size: 'M', price: 100 }], image }, type: 'Den', size: 'M', orderNumber: 2 }],
      orders: [], address: 'DC', save: jest.fn(),
    };
    User.findById.mockReturnValue(populated(user));
    const res = response();
    await cartController.checkoutCart(request({ headers: { accept: 'text/html' } }), res, jest.fn());
    expect(res.redirect).toHaveBeenCalledWith('/checkout?success=1');
    expect(Order).toHaveBeenCalledWith(expect.objectContaining({ totalAmount: 200 }));
  });

  test('checkoutCart HTML chuyển lỗi cho next', async () => {
    User.findById.mockReturnValue({ populate: jest.fn().mockRejectedValue(new Error('DB')) });
    const next = jest.fn();
    await cartController.checkoutCart(request({ headers: { accept: 'text/html' } }), response(), next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });

  test('quickOrder HTML bao phủ guest, mua ngay thành công và thiếu kho', async () => {
    let res = response();
    await orderController.quickOrder(request({ userId: null, headers: { accept: 'text/html' } }), res, jest.fn());
    expect(res.redirect).toHaveBeenCalledWith('/auth/login');

    const body = { name: 'Ao', type: 'Den', size: 'M', price: '100', quantity: '2', productId: 'p1', firstName: 'A', lastName: 'B' };
    Product.findById.mockResolvedValue({ image: { imageName: 'a', imageType: 'image/png', imageData: Buffer.from('x') } });
    Product.findOneAndUpdate.mockResolvedValue({});
    User.findById.mockResolvedValue({ orders: [], save: jest.fn() });
    res = response();
    await orderController.quickOrder(request({ body, headers: { accept: 'text/html' } }), res, jest.fn());
    expect(res.redirect).toHaveBeenCalledWith('/order/checkout?orderId=new-order');

    Product.findOneAndUpdate.mockResolvedValue(null);
    res = response();
    await orderController.quickOrder(request({ body, headers: { accept: 'text/html' } }), res, jest.fn());
    expect(res.redirect).toHaveBeenCalledWith('/cart?error=outofstock');
  });

  test('quickOrder HTML giỏ rỗng, đặt giỏ thành công và thiếu tồn', async () => {
    User.findById.mockReturnValueOnce(populated({ carts: [] }));
    let res = response();
    await orderController.quickOrder(request({ headers: { accept: 'text/html' } }), res, jest.fn());
    expect(res.redirect).toHaveBeenCalledWith('/cart');

    const image = { imageName: 'a', imageType: 'image/png', imageData: Buffer.from('x') };
    const cartItem = { productID: { _id: { toString: () => 'p1' }, name: 'Ao', type: 'Den', detail: [{ size: 'M', price: 100 }], image }, type: 'Den', size: 'M', orderNumber: 1 };
    const user = { carts: [cartItem], orders: [], save: jest.fn() };
    User.findById.mockReturnValueOnce(populated(user));
    Product.findOneAndUpdate.mockResolvedValueOnce({});
    res = response();
    await orderController.quickOrder(request({ body: { address: 'DC' }, headers: { accept: 'text/html' } }), res, jest.fn());
    expect(res.redirect).toHaveBeenCalledWith('/order/history');

    User.findById.mockReturnValueOnce(populated({ carts: [cartItem], orders: [], save: jest.fn() }));
    Product.findOneAndUpdate.mockResolvedValueOnce(null);
    res = response();
    await orderController.quickOrder(request({ headers: { accept: 'text/html' } }), res, jest.fn());
    expect(res.redirect).toHaveBeenCalledWith('/cart?error=outofstock');
  });

  test('quickOrder HTML chuyển cả lỗi trong và ngoài sang next', async () => {
    const item = { productID: { _id: 'p1', name: 'Ao', detail: [{ size: 'M', price: 100 }] }, type: 'Den', size: 'M', orderNumber: 1 };
    User.findById.mockReturnValueOnce(populated({ carts: [item], orders: [], save: jest.fn() }));
    Product.findOneAndUpdate.mockRejectedValueOnce(new Error('inner'));
    let next = jest.fn();
    await orderController.quickOrder(request({ headers: { accept: 'text/html' } }), response(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'inner' }));

    User.findById.mockReturnValueOnce({ populate: jest.fn().mockRejectedValue(new Error('outer')) });
    next = jest.fn();
    await orderController.quickOrder(request({ headers: { accept: 'text/html' } }), response(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'outer' }));
  });

  test('quickOrder AJAX trả 500 khi lỗi xảy ra trong vòng đặt giỏ', async () => {
    const item = { productID: { _id: 'p1', name: 'Ao', detail: [{ size: 'M', price: 100 }] }, type: 'Den', size: 'M', orderNumber: 1 };
    User.findById.mockReturnValueOnce(populated({ carts: [item], orders: [], save: jest.fn() }));
    Product.findOneAndUpdate.mockRejectedValueOnce(new Error('inner ajax'));
    const res = response();
    await orderController.quickOrder(request({ headers: { accept: 'application/json' } }), res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false, message: 'inner ajax' }));
  });
});

describe('Các nhánh giỏ hàng còn lại', () => {
  test('thêm mới và cộng dồn sản phẩm trong giỏ', async () => {
    const user = cartUser(1);
    User.findById.mockResolvedValue(user);
    let res = response();
    await cartController.addToCart(request({ body: { productID: 'p1', orderNumber: 2, type: 'Den', size: 'M' } }), res);
    expect(user.carts[0].orderNumber).toBe(3);
    expect(res.json).toHaveBeenCalledWith({ success: true, addcart_success: true });

    user.carts = [];
    res = response();
    await cartController.addToCart(request({ body: { productID: 'p2', orderNumber: 1, type: 'Trang', size: 'L' } }), res);
    expect(user.carts).toEqual([{ productID: 'p2', orderNumber: 1, type: 'Trang', size: 'L' }]);
  });

  test('thêm giỏ yêu cầu đăng nhập và xử lý lỗi DB', async () => {
    let res = response();
    await cartController.addToCart(request({ userId: null }), res);
    expect(res.status).toHaveBeenCalledWith(401);
    User.findById.mockRejectedValue(new Error('DB'));
    res = response();
    await cartController.addToCart(request({ body: {} }), res);
    expect(res.json).toHaveBeenCalledWith({ success: false, message: 'DB' });
  });

  test('hiển thị giỏ khách và giỏ có sản phẩm đúng tổng tiền', async () => {
    let res = response();
    await cartController.getCart(request({ userId: null }), res, jest.fn());
    expect(res.render).toHaveBeenCalledWith('pages/cart', expect.objectContaining({ cartCount: 0 }));

    const imageData = Buffer.from('x');
    const user = {
      carts: [{
        productID: { _id: 'p1', name: 'Ao', detail: [{ size: 'M', price: '100', stock: 4 }], image: { imageType: 'image/png', imageData } },
        type: 'Den', size: 'M', orderNumber: 2,
      }],
      wishlist: ['w1'],
    };
    User.findById.mockReturnValue(populated(user));
    res = response();
    await cartController.getCart(request(), res, jest.fn());
    expect(res.render).toHaveBeenCalledWith('pages/cart', expect.objectContaining({
      wishlistCount: 1, cartCount: 2,
      cart: expect.objectContaining({ itemsPrice: 200, shippingPrice: 2, totalPrice: 202 }),
    }));
  });

  test('lỗi tải giỏ chuyển cho middleware', async () => {
    const next = jest.fn();
    User.findById.mockReturnValue({ populate: jest.fn().mockRejectedValue(new Error('DB')) });
    await cartController.getCart(request(), response(), next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });

  test('thanh toán giỏ: chặn khách, giỏ rỗng và tạo đơn thành công', async () => {
    let res = response();
    await cartController.checkoutCart(request({ userId: null }), res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(401);

    User.findById.mockReturnValue(populated({ carts: [] }));
    res = response();
    await cartController.checkoutCart(request(), res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);

    const product = { _id: 'p1', name: 'Ao', detail: [{ size: 'M', price: 100 }], image: { imageName: 'a', imageType: 'image/png', imageData: Buffer.from('x') } };
    const user = { address: 'Dia chi', carts: [{ productID: product, type: 'Den', size: 'M', orderNumber: 2 }], orders: [], save: jest.fn() };
    User.findById.mockReturnValue(populated(user));
    res = response();
    await cartController.checkoutCart(request(), res, jest.fn());
    expect(Order).toHaveBeenCalledWith(expect.objectContaining({ totalAmount: 200, status: 'pending' }));
    expect(user.carts).toEqual([]);
    expect(res.json).toHaveBeenCalledWith({ success: true, orderId: 'new-order' });
  });

  test('thanh toán giỏ trả JSON lỗi khi DB lỗi', async () => {
    User.findById.mockReturnValue({ populate: jest.fn().mockRejectedValue(new Error('DB')) });
    const res = response();
    await cartController.checkoutCart(request(), res, jest.fn());
    expect(res.json).toHaveBeenCalledWith({ success: false, message: 'DB' });
  });

  test('xóa dòng giỏ: kiểm tra đầu vào, không tìm thấy, thành công và lỗi DB', async () => {
    let res = response();
    await cartController.removeFromCart(request({ userId: null }), res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));

    res = response();
    await cartController.removeFromCart(request({ body: { productId: 'p1' } }), res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));

    const user = cartUser();
    User.findById.mockResolvedValue(user);
    res = response();
    await cartController.removeFromCart(request({ body: { productId: 'p2', type: 'Den', size: 'M' } }), res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));

    res = response();
    await cartController.removeFromCart(request({ body: { productId: 'p1', type: 'Den', size: 'M' } }), res);
    expect(user.carts).toEqual([]);
    expect(res.json).toHaveBeenCalledWith({ success: true });

    User.findById.mockRejectedValue(new Error('DB'));
    res = response();
    await cartController.removeFromCart(request({ body: { productId: 'p1', type: 'Den', size: 'M' } }), res);
    expect(res.json).toHaveBeenCalledWith({ success: false, message: 'DB' });
  });
});

describe('Các nhánh đặt hàng và trang đơn hàng còn lại', () => {
  test('mua ngay yêu cầu đăng nhập và từ chối khi thiếu tồn', async () => {
    let res = response();
    await orderController.quickOrder(request({ userId: null, body: { name: 'Ao', type: 'Den', size: 'M', price: 100, quantity: 1 } }), res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(401);

    Product.findById.mockResolvedValue(null);
    Product.findOneAndUpdate.mockResolvedValue(null);
    res = response();
    await orderController.quickOrder(request({ body: { productId: 'p1', name: 'Ao', type: 'Den', size: 'M', price: 100, quantity: 1 } }), res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('mua ngay tạo đơn, địa chỉ và ảnh đúng', async () => {
    const image = { imageName: 'a', imageType: 'image/png', imageData: Buffer.from('x') };
    Product.findById.mockResolvedValue({ image });
    Product.findOneAndUpdate.mockResolvedValue({ _id: 'p1' });
    const user = { orders: [], save: jest.fn() };
    User.findById.mockResolvedValue(user);
    const res = response();
    await orderController.quickOrder(request({ body: {
      productId: 'p1', name: 'Ao', type: 'Den', size: 'M', price: '100', quantity: '2',
      firstName: 'Nguyen', lastName: 'A', address: 'Dia chi', phone: '0900', email: 'a@test',
    } }), res, jest.fn());
    expect(Order).toHaveBeenCalledWith(expect.objectContaining({ totalAmount: 200, shippingAddress: expect.objectContaining({ fullName: 'Nguyen A' }) }));
    expect(user.orders).toEqual(['new-order']);
    expect(res.json).toHaveBeenCalledWith({ success: true, orderId: 'new-order' });
  });

  test('đặt cả giỏ thành công và làm rỗng giỏ', async () => {
    const product = { _id: 'p1', name: 'Ao', type: 'Ao', detail: [{ size: 'M', price: '100', stock: 3 }], image: null };
    const user = { carts: [{ productID: product, type: 'Den', size: 'M', orderNumber: 2 }], orders: [], save: jest.fn() };
    User.findById.mockReturnValue(populated(user));
    Product.findOneAndUpdate.mockResolvedValue(product);
    const res = response();
    await orderController.quickOrder(request({ body: { shippingAddress: { fullName: 'A', address: 'B', phone: 'C', email: 'D' } } }), res, jest.fn());
    expect(Order).toHaveBeenCalledWith(expect.objectContaining({ totalAmount: 200 }));
    expect(user.carts).toEqual([]);
    expect(res.json).toHaveBeenCalledWith({ success: true, orderId: 'new-order' });
  });

  test('giỏ rỗng và lỗi đặt giỏ được trả có kiểm soát', async () => {
    User.findById.mockReturnValue(populated({ carts: [] }));
    let res = response();
    await orderController.quickOrder(request(), res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);

    User.findById.mockReturnValue({ populate: jest.fn().mockRejectedValue(new Error('DB')) });
    res = response();
    await orderController.quickOrder(request(), res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(500);
  });

  test('trang xác nhận xử lý thiếu mã, không tìm thấy, thành công và lỗi', async () => {
    let res = response();
    await orderController.checkoutPage({ query: {}, session: {} }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);

    Order.findById.mockReturnValue(populated(null));
    res = response();
    await orderController.checkoutPage({ query: { orderId: 'o1' }, session: {} }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(404);

    Order.findById.mockReturnValue(populated({ _id: 'o1' }));
    User.findById.mockResolvedValue({ wishlist: ['w'], carts: [{ orderNumber: 2 }] });
    res = response();
    await orderController.checkoutPage({ query: { orderId: 'o1' }, session: { user: { _id: 'u1' } } }, res, jest.fn());
    expect(res.render).toHaveBeenCalledWith('pages/order_confirmation', expect.objectContaining({ wishlistCount: 1, cartCount: 2 }));

    const next = jest.fn();
    Order.findById.mockReturnValue({ populate: jest.fn().mockRejectedValue(new Error('DB')) });
    await orderController.checkoutPage({ query: { orderId: 'o1' }, session: {} }, response(), next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });

  test('lịch sử đơn yêu cầu đăng nhập, hiển thị đúng đếm và xử lý lỗi', async () => {
    let req = { session: {}, flash: jest.fn() };
    let res = response();
    await orderController.getOrderHistory(req, res, jest.fn());
    expect(res.redirect).toHaveBeenCalledWith('/auth/login');

    const user = { orders: ['o1'], wishlist: ['w'], carts: [{ orderNumber: 2 }] };
    User.findById.mockReturnValue(populated(user));
    res = response();
    await orderController.getOrderHistory({ session: { user: { _id: 'u1' } } }, res, jest.fn());
    expect(res.render).toHaveBeenCalledWith('pages/order_history', { orders: ['o1'], wishlistCount: 1, cartCount: 2 });

    const next = jest.fn();
    User.findById.mockReturnValue({ populate: jest.fn().mockRejectedValue(new Error('DB')) });
    await orderController.getOrderHistory({ session: { user: { _id: 'u1' } } }, response(), next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });
});

describe('Các nhánh shipper còn lại', () => {
  test('bảng điều khiển tổng hợp các nhóm đơn và tiền công', async () => {
    Order.find
      .mockReturnValueOnce(populatedLean([{ _id: 'w' }]))
      .mockReturnValueOnce(populatedLean([{ _id: 's' }]))
      .mockReturnValueOnce(populatedLean([{ _id: 'd' }]))
      .mockReturnValueOnce(populatedLean([{ _id: 'c' }]));
    Order.countDocuments.mockResolvedValue(1);
    Shipper.findOne.mockResolvedValue({ totalEarnings: 12000, orderHistory: [{ status: 'delivered' }] });
    const res = response();
    await shipperController.getDashboard(request({ userId: 's1' }), res);
    expect(res.render).toHaveBeenCalledWith('shipper/dashboard', expect.objectContaining({ totalEarnings: 12000, shippingCount: 1, historyCount: 1 }));
  });

  test('nhận đơn từ chối đơn sai và nhận đơn waiting', async () => {
    Order.findById.mockResolvedValue(null);
    let res = response();
    await shipperController.acceptOrder(request({ userId: 's1', body: { orderId: 'o1' } }), res);
    expect(res.status).toHaveBeenCalledWith(400);

    const order = orderRecord({ status: 'waiting' });
    Order.findById.mockResolvedValue(order);
    res = response();
    await shipperController.acceptOrder(request({ userId: 's1', body: { orderId: 'o1' } }), res);
    expect(order.status).toBe('shipping');
    expect(order.shiperID).toBe('s1');
    expect(Shipper.updateOne).toHaveBeenCalled();
  });

  test('giao đơn từ chối sai trạng thái và lịch sử đã giao', async () => {
    Order.findById.mockResolvedValue(orderRecord({ status: 'waiting' }));
    let res = response();
    await shipperController.deliverOrder(request({ userId: 's1', body: { orderId: 'o1' } }), res);
    expect(res.status).toHaveBeenCalledWith(400);

    Order.findById.mockResolvedValue(orderRecord({ status: 'shipping' }));
    Shipper.findOne.mockResolvedValue({ orderHistory: [{ order: 'o1', status: 'delivered' }] });
    res = response();
    await shipperController.deliverOrder(request({ userId: 's1', body: { orderId: 'o1' } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('hủy giao từ chối đơn sai và lưu lịch sử đơn hợp lệ', async () => {
    Order.findById.mockResolvedValue(null);
    let res = response();
    await shipperController.cancelOrder(request({ userId: 's1', body: { orderId: 'o1' } }), res);
    expect(res.status).toHaveBeenCalledWith(400);

    const order = orderRecord({ status: 'shipping' });
    Order.findById.mockResolvedValue(order);
    res = response();
    await shipperController.cancelOrder(request({ userId: 's1', body: { orderId: 'o1' } }), res);
    expect(order.status).toBe('cancelled');
    expect(Shipper.updateOne).toHaveBeenCalled();
  });

  test('lọc lịch sử và gom tiền công theo ngày', async () => {
    const history = [
      { status: 'shipping', updatedAt: new Date('2026-10-01'), earning: 0 },
      { status: 'delivered', updatedAt: new Date('2026-10-02'), earning: 100 },
      { status: 'delivered', updatedAt: new Date('2026-10-02'), earning: 200 },
    ];
    Shipper.findOne.mockResolvedValue({ orderHistory: history });
    let res = response();
    await shipperController.filterOrderHistory({ query: { status: 'delivered' }, session: { user: { _id: 's1' } } }, res);
    expect(res.json).toHaveBeenCalledWith({ success: true, history: history.slice(1) });

    res = response();
    await shipperController.earningsChartData(request({ userId: 's1' }), res);
    expect(res.json).toHaveBeenCalledWith({ success: true, chartData: { '2026-10-02': 300 } });
  });

  test('ba trang shipper đọc và sắp xếp dữ liệu', async () => {
    Order.find.mockReturnValueOnce(lean([{ _id: 'w' }])).mockReturnValueOnce(lean([{ _id: 's' }]));
    let res = response();
    await shipperController.getOrdersPage(request({ userId: 's1' }), res);
    expect(res.render).toHaveBeenCalledWith('shipper/orders', expect.objectContaining({ waitingOrders: [{ _id: 'w' }] }));
    res = response();
    await shipperController.getShippingPage(request({ userId: 's1' }), res);
    expect(res.render).toHaveBeenCalledWith('shipper/shipping', expect.objectContaining({ shippingOrders: [{ _id: 's' }] }));

    const old = { order: { _id: 'o1' }, status: 'delivered', updatedAt: new Date('2026-10-01') };
    const latest = { order: { _id: 'o1' }, status: 'delivered', updatedAt: new Date('2026-10-03') };
    const second = { order: { _id: 'o2' }, status: 'delivered', updatedAt: new Date('2026-10-02') };
    Shipper.findOne.mockReturnValue(populated({ orderHistory: [old, latest, second, { order: null, status: 'delivered' }, { status: 'shipping' }] }));
    res = response();
    await shipperController.getHistoryPage(request({ userId: 's1' }), res);
    expect(res.render).toHaveBeenCalledWith('shipper/history', expect.objectContaining({ deliveredHistory: [latest, second] }));
  });
});

describe('Các nhánh xác thực, đăng ký và hồ sơ', () => {
  test('trang đăng nhập và đăng ký hiển thị số yêu thích, số giỏ', async () => {
    User.findById.mockResolvedValue({ wishlist: ['w'], carts: [{ orderNumber: 2 }] });
    let res = response();
    await authController.getLoginPage({ session: { user: { _id: 'u1' } } }, res, jest.fn());
    expect(res.render).toHaveBeenCalledWith('pages/login', expect.objectContaining({ wishlistCount: 1, cartCount: 2 }));
    res = response();
    await authController.getRegisterPage({ session: { user: { _id: 'u1' } } }, res, jest.fn());
    expect(res.render).toHaveBeenCalledWith('pages/register', expect.objectContaining({ wishlistCount: 1, cartCount: 2 }));
  });

  test('lỗi tải trang đăng nhập và đăng ký chuyển cho middleware', async () => {
    Category.find.mockRejectedValue(new Error('DB'));
    let next = jest.fn();
    await authController.getLoginPage({ session: {} }, response(), next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
    next = jest.fn();
    await authController.getRegisterPage({ session: {} }, response(), next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });

  test('đăng nhập hiển thị lỗi validation', async () => {
    validationResult.mockReturnValue({ isEmpty: () => false, array: () => [{ msg: 'Thiếu tài khoản' }] });
    const res = response();
    await authController.postLogin({ body: { account: '', password: '' }, session: {}, flash: jest.fn() }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(422);
  });

  test('đăng nhập từ chối tài khoản không tồn tại và mật khẩu sai', async () => {
    const req = { body: { account: 'a', password: 'b' }, session: {}, flash: jest.fn() };
    User.findOne.mockResolvedValue(null);
    let res = response();
    await authController.postLogin(req, res, jest.fn());
    expect(res.redirect).toHaveBeenCalledWith('/auth/login');

    User.findOne.mockResolvedValue({ password: 'hash', role: 'User' });
    bcrypt.compare.mockResolvedValue(false);
    res = response();
    await authController.postLogin(req, res, jest.fn());
    expect(res.redirect).toHaveBeenCalledWith('/auth/login');
  });

  test.each([
    ['User', '/?login_success=1'],
    ['admin', '/'],
  ])('đăng nhập vai trò %s chuyển đúng trang', async (role, target) => {
    const req = { body: { account: 'a', password: 'b' }, session: {}, flash: jest.fn() };
    User.findOne.mockResolvedValue({ _id: 'u1', password: 'hash', role });
    const res = response();
    await authController.postLogin(req, res, jest.fn());
    expect(req.session.isLoggedIn).toBe(true);
    expect(res.redirect).toHaveBeenCalledWith(target);
  });

  test('đăng nhập nhầm khu vực bằng tài khoản shipper tạo hồ sơ và hủy phiên', async () => {
    const destroy = jest.fn(callback => callback());
    const req = { body: { account: 's', password: 'b' }, session: { destroy }, flash: jest.fn() };
    User.findOne.mockResolvedValue({ _id: 's1', password: 'hash', role: 'Shipper' });
    Shipper.findOne.mockResolvedValue(null);
    Shipper.create = jest.fn().mockResolvedValue({});
    const res = response();
    await authController.postLogin(req, res, jest.fn());
    expect(Shipper.create).toHaveBeenCalledWith({ user: 's1' });
    expect(res.render).toHaveBeenCalledWith('pages/shipper_blocked', expect.any(Object));
  });

  test('lỗi truy vấn đăng nhập chuyển cho middleware', async () => {
    User.findOne.mockRejectedValue(new Error('DB'));
    const next = jest.fn();
    await authController.postLogin({ body: { account: 'a', password: 'b' }, session: {}, flash: jest.fn() }, response(), next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });

  test('đăng ký từ chối xác nhận mật khẩu sai và lỗi validation', async () => {
    let res = response();
    const base = { account: 'a', password: '1', confirmPassword: '2', name: 'A', gmail: 'a@test' };
    await authController.postRegister({ body: base, session: {}, flash: jest.fn() }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(422);

    validationResult.mockReturnValue({ isEmpty: () => false, array: () => [{ msg: 'Email sai' }] });
    res = response();
    await authController.postRegister({ body: { ...base, confirmPassword: '1' }, session: {}, flash: jest.fn() }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(422);
  });

  test('đăng ký từ chối trùng và lưu mật khẩu băm khi hợp lệ', async () => {
    const body = { account: 'a', password: '1', confirmPassword: '1', name: 'A', gmail: 'a@test' };
    const req = { body, session: {}, flash: jest.fn() };
    User.findOne.mockResolvedValue({ _id: 'existing' });
    let res = response();
    await authController.postRegister(req, res, jest.fn());
    expect(res.redirect).toHaveBeenCalledWith('/auth/register');

    User.findOne.mockResolvedValue(null);
    res = response();
    await authController.postRegister(req, res, jest.fn());
    expect(bcrypt.hash).toHaveBeenCalledWith('1', 10);
    expect(User).toHaveBeenCalledWith(expect.objectContaining({ password: 'hashed' }));
    expect(res.redirect).toHaveBeenCalledWith('/');
  });

  test('lỗi lưu đăng ký chuyển cho middleware', async () => {
    User.findOne.mockRejectedValue(new Error('DB'));
    const next = jest.fn();
    const body = { account: 'a', password: '1', confirmPassword: '1', name: 'A', gmail: 'a@test' };
    await authController.postRegister({ body, session: {}, flash: jest.fn() }, response(), next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });

  test.each(['getLogout', 'postLogout'])('%s xóa cookie và chuyển về trang chủ', async method => {
    const req = { session: { destroy: callback => callback() } };
    const res = response();
    res.clearCookie = jest.fn();
    authController[method](req, res, jest.fn());
    expect(res.clearCookie).toHaveBeenCalledWith('connect.sid');
    expect(res.redirect).toHaveBeenCalledWith('/');
  });

  test('lỗi hủy phiên chuyển cho middleware', () => {
    const error = new Error('session');
    const next = jest.fn();
    authController.getLogout({ session: { destroy: callback => callback(error) } }, response(), next);
    expect(next).toHaveBeenCalledWith(error);
  });

  test('postLogout chuyển lỗi hủy phiên cho middleware', () => {
    const error = new Error('session');
    const next = jest.fn();
    authController.postLogout({ session: { destroy: callback => callback(error) } }, response(), next);
    expect(next).toHaveBeenCalledWith(error);
  });

  test('hồ sơ: không tìm thấy, hiển thị đúng và xử lý lỗi', async () => {
    const req = { session: { user: { _id: 'u1' } }, flash: jest.fn() };
    User.findById.mockResolvedValue(null);
    let res = response();
    await authController.getUserProfilePage(req, res, jest.fn());
    expect(res.redirect).toHaveBeenCalledWith('/');

    User.findById.mockResolvedValue({ wishlist: ['w'], carts: [{ orderNumber: 2 }] });
    res = response();
    await authController.getUserProfilePage(req, res, jest.fn());
    expect(res.render).toHaveBeenCalledWith('pages/profile', expect.objectContaining({ wishlistCount: 1, cartCount: 2 }));

    User.findById.mockRejectedValue(new Error('DB'));
    const next = jest.fn();
    await authController.getUserProfilePage(req, response(), next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });

  test('cập nhật hồ sơ: không tìm thấy, thành công và lỗi', async () => {
    const req = { session: { user: { _id: 'u1' } }, body: { fullName: 'Moi', phone: '09', address: 'DC' }, flash: jest.fn() };
    User.findById.mockResolvedValue(null);
    let res = response();
    await authController.postUpdateUserProfile(req, res, jest.fn());
    expect(res.redirect).toHaveBeenCalledWith('/auth/profile');

    const user = { name: 'Cu', phone: '', address: '', password: 'hash', save: jest.fn(), toObject: () => ({ name: 'Moi', password: 'hash' }) };
    User.findById.mockResolvedValue(user);
    res = response();
    await authController.postUpdateUserProfile(req, res, jest.fn());
    expect(user.name).toBe('Moi');
    expect(req.session.user.password).toBeUndefined();

    User.findById.mockRejectedValue(new Error('DB'));
    const next = jest.fn();
    await authController.postUpdateUserProfile(req, response(), next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });

  test('trang đăng nhập shipper hiển thị', async () => {
    const res = response();
    await authController.getShipperLoginPage({}, res, jest.fn());
    expect(res.render).toHaveBeenCalledWith('pages/shipper_login', expect.any(Object));
  });

  test('trang đăng nhập shipper chuyển lỗi render cho middleware', async () => {
    const res = response();
    res.render.mockImplementation(() => { throw new Error('render'); });
    const next = jest.fn();
    await authController.getShipperLoginPage({}, res, next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });

  test('đăng nhập shipper xử lý validation, sai vai trò, sai mật khẩu và thành công', async () => {
    const req = { body: { account: 's', password: 'p' }, session: {} };
    validationResult.mockReturnValue({ isEmpty: () => false, array: () => [{ msg: 'Thiếu' }] });
    let res = response();
    await authController.postShipperLogin(req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(422);

    validationResult.mockReturnValue({ isEmpty: () => true, array: () => [] });
    User.findOne.mockResolvedValue({ role: 'User' });
    res = response();
    await authController.postShipperLogin(req, res, jest.fn());
    expect(res.render).toHaveBeenCalledWith('pages/shipper_login', expect.objectContaining({ error_msg: expect.stringContaining('không phải') }));

    User.findOne.mockResolvedValue({ role: 'Shipper', password: 'hash' });
    bcrypt.compare.mockResolvedValue(false);
    res = response();
    await authController.postShipperLogin(req, res, jest.fn());
    expect(res.render).toHaveBeenCalledWith('pages/shipper_login', expect.objectContaining({ error_msg: 'Mật khẩu không đúng.' }));

    bcrypt.compare.mockResolvedValue(true);
    res = response();
    await authController.postShipperLogin(req, res, jest.fn());
    expect(res.redirect).toHaveBeenCalledWith('/shipper/dashboard');
  });

  test('lỗi đăng nhập shipper chuyển cho middleware', async () => {
    User.findOne.mockRejectedValue(new Error('DB'));
    const next = jest.fn();
    await authController.postShipperLogin({ body: { account: 's', password: 'p' }, session: {} }, response(), next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });
});
