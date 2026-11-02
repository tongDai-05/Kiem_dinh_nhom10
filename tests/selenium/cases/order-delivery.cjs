'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { By, until } = require('selenium-webdriver');

const clean = value => String(value ?? '').replace(/\s+/gu, ' ').trim();
const id = value => String(value ?? '');
const amount = value => Number(String(value).replace(/[^\d-]/gu, ''));
const stock = (product, size) => product.detail.find(item => item.size === size)?.stock;
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const commercialHash = order => {
  const copy = { ...order };
  delete copy.status;
  return hash(copy);
};
function preconditions(check) {
  try {
    check();
  } catch (error) {
    error.code = 'TEST_SETUP';
    throw error;
  }
}
const orderSummary = order => order && ({
  id: id(order._id), user: id(order.user), status: order.status,
  shipper: id(order.shiperID), shipDate: order.shipDate ?? null,
  totalAmount: order.totalAmount, paymentMethod: order.paymentMethod,
  items: (order.items || []).map(item => ({
    product: id(item.product), name: item.name, group: item.group,
    size: item.size, quantity: item.quantity, price: item.price,
  })),
});

async function observeChange(driver, predicate) {
  try {
    await driver.wait(predicate, 10000, 'Chờ website hoàn thành thao tác');
  } catch (error) {
    // A timeout remains observable through the following soft assertions.
    if (error.name !== 'TimeoutError') throw error;
  }
}

async function confirmAction(ctx, selector, expectedPrompt) {
  await ctx.h.visible(selector);
  await ctx.driver.findElement(By.css(selector)).click();
  const alert = await ctx.driver.wait(until.alertIsPresent(), 5000);
  const prompt = await alert.getText();
  await ctx.record('Hộp thoại xác nhận thao tác', { prompt });
  await alert.accept();
  await ctx.verify(prompt.includes(expectedPrompt), true, 'Website hỏi xác nhận đúng thao tác');
}

async function adminState(ctx, orderId) {
  const row = `#add-row tbody tr:has(form[action="/orders/detail"] input[value="${id(orderId)}"])`;
  await ctx.h.visible(row);
  return {
    selector: row,
    name: clean(await ctx.h.text(`${row} td:nth-child(1)`)),
    status: clean(await ctx.h.text(`${row} td:nth-child(6)`)),
    total: await ctx.h.money(`${row} td:nth-child(7)`),
  };
}

