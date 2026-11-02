'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const net = require('node:net');
const http = require('node:http');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { isDeepStrictEqual } = require('node:util');
const { Builder, Browser, By, until } = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');
const { createFixtures } = require('../selenium/fixtures.cjs');

const ROOT = path.resolve(__dirname, '../..');
const OUTPUT = path.join(ROOT, 'tests/evidence/advanced');
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const text = value => String(value ?? '').replace(/\s+/gu, ' ').trim();
const id = value => String(value ?? '');

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const value = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return value;
}

class Session {
  constructor(baseUrl) { this.baseUrl = baseUrl; this.cookies = new Map(); }
  cookieHeader() { return [...this.cookies].map(([key, value]) => `${key}=${value}`).join('; '); }
  async request(route, options = {}) {
    const headers = { Accept: options.accept || 'application/json', ...(options.headers || {}) };
    const cookie = options.cookie === undefined ? this.cookieHeader() : options.cookie;
    if (cookie) headers.Cookie = cookie;
    let body;
    if (options.json !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(options.json);
    } else if (options.form !== undefined) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      body = new URLSearchParams(options.form).toString();
    }
    const startedAt = new Date();
    const response = await fetch(this.baseUrl + route, {
      method: options.method || (body ? 'POST' : 'GET'), headers, body, redirect: 'manual', signal: AbortSignal.timeout(15000),
    });
    for (const raw of response.headers.getSetCookie?.() || []) {
      const pair = raw.split(';', 1)[0];
      const index = pair.indexOf('=');
      if (index > 0) this.cookies.set(pair.slice(0, index), pair.slice(index + 1));
    }
    const raw = await response.text();
    let data = null;
    try { data = JSON.parse(raw); } catch { /* HTML or empty response. */ }
    return {
      status: response.status, location: response.headers.get('location'), contentType: response.headers.get('content-type'),
      body: raw.slice(0, 4000), json: data, startedAt: startedAt.toISOString(), finishedAt: new Date().toISOString(),
    };
  }
  login(account, password, route = '/auth/login') { return this.request(route, { form: { account, password } }); }
}

function serial(value) {
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return `[buffer ${value.length}]`;
  if (Array.isArray(value)) return value.map(serial);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, serial(item)]));
  return value;
}

function createResult(test) {
  return { id: test.id, title: test.title, status: 'ERROR', startedAt: new Date().toISOString(), assertions: [], observations: [], screenshots: [] };
}

function createContext(result, environment, urls, directory) {
  return {
    ...environment, urls, directory,
    check(actual, expected, message) {
      const passed = isDeepStrictEqual(serial(actual), serial(expected));
      result.assertions.push({ message, expected: serial(expected), actual: serial(actual), passed });
      console.log(`  ${passed ? 'OK' : 'SAI'}: ${message}`);
      return passed;
    },
    observe(label, data) { result.observations.push({ label, data: serial(data) }); },
  };
}

async function buildChrome(width = 1440, height = 1000) {
  process.env.SE_CACHE_PATH = path.join(ROOT, 'tests/.cache/selenium');
  process.env.SE_AVOID_STATS = 'true';
  const options = new chrome.Options().addArguments(`--window-size=${width},${height}`, '--headless=new', '--no-first-run');
  const driver = await new Builder().disableEnvironmentOverrides().forBrowser(Browser.CHROME).setChromeOptions(options).build();
  await driver.manage().setTimeouts({ pageLoad: 45000, script: 15000, implicit: 0 });
  return driver;
}

async function quitDriver(driver) {
  await Promise.race([driver.quit(), sleep(12000)]).catch(() => {});
}

async function browserLogin(driver, baseUrl, account, password, shipper = false) {
  await driver.get(baseUrl + (shipper ? '/auth/shipper-login' : '/auth/login'));
  await driver.findElement(By.css('#account')).sendKeys(account);
  await driver.findElement(By.css('#password')).sendKeys(password);
  await driver.findElement(By.css(`form[action="${shipper ? '/auth/shipper-login' : '/auth/login'}"] button[type="submit"]`)).click();
  await driver.wait(async () => new URL(await driver.getCurrentUrl()).pathname !== (shipper ? '/auth/shipper-login' : '/auth/login'), 15000);
}

