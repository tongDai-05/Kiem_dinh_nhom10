'use strict';

const { By } = require('selenium-webdriver');

module.exports = [{
  id: 'UI-05',
  title: 'Sửa số lượng và xóa đúng size trong giỏ',
  async run(ctx) {
    const { driver, fixture, db, h, verify, snapshot, record } = ctx;
    const prefix = `tr[data-product-id="${fixture.product.id}"]`;
    const row = (size) => `${prefix}[data-size="${size}"]`;
    const cart = async () => {
      const u = await db.collection('users').findOne({ _id: fixture.user.id });
      return u.carts.map((c) => ({ product: String(c.productID), size: c.size, type: c.type, quantity: c.orderNumber }));
    };
    await h.loginUser();
    await h.open('/cart');
    verify((await driver.findElements(By.css(prefix))).length, 2, 'Giỏ ban đầu có hai dòng M và L');
    verify(await h.money('#cart-subtotal'), 270000, 'Tiền hàng ban đầu là 270.000 đồng');
    record('Giỏ trước khi sửa', await cart());
    await snapshot('01-hai-size-ban-dau');

    // The app handles mousedown. A genuine WebDriver click exercises that event.
    await h.click(`${row('L')} .cart-qty-up`);
    await driver.wait(async () => (await cart()).some((c) => c.quantity === 2), 10000, 'Chưa ghi nhận cập nhật số lượng.');
    await driver.navigate().refresh();
    await h.ready();
    const after = await cart();
    record('Giỏ sau khi tăng size L', after);
    verify(after.find((c) => c.size === 'M')?.quantity, 1, 'Tăng L không thay đổi số lượng size M');
    verify(after.find((c) => c.size === 'L')?.quantity, 2, 'Size L được tăng từ một lên hai');
    verify(await h.money('#cart-subtotal'), 420000, 'Tiền hàng sau khi tăng L là 420.000 đồng');
    verify(await driver.findElement(By.css(`${row('M')} .cart-qty-input`)).getAttribute('value'), '1', 'Giao diện sau tải lại giữ M một chiếc');
    verify(await driver.findElement(By.css(`${row('L')} .cart-qty-input`)).getAttribute('value'), '2', 'Giao diện sau tải lại giữ L hai chiếc');
    await snapshot('02-sau-tang-size-L');

    await h.click(`${row('L')} .cart-remove-btn`);
    const confirms = await driver.findElements(By.css('.swal2-confirm'));
    if (confirms.length) {
      await h.click('.swal2-confirm');
    } else {
      await driver.wait(async () => {
        try { return await driver.switchTo().alert(); } catch { return false; }
      }, 5000, 'Chưa xuất hiện xác nhận xóa.');
      await (await driver.switchTo().alert()).accept();
    }
    await driver.wait(async () => !(await cart()).some((c) => c.size === 'L'), 10000);
    await driver.navigate().refresh();
    await h.ready();
    const finalCart = await cart();
    record('Giỏ sau khi xóa riêng L', finalCart);
    verify(finalCart.length, 1, 'Sau xóa chỉ còn một dòng');
    verify(finalCart[0]?.size, 'M', 'Dòng còn lại là size M');
    verify(finalCart[0]?.quantity, 1, 'Dòng M vẫn giữ một chiếc');
    verify((await driver.findElements(By.css(row('L')))).length, 0, 'Giao diện không còn dòng L');
    verify(await h.money('#cart-subtotal'), 120000, 'Tiền hàng còn lại là 120.000 đồng');
    await snapshot('03-sau-xoa-size-L');
  },
}];
