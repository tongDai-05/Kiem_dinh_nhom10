'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequire } = require('node:module');
const { By, until } = require('selenium-webdriver');
const userRequire = createRequire(path.resolve(__dirname, '../../../user/package.json'));
const bcrypt = userRequire('bcryptjs');

const registerForm = 'form[action="/auth/register"]';
const loginForm = 'form[action="/auth/login"]';

async function capture(ctx, name, css) {
  if (css) {
    const elements = await ctx.driver.findElements(By.css(css));
    for (const element of elements) {
      if (await element.isDisplayed()) {
        await ctx.driver.executeScript('arguments[0].scrollIntoView({block:"center",behavior:"instant"});', element);
        break;
      }
    }
  }
  await ctx.snapshot(name);
}

async function submit(ctx, form) {
  const oldForm = await ctx.driver.findElement(By.css(form));
  await ctx.h.click(`${form} button[type="submit"]`);
  await ctx.driver.wait(until.stalenessOf(oldForm), 15000, 'Biểu mẫu chưa gửi hoặc trang chưa tải lại.');
  await ctx.h.ready();
}

async function messages(ctx) {
  const found = [];
  for (const element of await ctx.driver.findElements(By.css('.custom-message-error .custom-message-text, form.contact_form small.text-danger'))) {
    try {
      const text = (await element.getText()).trim();
      if (text) found.push(text);
    } catch (error) {
      if (error.name !== 'StaleElementReferenceError') throw error;
    }
  }
  return [...new Set(found)];
}

async function fillRegistration(ctx, data) {
  await ctx.h.open('/auth/register');
  await ctx.h.fill('#name', data.name);
  await ctx.h.fill('#account', data.account);
  await ctx.h.fill('#gmail', data.gmail);
  await ctx.h.fill('#password', data.password);
  await ctx.h.fill('#confirmPassword', data.confirmPassword ?? data.password);
}

async function login(ctx, identifier, password) {
  await ctx.h.open('/auth/login');
  await ctx.h.fill('#account', identifier);
  await ctx.h.fill('#password', password);
  await submit(ctx, loginForm);
}

async function logout(ctx) {
  await ctx.h.dismissNotice();
  await ctx.h.click('.header-user-btn');
  await ctx.h.click('form[action="/auth/logout"] button[type="submit"]');
  await ctx.driver.wait(async () => new URL(await ctx.driver.getCurrentUrl()).pathname === '/', 15000, 'Chưa chuyển về trang chủ sau đăng xuất.');
  await ctx.h.ready();
}

async function productCards(ctx) {
  const data = [];
  for (const card of await ctx.driver.findElements(By.css('.latest-product-area .single-product'))) {
    data.push({
      name: (await card.findElement(By.css('.product-caption h4 a')).getText()).trim(),
      price: Number((await card.findElement(By.css('.price li')).getText()).replace(/[^\d]/g, ''))
    });
  }
  return data;
}

function safeUser(document) {
  return document && {
    id: String(document._id), account: document.account, name: document.name,
    gmail: document.gmail, role: document.role, address: document.address || ''
  };
}

function imageSource(image) {
  const data = image?.imageData;
  const bytes = Buffer.isBuffer(data) ? data : data?.buffer ? Buffer.from(data.buffer) : null;
  return bytes ? `data:${image.imageType};base64,${bytes.toString('base64')}` : '';
}

async function optionValue(ctx, selector, text) {
  for (const option of await ctx.driver.findElements(By.css(`${selector} option`))) {
    if ((await option.getAttribute('textContent')).trim() === text) return option.getAttribute('value');
  }
  assert.fail(`Fixture hoặc lựa chọn giao diện bị thiếu: ${text}`);
}

