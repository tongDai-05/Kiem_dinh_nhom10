'use strict';

const { By } = require('selenium-webdriver');
const { createHash } = require('node:crypto');

const sid = value => String(value ?? '');
const text = value => String(value ?? '').replace(/\s+/gu, ' ').trim();
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const productStock = product => product.detail.map(d => ({ size: d.size, stock: d.stock }));
const row = (ctx, size) => `tr[data-product-id="${sid(ctx.fixture.product.id)}"][data-size="${size}"]`;
const item = (ctx, size, quantity, product = ctx.fixture.product) => ({
  productID: product.id, type: product.type, size, orderNumber: quantity,
});
const cartView = carts => carts.map(c => ({ product: sid(c.productID), type: c.type, size: c.size, quantity: c.orderNumber }));
const expectedCart = (ctx, rows) => cartView(rows.map(([size, quantity]) => item(ctx, size, quantity)));
const orderView = order => order && ({
  id: sid(order._id), user: sid(order.user), status: order.status,
  total: order.totalAmount, payment: order.paymentMethod, recipient: order.shippingAddress,
  items: order.items.map(i => ({ product: sid(i.product), name: i.name, type: i.group, size: i.size, price: Number(i.price), quantity: i.quantity })),
});

function need(condition, message) {
  if (!condition) {
    const error = new Error(message);
    error.code = 'TEST_SETUP';
    throw error;
  }
}

async function cart(ctx) {
  const user = await ctx.db.collection('users').findOne({ _id: ctx.fixture.user.id });
  need(user, 'Thiếu khách hàng trong cơ sở dữ liệu kiểm thử');
  return user.carts || [];
}

async function setCart(ctx, entries) {
  need(ctx.db.databaseName === 'webbtl_selenium', 'Chỉ chuẩn bị dữ liệu trong database tạm webbtl_selenium');
  const result = await ctx.db.collection('users').updateOne({ _id: ctx.fixture.user.id }, { $set: { carts: entries } });
  need(result.matchedCount === 1, 'Không tìm thấy khách hàng khi chuẩn bị giỏ');
  await ctx.record('Chuẩn bị giỏ độc lập trước lượt thử', cartView(entries));
}

async function state(ctx) {
  const products = await ctx.db.collection('products').find({}).sort({ _id: 1 }).toArray();
  const orders = await ctx.db.collection('orders').find({}).sort({ _id: 1 }).toArray();
  return { products, orders, carts: await cart(ctx) };
}

async function waitChange(ctx, predicate) {
  try { await ctx.driver.wait(predicate, 8000); }
  catch (error) { if (error.name !== 'TimeoutError') throw error; }
}

async function snap(ctx, name, selector) {
  await ctx.h.ready();
  if (selector) {
    for (const element of await ctx.driver.findElements(By.css(selector))) {
      if (await element.isDisplayed()) {
        await ctx.driver.executeScript('arguments[0].scrollIntoView({block:"center",behavior:"instant"});', element);
        break;
      }
    }
  }
  await ctx.snapshot(name);
}

async function selectProduct(ctx, size = 'M', quantity = 1) {
  await ctx.h.open('/products/' + encodeURIComponent(ctx.fixture.product.name));
  await ctx.h.visible('#qtyInput');
  await ctx.h.select('#typeSelect', '0');
  await ctx.h.select('#sizeSelect', size === 'M' ? '0' : '1');
  await ctx.h.fill('#qtyInput', quantity);
}

async function addSelected(ctx) {
  await ctx.h.click('#addToCartBtn');
  await ctx.h.visible('.swal2-popup, #authModal.show');
  return text(await ctx.h.text('.swal2-popup, #authModal.show'));
}

async function post(ctx, route, payload) {
  const response = await ctx.driver.executeAsyncScript(function (url, data, done) {
    fetch(url, {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(data),
    }).then(async res => {
      const raw = await res.text();
      let body;
      try { body = JSON.parse(raw); } catch { body = raw.slice(0, 1200); }
      done({ status: res.status, body });
    }).catch(error => done({ transportError: error.message }));
  }, route, payload);
  await ctx.record('Yêu cầu công cụ trong phiên trình duyệt', { route, payload, response });
  return response;
}

async function confirm(ctx) {
  const dialog = await ctx.driver.wait(async () => {
    for (const element of await ctx.driver.findElements(By.css('.swal2-confirm'))) {
      if (await element.isDisplayed() && await element.isEnabled()) return { button: element };
    }
    try { return { alert: await ctx.driver.switchTo().alert() }; } catch { return false; }
  }, 6000, 'Không xuất hiện hộp thoại xác nhận');
  if (dialog.button) await dialog.button.click();
  else await dialog.alert.accept();
}

