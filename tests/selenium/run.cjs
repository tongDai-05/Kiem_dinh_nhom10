'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { isDeepStrictEqual } = require('node:util');
const { Builder, Browser } = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');
const edge = require('selenium-webdriver/edge');
const firefox = require('selenium-webdriver/firefox');
const { createFixtures } = require('./fixtures.cjs');
const { createHelpers } = require('./helpers.cjs');
const { writeReports } = require('./reporter.cjs');

const ROOT = path.resolve(__dirname, '../..');
const EVIDENCE_ROOT = path.join(ROOT, 'tests/evidence');
const SUITES = {
  ui: [...require('./cases/auth-products.cjs'), ...require('./cases/cart.cjs'), ...require('./cases/order-delivery.cjs')],
  blackbox: [...require('./blackbox/auth-products.cjs'), ...require('./blackbox/cart-orders.cjs'), ...require('./blackbox/admin-shipper.cjs')],
};
for (const cases of Object.values(SUITES)) cases.sort((a, b) => a.id.localeCompare(b.id));

async function bounded(promise, milliseconds, message) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), milliseconds); })]);
  } finally { clearTimeout(timer); }
}

async function quitDriver(driver) {
  await bounded(driver.quit(), 10000, 'Hết thời gian đóng phiên trình duyệt.');
}

