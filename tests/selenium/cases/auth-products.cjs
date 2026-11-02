'use strict';

const assert = require('node:assert/strict');
const { By, until } = require('selenium-webdriver');

const loginForm = 'form[action="/auth/login"]';
const headerSearch = 'form.header-search-group';

function numericMoney(value) {
  return Number(String(value).replace(/[^\d]/g, ''));
}

function cartData(user) {
  return (user?.carts || []).map(item => ({
    productId: String(item.productID),
    type: item.type,
    size: item.size,
    quantity: Number(item.orderNumber)
  }));
}

async function waitForNavigation(driver, oldElement) {
  await driver.wait(until.stalenessOf(oldElement), 15000, 'Biểu mẫu chưa được gửi hoặc trang chưa được tải lại.');
}

async function readProductCards(driver) {
  const cards = await driver.findElements(By.css('.latest-product-area .single-product'));
  const data = [];
  for (const card of cards) {
    data.push({
      name: (await card.findElement(By.css('.product-caption h4 a')).getText()).trim(),
      price: numericMoney(await card.findElement(By.css('.price li')).getText())
    });
  }
  return data;
}

async function checkCartView(ctx, row, label) {
  const { driver, h, verify, record } = ctx;
  await h.visible(row);
  const current = {
    name: await h.text(`${row} .cart-product-name-modern`),
    type: await driver.findElement(By.css(row)).getAttribute('data-type'),
    size: await driver.findElement(By.css(row)).getAttribute('data-size'),
    quantity: Number(await driver.findElement(By.css(`${row} .cart-qty-input`)).getAttribute('value')),
    price: await h.money(`${row} td:nth-child(2) .summary-value`),
    lineTotal: await h.money(`${row} .item-total`)
  };
  await record(label, current);
  await verify(current.name.includes(ctx.fixture.product.name), true, `${label}: đúng tên sản phẩm`);
  await verify(current.type, 'Đen', `${label}: đúng màu Đen`);
  await verify(current.size, 'L', `${label}: đúng size L`);
  await verify(current.quantity, 2, `${label}: đúng hai chiếc`);
  await verify(current.price, 150000, `${label}: đơn giá của size L`);
  await verify(current.lineTotal, 300000, `${label}: tiền hàng của dòng`);
}