async function ownOrders(ctx, keys) {
  need(ctx.db.databaseName === 'webbtl_selenium', 'Chỉ thay chủ đơn mẫu trong database tạm');
  const ids = keys.map(key => ctx.fixture[key].id);
  await ctx.db.collection('orders').updateMany({ _id: { $in: ids } }, { $set: { user: ctx.fixture.user.id } });
  await ctx.db.collection('users').updateOne({ _id: ctx.fixture.user.id }, { $set: { orders: ids } });
  await ctx.record('Chuẩn bị đơn thuộc khách A', { ids: ids.map(sid) });
}

async function fillAndPlace(ctx, label) {
  const recipient = {
    fullName: 'Nguyễn Blackbox', address: ctx.fixture.user.address,
    phone: ctx.fixture.user.phone, email: ctx.fixture.user.gmail,
  };
  await ctx.h.visible('#checkoutForm');
  for (const [selector, value] of [
    ['#firstName', 'Nguyễn'], ['#lastName', 'Blackbox'], ['#address', recipient.address],
    ['#phone', recipient.phone], ['#email', recipient.email],
  ]) await ctx.h.fill(selector, value);
  await snap(ctx, `${label}-thanh-toan-truoc-gui`, '.checkout-modern-container');
  const form = await ctx.driver.findElement(By.css('#checkoutForm'));
  await ctx.h.click('#checkoutForm button[type="submit"]');
  await waitChange(ctx, async () => {
    try { await form.getTagName(); return false; }
    catch (error) {
      if (error.name === 'StaleElementReferenceError') return true;
      throw error;
    }
  });
  await ctx.h.ready();
  await snap(ctx, `${label}-ket-qua-sau-gui`, '.order-confirm-modern, .order-history-modern-container, .cart-area-modern, .checkout-modern-container');
  await ctx.record('Trang kết quả sau gửi đơn một lần', { path: new URL(await ctx.driver.getCurrentUrl()).pathname });
  return recipient;
}

async function readNewOrders(ctx, before) {
  const ids = new Set(before.orders.map(order => sid(order._id)));
  return (await ctx.db.collection('orders').find({ user: ctx.fixture.user.id }).toArray())
    .filter(order => !ids.has(sid(order._id)));
}

async function wholeCart(ctx, label) {
  await setCart(ctx, [item(ctx, 'M', 1), item(ctx, 'L', 2)]);
  const before = await state(ctx);
  await ctx.h.loginUser();
  await ctx.h.open('/cart');
  await ctx.verify(await ctx.h.money(`${row(ctx, 'M')} .item-total`), 120000, 'Dòng M một chiếc có thành tiền 120.000 đồng');
  await ctx.verify(await ctx.h.money(`${row(ctx, 'L')} .item-total`), 300000, 'Dòng L hai chiếc có thành tiền 300.000 đồng');
  await ctx.verify(await ctx.h.money('#cart-subtotal'), 420000, 'Tiền hàng toàn giỏ là 420.000 đồng');
  await snap(ctx, `${label}-gio-hai-co`, '.cart-card-modern');
  await ctx.h.click('a[href="/cart/checkout"]');
  await ctx.h.ready();
  await ctx.verify(await ctx.h.money('.checkout-modern-summary .list_2 li > span:last-child'), 420000, 'Tổng Thanh toán dùng đúng giá từng cỡ và khớp Giỏ hàng');
  const recipient = await fillAndPlace(ctx, label);
  const after = await state(ctx);
  const created = await readNewOrders(ctx, before);
  await ctx.verify(created.length, 1, 'Một lần xác nhận tạo đúng một đơn mới của A');
  await ctx.verify(after.orders.length, before.orders.length + 1, 'Tổng số đơn tăng đúng một');
  await ctx.verify(cartView(after.carts), [], 'Giỏ được xóa sau khi đặt thành công');
  const product = after.products.find(p => sid(p._id) === sid(ctx.fixture.product.id));
  await ctx.verify(productStock(product), [{ size: 'M', stock: 4 }, { size: 'L', stock: 1 }], 'Tồn M giảm một và tồn L giảm hai');
  await ctx.record('Đối chiếu trước sau đặt toàn giỏ', {
    expectedMerchandise: 420000, beforeStock: productStock(before.products.find(p => sid(p._id) === sid(ctx.fixture.product.id))),
    afterStock: productStock(product), created: created.map(orderView), cartAfter: cartView(after.carts),
  });
  if (created.length) {
    const order = created[0];
    await ctx.verify(order.status, 'pending', 'Đơn mới ở trạng thái chờ duyệt');
    await ctx.verify(order.paymentMethod, 'COD', 'Thanh toán khi nhận hàng');
    await ctx.verify(order.totalAmount, 420000, 'Đơn lưu tiền hàng 420.000 đồng');
    await ctx.verify(order.items.map(i => ({ size: i.size, quantity: i.quantity, price: Number(i.price) })), [
      { size: 'M', quantity: 1, price: 120000 }, { size: 'L', quantity: 2, price: 150000 },
    ], 'Đơn lưu đúng hai dòng và đơn giá mỗi cỡ');
    await ctx.verify(order.shippingAddress, recipient, 'Đơn lưu thông tin người nhận đã nhập');
    await ctx.h.open('/order/history');
    const card = `.order-history-card[data-order-id="${sid(order._id)}"]`;
    await ctx.h.visible(card);
    await ctx.verify(await ctx.h.money(`${card} .order-history-total`), 420000, 'Lịch sử hiển thị đúng tổng đơn mới');
    await snap(ctx, `${label}-don-moi-trong-lich-su`, card);
  }
  await ctx.h.open('/cart');
  await snap(ctx, `${label}-gio-sau-dat`, '.cart-area-modern');
}