function options() {
  const config = { browser: 'chrome', headed: false, caseId: null, suite: 'ui' };
  for (const arg of process.argv.slice(2)) {
    if (arg === '--headed') config.headed = true;
    else if (arg.startsWith('--browser=')) config.browser = arg.slice(10).toLowerCase();
    else if (arg.startsWith('--case=')) config.caseId = arg.slice(7).toUpperCase();
    else if (arg.startsWith('--suite=')) config.suite = arg.slice(8).toLowerCase();
    else throw new Error(`Tùy chọn không hợp lệ: ${arg}`);
  }
  if (!['chrome', 'edge', 'firefox'].includes(config.browser)) throw new Error('Dùng --browser=chrome, --browser=edge hoặc --browser=firefox.');
  if (!SUITES[config.suite]) throw new Error('Dùng --suite=ui hoặc --suite=blackbox.');
  if (config.caseId && !SUITES[config.suite].some((c) => c.id === config.caseId)) throw new Error(`Không tìm thấy ${config.caseId} trong bộ ${config.suite}.`);
  return config;
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function buildDriver(config) {
  const opts = config.browser === 'edge' ? new edge.Options() : config.browser === 'firefox' ? new firefox.Options() : new chrome.Options();
  if (config.browser === 'firefox') {
    opts.addArguments('--width=1440', '--height=1000');
    if (!config.headed) opts.addArguments('-headless');
  } else {
    opts.addArguments('--window-size=1440,1000', '--no-first-run');
    if (!config.headed) opts.addArguments('--headless=new');
  }
  if (process.env.SELENIUM_BROWSER_BINARY) opts.setBinaryPath(process.env.SELENIUM_BROWSER_BINARY);
  const browserName = config.browser === 'edge' ? Browser.EDGE : config.browser === 'firefox' ? Browser.FIREFOX : Browser.CHROME;
  const builder = new Builder().disableEnvironmentOverrides().forBrowser(browserName);
  if (config.browser === 'edge') builder.setEdgeOptions(opts);
  else if (config.browser === 'firefox') builder.setFirefoxOptions(opts);
  else builder.setChromeOptions(opts);
  if (process.env.SELENIUM_DRIVER_PATH) {
    if (config.browser === 'edge') builder.setEdgeService(new edge.ServiceBuilder(process.env.SELENIUM_DRIVER_PATH));
    else if (config.browser === 'firefox') builder.setFirefoxService(new firefox.ServiceBuilder(process.env.SELENIUM_DRIVER_PATH));
    else builder.setChromeService(new chrome.ServiceBuilder(process.env.SELENIUM_DRIVER_PATH));
  }
  const driver = await builder.build();
  try {
    await driver.manage().setTimeouts({ pageLoad: 45000, script: 15000, implicit: 0 });
    return driver;
  } catch (e) {
    await quitDriver(driver).catch(() => {});
    throw e;
  }
}

async function main() {
  const config = options();
  const selected = SUITES[config.suite].filter((c) => !config.caseId || c.id === config.caseId);
  const evidence = path.join(EVIDENCE_ROOT, config.suite === 'blackbox' ? 'blackbox' : 'selenium');
  const startedAt = new Date();
  const runId = startedAt.toISOString().replace(/[:.]/g, '-') + '-' + config.browser;
  const directory = path.join(evidence, runId);
  await fs.mkdir(path.join(directory, 'screenshots'), { recursive: true });
  process.env.SE_CACHE_PATH = path.join(ROOT, 'tests/.cache/selenium');
  process.env.SE_AVOID_STATS = 'true';
  await fs.mkdir(process.env.SE_CACHE_PATH, { recursive: true });
  const run = {
    schemaVersion: 1, id: runId, startedAt: startedAt.toISOString(),
    localTime: new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Bangkok', dateStyle: 'full', timeStyle: 'long' }).format(startedAt),
    requestedBrowser: config.browser, headless: !config.headed, nodeVersion: process.version, suite: config.suite,
    environment: 'Hai ứng dụng thật, MongoDB tạm riêng, dữ liệu giả; không sử dụng database đang chạy của người dùng.',
    tests: [], sourceHashes: {}, cleanupErrors: [],
  };
  const caseFiles = config.suite === 'blackbox'
    ? ['tests/selenium/blackbox/auth-products.cjs', 'tests/selenium/blackbox/cart-orders.cjs', 'tests/selenium/blackbox/admin-shipper.cjs']
    : ['tests/selenium/cases/auth-products.cjs', 'tests/selenium/cases/cart.cjs', 'tests/selenium/cases/order-delivery.cjs'];
  for (const filename of ['package.json', 'user/controllers/cartController.js', 'user/controllers/productController.js', 'user/controllers/orderController.js', 'user/controllers/shipperController.js', 'tests/selenium/run.cjs', 'tests/selenium/helpers.cjs', 'tests/selenium/fixtures.cjs', 'tests/selenium/reporter.cjs', ...caseFiles]) {
    run.sourceHashes[filename] = crypto.createHash('sha256').update(await fs.readFile(path.join(ROOT, filename))).digest('hex');
  }
  const processes = [];
  let environment;
  let activeDriver;
  let cleanupPromise;
  async function cleanup() {
    if (cleanupPromise) return cleanupPromise;
    cleanupPromise = (async () => {
      if (activeDriver) await quitDriver(activeDriver).catch((e) => run.cleanupErrors.push(e.message));
      activeDriver = null;
      for (const proc of processes) {
        if (proc.child.exitCode === null && !proc.child.killed) proc.child.kill();
        if (proc.child.exitCode === null) await Promise.race([new Promise((resolve) => proc.child.once('exit', resolve)), new Promise((resolve) => setTimeout(resolve, 2000))]);
        if (proc.child.exitCode === null) proc.child.kill('SIGKILL');
        await proc.log.close().catch(() => {});
      }
      if (environment) await environment.close().catch((e) => run.cleanupErrors.push(e.message));
    })();
    return cleanupPromise;
  }
  const interrupt = () => { cleanup().finally(() => process.exit(130)); };
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);

  async function startApp(name, port) {
    const log = await fs.open(path.join(directory, `${name}-app.log`), 'w');
    const child = spawn(process.execPath, ['server.js'], {
      cwd: path.join(ROOT, name), windowsHide: true,
      env: {
        ...process.env, NODE_ENV: 'test', PORT: String(port), MONGODB_URI: environment.uri,
        ADMIN_ACCOUNT: environment.fixture.admin.account, ADMIN_PASSWORD: environment.fixture.admin.password,
        SESSION_SECRET: 'selenium-' + crypto.randomBytes(24).toString('hex'),
      },
      stdio: ['ignore', log.fd, log.fd],
    });
    const proc = { child, log, error: null };
    child.on('error', (e) => { proc.error = e; });
    processes.push(proc);
    const url = `http://127.0.0.1:${port}`;
    const limit = Date.now() + 30000;
    while (Date.now() < limit) {
      if (proc.error) throw proc.error;
      if (child.exitCode !== null) throw new Error(`${name} dừng khi khởi động; xem ${name}-app.log.`);
      try {
        const res = await fetch(`${url}${name === 'admin' ? '/login' : '/auth/login'}`, { signal: AbortSignal.timeout(1500) });
        await res.text();
        if (res.status === 200) return url;
      } catch { /* Wait for this child app, not for an unrelated running app. */ }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error(`Chưa khởi động được ứng dụng ${name}; xem ${name}-app.log.`);
  }

  try {
    console.log('Tạo MongoDB tạm và dữ liệu kiểm thử riêng...');
    environment = await createFixtures();
    await environment.reset('startup');
    const baseUrl = await startApp('user', await freePort());
    const adminUrl = await startApp('admin', await freePort());
    run.applicationUrls = { user: baseUrl, admin: adminUrl };
    for (const test of selected) {
      const start = Date.now();
      const result = { id: test.id, title: test.title, status: 'ERROR', durationMs: 0, assertions: [], observations: [], screenshots: [] };
      console.log(`\n${test.id}: ${test.title}`);
      let ctx;
      try {
        await environment.reset(test.id);
        activeDriver = await buildDriver(config);
        const caps = await activeDriver.getCapabilities();
        run.browser = { name: caps.get('browserName'), version: caps.get('browserVersion'), driver: caps.get('chrome')?.chromedriverVersion || caps.get('msedge')?.msedgedriverVersion || null };
        ctx = {
          driver: activeDriver, baseUrl, adminUrl, fixture: environment.fixture, db: environment.db, reset: environment.reset,
          verify(actual, expected, message) {
            const passed = isDeepStrictEqual(actual, expected);
            result.assertions.push({ message, expected, actual, passed });
            console.log(`  ${passed ? 'OK' : 'SAI'}: ${message}`);
            return passed;
          },
          record(label, data) { result.observations.push({ label, data }); },
          async snapshot(name) {
            // Visibility of the form alone does not imply that the page-wide
            // loading overlay has disappeared. Evidence must show the actual UI.
            await ctx.h.ready();
            const filename = `${test.id}-${String(result.screenshots.length + 1).padStart(2, '0')}-${name.replace(/[^\w-]/g, '-')}.png`;
            const relative = `screenshots/${filename}`;
            const data = await activeDriver.takeScreenshot();
            await fs.writeFile(path.join(directory, relative), data, 'base64');
            result.screenshots.push({ name, path: relative, url: await activeDriver.getCurrentUrl(), capturedAt: new Date().toISOString() });
          },
        };
        ctx.h = createHelpers(ctx);
        await test.run(ctx);
        if (!result.assertions.length) throw new Error('Ca không có bước đối chiếu kết quả.');
        result.status = result.assertions.some((a) => !a.passed) ? 'FAIL' : test.complete === false ? 'PARTIAL' : 'PASS';
        result.complete = test.complete !== false;
        if (test.scope) result.scope = test.scope;
        if (!result.screenshots.length) await ctx.snapshot('ket-qua-cuoi-ca');
      } catch (e) {
        // Hard assertions in case files validate fixture prerequisites. Business
        // checks use verify(), so a missing prerequisite is an execution ERROR.
        const assertionFailed = result.assertions.some((a) => !a.passed);
        result.status = assertionFailed ? 'FAIL' : 'ERROR';
        result.error = { name: e.name, message: e.message, stack: e.stack };
        if (ctx && activeDriver) await ctx.snapshot('thoi-diem-dung-ca').catch(() => {});
      } finally {
        if (activeDriver) {
          await quitDriver(activeDriver).catch((e) => run.cleanupErrors.push(e.message));
          activeDriver = null;
        }
        result.durationMs = Date.now() - start;
        run.tests.push(result);
        console.log(`${test.id}: ${result.status} (${(result.durationMs / 1000).toFixed(1)}s)`);
      }
    }
  } catch (e) {
    for (const test of selected.filter((c) => !run.tests.some((r) => r.id === c.id))) {
      run.tests.push({ id: test.id, title: test.title, complete: test.complete !== false, status: 'ERROR', durationMs: 0, assertions: [], observations: [], screenshots: [], error: { name: e.name, message: e.message, stack: e.stack } });
    }
    console.error(e.message);
  } finally {
    await cleanup().catch((e) => run.cleanupErrors.push(e.message));
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
    run.finishedAt = new Date().toISOString();
    run.durationMs = Date.now() - startedAt.getTime();
    await writeReports(run, directory);
  }
  console.log(`\nPASS: ${run.totals.PASS} | PARTIAL: ${run.totals.PARTIAL || 0} | FAIL: ${run.totals.FAIL} | ERROR: ${run.totals.ERROR}`);
  console.log(`Báo cáo: ${path.join(directory, 'report.html')}`);
  process.exitCode = run.totals.FAIL || run.totals.ERROR || run.cleanupErrors.length ? 1 : 0;
}

main().catch((e) => { console.error(e.message); process.exitCode = 1; });
