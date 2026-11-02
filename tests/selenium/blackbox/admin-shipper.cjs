'use strict';

const path = require('node:path');
const { By, until, Select } = require('selenium-webdriver');
const uiDelivery = require('../cases/order-delivery.cjs').find(test => test.id === 'UI-08');

const sid = value => String(value ?? '');
const clean = value => String(value ?? '').replace(/\s+/gu, ' ').trim();
const imagePath = path.resolve(__dirname, '../../../user/public/img/favicon.png');
const priceStock = product => (product?.detail || []).map(d => ({ size: d.size, price: Number(d.price), stock: Number(d.stock) }));
const historyView = shipper => (shipper?.orderHistory || []).map(h => ({ order: sid(h.order), status: h.status, earning: h.earning, orderAmount: h.orderAmount }));
const orderView = order => order && ({ id: sid(order._id), status: order.status, shipper: sid(order.shiperID), totalAmount: order.totalAmount });

function need(value, message) {
  if (!value) {
    const error = new Error(message);
    error.code = 'TEST_SETUP';
    throw error;
  }
}

function temporary(ctx) {
  need(ctx.db.databaseName === 'webbtl_selenium', 'Chỉ chuẩn bị dữ liệu trong MongoDB tạm của bộ kiểm thử');
}

function newId(ctx) { return new (ctx.fixture.user.id.constructor)(); }

async function observe(ctx, predicate) {
  try { await ctx.driver.wait(predicate, 10000, 'Chờ website hoàn thành thao tác'); }
  catch (error) { if (error.name !== 'TimeoutError') throw error; }
}

async function submit(ctx, form) {
  const previous = await ctx.driver.findElement(By.css(form));
  await ctx.h.click(`${form} button`);
  await ctx.driver.wait(until.stalenessOf(previous), 15000, 'Biểu mẫu chưa chuyển trang');
  await ctx.h.ready();
}

async function scroll(ctx, element) {
  await ctx.driver.executeScript('arguments[0].scrollIntoView({block:"center",behavior:"instant"});', element);
}

async function confirm(ctx, selector, fragment) {
  await ctx.h.click(selector);
  const alert = await ctx.driver.wait(until.alertIsPresent(), 5000);
  const message = await alert.getText();
  ctx.record('Nội dung xác nhận của website', { message });
  await alert.accept();
  ctx.verify(message.includes(fragment), true, 'Hộp thoại xác nhận đúng thao tác đang thử');
}

// These requests originate from the live Selenium browser, with its current
// session. They exercise rejected/repeated operations for which the UI has no
// button; observations contain the real HTTP response, not a simulated result.
async function browserRequest(ctx, route, method = 'GET', body) {
  need(route.startsWith('/shipper/'), 'Chỉ gọi chức năng shipper của ứng dụng tạm');
  need(new URL(await ctx.driver.getCurrentUrl()).origin === new URL(ctx.baseUrl).origin, 'Yêu cầu phải xuất phát từ đúng ứng dụng user tạm');
  const result = await ctx.driver.executeAsyncScript(function (routeValue, methodValue, bodyValue, done) {
    const options = { method: methodValue, credentials: 'same-origin', headers: { Accept: 'application/json' } };
    if (bodyValue !== null) {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(bodyValue);
    }
    fetch(routeValue, options).then(async response => {
      const text = await response.text();
      let json = null;
      try { json = JSON.parse(text); } catch { /* Keep only a bounded diagnostic. */ }
      done({ status: response.status, json, message: json ? null : text.slice(0, 300) });
    }).catch(error => done({ transportError: error.message }));
  }, route, method, body ?? null);
  if (result.transportError) throw new Error(`Không gửi được yêu cầu từ trình duyệt: ${result.transportError}`);
  ctx.record(`Phản hồi thực ${method} ${route}`, result);
  return result;
}

async function adminRequest(ctx, route, method = 'POST', body = {}) {
  need(route.startsWith('/orders/'), 'Chỉ gọi chức năng đơn hàng của Admin App tạm');
  need(new URL(await ctx.driver.getCurrentUrl()).origin === new URL(ctx.adminUrl).origin, 'Yêu cầu phải xuất phát từ đúng Admin App tạm');
  const result = await ctx.driver.executeAsyncScript(function (routeValue, methodValue, bodyValue, done) {
    fetch(routeValue, {
      method: methodValue,
      credentials: 'same-origin',
      redirect: 'follow',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json,text/html' },
      body: new URLSearchParams(bodyValue).toString(),
    }).then(async response => done({ status: response.status, finalUrl: response.url, text: (await response.text()).slice(0, 500) }))
      .catch(error => done({ transportError: error.message }));
  }, route, method, body);
  if (result.transportError) throw new Error(`Không gửi được yêu cầu Admin App: ${result.transportError}`);
  ctx.record(`Phản hồi thực ${method} ${route} trên Admin App`, result);
  return result;
}

async function concurrentShipperRequests(ctx, route, body, count = 2) {
  need(route.startsWith('/shipper/'), 'Chỉ gửi đồng thời chức năng shipper của ứng dụng tạm');
  const result = await ctx.driver.executeAsyncScript(function (routeValue, bodyValue, requestCount, done) {
    const send = () => {
      const startedAt = new Date().toISOString();
      return fetch(routeValue, {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(bodyValue),
      }).then(async response => {
        const text = await response.text();
        let json = null;
        try { json = JSON.parse(text); } catch { /* bounded below */ }
        return { status: response.status, json, text: json ? null : text.slice(0, 200), startedAt, finishedAt: new Date().toISOString() };
      });
    };
    Promise.all(Array.from({ length: requestCount }, send)).then(done).catch(error => done({ transportError: error.message }));
  }, route, body, count);
  if (result.transportError) throw new Error(`Không gửi được yêu cầu đồng thời: ${result.transportError}`);
  ctx.record(`Các phản hồi đồng thời ${route}`, result);
  return result;
}

async function jsonPage(ctx, route, screenshot) {
  const response = await browserRequest(ctx, route, 'GET');
  const data = response.json;
  ctx.verify(response.status, 200, 'Chức năng lọc trả HTTP 200 cho đúng phiên shipper');
  ctx.verify(Boolean(data), true, 'Chức năng trả dữ liệu JSON hợp lệ cho đúng phiên shipper');
  ctx.record(`Dữ liệu thực ${route}`, data);
  await ctx.snapshot(screenshot);
  return data;
}

async function loginAccount(ctx, route, account, password) {
  await ctx.h.open(route);
  const form = `form[action="${route}"]`;
  await ctx.h.fill(`${form} input[name="account"]`, account);
  await ctx.h.fill(`${form} input[name="password"]`, password);
  await submit(ctx, form);
}

async function logout(ctx) { await ctx.h.open('/auth/logout'); await ctx.h.dismissNotice(); }