module.exports = [
  {
    id: 'BB-11', title: 'Thêm một sản phẩm mới vào giỏ', complete: true,
    scope: 'Dữ liệu tương đương: Đen/M giá 120.000 đồng, thêm hai chiếc; UI, tải lại giỏ, đơn và tồn kho.',
    async run(ctx) {
      await setCart(ctx, []);
      const before = await state(ctx);
      await ctx.h.loginUser();
      await selectProduct(ctx, 'M', 2);
      await snap(ctx, 'lua-chon-M-hai-chiec', '.single-product-details');
      await addSelected(ctx);
      await ctx.h.dismissNotice();
      await ctx.h.open('/cart');
      await ctx.driver.navigate().refresh();
      await ctx.h.ready();
      const after = await state(ctx);
      await ctx.verify(cartView(after.carts), expectedCart(ctx, [['M', 2]]), 'Giỏ chỉ có một dòng đúng M, Đen, số lượng hai');
      await ctx.verify(await ctx.h.money(`${row(ctx, 'M')} .item-total`), 240000, 'Thành tiền hai chiếc M là 240.000 đồng');
      await ctx.verify(after.orders.length, before.orders.length, 'Thêm giỏ chưa tạo đơn');
      await ctx.verify(after.products.map(productStock), before.products.map(productStock), 'Thêm giỏ chưa giảm kho');
      await ctx.record('Giỏ và kho sau thêm', { cart: cartView(after.carts), stocks: after.products.map(productStock) });
      await snap(ctx, 'gio-sau-tai-lai', '.cart-card-modern');
    },
  },
  {
    id: 'BB-12', title: 'Thêm giỏ khi chưa đăng nhập', complete: true,
    scope: 'Khách chưa đăng nhập: nút thêm giỏ thật và POST /cart/add; đối chiếu giỏ của mọi tài khoản mẫu.',
    async run(ctx) {
      const before = await ctx.db.collection('users').find({}).sort({ _id: 1 }).toArray();
      await selectProduct(ctx, 'M', 1);
      const message = await addSelected(ctx);
      await ctx.verify(/đăng nhập|đăng ký/iu.test(message), true, 'Giao diện yêu cầu xác thực khi thêm giỏ');
      await ctx.record('Thông báo cho khách chưa đăng nhập', { message });
      await snap(ctx, 'thong-bao-yeu-cau-dang-nhap', '.swal2-popup, #authModal.show');
      const response = await post(ctx, '/cart/add', { productID: sid(ctx.fixture.product.id), type: ctx.fixture.product.type, size: 'M', orderNumber: 1 });
      await ctx.verify(response.status, 401, 'Yêu cầu công cụ chưa đăng nhập bị từ chối');
      await ctx.verify(response.body?.success, false, 'Không báo thêm giỏ thành công cho khách chưa xác thực');
      const after = await ctx.db.collection('users').find({}).sort({ _id: 1 }).toArray();
      await ctx.verify(after.map(u => ({ id: sid(u._id), carts: cartView(u.carts) })), before.map(u => ({ id: sid(u._id), carts: cartView(u.carts) })), 'Không đổi giỏ của bất kỳ tài khoản mẫu nào');
    },
  },
  {
    id: 'BB-13', title: 'Thêm lặp cùng màu và cỡ', complete: true,
    scope: 'Đen/M có sẵn một chiếc; thêm hai qua giao diện, kiểm tra hợp nhất thành một dòng ba chiếc sau tải lại.',
    async run(ctx) {
      await setCart(ctx, [item(ctx, 'M', 1)]);
      await ctx.h.loginUser();
      await ctx.h.open('/cart');
      await snap(ctx, 'gio-mot-chiec-truoc-them', '.cart-card-modern');
      await selectProduct(ctx, 'M', 2);
      await snap(ctx, 'chon-them-hai-chiec-cung-bien-the', '.single-product-details');
      await addSelected(ctx);
      await ctx.h.dismissNotice();
      await ctx.h.open('/cart');
      await ctx.driver.navigate().refresh();
      await ctx.h.ready();
      const after = cartView(await cart(ctx));
      await ctx.verify(after, expectedCart(ctx, [['M', 3]]), 'Cùng biến thể được cộng số thành ba, không tạo dòng lặp');
      await ctx.verify((await ctx.driver.findElements(By.css(`${row(ctx, 'M')}`))).length, 1, 'Giao diện có đúng một dòng M');
      await ctx.verify(await ctx.h.money('#cart-subtotal'), 360000, 'Ba chiếc M có tiền hàng 360.000 đồng');
      await ctx.record('Giỏ sau thêm lặp', after);
      await snap(ctx, 'gio-ba-chiec-sau-them-lap', '.cart-card-modern');
    },
  },
  {
    id: 'BB-14', title: 'Đổi số lượng đúng cỡ trong giỏ', complete: true,
    scope: 'Dữ liệu tương đương M một chiếc/L hai chiếc; tăng đúng nút dòng L lên ba và đối chiếu hai dòng sau tải lại.',
    async run(ctx) {
      await setCart(ctx, [item(ctx, 'M', 1), item(ctx, 'L', 2)]);
      await ctx.h.loginUser();
      await ctx.h.open('/cart');
      await snap(ctx, 'hai-co-truoc-tang-L', '.cart-card-modern');
      const before = hash(cartView(await cart(ctx)));
      await ctx.h.click(`${row(ctx, 'L')} .cart-qty-up`);
      await waitChange(ctx, async () => hash(cartView(await cart(ctx))) !== before);
      await ctx.h.open('/cart');
      const after = cartView(await cart(ctx));
      await ctx.verify(after, expectedCart(ctx, [['M', 1], ['L', 3]]), 'Chỉ L tăng từ hai lên ba, M giữ một');
      await ctx.verify(await ctx.h.money(`${row(ctx, 'M')} .item-total`), 120000, 'Thành tiền dòng M giữ 120.000 đồng');
      await ctx.verify(await ctx.h.money(`${row(ctx, 'L')} .item-total`), 450000, 'Dòng L ba chiếc có 450.000 đồng');
      await ctx.verify(await ctx.h.money('#cart-subtotal'), 570000, 'Tổng đúng sau tăng L là 570.000 đồng');
      await ctx.record('Giỏ quan sát sau bấm tăng ở dòng L', after);
      await snap(ctx, 'hai-co-sau-tang-L-va-tai-lai', '.cart-card-modern');
    },
  },
  {
    id: 'BB-15', title: 'Kiểm tra số lượng ở giới hạn và ngoài giới hạn', complete: false,
    scope: 'Chỉ thử M tồn năm: 0, 1, 5, 6 qua UI và 0/6 qua POST. Chưa thử -1, 4, số lẻ, chữ, rỗng và chuỗi số 2.',
    async run(ctx) {
      await ctx.h.loginUser();
      for (const quantity of [0, 1, 5, 6]) {
        await setCart(ctx, []);
        await selectProduct(ctx, 'M', quantity);
        const message = await addSelected(ctx);
        await ctx.record('Lượt UI kiểm tra số lượng', { entered: quantity, message, cart: cartView(await cart(ctx)) });
        await snap(ctx, `UI-so-luong-${quantity}-phan-hoi`, '.swal2-popup');
        await ctx.h.dismissNotice();
        await ctx.h.open('/cart');
        const valid = quantity >= 1 && quantity <= 5;
        await ctx.verify(cartView(await cart(ctx)), valid ? expectedCart(ctx, [['M', quantity]]) : [], `UI số lượng ${quantity}: chỉ chấp nhận số nguyên trong tồn kho`);
      }
      for (const quantity of [0, 6]) {
        await setCart(ctx, []);
        await ctx.h.open('/cart');
        const response = await post(ctx, '/cart/add', { productID: sid(ctx.fixture.product.id), type: ctx.fixture.product.type, size: 'M', orderNumber: quantity });
        await ctx.verify(response.body?.success, false, `POST từ chối số lượng ${quantity} ngoài giới hạn`);
        await ctx.verify(cartView(await cart(ctx)), [], `POST ${quantity} không làm thay đổi giỏ`);
        await ctx.h.open('/cart');
        await snap(ctx, `POST-so-luong-${quantity}-gio-thuc-te`, '.cart-area-modern');
      }
    },
  },
  {
    id: 'BB-16', title: 'Xóa đúng một cỡ của sản phẩm', complete: true,
    scope: 'Giỏ có M và L; xóa L bằng giao diện rồi POST xóa lại cùng L, kiểm tra M, tổng và bộ đếm.',
    async run(ctx) {
      await setCart(ctx, [item(ctx, 'M', 1), item(ctx, 'L', 1)]);
      await ctx.h.loginUser();
      await ctx.h.open('/cart');
      await snap(ctx, 'hai-co-truoc-xoa', '.cart-card-modern');
      await ctx.h.click(`${row(ctx, 'L')} .cart-remove-btn`);
      await confirm(ctx);
      await waitChange(ctx, async () => !(await cart(ctx)).some(c => c.size === 'L'));
      await ctx.h.open('/cart');
      await ctx.verify(cartView(await cart(ctx)), expectedCart(ctx, [['M', 1]]), 'Xóa L giữ nguyên M một chiếc');
      await ctx.verify(await ctx.h.money('#cart-subtotal'), 120000, 'Tiền hàng còn 120.000 đồng');
      await ctx.verify(await ctx.driver.findElement(By.css('a.header-icon-btn[href="/cart"]')).getAttribute('data-badge'), '1', 'Bộ đếm giỏ còn một chiếc');
      await snap(ctx, 'chi-con-M-sau-xoa-L', '.cart-card-modern');
      await post(ctx, '/cart/remove', { productId: sid(ctx.fixture.product.id), type: ctx.fixture.product.type, size: 'L' });
      await ctx.verify(cartView(await cart(ctx)), expectedCart(ctx, [['M', 1]]), 'Xóa lại L đã mất không xóa nhầm M');
      await ctx.record('Giỏ cuối sau yêu cầu xóa lặp', cartView(await cart(ctx)));
    },
  },
  {
    id: 'BB-17', title: 'Đối chiếu tổng tiền từ giỏ đến đơn', complete: true,
    scope: 'Dữ liệu tương đương M một chiếc 120.000 và L hai chiếc 150.000; tiền hàng 420.000. So sánh UI giỏ, thanh toán, lịch sử và đơn lưu.',
    async run(ctx) { await wholeCart(ctx, 'doi-chieu-tien'); },
  },
  {
    id: 'BB-18', title: 'Không đặt hàng từ giỏ rỗng', complete: true,
    scope: 'Thử UI giỏ rỗng và hai đường POST /order/quick-order, /cart/checkout; ghi số đơn, giỏ và toàn bộ tồn kho.',
    async run(ctx) {
      await setCart(ctx, []);
      const before = await state(ctx);
      await ctx.h.loginUser();
      await ctx.h.open('/cart');
      await snap(ctx, 'gio-rong-ban-dau', '.cart-area-modern');
      await ctx.h.open('/cart/checkout');
      await ctx.h.visible('#checkoutForm');
      await ctx.verify((await ctx.h.text('.checkout-modern-summary')).includes('Không có sản phẩm'), true, 'Thanh toán thông báo không có sản phẩm');
      await fillAndPlace(ctx, 'thu-dat-gio-rong');
      for (const route of ['/order/quick-order', '/cart/checkout']) {
        const response = await post(ctx, route, {});
        await ctx.verify(response.status, 400, `Giỏ rỗng bị từ chối ở ${route}`);
        await ctx.verify(response.body?.success, false, `Không báo tạo đơn thành công ở ${route}`);
      }
      const after = await state(ctx);
      await ctx.verify(after.orders.length, before.orders.length, 'Giỏ rỗng không tạo đơn mới');
      await ctx.verify(after.products.map(productStock), before.products.map(productStock), 'Không đổi tồn kho ở các lượt giỏ rỗng');
      await ctx.verify(cartView(after.carts), [], 'Giỏ vẫn rỗng');
      await ctx.record('Đối chiếu sau các lượt giỏ rỗng', { orderCountBefore: before.orders.length, orderCountAfter: after.orders.length, stocks: after.products.map(productStock) });
    },
  },
  {
    id: 'BB-19', title: 'Mua ngay một sản phẩm hợp lệ', complete: true,
    scope: 'Dữ liệu tương đương M hai chiếc giá 120.000; tiền hàng 240.000. Giữ một sản phẩm khác trong giỏ và kiểm tra bảo toàn sau mua ngay.',
    async run(ctx) {
      await setCart(ctx, [item(ctx, 'M', 1, ctx.fixture.otherProduct)]);
      const before = await state(ctx);
      await ctx.h.loginUser();
      await selectProduct(ctx, 'M', 2);
      await snap(ctx, 'M-hai-chiec-truoc-mua-ngay', '.single-product-details');
      await ctx.h.click('#buyNowBtn');
      await ctx.h.ready();
      await ctx.h.visible('#checkoutForm');
      await ctx.verify(await ctx.h.money('.checkout-modern-summary .list_2 li > span:last-child'), 240000, 'Mua ngay hiển thị 240.000 đồng');
      const recipient = await fillAndPlace(ctx, 'mua-ngay');
      const after = await state(ctx);
      const created = await readNewOrders(ctx, before);
      await ctx.verify(created.length, 1, 'Mua ngay tạo đúng một đơn của A');
      await ctx.verify(cartView(after.carts), cartView(before.carts), 'Giỏ cũ chứa sản phẩm khác được bảo toàn');
      const product = after.products.find(p => sid(p._id) === sid(ctx.fixture.product.id));
      await ctx.verify(productStock(product), [{ size: 'M', stock: 3 }, { size: 'L', stock: 3 }], 'Mua ngay giảm M hai chiếc, không đổi L');
      if (created.length) {
        const order = created[0];
        await ctx.verify({ user: sid(order.user), status: order.status, payment: order.paymentMethod, total: order.totalAmount }, { user: sid(ctx.fixture.user.id), status: 'pending', payment: 'COD', total: 240000 }, 'Đơn mua ngay đúng chủ, chờ duyệt, COD và tiền hàng');
        await ctx.verify(order.items.map(i => ({ product: sid(i.product), size: i.size, quantity: i.quantity, price: Number(i.price) })), [{ product: sid(ctx.fixture.product.id), size: 'M', quantity: 2, price: 120000 }], 'Đơn mua ngay đúng hàng, cỡ và số lượng');
        await ctx.verify(order.shippingAddress, recipient, 'Lưu đúng thông tin người nhận mua ngay');
        await ctx.h.open('/order/history');
        await ctx.h.visible(`.order-history-card[data-order-id="${sid(order._id)}"]`);
        await snap(ctx, 'don-mua-ngay-trong-lich-su', '.order-history-modern-container');
      }
      await ctx.record('Dữ liệu sau mua ngay', { created: created.map(orderView), stocks: after.products.map(productStock), preservedCart: cartView(after.carts) });
      await ctx.h.open('/cart');
      await snap(ctx, 'gio-cu-duoc-giu-sau-mua-ngay', '.cart-card-modern');
    },
  },
  {
    id: 'BB-20', title: 'Đặt toàn bộ sản phẩm trong giỏ', complete: false,
    scope: 'Đã thử luồng UI /cart/checkout đến /order/quick-order với M một/L hai, tổng 420.000. Chưa thử đường POST /cart/checkout cũ với giỏ có hàng.',
    async run(ctx) { await wholeCart(ctx, 'dat-toan-gio'); },
  },
  {
    id: 'BB-21', title: 'Đặt hàng khi một sản phẩm không đủ tồn kho', complete: false,
    scope: 'Chỉ thử giỏ nhiều dòng: M còn năm xếp trước sản phẩm khác hết hàng, mỗi loại một chiếc. Chưa thử lượt mua riêng sản phẩm hết hàng.',
    async run(ctx) {
      need(ctx.db.databaseName === 'webbtl_selenium', 'Chỉ chuẩn bị tồn kho trong database tạm');
      await ctx.db.collection('products').updateOne({ _id: ctx.fixture.otherProduct.id }, { $set: { 'detail.0.stock': 0 } });
      await setCart(ctx, [item(ctx, 'M', 1), item(ctx, 'M', 1, ctx.fixture.otherProduct)]);
      const before = await state(ctx);
      await ctx.h.loginUser();
      await ctx.h.open('/cart');
      await snap(ctx, 'gio-co-hang-va-het-hang-truoc-dat', '.cart-card-modern');
      await ctx.h.click('a[href="/cart/checkout"]');
      await ctx.h.ready();
      await fillAndPlace(ctx, 'thu-dat-gio-thieu-hang');
      const resultUrl = new URL(await ctx.driver.getCurrentUrl());
      await ctx.verify(resultUrl.pathname, '/cart', 'Đặt thiếu hàng được đưa về giỏ');
      await ctx.verify(resultUrl.searchParams.get('error'), 'outofstock', 'Kết quả có chỉ báo thiếu tồn kho');
      const after = await state(ctx);
      await ctx.verify(after.orders.length, before.orders.length, 'Không có đơn mới thành công khi một dòng hết hàng');
      await ctx.verify(after.products.map(productStock), before.products.map(productStock), 'Cả lượt thất bại phải giữ tồn kho của mọi sản phẩm');
      await ctx.verify(cartView(after.carts), cartView(before.carts), 'Giỏ được giữ để khách sửa sau thiếu hàng');
      await ctx.record('Kho từng dòng trước sau lượt đặt thất bại', { before: before.products.map(p => ({ name: p.name, stock: productStock(p) })), after: after.products.map(p => ({ name: p.name, stock: productStock(p) })), ordersBefore: before.orders.length, ordersAfter: after.orders.length });
      await snap(ctx, 'gio-va-ket-qua-sau-thieu-hang', '.cart-card-modern');
    },
  },
  {
    id: 'BB-22', title: 'Khách hủy đơn ở trạng thái được phép', complete: true,
    scope: 'Chuẩn bị hai đơn của A ở pending và waiting; hủy từng đơn qua UI, kiểm tra đơn khác giữ nguyên. Chỉ ghi nhận kho, chưa chấm chính sách hoàn kho.',
    async run(ctx) {
      await ownOrders(ctx, ['pendingOrder', 'waitingOrder']);
      const before = await state(ctx);
      const otherBefore = before.orders.find(o => sid(o._id) === sid(ctx.fixture.deliveredOrder.id));
      await ctx.h.loginUser();
      await ctx.h.open('/order/history');
      await snap(ctx, 'hai-don-cua-A-truoc-huy', '.order-history-modern-container');
      for (const key of ['pendingOrder', 'waitingOrder']) {
        const selector = `.order-history-card[data-order-id="${sid(ctx.fixture[key].id)}"]`;
        await ctx.h.click(`${selector} .btn-cancel-modern`);
        await confirm(ctx);
        await waitChange(ctx, async () => (await ctx.db.collection('orders').findOne({ _id: ctx.fixture[key].id })).status === 'cancelled');
        await ctx.h.open('/order/history');
        await ctx.verify(text(await ctx.h.text(`${selector} .order-history-status`)), 'Đã hủy', `Lịch sử phản ánh ${key} đã hủy`);
        await ctx.verify((await ctx.db.collection('orders').findOne({ _id: ctx.fixture[key].id })).status, 'cancelled', `Dữ liệu ${key} chuyển sang cancelled`);
        await snap(ctx, `${key}-sau-huy`, selector);
      }
      const after = await state(ctx);
      await ctx.verify(hash(after.orders.find(o => sid(o._id) === sid(ctx.fixture.deliveredOrder.id))), hash(otherBefore), 'Đơn đã giao của khách khác không đổi');
      await ctx.record('Tồn kho quan sát khi hủy, chưa chấm hoàn kho', { before: before.products.map(productStock), after: after.products.map(productStock) });
    },
  },
  {
    id: 'BB-23', title: 'Không hủy đơn của người khác hoặc đơn đã qua trạng thái cho phép', complete: true,
    scope: 'Thử khác chủ, đã giao, đang giao, đã hủy, hủy lặp và mã không tồn tại; đối chiếu đơn, kho và tiền công không đổi.',
    async run(ctx) {
      await ownOrders(ctx, ['deliveredOrder']);
      const source = await ctx.db.collection('orders').findOne({ _id: ctx.fixture.pendingOrder.id });
      const shippingId = new (ctx.fixture.user.id.constructor)();
      const cancelledId = new (ctx.fixture.user.id.constructor)();
      await ctx.db.collection('orders').insertMany([
        { ...source, _id: shippingId, user: ctx.fixture.user.id, status: 'shipping', shiperID: ctx.fixture.shipper.id },
        { ...source, _id: cancelledId, user: ctx.fixture.user.id, status: 'cancelled' },
      ]);
      await ctx.db.collection('users').updateOne({ _id: ctx.fixture.user.id }, { $addToSet: { orders: { $each: [shippingId, cancelledId] } } });
      await ctx.record('Chuẩn bị đơn đóng trạng thái trong DB tạm', { shippingId: sid(shippingId), cancelledId: sid(cancelledId) });
      const before = await state(ctx);
      const earningsBefore = await ctx.db.collection('shippers').find({}).toArray();
      await ctx.h.loginUser();
      await ctx.h.open('/order/history');
      const ownCard = `.order-history-card[data-order-id="${sid(ctx.fixture.deliveredOrder.id)}"]`;
      await ctx.verify(await ctx.driver.findElement(By.css(`${ownCard} .btn-cancel-modern`)).isEnabled(), false, 'UI khóa hủy đơn đã giao của A');
      await snap(ctx, 'don-da-giao-khong-cho-huy', ownCard);
      for (const [label, orderId, status] of [
        ['khác chủ', ctx.fixture.pendingOrder.id, 403], ['đã giao', ctx.fixture.deliveredOrder.id, 400],
        ['đang giao của mình', shippingId, 400], ['đã hủy của mình', cancelledId, 400],
        ['hủy lặp đơn đã hủy', cancelledId, 400],
        ['không tồn tại', '000000000000000000000001', 404],
      ]) {
        const response = await post(ctx, '/order/cancel', { orderId: sid(orderId) });
        await ctx.verify(response.status, status, `Từ chối hủy đơn ${label}`);
        await ctx.verify(response.body?.success, false, `Không báo hủy thành công với đơn ${label}`);
      }
      const after = await state(ctx);
      await ctx.verify(hash(after.orders), hash(before.orders), 'Mọi đơn giữ nguyên sau các yêu cầu hủy không hợp lệ');
      await ctx.verify(after.products.map(productStock), before.products.map(productStock), 'Yêu cầu hủy sai không đổi kho');
      await ctx.verify(hash(await ctx.db.collection('shippers').find({}).toArray()), hash(earningsBefore), 'Yêu cầu hủy sai không đổi tiền công hay lịch sử shipper');
    },
  },
  {
    id: 'BB-24', title: 'Chỉ xem lịch sử và xác nhận đơn thuộc mình', complete: true,
    scope: 'Thử lịch sử của A/B và cùng URL xác nhận đơn A ở phiên A, phiên B sau đăng xuất A, và khách chưa đăng nhập; kiểm tra dữ liệu người nhận.',
    async run(ctx) {
      await ownOrders(ctx, ['pendingOrder']);
      await ctx.db.collection('users').updateOne({ _id: ctx.fixture.otherUser.id }, { $set: { orders: [ctx.fixture.waitingOrder.id, ctx.fixture.deliveredOrder.id] } });
      const order = await ctx.db.collection('orders').findOne({ _id: ctx.fixture.pendingOrder.id });
      const route = '/order/checkout?orderId=' + sid(order._id);
      await ctx.h.loginUser();
      await ctx.h.open('/order/history');
      await ctx.verify((await ctx.driver.findElements(By.css(`.order-history-card[data-order-id="${sid(order._id)}"]`))).length, 1, 'Lịch sử A có đơn của A');
      await ctx.verify((await ctx.driver.findElements(By.css(`.order-history-card[data-order-id="${sid(ctx.fixture.waitingOrder.id)}"]`))).length, 0, 'Lịch sử A không chứa đơn của B');
      await snap(ctx, 'lich-su-A-chi-co-don-A', '.order-history-modern-container');
      await ctx.h.open(route);
      await ctx.verify((await ctx.h.text('.order-confirm-modern')).includes(sid(order._id)), true, 'A xem được xác nhận đơn chính mình');
      await snap(ctx, 'A-xem-xac-nhan-don-minh', '.order-confirm-modern');

      await ctx.h.open('/auth/logout');
      await ctx.h.open('/auth/login');
      await ctx.h.fill('#account', ctx.fixture.otherUser.account);
      await ctx.h.fill('#password', ctx.fixture.otherUser.password);
      await ctx.h.click('form[action="/auth/login"] button[type="submit"]');
      await ctx.driver.wait(async () => new URL(await ctx.driver.getCurrentUrl()).pathname === '/', 15000);
      await ctx.h.ready();
      await ctx.h.dismissNotice();
      await ctx.h.open('/order/history');
      await ctx.verify((await ctx.driver.findElements(By.css(`.order-history-card[data-order-id="${sid(order._id)}"]`))).length, 0, 'Lịch sử B không chứa đơn của A');
      await snap(ctx, 'lich-su-B-khong-co-don-A', '.order-history-modern-container');

      for (const actor of ['B', 'khach-chua-dang-nhap']) {
        if (actor !== 'B') await ctx.h.open('/auth/logout');
        await ctx.h.open(route);
        const body = await ctx.driver.findElement(By.css('body')).getText();
        const disclosed = body.includes(order.shippingAddress.phone) || body.includes(order.shippingAddress.address);
        await ctx.verify(disclosed, false, `${actor} không được nhận địa chỉ hoặc điện thoại trong xác nhận đơn A`);
        await ctx.record('Đối chiếu quyền xem xác nhận đơn A', { actor, requestedOrderId: sid(order._id), path: new URL(await ctx.driver.getCurrentUrl()).pathname, privateRecipientVisible: disclosed });
        await snap(ctx, `${actor}-mo-cung-xac-nhan-don-A`, '.order-confirm-modern, main, form[action="/auth/login"]');
      }
      await ctx.h.open('/order/history');
      await ctx.verify(new URL(await ctx.driver.getCurrentUrl()).pathname, '/auth/login', 'Khách chưa đăng nhập không được xem lịch sử');
    },
  },
];