module.exports = [
  {
    id: 'UI-01',
    title: 'Đăng nhập đúng tài khoản khách hàng',
    async run(ctx) {
      const { driver, fixture, db, h, snapshot, record, verify } = ctx;
      assert.ok(fixture.user?.id && fixture.user.account && fixture.user.password, 'Thiếu tài khoản khách hàng kiểm thử.');
      await h.open('/auth/login');
      await h.fill('#account', fixture.user.account);
      await h.fill('#password', fixture.user.password);
      await h.click(`${loginForm} button[type="submit"]`);
      await driver.wait(async () => new URL(await driver.getCurrentUrl()).pathname === '/', 15000, 'Đăng nhập đúng chưa chuyển về trang chủ.');
      await h.ready();
      await record('Điều hướng sau đăng nhập', { pathname: new URL(await driver.getCurrentUrl()).pathname });
      await verify(new URL(await driver.getCurrentUrl()).pathname, '/', 'Khách đăng nhập đúng được chuyển về trang chủ');
      await snapshot('ui01-sau-dang-nhap');
      await h.dismissNotice();

      await h.open('/auth/profile');
      const info = await h.text('.profile-modern-info');
      const fullName = await driver.findElement(By.css('#fullName')).getAttribute('value');
      const address = await driver.findElement(By.css('#address')).getAttribute('value');
      const source = await driver.getPageSource();
      const stored = await db.collection('users').findOne({ _id: fixture.user.id });
      assert.ok(stored, 'Không tìm thấy người dùng trong DB kiểm thử.');
      await record('Hồ sơ khách hàng được hiển thị', {
        name: fullName, account: fixture.user.account, gmail: fixture.user.gmail, address,
        otherCustomerDisplayed: Boolean(fixture.otherUser?.name && info.includes(fixture.otherUser.name)),
        passwordDisplayed: source.includes(fixture.user.password),
        passwordHashDisplayed: typeof stored.password === 'string' && source.includes(stored.password)
      });
      await verify(fullName, fixture.user.name, 'Hồ sơ có đúng tên khách A');
      await verify(address, fixture.user.address, 'Hồ sơ có đúng địa chỉ khách A');
      await verify(info.includes(fixture.user.account), true, 'Hồ sơ có đúng tài khoản khách A');
      await verify(info.includes(fixture.user.gmail), true, 'Hồ sơ có đúng email khách A');
      if (fixture.otherUser?.name) {
        await verify(info.includes(fixture.otherUser.name), false, 'Không hiển thị tên khách B trong hồ sơ A');
      }
      await verify(source.includes(fixture.user.password), false, 'Trang hồ sơ không lộ mật khẩu kiểm thử');
      await verify(typeof stored.password === 'string' && source.includes(stored.password), false, 'Trang hồ sơ không lộ giá trị băm mật khẩu');
      await snapshot('ui01-ho-so-khach-a');
    }
  },
  {
    id: 'UI-02',
    title: 'Từ chối đăng nhập sai và mất quyền sau đăng xuất',
    async run(ctx) {
      const { driver, fixture, h, snapshot, record, verify } = ctx;
      assert.ok(fixture.user?.account && fixture.user.password, 'Thiếu tài khoản thử độc lập cho UI-02.');
      await h.open('/auth/login');
      await h.fill('#account', fixture.user.account);
      await h.fill('#password', `${fixture.user.password}-sai`);
      const oldForm = await driver.findElement(By.css(loginForm));
      await h.click(`${loginForm} button[type="submit"]`);
      await waitForNavigation(driver, oldForm);
      let message = '';
      try {
        const notice = await driver.wait(until.elementLocated(By.css('.custom-message-error .custom-message-text')), 5000, 'Không thấy thông báo đăng nhập sai.', 100);
        message = (await notice.getText()).trim();
      } catch (error) {
        await record('Không thu được thông báo đăng nhập sai', { reason: error.message });
      }
      await record('Phản hồi đăng nhập sai', { message, pathname: new URL(await driver.getCurrentUrl()).pathname });
      await verify(message, 'Tài khoản hoặc mật khẩu không đúng.', 'Sai mật khẩu có thông báo đúng');
      await verify(new URL(await driver.getCurrentUrl()).pathname, '/auth/login', 'Sai mật khẩu vẫn ở trang đăng nhập');
      await h.ready();
      await snapshot('ui02-sai-mat-khau');

      await h.open('/auth/profile');
      await verify(new URL(await driver.getCurrentUrl()).pathname, '/auth/login', 'Sau đăng nhập sai chưa được truy cập hồ sơ');
      await h.visible(loginForm);
      await snapshot('ui02-ho-so-sau-dang-nhap-sai');

      await h.loginUser();
      await h.click('.header-user-btn');
      await h.click('form[action="/auth/logout"] button[type="submit"]');
      await driver.wait(async () => new URL(await driver.getCurrentUrl()).pathname === '/', 15000, 'Đăng xuất chưa chuyển về trang chủ.');
      await h.ready();
      await h.dismissNotice();
      await snapshot('ui02-sau-dang-xuat');

      for (const route of ['/auth/profile', '/order/history']) {
        // A fresh request, rather than browser Back, verifies that the server rejects the old session.
        await h.open(route);
        const actualPath = new URL(await driver.getCurrentUrl()).pathname;
        await record('Truy cập mới sau đăng xuất', { requestedPath: route, actualPath });
        await verify(actualPath, '/auth/login', `Đăng xuất chặn truy cập mới tới ${route}`);
        await h.visible(loginForm);
        await snapshot(route === '/auth/profile' ? 'ui02-ho-so-da-bi-chan' : 'ui02-lich-su-da-bi-chan');
      }
    }
  },
  {
    id: 'UI-03',
    title: 'Tìm kiếm kết hợp danh mục và sắp xếp',
    async run(ctx) {
      const { driver, fixture, h, snapshot, record, verify } = ctx;
      assert.ok(fixture.product?.name && fixture.otherProduct?.name && fixture.category?.name, 'Thiếu dữ liệu tìm kiếm và danh mục.');
      const keyword = 'Alpha';
      await record('Bộ dữ liệu đối chiếu tìm kiếm', {
        keyword, selectedCategory: fixture.category.name,
        expectedIncluded: fixture.product.name,
        expectedExcluded: fixture.otherProduct.name,
        thirdProduct: fixture.thirdProduct?.name
      });
      await h.open('/products');
      await h.fill('#searchForm input[name="keyword"]', keyword);
      const oldForm = await driver.findElement(By.css('#searchForm'));
      await h.select('#searchForm select[name="category"]', fixture.category.name);
      await waitForNavigation(driver, oldForm);
      await h.ready();
      const filteredUrl = new URL(await driver.getCurrentUrl());
      await verify(filteredUrl.searchParams.get('keyword'), keyword, 'Biểu mẫu gửi đúng từ khóa');
      await verify(filteredUrl.searchParams.get('category'), fixture.category.name, 'Biểu mẫu gửi đúng danh mục');
      const cards = await readProductCards(driver);
      await record('Kết quả tìm kiếm và lọc qua biểu mẫu thật', { cards });
      await verify(cards.some(x => x.name === fixture.product.name), true, 'Kết quả chứa sản phẩm Alpha trong danh mục được chọn');
      await verify(cards.some(x => x.name === fixture.otherProduct.name), false, 'Không lẫn sản phẩm Alpha ngoài danh mục');
      const expectedNames = [fixture.product, fixture.thirdProduct]
        .filter(Boolean).filter(x => x.name.toLowerCase().includes(keyword.toLowerCase()))
        .map(x => x.name).sort();
      await verify(cards.map(x => x.name).sort(), expectedNames, 'Danh sách đồng thời thỏa từ khóa và danh mục');
      await snapshot('ui03-ket-qua-loc-danh-muc');
      const firstCaption = await driver.findElement(By.css('.latest-product-area .single-product .product-caption'));
      await driver.executeScript('arguments[0].scrollIntoView({block:"center",behavior:"instant"})', firstCaption);
      await snapshot('ui03-ten-va-gia-hai-san-pham');

      // A missing UI control is a real unmet test expectation; do not inject a sort parameter or add DOM elements.
      const sortSelector = 'select[name="sort"], #sortSelect';
      const sortControls = await driver.findElements(By.css(sortSelector));
      await verify(sortControls.length > 0, true, 'Giao diện có lựa chọn sắp xếp giá tăng dần');
      if (sortControls.length) {
        await h.select(sortSelector, 'price_asc');
        const sorted = await readProductCards(driver);
        await record('Giá sau khi chọn sắp xếp trên giao diện', { cards: sorted });
        const prices = sorted.map(x => x.price);
        await verify(prices, [...prices].sort((a, b) => a - b), 'Giá hiển thị được sắp tăng dần');
        await snapshot('ui03-sap-xep-gia');
      } else {
        await record('Giới hạn giao diện được quan sát', { sortControlPresent: false, action: 'Không thay thế thao tác UI bằng URL hoặc JavaScript.' });
      }

      const noResults = `khongcotensanpham_selenium_${Date.now()}`;
      await h.fill(`${headerSearch} input[name="keyword"]`, noResults);
      const oldSearch = await driver.findElement(By.css(headerSearch));
      await h.click(`${headerSearch} button[type="submit"]`);
      await waitForNavigation(driver, oldSearch);
      await h.ready();
      const remaining = await readProductCards(driver);
      const body = await h.text('body');
      await record('Tìm từ khóa không có kết quả', { keyword: noResults, cardCount: remaining.length, emptyMessageVisible: body.includes('No products found.'), serverErrorVisible: body.includes('500 - Lỗi Máy Chủ') });
      await verify(new URL(await driver.getCurrentUrl()).searchParams.get('keyword'), noResults, 'Gửi từ khóa không có kết quả qua biểu mẫu header');
      await verify(remaining.length, 0, 'Không có sản phẩm cho từ khóa không tồn tại');
      await verify(body.includes('No products found.'), true, 'Có thông báo danh sách rỗng rõ ràng');
      await verify(body.includes('500 - Lỗi Máy Chủ'), false, 'Tìm kiếm rỗng không dẫn đến trang lỗi máy chủ');
      await snapshot('ui03-khong-co-ket-qua');
    }
  },
  {
    id: 'UI-04',
    title: 'Chọn đúng màu và size khi thêm giỏ',
    async run(ctx) {
      const { driver, fixture, db, h, snapshot, record, verify } = ctx;
      assert.ok(fixture.user?.id && fixture.product?.id, 'Thiếu người dùng hoặc sản phẩm kiểm thử.');
      const sizeIndex = fixture.product.detail.findIndex(x => x.size === 'L');
      assert.ok(sizeIndex >= 0, 'Fixture không có size L.');
      const before = await db.collection('users').findOne({ _id: fixture.user.id });
      assert.ok(before, 'Không tìm thấy người dùng trong DB kiểm thử.');
      assert.deepEqual(cartData(before), [], 'UI-04 yêu cầu giỏ ban đầu rỗng.');
      await record('Giỏ trước khi thêm, đọc từ DB kiểm thử', { userId: String(fixture.user.id), cart: cartData(before) });

      await h.loginUser();
      await h.open(`/products/${encodeURIComponent(fixture.product.name)}`);
      await verify((await h.text('.single-product-details h3')).trim(), fixture.product.name, 'Đúng trang sản phẩm fixture');
      await h.select('#typeSelect', '0');
      await h.select('#sizeSelect', String(sizeIndex));
      await driver.wait(async () => (await h.text('#productPrice')).trim().length > 0, 15000, 'Giá chưa hiển thị.');
      await verify(await h.money('#productPrice'), 150000, 'Chọn L hiển thị giá 150.000 đồng');
      await verify(Number((await h.text('#productStock')).trim()), 3, 'Chọn L hiển thị tồn ba chiếc');
      await h.fill('#qtyInput', '2');
      const enteredQuantity = await driver.findElement(By.css('#qtyInput')).getAttribute('value');
      await verify(enteredQuantity, '2', 'Trước khi thêm, ô số lượng đã được nhập đúng hai');
      assert.equal(enteredQuantity, '2', 'Không gửi thao tác thêm giỏ với số lượng chưa được nhập đúng.');
      await snapshot('ui04-size-l-gia-va-so-luong');
      await h.click('#addToCartBtn');
      const notice = await h.text('#swal2-title');
      await verify(notice, 'Sản phẩm đã được thêm vào giỏ hàng!', 'Có thông báo thêm giỏ thành công');
      await record('Thông báo sau khi thêm giỏ', { title: notice });
      await snapshot('ui04-thong-bao-them-gio');
      await h.dismissNotice();

      await driver.wait(async () => {
        const current = await db.collection('users').findOne({ _id: fixture.user.id });
        return Boolean(current?.carts?.length);
      }, 15000, 'Chưa thấy dữ liệu giỏ sau thao tác UI.');
      const after = await db.collection('users').findOne({ _id: fixture.user.id });
      await record('Giỏ sau khi thêm, đọc từ DB kiểm thử', { userId: String(fixture.user.id), cart: cartData(after) });
      await verify(cartData(after), [{ productId: String(fixture.product.id), type: 'Đen', size: 'L', quantity: 2 }], 'DB lưu đúng sản phẩm, màu, size và hai chiếc');

      const row = `tr[data-product-id="${String(fixture.product.id)}"][data-type="Đen"][data-size="L"]`;
      await h.open('/cart');
      await checkCartView(ctx, row, 'Giỏ sau lần mở đầu');
      await snapshot('ui04-gio-hang-truoc-tai-lai');
      await driver.navigate().refresh();
      await h.ready();
      await checkCartView(ctx, row, 'Giỏ sau tải lại');
      await snapshot('ui04-gio-hang-sau-tai-lai');
      const storedProduct = await db.collection('products').findOne({ _id: fixture.product.id });
      await verify(storedProduct.detail.find(x => x.size === 'L').stock, 3, 'Chỉ thêm giỏ chưa làm giảm tồn size L');
    }
  }
];