async function screenshot(driver, directory, result, name) {
  const filename = `${result.id}-${String(result.screenshots.length + 1).padStart(2, '0')}-${name}.png`;
  const relative = `screenshots/${filename}`;
  await fs.writeFile(path.join(directory, relative), await driver.takeScreenshot(), 'base64');
  result.screenshots.push({ name, path: relative, url: await driver.getCurrentUrl(), capturedAt: new Date().toISOString() });
}

async function addSecondShipper(ctx) {
  const { db, f } = ctx;
  const first = await db.collection('users').findOne({ _id: f.shipper.id });
  const second = { id: new first._id.constructor(), account: 'advanced_shipper_b', password: f.shipper.password, name: 'Shipper Advanced B' };
  await db.collection('users').insertOne({
    _id: second.id, account: second.account, password: first.password, name: second.name,
    gmail: 'advanced-shipper-b@example.test', phone: '0900000099', address: 'Địa chỉ kiểm thử B',
    role: 'Shipper', carts: [], orders: [], wishlist: [], reviewProducts: [],
  });
  await db.collection('shippers').insertOne({ user: second.id, totalEarnings: 0, orderHistory: [] });
  return second;
}

const TESTS = [
  {
    id: 'ADV-01', title: 'Hai khách cùng mua sản phẩm cuối của một size',
    async run(ctx) {
      const { db, f, urls, check, observe } = ctx;
      await db.collection('products').updateOne({ _id: f.product.id }, { $set: { 'detail.0.stock': 10, 'detail.1.stock': 1 } });
      const a = new Session(urls.user), b = new Session(urls.user);
      await Promise.all([a.login(f.user.account, f.user.password), b.login(f.otherUser.account, f.otherUser.password)]);
      const request = session => session.request('/order/quick-order', { json: {
        name: f.product.name, type: f.product.type, size: 'L', price: 150000, quantity: 1, productId: id(f.product.id),
        shippingAddress: { fullName: 'Người nhận ADV01', address: 'Địa chỉ ADV01', phone: '0900000011', email: 'adv01@example.test' },
      } });
      const responses = await Promise.all([request(a), request(b)]);
      const product = await db.collection('products').findOne({ _id: f.product.id });
      const orders = await db.collection('orders').find({ 'shippingAddress.email': 'adv01@example.test' }).toArray();
      const success = responses.filter(item => item.status === 200 && item.json?.success === true).length;
      observe('Hai phản hồi gần đồng thời', responses.map(item => ({ status: item.status, success: item.json?.success, startedAt: item.startedAt, finishedAt: item.finishedAt })));
      check(success, 1, 'Chỉ một khách nhận phản hồi đặt thành công');
      check(responses.map(item => item.status).sort((x, y) => x - y), [200, 400], 'Một yêu cầu thành công và một yêu cầu bị từ chối');
      check(orders.length, 1, 'Chỉ tạo một đơn dùng chiếc L cuối');
      check(product.detail.find(item => item.size === 'L').stock, 0, 'Tồn size L về 0');
      check(product.detail.find(item => item.size === 'M').stock, 10, 'Tồn size M giữ nguyên 10');
      check(product.detail.every(item => item.stock >= 0), true, 'Không có tồn kho âm');
    },
  },
  {
    id: 'ADV-02', title: 'Hai shipper cùng nhận một đơn',
    async run(ctx) {
      const { db, f, urls, check, observe } = ctx;
      const second = await addSecondShipper(ctx);
      const a = new Session(urls.user), b = new Session(urls.user);
      await Promise.all([a.login(f.shipper.account, f.shipper.password, '/auth/shipper-login'), b.login(second.account, second.password, '/auth/shipper-login')]);
      const accept = session => session.request('/shipper/accept', { json: { orderId: id(f.waitingOrder.id) } });
      const responses = await Promise.all([accept(a), accept(b)]);
      const order = await db.collection('orders').findOne({ _id: f.waitingOrder.id });
      const histories = await db.collection('shippers').find({}).toArray();
      const entries = histories.flatMap(shipper => shipper.orderHistory.filter(item => id(item.order) === id(f.waitingOrder.id)).map(item => ({ user: id(shipper.user), status: item.status })));
      observe('Hai phản hồi nhận đơn', responses.map(item => ({ status: item.status, success: item.json?.success, startedAt: item.startedAt, finishedAt: item.finishedAt })));
      check(responses.filter(item => item.status === 200 && item.json?.success).length, 1, 'Chỉ một shipper được báo nhận thành công');
      check(order.status, 'shipping', 'Đơn chuyển sang đang giao');
      check([id(f.shipper.id), id(second.id)].includes(id(order.shiperID)), true, 'Đơn được gán cho một trong hai shipper thử');
      check(entries.length, 1, 'Chỉ lịch sử của người thắng ghi nhận đã nhận đơn');
      check(entries[0]?.user, id(order.shiperID), 'Lịch sử nhận thuộc đúng shipper cuối cùng của đơn');
    },
  },
  {
    id: 'ADV-03', title: 'Xác nhận giao lặp không cộng tiền công nhiều lần',
    async run(ctx) {
      const { db, f, urls, check, observe, reset } = ctx;
      async function prepareShipping() {
        await db.collection('orders').updateOne({ _id: f.waitingOrder.id }, { $set: { status: 'shipping', shiperID: f.shipper.id }, $unset: { shipDate: '' } });
        await db.collection('shippers').updateOne({ user: f.shipper.id }, { $set: { totalEarnings: 0, orderHistory: [] } }, { upsert: true });
      }
      await prepareShipping();
      let session = new Session(urls.user);
      await session.login(f.shipper.account, f.shipper.password, '/auth/shipper-login');
      const sequential = [await session.request('/shipper/deliver', { json: { orderId: id(f.waitingOrder.id) } }), await session.request('/shipper/deliver', { json: { orderId: id(f.waitingOrder.id) } })];
      let shipper = await db.collection('shippers').findOne({ user: f.shipper.id });
      check(sequential.filter(item => item.status === 200 && item.json?.success).length, 1, 'Giao lặp tuần tự chỉ thành công một lần');
      check(shipper.totalEarnings, 12000, 'Giao lặp tuần tự chỉ cộng 12.000 đồng');
      check(shipper.orderHistory.filter(item => item.status === 'delivered').length, 1, 'Giao lặp tuần tự chỉ lưu một sự kiện đã giao');

      await reset('ADV-03-concurrent');
      await prepareShipping();
      session = new Session(urls.user);
      await session.login(f.shipper.account, f.shipper.password, '/auth/shipper-login');
      const concurrent = await Promise.all([
        session.request('/shipper/deliver', { json: { orderId: id(f.waitingOrder.id) } }),
        session.request('/shipper/deliver', { json: { orderId: id(f.waitingOrder.id) } }),
      ]);
      shipper = await db.collection('shippers').findOne({ user: f.shipper.id });
      const order = await db.collection('orders').findOne({ _id: f.waitingOrder.id });
      observe('Hai phản hồi giao đồng thời', concurrent.map(item => ({ status: item.status, success: item.json?.success, startedAt: item.startedAt, finishedAt: item.finishedAt })));
      check(concurrent.filter(item => item.status === 200 && item.json?.success).length, 1, 'Giao đồng thời chỉ thành công một lần');
      check(order.status, 'delivered', 'Đơn kết thúc ở trạng thái đã giao');
      check(shipper.totalEarnings, 12000, 'Giao đồng thời chỉ cộng tiền công một lần');
      check(shipper.orderHistory.filter(item => item.status === 'delivered').length, 1, 'Giao đồng thời chỉ lưu một sự kiện đã giao');

      await reset('ADV-03-owner');
      await prepareShipping();
      const second = await addSecondShipper(ctx);
      const outsider = new Session(urls.user);
      await outsider.login(second.account, second.password, '/auth/shipper-login');
      const denied = await outsider.request('/shipper/deliver', { json: { orderId: id(f.waitingOrder.id) } });
      const unchanged = await db.collection('orders').findOne({ _id: f.waitingOrder.id });
      const outsiderData = await db.collection('shippers').findOne({ user: second.id });
      check(denied.status, 400, 'Shipper khác bị từ chối giao đơn');
      check(unchanged.status, 'shipping', 'Đơn giữ trạng thái đang giao sau yêu cầu sai chủ');
      check(id(unchanged.shiperID), id(f.shipper.id), 'Đơn vẫn thuộc shipper ban đầu');
      check(outsiderData.totalEarnings, 0, 'Shipper khác không được cộng tiền');
    },
  },
  {
    id: 'ADV-04', title: 'Xử lý dữ liệu nhập sai và nội dung hiển thị bất thường',
    async run(ctx) {
      const { db, f, urls, check, observe, reset } = ctx;
      const guest = new Session(urls.user);
      const loginSamples = [
        { name: 'trường rỗng', form: { account: '', password: '' } },
        { name: 'chuỗi tài khoản dài 10001 ký tự', form: { account: 'A'.repeat(10001), password: f.user.password } },
        { name: 'cú pháp khóa truy vấn trong tên trường', form: { 'account[$gt]': '', 'password[$gt]': '' } },
      ];
      for (const sample of loginSamples) {
        const response = await guest.request('/auth/login', { form: sample.form });
        check(response.status < 500, true, `${sample.name}: máy chủ xử lý có kiểm soát`);
        const profile = await guest.request('/auth/profile', { accept: 'text/html' });
        check(profile.status, 302, `${sample.name}: không phát sinh phiên đăng nhập`);
      }
      const marker = '<qa-marker data-id="ADV04">Nội dung thử</qa-marker>';
      const search = await guest.request('/products?keyword=' + encodeURIComponent(marker), { accept: 'text/html' });
      check(search.status, 200, 'Từ khóa có dấu HTML không làm lỗi máy chủ');
      check(search.body.includes('<qa-marker'), false, 'Dấu HTML bất hoạt không trở thành phần tử trong trang');

      const samples = [
        { name: 'số lượng âm', value: -1 }, { name: 'số lượng bằng không', value: 0 }, { name: 'số lượng số lẻ', value: 1.5 },
      ];
      for (const sample of samples) {
        await reset('ADV-04-' + sample.name);
        const user = new Session(urls.user);
        await user.login(f.user.account, f.user.password);
        const response = await user.request('/cart/add', { json: { productID: id(f.product.id), orderNumber: sample.value, type: f.product.type, size: 'M' } });
        const stored = await db.collection('users').findOne({ _id: f.user.id });
        observe(sample.name, { response: { status: response.status, json: response.json }, carts: stored.carts });
        check(response.json?.success, false, `${sample.name}: yêu cầu bị từ chối`);
        check(stored.carts.length, 0, `${sample.name}: không lưu dòng giỏ sai`);
      }
      await reset('ADV-04-invalid-id');
      const user = new Session(urls.user);
      await user.login(f.user.account, f.user.password);
      const invalid = await user.request('/cart/add', { json: { productID: 'khong-phai-object-id', orderNumber: 1, type: f.product.type, size: 'M' } });
      const stored = await db.collection('users').findOne({ _id: f.user.id });
      check(invalid.status < 500, true, 'Mã sản phẩm sai không trả lỗi máy chủ 5xx');
      check(invalid.json?.success, false, 'Mã sản phẩm sai bị từ chối');
      check(stored.carts.length, 0, 'Mã sản phẩm sai không làm thay đổi giỏ');
    },
  },
  {
    id: 'ADV-05', title: 'Đúng vai trò, đúng chủ sở hữu và hết quyền sau đăng xuất',
    async run(ctx) {
      const { db, f, urls, check } = ctx;
      await db.collection('users').updateOne({ _id: f.otherUser.id }, { $set: { orders: [f.pendingOrder.id, f.deliveredOrder.id, f.waitingOrder.id] } });
      const privateAddress = 'DIA_CHI_RIENG_ADV05';
      await db.collection('orders').updateOne({ _id: f.pendingOrder.id }, { $set: {
        shippingAddress: { fullName: 'NGUOI_NHAN_RIENG_ADV05', address: privateAddress, phone: '0900090505', email: 'private-adv05@example.test' },
        shipAddress: privateAddress,
      } });
      const privateOrder = await db.collection('orders').findOne({ _id: f.pendingOrder.id });
      check(privateOrder.shippingAddress.address, privateAddress, 'Dữ liệu riêng dùng cho ca kiểm thử được chuẩn bị đúng');
      const guest = new Session(urls.user);
      const guestView = await guest.request('/order/checkout?orderId=' + id(f.pendingOrder.id), { accept: 'text/html' });
      check([302, 401, 403].includes(guestView.status), true, 'Khách chưa đăng nhập không xem xác nhận đơn riêng');
      check(guestView.body.includes(privateAddress), false, 'Phản hồi khách không lộ địa chỉ riêng');
      const user = new Session(urls.user);
      await user.login(f.user.account, f.user.password);
      const otherView = await user.request('/order/checkout?orderId=' + id(f.pendingOrder.id), { accept: 'text/html' });
      check([302, 401, 403].includes(otherView.status), true, 'Khách A không xem xác nhận đơn của khách B');
      check(otherView.body.includes(privateAddress), false, 'Phản hồi khách A không lộ địa chỉ của B');
      const cancel = await user.request('/order/cancel', { json: { orderId: id(f.pendingOrder.id) } });
      check(cancel.status, 403, 'Khách A không hủy được đơn của B');
      const accept = await user.request('/shipper/accept', { json: { orderId: id(f.waitingOrder.id) } });
      check(accept.status, 403, 'Khách thường không nhận được đơn shipper');
      const beforeLogout = user.cookieHeader();
      await user.request('/auth/logout', { accept: 'text/html' });
      const replay = await user.request('/auth/profile', { accept: 'text/html', cookie: beforeLogout });
      check(replay.status, 302, 'Cookie cũ sau đăng xuất không mở lại hồ sơ');
      const order = await db.collection('orders').findOne({ _id: f.pendingOrder.id });
      check(order.status, 'pending', 'Các yêu cầu trái quyền không thay đổi đơn');
    },
  },
  {
    id: 'ADV-06', title: 'Thay đổi dữ liệu phải có sự cho phép đúng',
    async run(ctx, result) {
      const { db, f, urls, check, directory } = ctx;
      const before = await db.collection('users').findOne({ _id: f.user.id });
      const driver = await buildChrome();
      let attacker;
      try {
        await browserLogin(driver, urls.user, f.user.account, f.user.password);
        await driver.get(urls.user + '/products/' + encodeURIComponent(f.product.name));
        const afterRead = await db.collection('users').findOne({ _id: f.user.id });
        check(afterRead.carts, before.carts, 'Chỉ mở trang xem sản phẩm không thay đổi giỏ');
        const attackerPort = await freePort();
        attacker = http.createServer((request, response) => {
          response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          response.end(`<!doctype html><meta charset="utf-8"><form id="controlled" method="post" action="${urls.user}/cart/add"><input name="productID" value="${id(f.product.id)}"><input name="orderNumber" value="1"><input name="type" value="${f.product.type}"><input name="size" value="M"><button id="submit">Gửi yêu cầu kiểm thử</button></form>`);
        });
        await new Promise((resolve, reject) => { attacker.once('error', reject); attacker.listen(attackerPort, '127.0.0.1', resolve); });
        await driver.get(`http://127.0.0.1:${attackerPort}/controlled`);
        await screenshot(driver, directory, result, 'trang-kiem-thu-kiem-soat');
        await driver.findElement(By.css('#submit')).click();
        await driver.wait(async () => (await driver.getPageSource()).includes('success'), 10000);
        const afterAttack = await db.collection('users').findOne({ _id: f.user.id });
        check(afterAttack.carts.length, 0, 'Yêu cầu thay đổi từ trang khác bị chặn và giỏ giữ nguyên');
        await screenshot(driver, directory, result, 'phan-hoi-sau-yeu-cau-khac-nguon');
      } finally {
        if (attacker) {
          // Chrome may keep the local test page's HTTP/1.1 connection alive.
          // Close active sockets first so cleanup cannot hang indefinitely.
          attacker.closeAllConnections?.();
          await Promise.race([
            new Promise(resolve => attacker.close(resolve)),
            sleep(2000),
          ]);
        }
        await quitDriver(driver);
      }
    },
  },
  {
    id: 'ADV-08', title: 'Thao tác được ở kích thước desktop, tablet và điện thoại',
    async run(ctx, result) {
      const { db, f, urls, check, observe, reset, directory } = ctx;
      const viewports = [[1366, 768, 'desktop'], [768, 1024, 'tablet'], [375, 812, 'dien-thoai']];
      const driver = await buildChrome();
      try {
        for (const [width, height, label] of viewports) {
          await reset('UI-06');
          await driver.manage().deleteAllCookies();
          await driver.manage().window().setRect({ width, height, x: 0, y: 0 });
          await browserLogin(driver, urls.user, f.user.account, f.user.password);
          const pages = [
            ['/products', '.latest-product-area', 'danh-sach'],
            ['/products/' + encodeURIComponent(f.product.name), '#addToCartBtn', 'chi-tiet'],
            ['/cart', '.cart-table-modern', 'gio'],
            ['/cart/checkout', '#checkoutForm', 'thanh-toan'],
          ];
          for (const [route, selector, pageLabel] of pages) {
            await driver.get(urls.user + route);
            const element = await driver.wait(until.elementLocated(By.css(selector)), 15000);
            check(await element.isDisplayed(), true, `${label} ${pageLabel}: nội dung chính hiển thị`);
            const metrics = await driver.executeScript('return {innerWidth: window.innerWidth, innerHeight: window.innerHeight, scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight};');
            observe(`${label} ${pageLabel}`, metrics);
            check(metrics.scrollWidth <= metrics.innerWidth + 2, true, `${label} ${pageLabel}: không có cuộn ngang toàn trang`);
            await screenshot(driver, directory, result, `${label}-${pageLabel}`);
          }
          await driver.get(urls.user + '/cart');
          await driver.wait(async () => {
            const preloaders = await driver.findElements(By.css('.preloader'));
            return preloaders.length === 0 || !(await preloaders[0].isDisplayed());
          }, 10000);
          const up = await driver.findElement(By.css('.cart-qty-up'));
          await driver.executeScript('arguments[0].scrollIntoView({block:"center"})', up);
          await up.click();
          await driver.wait(async () => (await db.collection('users').findOne({ _id: f.user.id })).carts[0]?.orderNumber === 3, 10000);
          const cart = await db.collection('users').findOne({ _id: f.user.id });
          check(cart.carts[0]?.orderNumber, 3, `${label}: đổi số lượng trong giỏ lưu đúng`);
          await driver.get(urls.user + '/cart/checkout');
          for (const [selector, value] of [['#firstName', 'Nguyen'], ['#lastName', 'ADV08'], ['#address', 'Dia chi ADV08'], ['#phone', '0900000088'], ['#email', 'adv08@example.test']]) {
            const field = await driver.findElement(By.css(selector)); await field.clear(); await field.sendKeys(value);
          }
          check(await driver.findElement(By.css('#address')).getAttribute('value'), 'Dia chi ADV08', `${label}: nhập được địa chỉ giao hàng`);
          await screenshot(driver, directory, result, `${label}-bieu-mau-da-nhap`);
        }
      } finally { await quitDriver(driver); }
    },
  },
];