async function ownProduct(ctx, name, twoColours = false) {
  temporary(ctx);
  const source = await ctx.db.collection('products').findOne({ _id: ctx.fixture.product.id });
  need(source, 'Thiếu sản phẩm gốc dành riêng cho kiểm thử');
  const product = { ...source, _id: newId(ctx), name, category: undefined, detail: priceStock(source) };
  delete product.category;
  await ctx.db.collection('products').insertOne(product);
  let other;
  if (twoColours) {
    other = { ...product, _id: newId(ctx), type: 'Trắng', detail: priceStock(source) };
    await ctx.db.collection('products').insertOne(other);
  }
  ctx.record('Chuẩn bị sản phẩm riêng, không nằm trong đơn fixture', { id: sid(product._id), name, type: product.type, detail: priceStock(product), otherColour: other && { id: sid(other._id), type: other.type } });
  return { product, other };
}

async function customerProduct(ctx, name, size, price, stock) {
  await ctx.h.open(`/products/${encodeURIComponent(name)}`);
  const headings = await ctx.driver.findElements(By.css('.single-product-details h3'));
  ctx.verify(headings.length > 0, true, 'Khách mở được chi tiết sản phẩm kiểm thử');
  if (!headings.length) { await ctx.snapshot('trang-khach-khong-mo-duoc-san-pham'); return; }
  ctx.verify(clean(await headings[0].getText()), name, 'Trang khách hiển thị đúng tên sản phẩm');
  const options = await ctx.driver.findElements(By.css('#sizeSelect option'));
  let value;
  for (const option of options) {
    // Nice Select hides the native select. getText() returns rendered text and
    // can therefore be empty even when its option exists. Read the DOM label,
    // then h.select() still clicks the visible Nice Select control normally.
    if (clean(await option.getAttribute('textContent')).split(' ')[0] === size) { value = await option.getAttribute('value'); break; }
  }
  ctx.verify(value !== undefined, true, `Trang khách có size ${size}`);
  if (value !== undefined) {
    await ctx.h.select('#sizeSelect', value);
    ctx.verify(await ctx.h.money('#productPrice'), price, `Trang khách hiển thị đúng giá size ${size}`);
    ctx.verify(Number(clean(await ctx.h.text('#productStock'))), stock, `Trang khách hiển thị đúng tồn size ${size}`);
  }
  await scroll(ctx, headings[0]);
  await ctx.snapshot(`trang-khach-size-${size}`);
}

async function prepareShipping(ctx, orderId) {
  temporary(ctx);
  const order = await ctx.db.collection('orders').findOne({ _id: orderId });
  need(order, 'Thiếu đơn độc lập để chuẩn bị trạng thái Đang giao');
  await ctx.db.collection('orders').updateOne({ _id: orderId }, { $set: { status: 'shipping', shiperID: ctx.fixture.shipper.id } });
  await ctx.db.collection('shippers').updateOne({ user: ctx.fixture.shipper.id }, { $push: { orderHistory: { order: orderId, status: 'shipping', updatedAt: new Date(), orderAmount: order.totalAmount, earning: 0 } } });
  ctx.record('Tiền điều kiện đơn đang giao, chuẩn bị trực tiếp trước thao tác thử', { id: sid(orderId), shipper: sid(ctx.fixture.shipper.id), totalAmount: order.totalAmount });
  return order;
}

async function secondShipper(ctx, suffix) {
  temporary(ctx);
  const source = await ctx.db.collection('users').findOne({ _id: ctx.fixture.shipper.id });
  need(source, 'Thiếu tài khoản shipper gốc trong môi trường tạm');
  const user = { ...source, _id: newId(ctx), account: `selenium_shipper_${suffix}`, name: `Shipper thứ hai ${suffix}`, gmail: `${suffix.toLowerCase()}@example.test` };
  await ctx.db.collection('users').insertOne(user);
  await ctx.db.collection('shippers').insertOne({ user: user._id, totalEarnings: 0, orderHistory: [] });
  return user;
}

const adminRow = orderId => `#add-row tbody tr:has(form[action="/orders/detail"] input[value="${sid(orderId)}"])`;

