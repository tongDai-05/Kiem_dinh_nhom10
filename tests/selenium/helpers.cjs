'use strict';

const { By, Key, until, Select, error } = require('selenium-webdriver');

function createHelpers(ctx) {
  const { driver, baseUrl, adminUrl, fixture } = ctx;
  const timeout = 15000;
  async function ready() {
    await driver.wait(async () => (await driver.executeScript('return document.readyState')) === 'complete', timeout, 'Trang chưa tải xong.');
    await driver.wait(async () => {
      const masks = await driver.findElements(By.css('#preloader-active'));
      for (const mask of masks) { if (await mask.isDisplayed()) return false; }
      return true;
    }, timeout, 'Preloader chưa kết thúc.');
  }
  async function visible(css) {
    return driver.wait(async () => {
      const elements = await driver.findElements(By.css(css));
      for (const el of elements) {
        try { if (await el.isDisplayed()) return el; } catch (e) { if (!(e instanceof error.StaleElementReferenceError)) throw e; }
      }
      return false;
    }, timeout, `Không thấy phần tử: ${css}`);
  }
  async function click(css) {
    const el = await visible(css);
    await driver.executeScript('arguments[0].scrollIntoView({block:"center",behavior:"instant"});', el);
    await driver.wait(until.elementIsEnabled(el), timeout);
    await el.click();
  }
  async function fill(css, value) {
    const el = await visible(css);
    // Replacing the selection avoids a transient empty number input. This app
    // normalizes an empty quantity to 1 immediately in its input handler.
    const modifier = process.platform === 'darwin' ? Key.COMMAND : Key.CONTROL;
    // Send the selection and replacement as two operations. Firefox can treat
    // a chord and replacement passed in one sendKeys call as one modified
    // sequence, leaving the field empty even though Chrome accepts it.
    await el.sendKeys(modifier, 'a', Key.NULL);
    await el.sendKeys(String(value));
  }
  async function open(route, admin = false) {
    await driver.get(new URL(route, admin ? adminUrl : baseUrl).href);
    await ready();
  }
  async function dismissNotice() {
    // SweetAlert's container may appear one animation frame before its button.
    // Poll the close action as well as the resulting absence of the dialog.
    await driver.wait(async () => {
      const dialogs = await driver.findElements(By.css('.swal2-container'));
      if (!dialogs.length || !(await dialogs[0].isDisplayed())) return true;
      const buttons = await driver.findElements(By.css('.swal2-confirm'));
      for (const button of buttons) {
        try { if (await button.isDisplayed() && await button.isEnabled()) await button.click(); }
        catch (e) { if (!(e instanceof error.StaleElementReferenceError) && !(e instanceof error.ElementClickInterceptedError)) throw e; }
      }
      return false;
    }, timeout, 'Chưa đóng được thông báo SweetAlert.');
    for (const el of await driver.findElements(By.css('.custom-message-close'))) {
      try { if (await el.isDisplayed()) await el.click(); }
      catch (e) { if (!(e instanceof error.StaleElementReferenceError)) throw e; }
    }
  }
  async function select(css, value) {
    const el = await driver.findElement(By.css(css));
    const scoped = `:is(${css})`;
    const nice = await driver.findElements(By.css(`${scoped} + .nice-select`));
    if (nice.length && await nice[0].isDisplayed()) {
      await click(`${scoped} + .nice-select`);
      // Values come only from test fixture IDs, names or option indices.
      await click(`${scoped} + .nice-select .option[data-value="${String(value).replace(/"/g, '\\"')}"]`);
    } else {
      await new Select(el).selectByValue(String(value));
    }
    await ready();
  }
  async function loginUser() {
    await open('/auth/login');
    await fill('#account', fixture.user.account);
    await fill('#password', fixture.user.password);
    await click('form[action="/auth/login"] button[type="submit"]');
    await driver.wait(async () => new URL(await driver.getCurrentUrl()).pathname === '/', timeout, 'Đăng nhập khách hàng chưa chuyển trang.');
    await ready();
    await dismissNotice();
  }
  async function loginAdmin() {
    await open('/login', true);
    await fill('input[name="account"]', fixture.admin.account);
    await fill('input[name="password"]', fixture.admin.password);
    await click('form[action="/login"] button[type="submit"]');
    await driver.wait(async () => !(new URL(await driver.getCurrentUrl()).pathname.match(/^\/(login)?$/)), timeout, 'Đăng nhập quản trị chưa chuyển trang.');
    await ready();
    await dismissNotice();
  }
  async function loginShipper() {
    await open('/auth/shipper-login');
    await fill('input[name="account"]', fixture.shipper.account);
    await fill('input[name="password"]', fixture.shipper.password);
    await click('form[action="/auth/shipper-login"] button[type="submit"]');
    await driver.wait(until.urlContains('/shipper/dashboard'), timeout);
    await ready();
    await dismissNotice();
  }
  async function text(css) { return (await visible(css)).getText(); }
  async function money(css) { return Number((await text(css)).replace(/[^\d]/g, '')); }
  return { ready, open, visible, click, fill, select, text, money, loginUser, loginAdmin, loginShipper, dismissNotice };
}

module.exports = { createHelpers };