async function runProcess(command, args, options = {}) {
  const child = spawn(command, args, { ...options, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
  return { code, stdout, stderr };
}

async function latestSeleniumRun(browser, after) {
  const root = path.join(ROOT, 'tests/evidence/selenium');
  const entries = await fs.readdir(root, { withFileTypes: true });
  const candidates = entries.filter(entry => entry.isDirectory() && entry.name.endsWith('-' + browser)).map(entry => entry.name).sort().reverse();
  for (const name of candidates) {
    const file = path.join(root, name, 'results.json');
    const stat = await fs.stat(file).catch(() => null);
    if (stat && stat.mtimeMs >= after - 2000) return { name, data: JSON.parse(await fs.readFile(file, 'utf8')) };
  }
  return null;
}

async function runCrossBrowser(directory) {
  const result = createResult({ id: 'ADV-07', title: 'Cùng nghiệp vụ trên Chrome và Firefox' });
  const logs = {};
  const runs = {};
  for (const browser of ['chrome', 'firefox']) {
    const started = Date.now();
    const execution = await runProcess(process.execPath, ['tests/selenium/run.cjs', '--browser=' + browser], { cwd: ROOT, env: process.env });
    logs[browser] = execution;
    await fs.writeFile(path.join(directory, `selenium-${browser}.log`), execution.stdout + '\n' + execution.stderr);
    runs[browser] = await latestSeleniumRun(browser, started);
  }
  if (!runs.firefox || !runs.chrome || runs.firefox.data.tests.every(test => test.status === 'ERROR')) {
    result.status = 'BLOCKED';
    result.error = 'Không tạo được lượt Firefox đầy đủ trên máy hiện tại. Xem selenium-firefox.log.';
  } else {
    const chromeTests = Object.fromEntries(runs.chrome.data.tests.map(test => [test.id, test]));
    const firefoxTests = Object.fromEntries(runs.firefox.data.tests.map(test => [test.id, test]));
    for (const caseId of Object.keys(chromeTests).sort()) {
      const a = chromeTests[caseId], b = firefoxTests[caseId];
      const actual = b ? { status: b.status, assertions: b.assertions.map(item => ({ message: item.message, passed: item.passed })) } : null;
      const expected = { status: a.status, assertions: a.assertions.map(item => ({ message: item.message, passed: item.passed })) };
      result.assertions.push({ message: `${caseId}: Firefox có kết quả nghiệp vụ tương đương Chrome`, expected, actual, passed: isDeepStrictEqual(actual, expected) });
    }
    result.status = result.assertions.every(item => item.passed) ? 'PASS' : 'FAIL';
  }
  result.observations.push({ label: 'Lượt Selenium', data: { chrome: runs.chrome?.name || null, firefox: runs.firefox?.name || null, exitCodes: { chrome: logs.chrome.code, firefox: logs.firefox.code } } });
  result.finishedAt = new Date().toISOString();
  return result;
}

function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]); }