module.exports = [
  {
    id: 'UI-06',
    title: 'Đặt đơn từ giỏ với thông tin giao hàng hợp lệ',
    async run(ctx) {
      const { db, driver, fixture, h, snapshot, record, verify } = ctx;
      const users = db.collection('users');
      const products = db.collection('products');
      const orders = db.collection('orders');
      const userBefore = await users.findOne({ _id: fixture.user.id });
      const productBefore = await products.findOne({ _id: fixture.product.id });
      const ordersBefore = await orders.find({ user: fixture.user.id }).toArray();
      preconditions(() => {
        assert.ok(userBefore && productBefore, 'Thiếu dữ liệu khách hàng hoặc sản phẩm kiểm thử');
        assert.deepEqual(userBefore.carts.map(item => ({
          product: id(item.productID), type: item.type, size: item.size, quantity: item.orderNumber,
        })), [{ product: id(fixture.product.id), type: fixture.product.type, size: 'L', quantity: 2 }]);
        assert.equal(stock(productBefore, 'L'), 3, 'Ca phải bắt đầu với tồn size L bằng ba');
        assert.equal(productBefore.detail.find(item => item.size === 'L').price, 150000);
        assert.match(fixture.user.phone, /^\d{10}$/u);
        assert.match(fixture.user.gmail, /@example\.test$/u);
      });
      await record('Dữ liệu ban đầu của UI-06', {
        existingOrderCount: ordersBefore.length,
        existingOrderIds: ordersBefore.map(order => id(order._id)),
        cart: [{ product: id(fixture.product.id), type: fixture.product.type, size: 'L', quantity: 2 }],
        stock: productBefore.detail.map(item => ({ size: item.size, stock: item.stock })),
      });

      await h.loginUser();
      await h.open('/cart');
      const cartRow = `tr[data-product-id="${id(fixture.product.id)}"][data-type="${fixture.product.type}"][data-size="L"]`;
      await h.visible(cartRow);
      await verify((await h.text(cartRow)).includes(fixture.product.name), true, 'Giỏ hiển thị đúng sản phẩm');
      await verify(Number(await driver.findElement(By.css(`${cartRow} input.cart-qty-input`)).getAttribute('value')), 2, 'Giỏ có hai chiếc size L');
      await verify(await h.money(`${cartRow} td:nth-child(2) .summary-value`), 150000, 'Đơn giá trong giỏ là giá size L');
      await verify(await h.money('#cart-subtotal'), 300000, 'Tiền hàng trong giỏ là 300.000 đồng');
      await snapshot('UI-06-01-gio-size-L-truoc-thanh-toan');

      await h.click('a[href="/cart/checkout"]');
      await h.visible('#checkoutForm');
      const summary = clean(await h.text('.checkout-modern-summary > ul.list:not(.list_2)'));
      const checkoutLine = await h.money('.checkout-modern-summary > ul.list:not(.list_2) > li > span.fw-bold');
      const checkoutTotal = await h.money('.checkout-modern-summary .list_2 li > span:last-child');
      await verify(summary.includes(fixture.product.name), true, 'Tóm tắt thanh toán có đúng tên hàng');
      await verify(/x\s*2\b/u.test(summary), true, 'Tóm tắt thanh toán có hai chiếc');
      await verify(/\bL\b/u.test(summary), true, 'Tóm tắt thanh toán thể hiện size L để khách đối chiếu');
      await verify(checkoutLine, 300000, 'Tiền dòng hàng khi thanh toán dùng giá size L');
      await verify(checkoutTotal, 300000, 'Tổng thanh toán nhất quán với giỏ đang hiển thị miễn phí vận chuyển');
      await record('Tóm tắt trên giao diện trước đặt', { summary, checkoutLine, checkoutTotal });

      const recipient = {
        fullName: 'Nguyễn Selenium', address: fixture.user.address,
        phone: fixture.user.phone, email: fixture.user.gmail,
      };
      await h.fill('#firstName', 'Nguyễn');
      await h.fill('#lastName', 'Selenium');
      await h.fill('#address', recipient.address);
      await h.fill('#phone', recipient.phone);
      await h.fill('#email', recipient.email);
      await snapshot('UI-06-02-thong-tin-va-tom-tat-truoc-dat');
      await h.click('#checkoutForm button[type="submit"]');
      // The full-cart branch redirects to history; buy-now has a confirmation page.
      await h.visible('.order-history-modern-container, .order-confirm-modern .success-title');
      const confirmationShown = (await driver.findElements(By.css('.order-confirm-modern'))).length > 0;
      await record('Trang kết quả sau khi đặt toàn bộ giỏ', {
        path: new URL(await driver.getCurrentUrl()).pathname,
        view: confirmationShown ? 'confirmation' : 'history',
      });
      await snapshot(confirmationShown ? 'UI-06-03-xac-nhan-don-moi' : 'UI-06-03-lich-su-sau-dat');

      const userAfter = await users.findOne({ _id: fixture.user.id });
      const productAfter = await products.findOne({ _id: fixture.product.id });
      const ordersAfter = await orders.find({ user: fixture.user.id }).toArray();
      const oldIds = new Set(ordersBefore.map(order => id(order._id)));
      const newOrders = ordersAfter.filter(order => !oldIds.has(id(order._id)));
      await verify(ordersAfter.length - ordersBefore.length, 1, 'Một lần bấm tạo thêm đúng một đơn của khách hàng');
      await verify(newOrders.length, 1, 'Đối chiếu mã đơn mới với toàn bộ đơn có sẵn trước ca');
      await verify(stock(productAfter, 'L'), 1, 'Tồn size L giảm từ ba xuống một');
      await verify(stock(productAfter, 'M'), stock(productBefore, 'M'), 'Tồn size M giữ nguyên');
      await verify(userAfter.carts, [], 'Giỏ được xóa sau khi đặt toàn bộ giỏ');
      await record('Dữ liệu sau thao tác đặt hàng', {
        orderCountBefore: ordersBefore.length, orderCountAfter: ordersAfter.length,
        newOrders: newOrders.map(orderSummary), cartCountAfter: userAfter.carts.length,
        stock: productAfter.detail.map(item => ({ size: item.size, stock: item.stock })),
      });
      if (!newOrders.length) return;
      const order = newOrders[0];
      await verify(orderSummary(order), {
        id: id(order._id), user: id(fixture.user.id), status: 'pending', shipper: '', shipDate: null,
        totalAmount: 300000, paymentMethod: 'COD',
        items: [{ product: id(fixture.product.id), name: fixture.product.name, group: fixture.product.type, size: 'L', quantity: 2, price: 150000 }],
      }, 'Đơn lưu đúng người mua, hàng, size, số lượng, giá, trạng thái và COD');
      await verify({
        fullName: order.shippingAddress?.fullName, address: order.shippingAddress?.address,
        phone: order.shippingAddress?.phone, email: order.shippingAddress?.email,
      }, recipient, 'Đơn lưu đúng các thông tin giao hàng đã nhập');
      await verify(userAfter.orders.some(value => id(value) === id(order._id)), true, 'Đơn mới thuộc lịch sử của U-A');
      if (confirmationShown) {
        await verify(await h.money('.order-summary .total-row .text-danger'), order.totalAmount, 'Tổng tiền trên xác nhận khớp dữ liệu đã lưu');
      }
      await verify(checkoutTotal, order.totalAmount, 'Tổng trước đặt khớp tổng đơn sau đặt');

      await h.open('/order/history');
      const historyCard = `.order-history-card[data-order-id="${id(order._id)}"]`;
      await h.visible(historyCard);
      await verify(clean(await h.text(`${historyCard} .order-history-status`)), 'Chờ duyệt', 'Lịch sử hiển thị trạng thái chờ duyệt của đơn mới');
      await verify(await h.money(`${historyCard} .order-history-total`), 300000, 'Lịch sử có đúng tổng tiền đơn mới');
      await verify(await h.money(`${historyCard} .order-history-total`), order.totalAmount, 'Tổng tiền trên lịch sử khớp dữ liệu đơn đã lưu');
      await verify(clean(await h.text(`${historyCard} .product-name`)), fixture.product.name, 'Lịch sử hiển thị đúng mặt hàng');
      await verify(clean(await h.text(`${historyCard} .product-qty`)), 'x2', 'Lịch sử hiển thị đúng hai chiếc');
      await snapshot('UI-06-04-don-moi-trong-lich-su');
    },
  },
  {
    id: 'UI-07',
    title: 'Quản trị viên duyệt đúng đơn đang chờ',
    async run(ctx) {
      const { db, driver, fixture, h, snapshot, record, verify } = ctx;
      const orders = db.collection('orders');
      const pendingBefore = await orders.findOne({ _id: fixture.pendingOrder.id });
      const deliveredBefore = await orders.findOne({ _id: fixture.deliveredOrder.id });
      preconditions(() => {
        assert.ok(pendingBefore && deliveredBefore, 'Thiếu hai đơn độc lập của ca duyệt đơn');
        assert.equal(pendingBefore.status, 'pending');
        assert.equal(deliveredBefore.status, 'delivered');
        assert.ok(pendingBefore.items.length > 0);
      });
      await record('Hai đơn trước duyệt', { pending: orderSummary(pendingBefore), delivered: orderSummary(deliveredBefore) });

      await h.loginAdmin();
      await h.open('/orders', true);
      const pendingRow = await adminState(ctx, fixture.pendingOrder.id);
      const deliveredRow = await adminState(ctx, fixture.deliveredOrder.id);
      await verify(pendingRow.status, 'Chờ duyệt', 'O-P đang chờ duyệt trên giao diện quản trị');
      await verify(deliveredRow.status, 'Đã giao', 'O-D đã giao trước thao tác');
      await verify(pendingRow.name, pendingBefore.shippingAddress.fullName, 'Danh sách hiển thị đúng khách nhận O-P');
      await verify(pendingRow.total, pendingBefore.totalAmount, 'Danh sách hiển thị đúng tổng O-P');
      await snapshot('UI-07-01-hai-don-truoc-duyet');

      await h.click(`${pendingRow.selector} form[action="/orders/detail"] button[type="submit"]`);
      await h.visible('#add-row tbody tr');
      const detailRows = await driver.findElements(By.css('#add-row tbody tr'));
      const actualItems = [];
      for (const row of detailRows) {
        const cells = await row.findElements(By.css('td'));
        if (cells.length !== 6) continue;
        actualItems.push({
          name: clean(await cells[1].getText()), group: clean(await cells[2].getText()),
          size: clean(await cells[3].getText()), price: amount(await cells[4].getText()),
          quantity: Number(clean(await cells[5].getText())),
        });
      }
      await verify(actualItems, pendingBefore.items.map(item => ({
        name: item.name, group: item.group, size: item.size, price: Number(item.price), quantity: item.quantity,
      })), 'Chi tiết O-P khớp từng dòng hàng đã chuẩn bị');
      await snapshot('UI-07-02-chi-tiet-O-P');

      await h.click('a[href="/orders"]');
      await h.visible(pendingRow.selector);
      await h.click(`${pendingRow.selector} form[action="/orders/approved"] button[type="submit"]`);
      await observeChange(driver, async () => (await orders.findOne({ _id: fixture.pendingOrder.id }))?.status === 'waiting');
      await h.open('/orders', true);
      await h.dismissNotice();
      const approvedRow = await adminState(ctx, fixture.pendingOrder.id);
      const deliveredRowAfter = await adminState(ctx, fixture.deliveredOrder.id);
      await verify(approvedRow.status, 'Đã duyệt', 'O-P chuyển sang trạng thái đã duyệt trên giao diện');
      await verify(deliveredRowAfter.status, 'Đã giao', 'Giao diện O-D giữ trạng thái đã giao');
      const deliveredApprove = await driver.findElements(By.css(`${deliveredRowAfter.selector} form[action="/orders/approved"]`));
      await verify(deliveredApprove.length, 0, 'Giao diện không cung cấp nút duyệt lại O-D đã giao');
      await snapshot('UI-07-03-danh-sach-sau-duyet');

      const pendingAfter = await orders.findOne({ _id: fixture.pendingOrder.id });
      const deliveredAfter = await orders.findOne({ _id: fixture.deliveredOrder.id });
      await verify(pendingAfter.status, 'waiting', 'Dữ liệu O-P chuyển từ pending sang waiting');
      await verify(commercialHash(pendingAfter), commercialHash(pendingBefore), 'Duyệt đơn chỉ đổi trạng thái, giữ nguyên các trường còn lại');
      await verify(hash(deliveredAfter), hash(deliveredBefore), 'Toàn bộ dữ liệu O-D không đổi');
      await record('Hai đơn sau duyệt', { pending: orderSummary(pendingAfter), delivered: orderSummary(deliveredAfter) });

      // AdminSession and the customer/shipper session are separate session mechanisms.
      await h.loginShipper();
      await h.open('/shipper/orders');
      const acceptButton = `.accept-btn[data-id="${id(fixture.pendingOrder.id)}"]`;
      await h.visible(acceptButton);
      const waitingCard = `.card-body:has(${acceptButton})`;
      await verify((await h.text(waitingCard)).includes(id(fixture.pendingOrder.id)), true, 'Phiên shipper nhìn thấy đúng mã O-P vừa duyệt');
      const availableIds = await Promise.all((await driver.findElements(By.css('.accept-btn'))).map(button => button.getAttribute('data-id')));
      await verify(availableIds.includes(id(fixture.deliveredOrder.id)), false, 'O-D đã giao không xuất hiện trong danh sách có thể nhận');
      await record('Các mã đơn shipper có thể nhận sau duyệt', { availableOrderIds: availableIds });
      await snapshot('UI-07-04-O-P-trong-danh-sach-shipper');
    },
  },
  {
    id: 'UI-08',
    title: 'Shipper nhận và hoàn tất giao một đơn',
    async run(ctx) {
      const { db, driver, fixture, h, snapshot, record, verify } = ctx;
      const orders = db.collection('orders');
      const shippers = db.collection('shippers');
      const orderBefore = await orders.findOne({ _id: fixture.waitingOrder.id });
      const shipperBefore = await shippers.findOne({ user: fixture.shipper.id });
      preconditions(() => {
        assert.ok(orderBefore && shipperBefore, 'Thiếu đơn chờ giao hoặc hồ sơ shipper');
        assert.equal(orderBefore.status, 'waiting');
        assert.ok(!orderBefore.shiperID, 'O-W chưa được gán shipper');
        assert.equal(orderBefore.totalAmount, 300000);
        assert.equal(shipperBefore.totalEarnings, 0);
        assert.equal(shipperBefore.orderHistory.filter(item => id(item.order) === id(orderBefore._id)).length, 0);
      });
      const initialHistoryCount = shipperBefore.orderHistory.filter(item => item.status === 'delivered').length;
      const earningSelector = '.display-6.fw-bold.text-success';
      await record('Đơn và thu nhập trước nhận', { order: orderSummary(orderBefore), totalEarnings: shipperBefore.totalEarnings });

      await h.loginShipper();
      await h.open('/shipper/dashboard');
      await h.visible(earningSelector);
      await verify(await h.money(earningSelector), shipperBefore.totalEarnings, 'Thu nhập trên dashboard khớp mốc ban đầu');
      await snapshot('UI-08-01-thu-nhap-ban-dau');
      await h.click('a[href="/shipper/orders"]');
      const acceptButton = `.accept-btn[data-id="${id(orderBefore._id)}"]`;
      await h.visible(acceptButton);
      await verify(await h.money(`.card-body:has(${acceptButton}) > div:nth-of-type(4)`), 300000, 'Đơn chờ nhận có giá trị 300.000 đồng');
      await snapshot('UI-08-02-O-W-truoc-nhan');
      await confirmAction(ctx, acceptButton, 'nhận đơn');
      await observeChange(driver, async () => {
        const order = await orders.findOne({ _id: orderBefore._id });
        const shipper = await shippers.findOne({ user: fixture.shipper.id });
        return order?.status === 'shipping' && shipper?.orderHistory.some(item =>
          id(item.order) === id(orderBefore._id) && item.status === 'shipping');
      });
      const acceptedOrder = await orders.findOne({ _id: orderBefore._id });
      const acceptedShipper = await shippers.findOne({ user: fixture.shipper.id });
      await verify(acceptedOrder.status, 'shipping', 'Nhận đơn chuyển O-W sang đang giao');
      await verify(id(acceptedOrder.shiperID), id(fixture.shipper.id), 'O-W được gán đúng shipper S-A');
      await verify(acceptedShipper.totalEarnings, shipperBefore.totalEarnings, 'Nhận đơn chưa cộng tiền công');
      const acceptedHistory = acceptedShipper.orderHistory.filter(item => id(item.order) === id(orderBefore._id));
      await verify(acceptedHistory.map(item => ({ status: item.status, earning: item.earning, orderAmount: item.orderAmount })), [
        { status: 'shipping', earning: 0, orderAmount: 300000 },
      ], 'Lịch sử nhận ghi đúng một sự kiện đang giao và tiền công bằng không');
      await record('Dữ liệu sau nhận', { order: orderSummary(acceptedOrder), totalEarnings: acceptedShipper.totalEarnings });
      if (acceptedOrder.status !== 'shipping') return;

      await h.open('/shipper/shipping');
      const deliverButton = `.deliver-btn[data-id="${id(orderBefore._id)}"]`;
      await h.visible(deliverButton);
      await verify((await h.text(`.card-body:has(${deliverButton})`)).includes(id(orderBefore._id)), true, 'O-W nằm trong danh sách đơn đang giao');
      await snapshot('UI-08-03-O-W-dang-giao');
      await h.open('/shipper/dashboard');
      await verify(await h.money(earningSelector), shipperBefore.totalEarnings, 'Dashboard chưa tăng thu nhập khi mới nhận');
      await snapshot('UI-08-04-chua-cong-tien-khi-nhan');
      await h.open('/shipper/shipping');
      await confirmAction(ctx, deliverButton, 'đã giao thành công');
      await observeChange(driver, async () => {
        const order = await orders.findOne({ _id: orderBefore._id });
        const shipper = await shippers.findOne({ user: fixture.shipper.id });
        return order?.status === 'delivered' && shipper?.orderHistory.some(item =>
          id(item.order) === id(orderBefore._id) && item.status === 'delivered');
      });
      const deliveredOrder = await orders.findOne({ _id: orderBefore._id });
      const shipperAfter = await shippers.findOne({ user: fixture.shipper.id });
      const targetHistory = shipperAfter.orderHistory.filter(item => id(item.order) === id(orderBefore._id));
      await verify(deliveredOrder.status, 'delivered', 'Hoàn tất giao chuyển O-W sang đã giao');
      await verify(id(deliveredOrder.shiperID), id(fixture.shipper.id), 'Đơn đã giao vẫn thuộc S-A');
      await verify(deliveredOrder.shipDate instanceof Date && Number.isFinite(deliveredOrder.shipDate.getTime()), true, 'Đơn có ngày giao hợp lệ');
      await verify(shipperAfter.totalEarnings - shipperBefore.totalEarnings, 12000, 'Thu nhập tăng đúng 12.000 đồng sau giao thành công');
      await verify(targetHistory.map(item => ({ status: item.status, earning: item.earning, orderAmount: item.orderAmount })), [
        { status: 'shipping', earning: 0, orderAmount: 300000 },
        { status: 'delivered', earning: 12000, orderAmount: 300000 },
      ], 'Lịch sử O-W có đúng các sự kiện nhận và giao, không cộng tiền công hai lần');
      await record('Dữ liệu sau giao thành công', {
        order: orderSummary(deliveredOrder), totalEarningsBefore: shipperBefore.totalEarnings,
        totalEarningsAfter: shipperAfter.totalEarnings,
        history: targetHistory.map(item => ({ status: item.status, earning: item.earning, updatedAt: item.updatedAt })),
      });

      await h.open('/shipper/history');
      const cards = await driver.findElements(By.css('.card-body'));
      let targetCard;
      for (const card of cards) {
        if ((await card.getText()).includes(id(orderBefore._id))) { targetCard = card; break; }
      }
      await verify(Boolean(targetCard), true, 'Lịch sử giao hiển thị đúng mã O-W');
      if (targetCard) {
        const historyText = clean(await targetCard.getText());
        await verify(historyText.includes(orderBefore.shippingAddress.fullName), true, 'Lịch sử hiển thị đúng khách nhận');
        await verify(amount(await targetCard.findElement(By.css('.text-success.fw-bold')).getText()), 12000, 'Lịch sử hiển thị tiền công 12.000 đồng');
      }
      await snapshot('UI-08-05-lich-su-giao-O-W');
      await h.open('/shipper/dashboard');
      await verify(await h.money(earningSelector), shipperBefore.totalEarnings + 12000, 'Dashboard hiển thị tổng thu nhập sau giao');
      await verify(Number(clean(await h.text('.display-6.fw-bold.text-info'))), initialHistoryCount + 1, 'Bộ đếm lịch sử tăng đúng một lần');
      await snapshot('UI-08-06-thu-nhap-sau-giao');
    },
  },
];