module.exports = [
  {
    id: 'BB-25', title: 'Quản trị viên thêm sản phẩm hợp lệ', complete: true,
    scope: 'Tạo một màu mới bằng biểu mẫu và PNG có sẵn; M 120.000 đồng/tồn 5, L 150.000 đồng/tồn 3; đối chiếu quản trị, trang khách và danh mục chưa gán.',
    async run(ctx) {
      const { db, h, driver, fixture, verify, record, snapshot } = ctx;
      const name = 'Áo Selenium BB25 mới';
      need(await db.collection('products').countDocuments({ name }) === 0, 'Tên sản phẩm BB25 phải chưa tồn tại');
      await h.loginAdmin();
      await h.open('/products/create', true);
      const form = 'form[action="/products/store"]';
      await h.fill(`${form} input[name="name"]`, name);
      await h.fill(`${form} input[name="description"]`, 'Sản phẩm được thêm qua Selenium trong DB tạm.');
      await h.fill(`${form} input[name="type"]`, 'Đen');
      for (const d of fixture.product.detail) {
        await h.fill(`${form} input[name="price[${d.size}]"]`, d.price);
        await h.fill(`${form} input[name="stock[${d.size}]"]`, d.stock);
      }
      await driver.findElement(By.css(`${form} input[name="image"]`)).sendKeys(imagePath);
      await scroll(ctx, await driver.findElement(By.css(`${form} input[name="price[M]"]`)));
      await snapshot('bieu-mau-san-pham-truoc-luu');
      await submit(ctx, form);
      await h.dismissNotice();
      const products = await db.collection('products').find({ name }).toArray();
      verify(products.length, 1, 'Một lần lưu tạo đúng một biến thể sản phẩm');
      verify(clean(await h.text('#add-row tbody')).includes(name), true, 'Danh sách quản trị có sản phẩm vừa thêm');
      await snapshot('quan-tri-co-san-pham-moi');
      if (!products.length) return;
      const product = products[0];
      verify(product.type, 'Đen', 'Lưu đúng màu Đen');
      verify(priceStock(product).filter(d => ['M', 'L'].includes(d.size)), fixture.product.detail, 'Lưu đúng giá và tồn riêng của M và L');
      verify({ name: product.image?.imageName, type: product.image?.imageType, hasData: Boolean(product.image?.imageData) }, { name: 'favicon.png', type: 'image/png', hasData: true }, 'Lưu tệp ảnh PNG đã chọn qua biểu mẫu');
      verify(await db.collection('categories').countDocuments({ 'products._id': product._id }), 0, 'Chưa tự chèn sản phẩm mới vào danh mục khi chưa gán');
      record('Sản phẩm được tạo thực tế', { id: sid(product._id), name, type: product.type, detail: priceStock(product), imageName: product.image?.imageName });
      await customerProduct(ctx, name, 'L', 150000, 3);
      verify(await driver.executeScript('return arguments[0].complete && arguments[0].naturalWidth > 0', await driver.findElement(By.css('#mainProductImg'))), true, 'Ảnh sản phẩm tải được ở trang khách');
    },
  },
  {
    id: 'BB-26', title: 'Từ chối sản phẩm thiếu, trùng hoặc có số liệu không hợp lệ', complete: true,
    scope: 'Thử rỗng, thiếu tên, thiếu màu, trùng tên/màu, giá âm/0, tồn âm/lẻ/0 và dữ liệu chữ trong ô số; đối chiếu DB tạm sau từng lượt.',
    async run(ctx) {
      const { db, h, verify, snapshot, record, driver, fixture } = ctx;
      await h.loginAdmin();
      const variants = [
        { label: 'bieu-mau-rong', name: '', type: '', expectedPersist: false, expectedNotice: 'Thiếu dữ liệu' },
        { label: 'thieu-ten', name: '', type: 'Xanh', price: '120000', stock: '1', expectedPersist: false, expectedNotice: 'Thiếu dữ liệu' },
        { label: 'thieu-mau', name: 'BB26 thiếu màu', type: '', price: '120000', stock: '1', expectedPersist: false, expectedNotice: 'Thiếu dữ liệu' },
        { label: 'trung-ten-mau', name: fixture.product.name, type: fixture.product.type, price: '120000', stock: '1', expectedPersist: false, duplicate: true, expectedNotice: 'đã có' },
        { label: 'gia-am', name: 'BB26 giá âm', type: 'Đen', price: '-1', stock: '1', expectedPersist: false, bypassValidation: true },
        { label: 'gia-bang-khong', name: 'BB26 giá 0', type: 'Đen', price: '0', stock: '1', expectedPersist: true },
        { label: 'ton-am', name: 'BB26 tồn âm', type: 'Đen', price: '120000', stock: '-1', expectedPersist: false, bypassValidation: true },
        { label: 'ton-le', name: 'BB26 tồn lẻ', type: 'Đen', price: '120000', stock: '1.5', expectedPersist: false, bypassValidation: true },
        { label: 'ton-bang-khong', name: 'BB26 tồn 0', type: 'Đen', price: '120000', stock: '0', expectedPersist: true },
        { label: 'chu-trong-o-so', name: 'BB26 chữ', type: 'Đen', price: 'abc', stock: 'xyz', expectedPersist: false, bypassValidation: true },
      ];
      for (const variant of variants) {
        await h.open('/products/create', true);
        await h.dismissNotice();
        const form = 'form[action="/products/store"]';
        await h.fill(`${form} input[name="name"]`, variant.name);
        await h.fill(`${form} input[name="type"]`, variant.type);
        if (variant.price !== undefined) {
          if (/^-?\d+(?:\.\d+)?$/.test(variant.price)) await h.fill(`${form} input[name="price[M]"]`, variant.price);
          else await driver.executeScript('arguments[0].setAttribute("value", arguments[1]);', await driver.findElement(By.css(`${form} input[name="price[M]"]`)), variant.price);
        }
        if (variant.stock !== undefined) {
          if (/^-?\d+(?:\.\d+)?$/.test(variant.stock)) await h.fill(`${form} input[name="stock[M]"]`, variant.stock);
          else await driver.executeScript('arguments[0].setAttribute("value", arguments[1]);', await driver.findElement(By.css(`${form} input[name="stock[M]"]`)), variant.stock);
        }
        if (variant.bypassValidation) await driver.executeScript('arguments[0].noValidate=true;', await driver.findElement(By.css(form)));
        const before = await db.collection('products').countDocuments({});
        const beforeMatching = await db.collection('products').countDocuments({ name: variant.name, type: variant.type });
        await snapshot(`bb26-${variant.label}-truoc-gui`);
        await submit(ctx, form);
        const matching = await db.collection('products').find({ name: variant.name, type: variant.type }).toArray();
        const after = await db.collection('products').countDocuments({});
        let notice = '';
        const titles = await driver.findElements(By.css('#swal2-title'));
        if (titles.length) notice = clean(await titles[0].getText());
        const persisted = variant.duplicate ? matching.length > beforeMatching : matching.length > 0;
        record('Kết quả biến thể BB-26', { variant: variant.label, input: { name: variant.name, type: variant.type, priceM: variant.price, stockM: variant.stock }, expectedPersist: variant.expectedPersist, persisted, notice, productCountBefore: before, productCountAfter: after, stored: matching.map(product => ({ id: sid(product._id), detail: priceStock(product) })) });
        if (variant.expectedNotice) verify(notice.includes(variant.expectedNotice), true, `${variant.label}: thông báo phù hợp`);
        verify(persisted, variant.expectedPersist, `${variant.label}: trạng thái lưu phù hợp quy tắc mong đợi`);
        await snapshot(`bb26-${variant.label}-ket-qua`);
        await h.dismissNotice();
        if (!variant.duplicate && matching.length) await db.collection('products').deleteMany({ _id: { $in: matching.map(product => product._id) } });
      }
    },
  },
  {
    id: 'BB-27', title: 'Sửa và xóa sản phẩm kiểm thử riêng', complete: true,
    scope: 'Hai màu cùng tên, chưa nằm trong đơn: sửa L của màu Đen từ 150.000/tồn 3 thành 160.000/tồn 4, giữ M và màu Trắng; xóa theo tên rồi tìm lại. Chưa đánh giá lịch sử sản phẩm đã mua.',
    async run(ctx) {
      const { db, driver, h, verify, snapshot, record } = ctx;
      const name = 'Áo Selenium BB27 sửa xóa';
      const { product, other } = await ownProduct(ctx, name, true);
      await h.loginAdmin();
      await h.open(`/products/edit/${encodeURIComponent(name)}`, true);
      const form = `form[action="/products/update"]:has(input[name="id"][value="${sid(product._id)}"])`;
      await h.visible(form);
      await scroll(ctx, await driver.findElement(By.css(`${form} input[name="price[L]"]`)));
      await snapshot('hai-co-mau-den-truoc-sua');
      await h.fill(`${form} input[name="price[L]"]`, '160000');
      await h.fill(`${form} input[name="stock[L]"]`, '4');
      await submit(ctx, form);
      await h.dismissNotice();
      const updated = await db.collection('products').findOne({ _id: product._id });
      const untouched = await db.collection('products').findOne({ _id: other._id });
      verify(priceStock(updated), [{ size: 'M', price: 120000, stock: 5 }, { size: 'L', price: 160000, stock: 4 }], 'Chỉ size L của màu Đen được sửa; M giữ nguyên');
      verify(priceStock(untouched), priceStock(other), 'Các cỡ của màu Trắng giữ nguyên');
      verify(await driver.findElement(By.css(`${form} input[name="price[L]"]`)).getAttribute('value'), '160000', 'Tải lại quản trị có giá L vừa lưu');
      await scroll(ctx, await driver.findElement(By.css(`${form} input[name="price[L]"]`)));
      await snapshot('du-lieu-quan-tri-sau-sua');
      await customerProduct(ctx, name, 'L', 160000, 4);
      record('Đối chiếu trước và sau sửa', { blackBefore: priceStock(product), blackAfter: priceStock(updated), whiteAfter: priceStock(untouched) });
      await h.open('/products', true);
      await h.dismissNotice();
      const deleteLink = `a[href="/products/destroy/${encodeURIComponent(name)}"]`;
      await h.click(deleteLink);
      await h.ready();
      await h.dismissNotice();
      verify(await db.collection('products').countDocuments({ name }), 0, 'Xóa theo tên loại bỏ cả hai màu của sản phẩm kiểm thử riêng');
      verify(clean(await h.text('#add-row tbody')).includes(name), false, 'Không còn tên sản phẩm trong danh sách quản trị');
      await snapshot('quan-tri-sau-xoa-ca-hai-mau');
      await h.open('/products');
      verify((await driver.findElement(By.css('body')).getText()).includes(name), false, 'Danh sách bán hàng không còn sản phẩm đã xóa');
      await snapshot('trang-khach-sau-xoa');
    },
  },
  {
    id: 'BB-28', title: 'Tạo danh mục và gán sản phẩm không trùng', complete: true,
    scope: 'Thiếu cả tên/ảnh, có tên nhưng thiếu ảnh, có ảnh nhưng thiếu tên; tạo danh mục hợp lệ, gán sản phẩm và gán lặp; đối chiếu DB và trang danh mục khách.',
    async run(ctx) {
      const { db, h, driver, fixture, verify, snapshot, record } = ctx;
      const name = 'Danh mục Selenium BB28';
      await h.loginAdmin();
      const before = await db.collection('categories').countDocuments({});
      for (const variant of ['empty', 'no-image', 'no-name']) {
        await h.open('/categories/create', true);
        const form = 'form[action="/categories/store"]';
        if (variant === 'no-image') await h.fill(`${form} input[name="name"]`, name);
        if (variant === 'no-name') await driver.findElement(By.css(`${form} input[name="image"]`)).sendKeys(imagePath);
        await submit(ctx, form);
        const notice = clean(await h.text('#swal2-title'));
        verify(notice.includes('Thiếu dữ liệu'), true, `Từ chối danh mục không đủ dữ liệu: ${variant}`);
        verify(await db.collection('categories').countDocuments({}), before, `Không lưu danh mục ở lượt ${variant}`);
        await snapshot(`danh-muc-thieu-du-lieu-${variant}`);
        await h.dismissNotice();
      }
      await h.fill('form[action="/categories/store"] input[name="name"]', name);
      await driver.findElement(By.css('form[action="/categories/store"] input[name="image"]')).sendKeys(imagePath);
      await snapshot('danh-muc-hop-le-truoc-luu');
      await submit(ctx, 'form[action="/categories/store"]');
      await h.dismissNotice();
      const category = await db.collection('categories').findOne({ name });
      verify(Boolean(category), true, 'Tạo được danh mục có tên và ảnh hợp lệ');
      if (!category) return;
      verify(await db.collection('categories').countDocuments({ name }), 1, 'Chỉ có một danh mục mới');
      verify(Boolean(category.image?.imageData) && category.image?.imageType === 'image/png', true, 'Danh mục lưu ảnh PNG');
      for (const attempt of [1, 2]) {
        await h.open('/categories/assign', true);
        const rows = await driver.findElements(By.css('#add-row tbody tr'));
        let row;
        for (const candidate of rows) { if ((await candidate.getText()).includes(fixture.product.name)) { row = candidate; break; } }
        verify(Boolean(row), true, 'Màn hình phân loại có sản phẩm fixture');
        if (!row) { await snapshot('khong-tim-thay-san-pham-de-gan'); return; }
        const select = await row.findElement(By.css('select[name="categoryID"]'));
        await new Select(select).selectByValue(sid(category._id));
        await scroll(ctx, row);
        await snapshot(`chon-san-pham-va-danh-muc-lan-${attempt}`);
        await row.findElement(By.css('button[type="submit"]')).click();
        await driver.wait(until.stalenessOf(row), 15000);
        await h.ready();
        await h.dismissNotice();
        const actual = await db.collection('categories').findOne({ _id: category._id });
        verify((actual.products || []).filter(p => sid(p._id) === sid(fixture.product.id)).length, 1, `Sau lần gán ${attempt}, sản phẩm chỉ có một bản trong danh mục`);
        record(`Danh mục sau lần gán ${attempt}`, { id: sid(category._id), products: actual.products.map(p => ({ id: sid(p._id), name: p.name })) });
        await h.open(`/products/category/${sid(category._id)}`);
        verify((await driver.findElement(By.css('body')).getText()).includes(fixture.product.name), true, `Khách thấy sản phẩm trong danh mục sau lần gán ${attempt}`);
        await snapshot(`danh-muc-trang-khach-lan-${attempt}`);
      }
    },
  },
  {
    id: 'BB-29', title: 'Quản lý tài khoản và giới hạn quyền quản trị', complete: true,
    scope: 'Tạo tài khoản Shipper hợp lệ, thử trùng tài khoản và xác nhận mật khẩu sai; đối chiếu mật khẩu băm, vai trò và ranh giới truy cập của guest/User/Shipper.',
    async run(ctx) {
      const { h, driver, verify, record, snapshot, db } = ctx;
      for (const role of ['guest', 'User', 'Shipper']) {
        if (role === 'User') await h.loginUser();
        if (role === 'Shipper') { await logout(ctx); await h.loginShipper(); }
        for (const route of ['/users', '/products']) {
          await h.open(route, true);
          const pathname = new URL(await driver.getCurrentUrl()).pathname;
          verify(pathname, '/login', `${role} không được mở ${route} của trang quản trị`);
          verify((await driver.findElements(By.css('form[action="/login"]'))).length, 1, `${role} chỉ thấy biểu mẫu đăng nhập quản trị`);
          record('Kiểm tra ranh giới phiên quản trị', { role, requestedPath: route, actualPath: pathname });
          await snapshot(`tu-choi-quan-tri-${role}-${route.slice(1)}`);
          await h.dismissNotice();
        }
      }
      await h.loginAdmin();
      const account = 'nhanvien_thu_1';
      const password = 'Kiemthu123';
      const fillUser = async (data) => {
        await h.open('/users/create', true);
        await h.dismissNotice();
        const form = 'form[action="/users/store"]';
        for (const [selector, value] of [
          ['#account', data.account], ['#password', data.password], ['#passwordConfirm', data.passwordConfirm],
          ['#name', 'Nhân viên thử 1'], ['#phone', '0900000029'], ['#gmail', 'bb29@example.test'], ['#address', 'Địa chỉ BB29'],
        ]) await h.fill(`${form} ${selector}`, value);
        if (data.role === 'Shipper') await h.click(`${form} #shipper`);
        await snapshot(`bb29-${data.label}-truoc-gui`);
        await submit(ctx, form);
        await snapshot(`bb29-${data.label}-ket-qua`);
        const title = await driver.findElements(By.css('#swal2-title'));
        return title.length ? clean(await title[0].getText()) : '';
      };
      const before = await db.collection('users').countDocuments({ account });
      const validNotice = await fillUser({ label: 'tao-shipper-hop-le', account, password, passwordConfirm: password, role: 'Shipper' });
      const created = await db.collection('users').findOne({ account });
      verify(await db.collection('users').countDocuments({ account }), before + 1, 'Tạo đúng một tài khoản nhân viên giao hàng');
      verify(created?.role, 'Shipper', 'Tài khoản mới có vai trò Shipper');
      verify(Boolean(created?.password && created.password !== password && created.password.startsWith('$2')), true, 'Mật khẩu được băm, không lưu văn bản');
      verify(validNotice.includes('thành công'), true, 'Giao diện báo tạo tài khoản thành công');
      const duplicateNotice = await fillUser({ label: 'trung-tai-khoan', account, password, passwordConfirm: password, role: 'Shipper' });
      verify(duplicateNotice.includes('Tài khoản đã tồn tại'), true, 'Tài khoản trùng bị từ chối');
      verify(await db.collection('users').countDocuments({ account }), before + 1, 'Thử trùng không tạo thêm bản ghi');
      const mismatchAccount = 'nhanvien_thu_1_lech';
      const mismatchNotice = await fillUser({ label: 'xac-nhan-mat-khau-lech', account: mismatchAccount, password, passwordConfirm: 'Kiemthu124', role: 'Shipper' });
      verify(mismatchNotice.includes('Mật khẩu không khớp'), true, 'Xác nhận mật khẩu sai bị từ chối');
      verify(await db.collection('users').countDocuments({ account: mismatchAccount }), 0, 'Không lưu tài khoản có xác nhận mật khẩu sai');
      record('Tài khoản BB-29 được lưu trong DB tạm', { id: sid(created?._id), account: created?.account, role: created?.role, passwordPlaintext: created?.password === password });
    },
  },
  {
    id: 'BB-30', title: 'Quản trị viên duyệt và hủy đơn theo trạng thái', complete: true,
    scope: 'Duyệt pending, phát lại yêu cầu và thử duyệt các trạng thái còn lại; thử hủy pending/waiting/shipping/delivered/cancelled, ghi riêng hành vi shipping và đối chiếu kho.',
    async run(ctx) {
      const { db, h, driver, fixture, verify, record, snapshot } = ctx;
      const orders = db.collection('orders');
      temporary(ctx);
      const source = await orders.findOne({ _id: fixture.pendingOrder.id });
      const variants = {};
      for (const status of ['waiting', 'shipping', 'delivered', 'cancelled']) {
        variants[`approve_${status}`] = newId(ctx);
        await orders.insertOne({ ...source, _id: variants[`approve_${status}`], status, ...(status === 'shipping' ? { shiperID: fixture.shipper.id } : {}) });
      }
      for (const status of ['pending', 'shipping', 'delivered', 'cancelled']) {
        variants[`cancel_${status}`] = newId(ctx);
        await orders.insertOne({ ...source, _id: variants[`cancel_${status}`], status, ...(status === 'shipping' ? { shiperID: fixture.shipper.id } : {}) });
      }
      record('Chuẩn bị ma trận trạng thái BB-30 trong DB tạm', Object.fromEntries(Object.entries(variants).map(([key, value]) => [key, sid(value)])));
      const beforeStock = priceStock(await db.collection('products').findOne({ _id: fixture.product.id }));
      await h.loginAdmin();
      await h.open('/orders', true);
      const pending = adminRow(fixture.pendingOrder.id);
      const waiting = adminRow(fixture.waitingOrder.id);
      verify(clean(await h.text(`${pending} td:nth-child(6)`)), 'Chờ duyệt', 'Đơn mục tiêu đang chờ duyệt');
      await snapshot('cac-trang-thai-truoc-duyet-huy');
      await h.click(`${pending} form[action="/orders/approved"] button`);
      await observe(ctx, async () => (await orders.findOne({ _id: fixture.pendingOrder.id }))?.status === 'waiting');
      await h.open('/orders', true);
      await h.dismissNotice();
      verify((await orders.findOne({ _id: fixture.pendingOrder.id })).status, 'waiting', 'Duyệt đơn pending sang waiting');
      verify(clean(await h.text(`${pending} td:nth-child(6)`)), 'Đã duyệt', 'Giao diện cập nhật trạng thái đã duyệt');
      verify((await driver.findElements(By.css(`${pending} form[action="/orders/approved"]`))).length, 0, 'Không có nút duyệt lại sau khi đã duyệt');
      await snapshot('don-sau-duyet');
      await adminRequest(ctx, '/orders/approved', 'POST', { id: sid(fixture.pendingOrder.id) });
      verify((await orders.findOne({ _id: fixture.pendingOrder.id })).status, 'waiting', 'Phát lại duyệt không đổi đơn đã duyệt');
      for (const status of ['waiting', 'shipping', 'delivered', 'cancelled']) {
        const id = variants[`approve_${status}`];
        await adminRequest(ctx, '/orders/approved', 'POST', { id: sid(id) });
        verify((await orders.findOne({ _id: id })).status, status, `Không duyệt đơn ở trạng thái ${status}`);
      }
      await h.click(`${waiting} form.btn-destroy-order button`);
      await h.visible('.swal2-confirm');
      await snapshot('xac-nhan-huy-don-waiting');
      await h.click('.swal2-confirm');
      await observe(ctx, async () => (await orders.findOne({ _id: fixture.waitingOrder.id }))?.status === 'cancelled');
      await h.open('/orders', true);
      await h.dismissNotice();
      verify((await orders.findOne({ _id: fixture.waitingOrder.id })).status, 'cancelled', 'Hủy đơn waiting chuyển sang cancelled');
      verify(clean(await h.text(`${waiting} td:nth-child(6)`)), 'Đã hủy', 'Tải lại quản trị cho thấy đơn đã hủy');
      verify((await orders.findOne({ _id: fixture.deliveredOrder.id })).status, 'delivered', 'Đơn đã giao riêng không bị thay đổi');
      await adminRequest(ctx, '/orders/cancelled', 'POST', { id: sid(variants.cancel_pending) });
      verify((await orders.findOne({ _id: variants.cancel_pending })).status, 'cancelled', 'Quản trị viên hủy được đơn pending chưa giao');
      for (const status of ['delivered', 'cancelled']) {
        const id = variants[`cancel_${status}`];
        const response = await adminRequest(ctx, '/orders/cancelled', 'POST', { id: sid(id) });
        verify(response.status, 500, `Hủy đơn ${status} bị từ chối`);
        verify((await orders.findOne({ _id: id })).status, status, `Đơn ${status} giữ nguyên sau yêu cầu hủy`);
      }
      const shippingResponse = await adminRequest(ctx, '/orders/cancelled', 'POST', { id: sid(variants.cancel_shipping) });
      const shippingAfter = await orders.findOne({ _id: variants.cancel_shipping });
      record('Hành vi thực tế khi quản trị viên hủy đơn shipping, chưa chấm chính sách', { responseStatus: shippingResponse.status, statusAfter: shippingAfter?.status });
      const stockAfter = priceStock(await db.collection('products').findOne({ _id: fixture.product.id }));
      verify(stockAfter, beforeStock, 'Các thao tác duyệt và yêu cầu hủy không tự ý đổi tồn kho');
      record('Quan sát kho và ma trận sau BB-30', { before: beforeStock, after: stockAfter, shippingPolicyObserved: shippingAfter?.status });
      await snapshot('trang-thai-sau-duyet-va-huy');
    },
  },
  {
    id: 'BB-31', title: 'Đăng nhập đúng khu vực giao hàng', complete: true,
    scope: 'Shipper sai mật khẩu, User đăng nhập khu vực shipper, Shipper đúng mật khẩu và Shipper vào khu vực khách; kiểm trang đích, cảnh báo và không giữ quyền sau đăng nhập nhầm.',
    async run(ctx) {
      const { h, driver, fixture, verify, snapshot, record } = ctx;
      for (const variant of [
        { name: 'sai-mat-khau', account: fixture.shipper.account, password: `${fixture.shipper.password}-sai`, message: 'Mật khẩu không đúng' },
        { name: 'khach-khong-phai-shipper', account: fixture.user.account, password: fixture.user.password, message: 'không phải là shipper' },
      ]) {
        await loginAccount(ctx, '/auth/shipper-login', variant.account, variant.password);
        const messages = await driver.findElements(By.css('.alert-danger'));
        const text = messages.length ? clean(await messages[0].getText()) : '';
        verify(new URL(await driver.getCurrentUrl()).pathname, '/auth/shipper-login', `${variant.name}: không vào bảng giao hàng`);
        verify(text.includes(variant.message), true, `${variant.name}: có thông báo từ chối phù hợp`);
        record('Đăng nhập bị từ chối', { variant: variant.name, message: text });
        await snapshot(`shipper-login-${variant.name}`);
      }
      await h.loginShipper();
      verify(new URL(await driver.getCurrentUrl()).pathname, '/shipper/dashboard', 'Shipper đúng thông tin được vào dashboard');
      verify((await driver.findElements(By.css('a[href="/shipper/orders"]'))).length > 0, true, 'Dashboard có chức năng nhận đơn');
      await snapshot('shipper-dang-nhap-dung');
      await logout(ctx);
      await loginAccount(ctx, '/auth/login', fixture.shipper.account, fixture.shipper.password);
      const blocked = clean(await driver.findElement(By.css('body')).getText());
      verify(blocked.includes('Vui lòng đăng nhập ở khu vực dành cho Shipper'), true, 'Đăng nhập nhầm khu vực khách có hướng dẫn sang khu vực Shipper');
      verify((await driver.findElements(By.css('a[href="/auth/shipper-login"]'))).length > 0, true, 'Có liên kết đến đăng nhập Shipper');
      await snapshot('shipper-dang-nhap-nham-khu-vuc');
      await h.open('/auth/profile');
      verify(new URL(await driver.getCurrentUrl()).pathname, '/auth/login', 'Đăng nhập nhầm không giữ phiên khách có quyền xem hồ sơ');
      await snapshot('khong-giu-quyen-khach-sau-dang-nhap-nham');
    },
  },
  {
    id: 'BB-32', title: 'Nhận một đơn Chờ giao', complete: true,
    scope: 'Nhận đơn waiting 300.000 đồng qua nút giao diện; đối chiếu người được gán, danh sách chờ/đang giao, lịch sử nhận và thu nhập chưa tăng.',
    async run(ctx) {
      const { db, h, driver, fixture, verify, snapshot, record } = ctx;
      const orderId = fixture.waitingOrder.id;
      const before = await db.collection('shippers').findOne({ user: fixture.shipper.id });
      const orderBefore = await db.collection('orders').findOne({ _id: orderId });
      need(orderBefore?.status === 'waiting' && !orderBefore.shiperID && before, 'BB32 cần đơn waiting chưa có shipper');
      await h.loginShipper();
      await h.open('/shipper/dashboard');
      verify(await h.money('.display-6.fw-bold.text-success'), before.totalEarnings, 'Thu nhập ban đầu khớp hồ sơ shipper');
      await snapshot('thu-nhap-truoc-nhan');
      await h.open('/shipper/orders');
      const accept = `.accept-btn[data-id="${sid(orderId)}"]`;
      await h.visible(accept);
      await snapshot('don-waiting-truoc-nhan');
      await confirm(ctx, accept, 'nhận đơn');
      await observe(ctx, async () => {
        const s = await db.collection('shippers').findOne({ user: fixture.shipper.id });
        return s.orderHistory.some(entry => sid(entry.order) === sid(orderId) && entry.status === 'shipping');
      });
      const orderAfter = await db.collection('orders').findOne({ _id: orderId });
      const after = await db.collection('shippers').findOne({ user: fixture.shipper.id });
      verify(orderAfter.status, 'shipping', 'Nhận đơn chuyển sang đang giao');
      verify(sid(orderAfter.shiperID), sid(fixture.shipper.id), 'Gán đơn cho đúng shipper đang đăng nhập');
      verify(after.totalEarnings, before.totalEarnings, 'Nhận đơn chưa cộng tiền công');
      verify(historyView(after).filter(entry => entry.order === sid(orderId)), [{ order: sid(orderId), status: 'shipping', earning: 0, orderAmount: 300000 }], 'Lịch sử nhận có đúng một sự kiện, tiền công bằng 0');
      await h.open('/shipper/orders');
      verify((await driver.findElements(By.css(accept))).length, 0, 'Đơn đã nhận rời danh sách có thể nhận');
      await snapshot('don-roi-danh-sach-cho');
      await h.open('/shipper/shipping');
      verify((await driver.findElements(By.css(`.deliver-btn[data-id="${sid(orderId)}"]`))).length, 1, 'Đơn xuất hiện trong danh sách đang giao của chính shipper');
      await snapshot('don-trong-danh-sach-dang-giao');
      await h.open('/shipper/dashboard');
      verify(await h.money('.display-6.fw-bold.text-success'), before.totalEarnings, 'Dashboard chưa tăng tiền sau khi nhận');
      await snapshot('thu-nhap-sau-nhan');
      const history = await jsonPage(ctx, '/shipper/history/filter?status=shipping', 'lich-su-nhan-tu-chuc-nang-loc');
      if (history) verify((history.history || []).map(entry => ({ order: sid(entry.order), status: entry.status, earning: entry.earning })), [{ order: sid(orderId), status: 'shipping', earning: 0 }], 'Bộ lọc lịch sử trả đúng lần nhận đơn');
      record('Trước và sau nhận', { orderBefore: orderView(orderBefore), orderAfter: orderView(orderAfter), earningsBefore: before.totalEarnings, earningsAfter: after.totalEarnings });
    },
  },
  {
    id: 'BB-33', title: 'Từ chối nhận đơn sai trạng thái hoặc sai vai trò', complete: true,
    scope: 'Guest và User thử nhận đơn waiting; Shipper thử nhận pending/shipping/delivered/cancelled; đối chiếu HTTP, đơn và lịch sử không đổi.',
    async run(ctx) {
      const { db, h, fixture, verify, snapshot, record } = ctx;
      temporary(ctx);
      const source = await db.collection('orders').findOne({ _id: fixture.pendingOrder.id });
      const shippingId = newId(ctx);
      const cancelledId = newId(ctx);
      await db.collection('orders').insertMany([
        { ...source, _id: shippingId, status: 'shipping', shiperID: fixture.shipper.id },
        { ...source, _id: cancelledId, status: 'cancelled' },
      ]);
      const beforeOrders = await db.collection('orders').find({}).sort({ _id: 1 }).toArray();
      const beforeHistory = historyView(await db.collection('shippers').findOne({ user: fixture.shipper.id }));
      await h.open('/auth/login');
      const guest = await browserRequest(ctx, '/shipper/accept', 'POST', { orderId: sid(fixture.waitingOrder.id) });
      verify(guest.status, 403, 'Guest không có quyền nhận đơn');
      verify(guest.json?.success, false, 'Guest nhận phản hồi từ chối');
      await h.open('/shipper/orders');
      verify(new URL(await ctx.driver.getCurrentUrl()).pathname, '/auth/login', 'Guest không mở được danh sách nhận đơn');
      await snapshot('guest-bi-chan-khu-vuc-nhan-don');
      await h.dismissNotice();
      await h.loginUser();
      const user = await browserRequest(ctx, '/shipper/accept', 'POST', { orderId: sid(fixture.waitingOrder.id) });
      verify(user.status, 403, 'User không có quyền nhận đơn');
      verify(user.json?.success, false, 'User nhận phản hồi từ chối');
      await h.open('/shipper/orders');
      verify(new URL(await ctx.driver.getCurrentUrl()).pathname, '/', 'User bị chuyển khỏi khu vực nhận đơn');
      await snapshot('user-bi-chan-khu-vuc-nhan-don');
      await logout(ctx);
      await h.loginShipper();
      for (const [label, orderId] of [['pending', fixture.pendingOrder.id], ['shipping', shippingId], ['delivered', fixture.deliveredOrder.id], ['cancelled', cancelledId]]) {
        const response = await browserRequest(ctx, '/shipper/accept', 'POST', { orderId: sid(orderId) });
        verify(response.status, 400, `Shipper không nhận được đơn ${label}`);
        verify(response.json?.success, false, `Đơn ${label} trả kết quả từ chối`);
      }
      const afterOrders = await db.collection('orders').find({}).sort({ _id: 1 }).toArray();
      verify(afterOrders, beforeOrders, 'Các yêu cầu bị từ chối không đổi dữ liệu đơn');
      verify(historyView(await db.collection('shippers').findOne({ user: fixture.shipper.id })), beforeHistory, 'Không phát sinh lịch sử nhận từ yêu cầu sai');
      await h.open('/shipper/orders');
      verify((await ctx.driver.findElements(By.css('.accept-btn'))).length, 1, 'Chỉ đơn waiting hợp lệ còn xuất hiện trong danh sách nhận');
      record('Danh sách đơn sau các yêu cầu bị từ chối', afterOrders.map(orderView));
      await snapshot('chi-don-waiting-con-co-the-nhan');
    },
  },
  {
    id: 'BB-34', title: 'Giao thành công và tính đúng tiền công', complete: true,
    scope: 'Dùng lại luồng UI08 nhận/giao đơn 300.000 đồng, tiền công 12.000 đồng; đối chiếu trạng thái, ngày giao, lịch sử, dashboard và dữ liệu biểu đồ. Bộ số liệu được đổi tương ứng fixture, không dùng mức 200.000/10.500 đồng của thiết kế ban đầu.',
    async run(ctx) {
      need(uiDelivery, 'Thiếu ca UI08 để dùng lại luồng nhận và giao');
      await uiDelivery.run(ctx);
      const order = await ctx.db.collection('orders').findOne({ _id: ctx.fixture.waitingOrder.id });
      if (order?.status !== 'delivered' || !(order.shipDate instanceof Date)) return;
      const day = order.shipDate.toISOString().slice(0, 10);
      const response = await browserRequest(ctx, '/shipper/earnings/chart');
      ctx.verify(response.status, 200, 'Chức năng biểu đồ tiền công trả thành công');
      ctx.verify(response.json?.chartData, { [day]: 12000 }, 'Dữ liệu biểu đồ ghi đúng 12.000 đồng vào ngày giao');
      await ctx.h.open('/shipper/dashboard');
      let chart = null;
      await observe(ctx, async () => {
        chart = await ctx.driver.executeScript('const c = typeof Chart === "undefined" ? null : Chart.getChart(document.getElementById("earningsChart")); return c ? {labels:c.data.labels,values:c.data.datasets[0].data} : null;');
        return chart !== null;
      });
      ctx.verify(chart, { labels: [day], values: [12000] }, 'Biểu đồ trên dashboard nhận đúng nhãn ngày và số tiền công');
      ctx.record('Căn cứ tính tiền công', { orderAmount: 300000, calculation: 'Math.round(7500 + 300000 × 0,015)', expectedEarning: 12000, day, chart });
      await ctx.snapshot('bieu-do-va-thu-nhap-sau-giao');
    },
  },
  {
    id: 'BB-35', title: 'Không giao đơn của nhân viên khác hoặc ghi công hai lần', complete: true,
    scope: 'Nhân viên thứ hai thử giao sai chủ; nhân viên đúng gửi hai yêu cầu giao đồng thời thật rồi phát lại; đối chiếu đơn, lịch sử và tiền công.',
    async run(ctx) {
      const { db, h, fixture, verify, snapshot, record } = ctx;
      const orderId = fixture.waitingOrder.id;
      await prepareShipping(ctx, orderId);
      const other = await secondShipper(ctx, 'BB35');
      const before = await db.collection('orders').findOne({ _id: orderId });
      await loginAccount(ctx, '/auth/shipper-login', other.account, fixture.shipper.password);
      await h.open('/shipper/shipping');
      verify((await ctx.driver.findElements(By.css(`.deliver-btn[data-id="${sid(orderId)}"]`))).length, 0, 'Người thứ hai không có nút giao đơn thuộc người thứ nhất');
      const wrongOwner = await browserRequest(ctx, '/shipper/deliver', 'POST', { orderId: sid(orderId) });
      verify(wrongOwner.status, 400, 'Yêu cầu giao sai chủ đơn bị từ chối');
      verify(wrongOwner.json?.success, false, 'Phản hồi giao sai người không thành công');
      verify(await db.collection('orders').findOne({ _id: orderId }), before, 'Giao sai người không đổi dữ liệu đơn');
      const otherAfter = await db.collection('shippers').findOne({ user: other._id });
      verify({ earnings: otherAfter.totalEarnings, history: historyView(otherAfter) }, { earnings: 0, history: [] }, 'Không cộng tiền hoặc ghi lịch sử cho người giao sai');
      await snapshot('shipper-thu-hai-khong-thay-don-cua-nguoi-khac');
      await logout(ctx);
      await h.loginShipper();
      await h.open('/shipper/shipping');
      const deliver = `.deliver-btn[data-id="${sid(orderId)}"]`;
      await h.visible(deliver);
      await snapshot('chu-don-truoc-hai-yeu-cau-dong-thoi');
      const concurrent = await concurrentShipperRequests(ctx, '/shipper/deliver', { orderId: sid(orderId) }, 2);
      await observe(ctx, async () => (await db.collection('orders').findOne({ _id: orderId }))?.status === 'delivered');
      const afterConcurrent = await db.collection('shippers').findOne({ user: fixture.shipper.id });
      verify(concurrent.filter(response => response.status === 200 && response.json?.success).length, 1, 'Hai yêu cầu đồng thời chỉ có một yêu cầu thành công');
      verify((await db.collection('orders').findOne({ _id: orderId })).status, 'delivered', 'Đơn kết thúc ở trạng thái delivered');
      verify(afterConcurrent.totalEarnings, 12000, 'Giao đồng thời chỉ cộng một lần 12.000 đồng');
      verify(historyView(afterConcurrent).filter(entry => entry.order === sid(orderId) && entry.status === 'delivered').length, 1, 'Giao đồng thời chỉ lưu một sự kiện delivered');
      await h.open('/shipper/dashboard');
      await snapshot('thu-nhap-sau-hai-yeu-cau-dong-thoi');
      const repeated = await browserRequest(ctx, '/shipper/deliver', 'POST', { orderId: sid(orderId) });
      verify(repeated.status, 400, 'Gửi lại giao đơn đã hoàn tất bị từ chối');
      verify(repeated.json?.success, false, 'Phản hồi lần giao lặp không thành công');
      const afterRepeat = await db.collection('shippers').findOne({ user: fixture.shipper.id });
      verify(afterRepeat.totalEarnings, afterConcurrent.totalEarnings, 'Giao lặp không tăng thêm tiền công');
      verify(historyView(afterRepeat), historyView(afterConcurrent), 'Giao lặp không tạo thêm lịch sử');
      verify(historyView(afterRepeat).filter(entry => entry.order === sid(orderId) && entry.status === 'delivered').length, 1, 'Chỉ có một sự kiện giao thành công');
      record('Thu nhập qua từng lượt', { afterWrongOwner: otherAfter.totalEarnings, concurrentResponses: concurrent, afterConcurrent: afterConcurrent.totalEarnings, afterRepeat: afterRepeat.totalEarnings });
      await h.open('/shipper/dashboard');
      verify(await h.money('.display-6.fw-bold.text-success'), 12000, 'Dashboard vẫn chỉ có 12.000 đồng sau yêu cầu lặp');
      await snapshot('thu-nhap-khong-tang-sau-giao-lap');
    },
  },
  {
    id: 'BB-36', title: 'Hủy đơn đang giao và lọc lịch sử', complete: true,
    scope: 'Nhân viên thứ hai thử hủy sai chủ; người đúng hủy đơn, đối chiếu tiền công và lọc cancelled/delivered/all không lẫn lịch sử người khác; kho chỉ ghi nhận do chính sách chưa chốt.',
    async run(ctx) {
      const { db, h, fixture, verify, record, snapshot } = ctx;
      const orderId = fixture.waitingOrder.id;
      await prepareShipping(ctx, orderId);
      const other = await secondShipper(ctx, 'BB36');
      const when = new Date();
      await db.collection('orders').updateOne({ _id: fixture.deliveredOrder.id }, { $set: { shiperID: fixture.shipper.id, shipDate: when } });
      await db.collection('shippers').updateOne({ user: fixture.shipper.id }, { $set: { totalEarnings: 12000 }, $push: { orderHistory: { order: fixture.deliveredOrder.id, status: 'delivered', updatedAt: when, orderAmount: 300000, earning: 12000 } } });
      await db.collection('shippers').updateOne({ user: other._id }, { $push: { orderHistory: { order: fixture.pendingOrder.id, status: 'cancelled', updatedAt: when, orderAmount: 300000, earning: 0 } } });
      const beforeStock = priceStock(await db.collection('products').findOne({ _id: fixture.product.id }));
      const before = await db.collection('shippers').findOne({ user: fixture.shipper.id });
      record('Tiền điều kiện lịch sử trước hủy', { currentShipper: sid(fixture.shipper.id), history: historyView(before), earnings: before.totalEarnings, otherShipper: sid(other._id), otherOrder: sid(fixture.pendingOrder.id) });
      const orderBeforeWrongOwner = await db.collection('orders').findOne({ _id: orderId });
      const otherBeforeWrongOwner = await db.collection('shippers').findOne({ user: other._id });
      await loginAccount(ctx, '/auth/shipper-login', other.account, fixture.shipper.password);
      await h.open('/shipper/shipping');
      verify((await ctx.driver.findElements(By.css(`.cancel-btn[data-id="${sid(orderId)}"]`))).length, 0, 'Người thứ hai không thấy nút hủy đơn của người thứ nhất');
      const wrongOwner = await browserRequest(ctx, '/shipper/cancel', 'POST', { orderId: sid(orderId) });
      verify(wrongOwner.status, 400, 'Yêu cầu hủy sai chủ bị từ chối');
      verify(await db.collection('orders').findOne({ _id: orderId }), orderBeforeWrongOwner, 'Hủy sai chủ không đổi dữ liệu đơn');
      verify(await db.collection('shippers').findOne({ user: other._id }), otherBeforeWrongOwner, 'Hủy sai chủ không đổi tiền công hoặc lịch sử người thứ hai');
      await snapshot('bb36-nguoi-thu-hai-khong-thay-don');
      await logout(ctx);
      await h.loginShipper();
      await h.open('/shipper/shipping');
      const cancel = `.cancel-btn[data-id="${sid(orderId)}"]`;
      await h.visible(cancel);
      await snapshot('don-dang-giao-truoc-huy');
      await confirm(ctx, cancel, 'hủy đơn');
      await observe(ctx, async () => (await db.collection('shippers').findOne({ user: fixture.shipper.id })).orderHistory.some(entry => sid(entry.order) === sid(orderId) && entry.status === 'cancelled'));
      const order = await db.collection('orders').findOne({ _id: orderId });
      const after = await db.collection('shippers').findOne({ user: fixture.shipper.id });
      verify(order.status, 'cancelled', 'Hủy đơn chuyển trạng thái cancelled');
      verify(sid(order.shiperID), sid(fixture.shipper.id), 'Đơn đã hủy vẫn ghi đúng người phụ trách');
      verify(after.totalEarnings, before.totalEarnings, 'Hủy không cộng thêm tiền công');
      verify(historyView(after).filter(entry => entry.order === sid(orderId) && entry.status === 'cancelled'), [{ order: sid(orderId), status: 'cancelled', earning: 0, orderAmount: 300000 }], 'Ghi đúng một sự kiện hủy với tiền công bằng 0');
      await h.open('/shipper/shipping');
      verify((await ctx.driver.findElements(By.css(cancel))).length, 0, 'Đơn đã hủy rời danh sách đang giao');
      await snapshot('don-roi-danh-sach-dang-giao-sau-huy');
      for (const status of ['cancelled', 'delivered', 'all']) {
        const response = await jsonPage(ctx, `/shipper/history/filter?status=${status}`, `lich-su-loc-${status}`);
        if (!response) continue;
        verify(response.success, true, `Bộ lọc ${status} trả thành công`);
        const expected = historyView(after).filter(entry => status === 'all' || entry.status === status);
        verify((response.history || []).map(entry => ({ order: sid(entry.order), status: entry.status, earning: entry.earning, orderAmount: entry.orderAmount })), expected, `Bộ lọc ${status} chỉ trả đúng lịch sử của shipper đang đăng nhập`);
        verify((response.history || []).some(entry => sid(entry.order) === sid(fixture.pendingOrder.id)), false, `Bộ lọc ${status} không lẫn đơn lịch sử của shipper thứ hai`);
      }
      await h.open('/shipper/dashboard');
      verify(await h.money('.display-6.fw-bold.text-success'), before.totalEarnings, 'Dashboard giữ nguyên tiền công sau khi hủy');
      record('Quan sát tồn kho sau hủy, chưa chấm quy tắc hoàn kho', { before: beforeStock, after: priceStock(await db.collection('products').findOne({ _id: fixture.product.id })) });
      await snapshot('thu-nhap-khong-tang-sau-huy');
    },
  },
];