async function writeReport(run, directory) {
  run.totals = Object.fromEntries(['PASS', 'FAIL', 'ERROR', 'BLOCKED'].map(status => [status, run.tests.filter(test => test.status === status).length]));
  run.finishedAt = new Date().toISOString();
  await fs.writeFile(path.join(directory, 'results.json'), JSON.stringify(run, null, 2));
  const rows = run.tests.map(test => `<tr><td>${test.id}</td><td>${escapeHtml(test.title)}</td><td class="${test.status}">${test.status}</td><td>${test.assertions.filter(item => item.passed).length}/${test.assertions.length}</td></tr>`).join('');
  const details = run.tests.map(test => `<section><h2>${test.id} ${escapeHtml(test.title)}</h2><p><b>Trạng thái:</b> <span class="${test.status}">${test.status}</span></p>${test.error ? `<p>${escapeHtml(test.error)}</p>` : ''}<table><tr><th>Đối chiếu</th><th>Mong đợi</th><th>Thực tế</th><th>Kết quả</th></tr>${test.assertions.map(item => `<tr><td>${escapeHtml(item.message)}</td><td><pre>${escapeHtml(JSON.stringify(item.expected, null, 2))}</pre></td><td><pre>${escapeHtml(JSON.stringify(item.actual, null, 2))}</pre></td><td class="${item.passed ? 'PASS' : 'FAIL'}">${item.passed ? 'Đúng' : 'Sai'}</td></tr>`).join('')}</table></section>`).join('');
  const html = `<!doctype html><html lang="vi"><meta charset="utf-8"><title>Kết quả kiểm thử nâng cao</title><style>body{font:16px/1.5 Arial;margin:36px auto;max-width:1180px;padding:0 24px;color:#17202a}table{border-collapse:collapse;width:100%;margin:20px 0}td,th{border:1px solid #cfd5db;padding:9px;text-align:left;vertical-align:top}th{background:#e7eef6}.PASS{color:#166534}.FAIL,.ERROR{color:#b91c1c}.BLOCKED{color:#92400e}pre{white-space:pre-wrap;word-break:break-word}section{margin-top:36px;border-top:1px solid #ddd}</style><h1>Kết quả tám ca kiểm thử nâng cao</h1><p>${escapeHtml(run.localTime)}</p><table><tr><th>Mã</th><th>Nội dung</th><th>Trạng thái</th><th>Đối chiếu đúng</th></tr>${rows}</table>${details}</html>`;
  await fs.writeFile(path.join(directory, 'report.html'), html);
}