module.exports = [
  {
    id: 'BB-01', title: 'Đăng ký tài khoản với thông tin hợp lệ', complete: true,
    scope: 'Đăng ký mới bằng biểu mẫu; kiểm tra hồ sơ sau đăng ký, số tài khoản tăng một và mật khẩu băm xác minh được trong DB tạm.',
    async run(ctx) {
      const data = { name: 'Người kiểm thử A', account: 'khach_thu_a', gmail: 'khach.a@example.test', password: 'Kiemthu123' };
      assert.equal(await ctx.db.collection('users').countDocuments({ $or: [{ account: data.account }, { gmail: data.gmail }] }), 0, 'Tài khoản đăng ký thử phải chưa tồn tại.');
      const before = await ctx.db.collection('users').countDocuments({});
      await fillRegistration(ctx, data);
      await ctx.record('Dữ liệu đăng ký hợp lệ', { name: data.name, account: data.account, gmail: data.gmail, passwordLength: data.password.length, usersBefore: before });
      await capture(ctx, 'bb01-bieu-mau-hop-le', registerForm);
      await submit(ctx, registerForm);
      await ctx.verify(new URL(await ctx.driver.getCurrentUrl()).pathname, '/', 'Đăng ký hợp lệ đưa khách về trang chủ');
      const stored = await ctx.db.collection('users').findOne({ account: data.account });
      const after = await ctx.db.collection('users').countDocuments({});
      const hashValid = Boolean(stored?.password && stored.password !== data.password && await bcrypt.compare(data.password, stored.password));
      await ctx.record('Tài khoản mới đọc từ DB kiểm thử', { usersBefore: before, usersAfter: after, user: safeUser(stored), passwordStoredAsPlaintext: stored?.password === data.password, hashMatchesTestPassword: hashValid });
      await ctx.verify(after, before + 1, 'Chỉ tạo đúng một tài khoản mới');
      await ctx.verify(stored?.role, 'User', 'Tài khoản mới có vai trò khách hàng');
      await ctx.verify(stored?.gmail, data.gmail, 'Email được lưu đúng');
      await ctx.verify(hashValid, true, 'Mật khẩu không lưu văn bản và băm xác minh được');
      await ctx.h.dismissNotice();
      await ctx.h.open('/auth/profile');
      const profile = await ctx.h.text('.profile-modern-info');
      await ctx.verify(await ctx.driver.findElement(By.css('#fullName')).getAttribute('value'), data.name, 'Hồ sơ đúng tên vừa đăng ký');
      await ctx.verify(profile.includes(data.account) && profile.includes(data.gmail), true, 'Hồ sơ đúng tài khoản và email mới');
      await capture(ctx, 'bb01-ho-so-sau-dang-ky', '.profile-modern-container');
    }
  },
  {
    id: 'BB-02', title: 'Đăng ký với dữ liệu thiếu hoặc ở giới hạn độ dài', complete: true,
    scope: 'Chạy đủ biên tên đăng nhập 2/3/4, mật khẩu 5/6/7, email sai, xác nhận lệch và họ tên rỗng hoặc chỉ có dấu cách; đối chiếu số bản ghi trong DB tạm sau từng lượt.',
    async run(ctx) {
      const variants = [
        { label: 'tai-khoan-2-ky-tu', data: { name: 'Khách kiểm thử biên', account: 'ab', gmail: 'bb02.account2@example.test', password: 'Kiemthu123' }, accepted: false, expected: 'Tên đăng nhập không được để trống và ít nhất 3 ký tự' },
        { label: 'tai-khoan-3-ky-tu', data: { name: 'Khách biên 3', account: 'b03', gmail: 'bb02.account3@example.test', password: 'Kiemthu123' }, accepted: true },
        { label: 'tai-khoan-4-ky-tu', data: { name: 'Khách biên 4', account: 'b004', gmail: 'bb02.account4@example.test', password: 'Kiemthu123' }, accepted: true },
        { label: 'mat-khau-5-ky-tu', data: { name: 'Khách kiểm thử biên', account: 'bb02_password5', gmail: 'bb02.password5@example.test', password: 'Abc12' }, accepted: false, expected: 'Mật khẩu phải có ít nhất 6 ký tự' },
        { label: 'mat-khau-6-ky-tu', data: { name: 'Khách biên 6', account: 'bb02_password6', gmail: 'bb02.password6@example.test', password: 'Abc123' }, accepted: true },
        { label: 'mat-khau-7-ky-tu', data: { name: 'Khách biên 7', account: 'bb02_password7', gmail: 'bb02.password7@example.test', password: 'Abc1234' }, accepted: true },
        { label: 'email-sai', data: { name: 'Khách email sai', account: 'bb02_bad_mail', gmail: 'khong-phai-email', password: 'Kiemthu123' }, accepted: false, expected: 'Email không hợp lệ' },
        { label: 'xac-nhan-lech', data: { name: 'Khách xác nhận lệch', account: 'bb02_mismatch', gmail: 'bb02.mismatch@example.test', password: 'Kiemthu123', confirmPassword: 'Kiemthu124' }, accepted: false, expected: 'không khớp' },
        { label: 'ho-ten-rong', data: { name: '', account: 'bb02_empty_name', gmail: 'bb02.empty.name@example.test', password: 'Kiemthu123' }, accepted: false, expected: 'Họ tên không được để trống' },
        { label: 'ho-ten-dau-cach', data: { name: '   ', account: 'bb02_space_name', gmail: 'bb02.space.name@example.test', password: 'Kiemthu123' }, accepted: false, expected: 'Họ tên không được để trống' }
      ];
      for (const variant of variants) {
        const before = await ctx.db.collection('users').countDocuments({});
        await fillRegistration(ctx, variant.data);
        await capture(ctx, `bb02-${variant.label}-truoc-gui`, registerForm);
        await submit(ctx, registerForm);
        const actualMessages = await messages(ctx);
        await capture(ctx, `bb02-${variant.label}-ket-qua`, `${registerForm} .text-danger, .custom-message-error, header`);
        const after = await ctx.db.collection('users').countDocuments({});
        const stored = await ctx.db.collection('users').findOne({ account: variant.data.account });
        await ctx.record('Kết quả thử biên đăng ký', { variant: variant.label, acceptedExpected: variant.accepted, accountLength: variant.data.account.length, passwordLength: variant.data.password.length, nameLength: variant.data.name.length, messages: actualMessages, pathname: new URL(await ctx.driver.getCurrentUrl()).pathname, usersBefore: before, usersAfter: after, stored: safeUser(stored) });
        if (variant.accepted) {
          await ctx.verify(new URL(await ctx.driver.getCurrentUrl()).pathname, '/', `${variant.label}: biên hợp lệ được chấp nhận`);
          await ctx.verify(after, before + 1, `${variant.label}: tạo đúng một tài khoản`);
          await ctx.verify(stored?.account, variant.data.account, `${variant.label}: DB lưu đúng tài khoản biên`);
          await ctx.h.open('/auth/logout');
          await ctx.h.dismissNotice();
        } else {
          await ctx.verify(actualMessages.some(x => x.toLowerCase().includes(variant.expected.toLowerCase())), true, `${variant.label}: có thông báo từ chối phù hợp`);
          await ctx.verify(new URL(await ctx.driver.getCurrentUrl()).pathname, '/auth/register', `${variant.label}: vẫn ở trang đăng ký`);
          await ctx.verify(after, before, `${variant.label}: không tạo tài khoản`);
        }
      }
    }
  },
  {
    id: 'BB-03', title: 'Đăng ký trùng tên đăng nhập hoặc email', complete: true,
    scope: 'Hai lượt độc lập trên tài khoản fixture đã có: trùng tên với email mới; trùng email với tên mới; đối chiếu tổng số tài khoản và bản ghi gốc.',
    async run(ctx) {
      const original = await ctx.db.collection('users').findOne({ _id: ctx.fixture.user.id });
      assert.ok(original, 'Thiếu tài khoản đã có để kiểm thử trùng.');
      const variants = [
        { label: 'trung-ten-dang-nhap', account: original.account, gmail: 'bb03.new@example.test' },
        { label: 'trung-email', account: 'bb03_new_account', gmail: original.gmail }
      ];
      for (const variant of variants) {
        const before = await ctx.db.collection('users').countDocuments({});
        await fillRegistration(ctx, { ...variant, name: 'Tên không được ghi đè', password: 'Kiemthu123' });
        await capture(ctx, `bb03-${variant.label}-bieu-mau`, registerForm);
        await submit(ctx, registerForm);
        const actualMessages = await messages(ctx);
        await capture(ctx, `bb03-${variant.label}-tu-choi`, '.custom-message-error');
        const current = await ctx.db.collection('users').findOne({ _id: original._id });
        const after = await ctx.db.collection('users').countDocuments({});
        await ctx.record('Từ chối đăng ký trùng', { variant: variant.label, account: variant.account, gmail: variant.gmail, messages: actualMessages, usersBefore: before, usersAfter: after, originalBefore: safeUser(original), originalAfter: safeUser(current), originalPasswordUnchanged: current?.password === original.password });
        await ctx.verify(actualMessages.some(x => x.includes('Tài khoản hoặc email đã tồn tại.')), true, `${variant.label}: thông báo đã tồn tại`);
        await ctx.verify(after, before, `${variant.label}: không thêm tài khoản`);
        await ctx.verify(safeUser(current), safeUser(original), `${variant.label}: không ghi đè hồ sơ cũ`);
        await ctx.verify(current?.password === original.password, true, `${variant.label}: không ghi đè mật khẩu cũ`);
      }
    }
  },
  {
    id: 'BB-04', title: 'Đăng nhập bằng tên đăng nhập và bằng email', complete: true,
    scope: 'Đăng nhập cùng khách fixture lần lượt bằng tên và email, đăng xuất giữa hai lượt, đối chiếu hồ sơ và cùng định danh tài khoản.',
    async run(ctx) {
      const variants = [{ label: 'ten-dang-nhap', identifier: ctx.fixture.user.account }, { label: 'email', identifier: ctx.fixture.user.gmail }];
      for (let i = 0; i < variants.length; i++) {
        const variant = variants[i];
        await login(ctx, variant.identifier, ctx.fixture.user.password);
        await ctx.verify(new URL(await ctx.driver.getCurrentUrl()).pathname, '/', `${variant.label}: đăng nhập thành công`);
        await capture(ctx, `bb04-${variant.label}-dang-nhap`, '.swal2-popup, .custom-message-success');
        await ctx.h.dismissNotice();
        await ctx.h.open('/auth/profile');
        const info = await ctx.h.text('.profile-modern-info');
        await ctx.record('Đối chiếu hồ sơ sau đăng nhập', { loginMethod: variant.label, identifier: variant.identifier, expectedUserId: String(ctx.fixture.user.id), displayedProfile: info });
        await ctx.verify(info.includes(ctx.fixture.user.account) && info.includes(ctx.fixture.user.gmail) && info.includes(ctx.fixture.user.name), true, `${variant.label}: đúng cùng hồ sơ khách A`);
        await ctx.verify(info.includes(ctx.fixture.otherUser.name), false, `${variant.label}: không nhầm khách B`);
        await capture(ctx, `bb04-${variant.label}-ho-so`, '.profile-modern-container');
        if (i < variants.length - 1) await logout(ctx);
      }
    }
  },
  {
    id: 'BB-05', title: 'Đăng nhập sai hoặc bỏ trống thông tin', complete: true,
    scope: 'Bốn lượt trên form thật: tài khoản không có, mật khẩu sai, tên rỗng và mật khẩu rỗng; mở mới hồ sơ sau mỗi lượt để kiểm tra chưa được cấp quyền.',
    async run(ctx) {
      const variants = [
        { label: 'tai-khoan-khong-co', identifier: 'bb05_khong_ton_tai', password: 'Kiemthu123', expected: 'Tài khoản hoặc mật khẩu không đúng.' },
        { label: 'mat-khau-sai', identifier: ctx.fixture.user.account, password: 'SaiMatKhau123', expected: 'Tài khoản hoặc mật khẩu không đúng.' },
        { label: 'tai-khoan-rong', identifier: '', password: 'Kiemthu123', expected: 'Tài khoản không được để trống' },
        { label: 'mat-khau-rong', identifier: ctx.fixture.user.account, password: '', expected: 'Mật khẩu không được để trống' }
      ];
      for (const variant of variants) {
        await login(ctx, variant.identifier, variant.password);
        const actualMessages = await messages(ctx);
        await capture(ctx, `bb05-${variant.label}-thong-bao`, '.custom-message-error, form.contact_form small.text-danger');
        await ctx.record('Kết quả đăng nhập không hợp lệ', { variant: variant.label, identifier: variant.identifier || '(rỗng)', passwordEmpty: !variant.password, messages: actualMessages, pathname: new URL(await ctx.driver.getCurrentUrl()).pathname });
        await ctx.verify(actualMessages.some(x => x.includes(variant.expected)), true, `${variant.label}: có thông báo phù hợp`);
        await ctx.verify(new URL(await ctx.driver.getCurrentUrl()).pathname, '/auth/login', `${variant.label}: không đăng nhập thành công`);
        await ctx.h.open('/auth/profile');
        await ctx.verify(new URL(await ctx.driver.getCurrentUrl()).pathname, '/auth/login', `${variant.label}: hồ sơ bị chặn khi gửi yêu cầu mới`);
        await ctx.verify((await ctx.driver.findElements(By.css('.profile-modern-info'))).length, 0, `${variant.label}: không trả nội dung hồ sơ`);
        await capture(ctx, `bb05-${variant.label}-ho-so-bi-chan`, '.custom-message-error, .login_part_form');
      }
    }
  },
  {
    id: 'BB-06', title: 'Đăng xuất và kiểm tra phiên cũ', complete: true,
    scope: 'Đăng xuất bằng nút UI, mở mới hồ sơ, rồi phát lại đúng cookie phiên trước đăng xuất bằng Selenium và gửi lại GET hồ sơ; che hoàn toàn giá trị cookie trong log.',
    async run(ctx) {
      await ctx.h.loginUser();
      await ctx.h.open('/auth/profile');
      const oldCookie = await ctx.driver.manage().getCookie('connect.sid');
      assert.ok(oldCookie?.value, 'Chưa ghi nhận được cookie của phiên đang đăng nhập.');
      await capture(ctx, 'bb06-ho-so-truoc-dang-xuat', '.profile-modern-container');
      await logout(ctx);
      await capture(ctx, 'bb06-trang-sau-dang-xuat', 'header');
      await ctx.h.open('/auth/profile');
      await ctx.verify(new URL(await ctx.driver.getCurrentUrl()).pathname, '/auth/login', 'Yêu cầu hồ sơ mới sau đăng xuất bị chuyển về đăng nhập');
      await capture(ctx, 'bb06-ho-so-sau-dang-xuat', '.custom-message-error');
      await ctx.driver.manage().addCookie({ name: oldCookie.name, value: oldCookie.value, path: '/' });
      await ctx.h.open('/auth/profile');
      const replayedPath = new URL(await ctx.driver.getCurrentUrl()).pathname;
      const privateBlocks = (await ctx.driver.findElements(By.css('.profile-modern-info'))).length;
      const decoded = decodeURIComponent(oldCookie.value);
      const sessionId = decoded.startsWith('s:') ? decoded.slice(2, decoded.lastIndexOf('.')) : decoded;
      const oldSessionStillExists = Boolean(await ctx.db.collection('user_app_sessions').findOne({ _id: sessionId }));
      await ctx.record('Phát lại phiên cũ đã che giá trị', { capturedCookie: true, replayAttempted: true, replayedPath, privateBlocks, oldSessionStillExists, cookieValue: '(đã che)' });
      await ctx.verify(replayedPath, '/auth/login', 'Phát lại cookie cũ không lấy lại quyền xem hồ sơ');
      await ctx.verify(privateBlocks, 0, 'Phát lại phiên cũ không trả khối thông tin riêng tư');
      await ctx.verify(oldSessionStillExists, false, 'Phiên cũ đã bị xóa khỏi kho phiên của DB kiểm thử');
      await capture(ctx, 'bb06-phat-lai-cookie-cu-bi-chan', '.custom-message-error');
    }
  },
  {
    id: 'BB-07', title: 'Tìm kiếm sản phẩm và xử lý khi không có kết quả', complete: true,
    scope: 'Kiểm tra riêng đường tìm kiếm cũ /products/search?query= bằng Alpha, ALPHA, từ không tồn tại và rỗng; không đánh đồng với form mới /products?keyword=. Fixture Alpha có cả áo và quần.',
    async run(ctx) {
      const variants = [{ label: 'khop-mot-phan', keyword: 'Alpha' }, { label: 'chu-hoa', keyword: 'ALPHA' }, { label: 'khong-ton-tai', keyword: 'khong_ton_tai_bb07' }, { label: 'rong', keyword: '' }];
      for (const variant of variants) {
        await ctx.h.open(`/products/search?query=${encodeURIComponent(variant.keyword)}`);
        const body = await ctx.h.text('body');
        const serverError = body.includes('500 - Lỗi Máy Chủ');
        const cards = await productCards(ctx);
        await ctx.record('Kết quả đường tìm kiếm cũ', { variant: variant.label, keyword: variant.keyword, pathname: new URL(await ctx.driver.getCurrentUrl()).pathname, serverError, cards, emptyMessageVisible: body.includes('No products found.') });
        await ctx.verify(serverError, false, `${variant.label}: không gây lỗi máy chủ`);
        if (variant.keyword.toLowerCase() === 'alpha') {
          await ctx.verify(cards.map(x => x.name).sort(), [ctx.fixture.product.name, ctx.fixture.otherProduct.name].sort(), `${variant.label}: kết quả khớp một phần và không phân biệt hoa thường`);
        } else if (variant.keyword) {
          await ctx.verify(cards.length, 0, 'Từ không tồn tại không có sản phẩm');
          await ctx.verify(body.includes('No products found.'), true, 'Từ không tồn tại có thông báo danh sách rỗng');
        } else {
          await ctx.verify(body.includes('Vui lòng nhập từ khóa') || body.includes('No products found.'), true, 'Từ khóa rỗng có hướng dẫn hoặc trạng thái rỗng rõ ràng');
        }
        await capture(ctx, `bb07-${variant.label}`, serverError ? '.hero-cap h2' : cards.length ? '.product-caption' : '.latest-product-area');
      }
    }
  },
  {
    id: 'BB-08', title: 'Kết hợp tìm kiếm với danh mục', complete: true,
    scope: 'Dùng form thật: nhập Alpha rồi chọn Áo Selenium để gửi đồng thời cả hai điều kiện. Đối chiếu tiêu chí đề xuất giao của từ khóa và danh mục; chưa có phê duyệt nghiệp vụ ngoài đặc tả báo cáo.',
    async run(ctx) {
      await ctx.h.open('/products');
      await ctx.h.fill('#searchForm input[name="keyword"]', 'Alpha');
      await capture(ctx, 'bb08-tu-khoa-va-lua-chon-danh-muc', '#searchForm');
      const oldForm = await ctx.driver.findElement(By.css('#searchForm'));
      await ctx.h.select('#searchForm select[name="category"]', ctx.fixture.category.name);
      await ctx.driver.wait(until.stalenessOf(oldForm), 15000);
      await ctx.h.ready();
      const url = new URL(await ctx.driver.getCurrentUrl());
      const cards = await productCards(ctx);
      await ctx.record('Hai điều kiện thực sự gửi và kết quả', { keyword: url.searchParams.get('keyword'), category: url.searchParams.get('category'), fixture: [{ name: ctx.fixture.product.name, category: ctx.fixture.category.name }, { name: ctx.fixture.otherProduct.name, category: ctx.fixture.otherCategory.name }], cards, oracle: 'Tiêu chí đề xuất: sản phẩm phải đồng thời thuộc danh mục và khớp từ khóa.' });
      await ctx.verify(url.searchParams.get('keyword'), 'Alpha', 'Form gửi đúng từ khóa Alpha');
      await ctx.verify(url.searchParams.get('category'), ctx.fixture.category.name, 'Form gửi đúng danh mục Áo');
      await ctx.verify(cards.map(x => x.name).sort(), [ctx.fixture.product.name], 'Theo tiêu chí đề xuất, chỉ áo Alpha thuộc danh mục Áo được hiển thị');
      await ctx.verify(cards.some(x => x.name === ctx.fixture.otherProduct.name), false, 'Theo tiêu chí đề xuất, không lẫn quần Alpha ngoài danh mục');
      await capture(ctx, 'bb08-ten-va-gia-cac-san-pham-thuc-te', '.product-caption');
    }
  },
  {
    id: 'BB-09', title: 'Chọn màu và cỡ trên trang chi tiết', complete: true,
    scope: 'Dữ liệu thực của lượt thử: Đen/M 120.000 còn 5, Đen/L 150.000 còn 3, thêm riêng Trắng/S 130.000 hết kho trong DB tạm. Kiểm tra ảnh mẫu, giá/kho, hai nút bị chặn ở biến thể hết và quay về biến thể còn hàng.',
    async run(ctx) {
      const base = await ctx.db.collection('products').findOne({ _id: ctx.fixture.product.id });
      assert.ok(base?.image?.imageData, 'Thiếu sản phẩm và ảnh mẫu fixture.');
      const whiteImage = {
        imageName: 'white-test-fixture.svg', imageType: 'image/svg+xml',
        imageData: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect x="1" y="1" width="38" height="38" fill="white" stroke="gray"/><text x="20" y="26" font-size="18" text-anchor="middle">W</text></svg>', 'utf8')
      };
      const white = { name: base.name, type: 'Trắng', category: ctx.fixture.category.id, description: 'Biến thể hết kho dành riêng cho kiểm thử BB-09.', detail: [{ size: 'S', price: 130000, stock: 0 }], image: whiteImage, reviewProducts: [] };
      const inserted = await ctx.db.collection('products').insertOne(white);
      const ordersBefore = await ctx.db.collection('orders').countDocuments({});
      await ctx.h.loginUser();
      await ctx.h.open(`/products/${encodeURIComponent(base.name)}`);
      const blackValue = await optionValue(ctx, '#typeSelect', 'Đen');
      const whiteValue = await optionValue(ctx, '#typeSelect', 'Trắng');
      const selections = [
        { label: 'den-m', type: blackValue, size: 'M', price: 120000, stock: 5, image: imageSource(base.image) },
        { label: 'den-l', type: blackValue, size: 'L', price: 150000, stock: 3, image: imageSource(base.image) },
        { label: 'trang-s-het-kho', type: whiteValue, size: 'S (Hết hàng)', price: 130000, stock: 0, image: imageSource(whiteImage) }
      ];
      for (const selection of selections) {
        await ctx.h.select('#typeSelect', selection.type);
        await ctx.h.select('#sizeSelect', await optionValue(ctx, '#sizeSelect', selection.size));
        const actual = { price: await ctx.h.money('#productPrice'), stock: Number((await ctx.h.text('#productStock')).trim()), imageMatchesFixture: await ctx.driver.findElement(By.css('#mainProductImg')).getAttribute('src') === selection.image, addHasDisabledClass: (await ctx.driver.findElement(By.css('#addToCartBtn')).getAttribute('class')).split(/\s+/).includes('disabled'), buyHasDisabledClass: (await ctx.driver.findElement(By.css('#buyNowBtn')).getAttribute('class')).split(/\s+/).includes('disabled') };
        await ctx.record('Đối chiếu biến thể đang chọn', { selection: selection.label, expectedPrice: selection.price, expectedStock: selection.stock, actual, imageOrigin: selection.type === whiteValue ? 'Ảnh SVG mẫu của biến thể kiểm thử, không phải ảnh minh chứng được chỉnh sửa.' : 'Ảnh fixture gốc.' });
        await ctx.verify(actual.price, selection.price, `${selection.label}: đúng giá`);
        await ctx.verify(actual.stock, selection.stock, `${selection.label}: đúng tồn kho`);
        await ctx.verify(actual.imageMatchesFixture, true, `${selection.label}: ảnh đúng biến thể fixture`);
        await ctx.verify(actual.addHasDisabledClass, selection.stock === 0, `${selection.label}: trạng thái thêm giỏ đúng tồn kho`);
        await ctx.verify(actual.buyHasDisabledClass, selection.stock === 0, `${selection.label}: trạng thái mua ngay đúng tồn kho`);
        await capture(ctx, `bb09-${selection.label}`, '.single-product-details');
      }
      for (const target of [{ button: '#addToCartBtn', label: 'them-gio' }, { button: '#buyNowBtn', label: 'mua-ngay' }]) {
        await ctx.h.click(target.button);
        const title = await ctx.h.text('#swal2-title');
        await ctx.verify(title, 'Sản phẩm đã hết hàng', `${target.label}: cảnh báo hết hàng`);
        await ctx.record('Thử thao tác với biến thể hết kho', { action: target.label, message: title });
        await capture(ctx, `bb09-chan-${target.label}-het-kho`, '.swal2-popup');
        await ctx.h.dismissNotice();
      }
      const userAfter = await ctx.db.collection('users').findOne({ _id: ctx.fixture.user.id });
      const whiteAfter = await ctx.db.collection('products').findOne({ _id: inserted.insertedId });
      await ctx.verify((userAfter.carts || []).length, 0, 'Biến thể hết kho không được thêm vào giỏ');
      await ctx.verify(await ctx.db.collection('orders').countDocuments({}), ordersBefore, 'Biến thể hết kho không tạo đơn');
      await ctx.verify(whiteAfter.detail[0].stock, 0, 'Kho của biến thể hết hàng vẫn bằng không');
      await ctx.h.select('#typeSelect', blackValue);
      await ctx.h.select('#sizeSelect', await optionValue(ctx, '#sizeSelect', 'M'));
      await ctx.verify((await ctx.driver.findElement(By.css('#addToCartBtn')).getAttribute('class')).split(/\s+/).includes('disabled'), false, 'Quay lại biến thể còn kho vẫn cho phép thao tác');
      await capture(ctx, 'bb09-bien-the-con-hang-van-ban-duoc', '.single-product-details');
    }
  },
  {
    id: 'BB-10', title: 'Sắp xếp sản phẩm theo giá và tên', complete: false,
    scope: 'Chỉ khảo sát giao diện và chụp danh sách/tên/giá thực tế, kiểm tra có điều khiển sắp xếp hay không; chưa chạy bốn kiểu sắp xếp. Sự hiện diện control là tiêu chí thiết kế đề xuất, chưa có xác nhận yêu cầu từ chủ dự án.',
    async run(ctx) {
      await ctx.h.open('/products');
      const cards = await productCards(ctx);
      const controls = await ctx.driver.findElements(By.css('select[name="sort"], #sortSelect, .product-sorting select, .sorting select'));
      await ctx.record('Khảo sát chức năng sắp xếp', { cards, sortControlsFound: controls.length, attemptedSortModes: [], limitation: 'Không thêm control vào DOM và không thay thao tác UI bằng URL; chưa thử bốn lựa chọn giá/tên. Tiêu chí hiện diện control còn là đề xuất.' });
      await ctx.verify(controls.length > 0, true, 'Theo tiêu chí đề xuất, giao diện có điều khiển sắp xếp để thực hiện ca');
      await capture(ctx, 'bb10-danh-sach-ten-gia-va-giao-dien-sort', '.product-caption');
      await capture(ctx, 'bb10-khu-vuc-bo-loc-thuc-te', '#searchForm');
    }
  }
];
