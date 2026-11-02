'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { Builder, Browser } = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');

const root = path.resolve(__dirname, '../..');
const images = path.join(root, 'evidence', 'images');
const inputs = [
  ['evidence/jest/jest-summary.html', 'MC-WB-JEST-1.png'],
  ['evidence/jest/coverage/index.html', 'MC-WB-COVERAGE-1.png'],
  ['evidence/jest/coverage/cartController.js.html', 'MC-WB-CART-1.png'],
  ['evidence/postman/report.html', 'MC-PM-SUMMARY-1.png'],
  ['evidence/retest/ADV-07/chrome-firefox/report.html', 'MC-ADV-07-1.png'],
  ['evidence/retest/BB-35/chrome/report.html', 'MC-SELENIUM-CHROME-1.png'],
  ['evidence/retest/BB-35/firefox/report.html', 'MC-SELENIUM-FIREFOX-1.png'],
  ['evidence/db/collections.html', 'MC-DB-01.png'],
  ['evidence/git-log.html', 'MC-GIT-LOG-01.png'],
];

(async () => {
  fs.mkdirSync(images, { recursive: true });
  const options = new chrome.Options().addArguments('--headless=new', '--window-size=1440,1200', '--no-first-run');
  const driver = await new Builder().disableEnvironmentOverrides().forBrowser(Browser.CHROME).setChromeOptions(options).build();
  try {
    await driver.manage().setTimeouts({ pageLoad: 30000, script: 10000 });
    for (const [sourceRelative, outputName] of inputs) {
      const source = path.join(root, sourceRelative);
      if (!fs.existsSync(source)) throw new Error(`Thiếu tệp nguồn: ${source}`);
      await driver.get(pathToFileURL(source).href);
      await driver.sleep(500);
      const screenshot = await driver.takeScreenshot();
      fs.writeFileSync(path.join(images, outputName), screenshot, 'base64');
      console.log(path.join(images, outputName));
    }
  } finally {
    await driver.quit();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