async function main() {
  const args = process.argv.slice(2);
  const only = args.find(argument => argument.startsWith('--case='))?.slice(7).toUpperCase() || null;
  const skipCross = args.includes('--skip-cross');
  if (args.some(argument => argument !== '--skip-cross' && !argument.startsWith('--case='))) throw new Error('Tùy chọn hợp lệ: --case=ADV-01 và --skip-cross');
  if (only && ![...TESTS.map(test => test.id), 'ADV-07'].includes(only)) throw new Error('Mã ca hợp lệ ADV-01 đến ADV-08.');
  const startedAt = new Date();
  const runId = startedAt.toISOString().replace(/[:.]/g, '-');
  const directory = path.join(OUTPUT, runId);
  await fs.mkdir(path.join(directory, 'screenshots'), { recursive: true });
  const run = {
    id: runId, startedAt: startedAt.toISOString(),
    localTime: new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Bangkok', dateStyle: 'full', timeStyle: 'long' }).format(startedAt),
    environment: 'Hai ứng dụng thật trên cổng ngẫu nhiên, MongoDB tạm riêng và dữ liệu giả; không dùng database của người dùng.',
    tests: [], cleanupErrors: [], sourceHashes: {},
  };
  for (const filename of ['user/controllers/orderController.js', 'user/controllers/shipperController.js', 'user/controllers/cartController.js', 'tests/advanced/run.cjs', 'tests/selenium/run.cjs']) {
    run.sourceHashes[filename] = crypto.createHash('sha256').update(await fs.readFile(path.join(ROOT, filename))).digest('hex');
  }
  const processes = [];
  let environment;
  async function startApp(name, port) {
    const log = await fs.open(path.join(directory, `${name}-app.log`), 'w');
    const child = spawn(process.execPath, ['server.js'], {
      cwd: path.join(ROOT, name), windowsHide: true,
      env: { ...process.env, NODE_ENV: 'test', PORT: String(port), MONGODB_URI: environment.uri, ADMIN_ACCOUNT: environment.fixture.admin.account, ADMIN_PASSWORD: environment.fixture.admin.password, SESSION_SECRET: 'advanced-' + crypto.randomBytes(24).toString('hex') },
      stdio: ['ignore', log.fd, log.fd],
    });
    processes.push({ child, log });
    const base = `http://127.0.0.1:${port}`;
    for (let attempt = 0; attempt < 120; attempt += 1) {
      if (child.exitCode !== null) throw new Error(`${name} dừng khi khởi động.`);
      try { const response = await fetch(base + (name === 'admin' ? '/login' : '/auth/login'), { signal: AbortSignal.timeout(1000) }); await response.text(); if (response.status === 200) return base; } catch { /* wait */ }
      await sleep(200);
    }
    throw new Error(`Không khởi động được ${name}.`);
  }
  async function cleanup() {
    for (const processInfo of processes) {
      if (processInfo.child.exitCode === null) processInfo.child.kill();
      await Promise.race([new Promise(resolve => processInfo.child.once('exit', resolve)), sleep(1500)]);
      await processInfo.log.close().catch(error => run.cleanupErrors.push(error.message));
    }
    if (environment) await environment.close().catch(error => run.cleanupErrors.push(error.message));
  }
  try {
    environment = await createFixtures();
    const urls = { user: await startApp('user', await freePort()), admin: await startApp('admin', await freePort()) };
    run.urls = urls;
    for (const test of TESTS.filter(test => !only || test.id === only)) {
      console.log(`\n${test.id} ${test.title}`);
      const result = createResult(test);
      const started = Date.now();
      try {
        await environment.reset(test.id === 'ADV-08' ? 'UI-06' : test.id);
        const ctx = createContext(result, { db: environment.db, f: environment.fixture, reset: environment.reset }, urls, directory);
        await test.run(ctx, result);
        result.status = result.assertions.length && result.assertions.every(item => item.passed) ? 'PASS' : 'FAIL';
      } catch (error) {
        result.error = error.stack || error.message;
        result.status = result.assertions.some(item => !item.passed) ? 'FAIL' : 'ERROR';
      }
      result.durationMs = Date.now() - started;
      result.finishedAt = new Date().toISOString();
      run.tests.push(result);
      console.log(`${result.id}: ${result.status}`);
      await writeReport(run, directory);
    }
  } finally {
    await cleanup();
  }
  if (!skipCross && (!only || only === 'ADV-07')) {
    console.log('\nADV-07 Chrome và Firefox');
    run.tests.push(await runCrossBrowser(directory));
  }
  run.tests.sort((a, b) => a.id.localeCompare(b.id));
  await writeReport(run, directory);
  console.log(JSON.stringify(run.totals));
  console.log('Báo cáo: ' + path.join(directory, 'report.html'));
  process.exitCode = run.totals.FAIL || run.totals.ERROR || run.totals.BLOCKED ? 1 : 0;
}

main().catch(error => { console.error(error.stack || error.message); process.exitCode = 2; });
