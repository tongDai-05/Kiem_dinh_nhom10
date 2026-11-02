'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { Builder } = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');

async function main() {
  const root = path.resolve(__dirname, '../..');
  const source = path.join(root, 'tests/evidence/unit/coverage/index.html');
  const target = path.join(root, 'tests/evidence/unit/coverage-summary.png');
  const driver = await new Builder().forBrowser('chrome').setChromeOptions(new chrome.Options().addArguments('--headless=new', '--disable-gpu', '--no-sandbox', '--window-size=1440,1200')).build();
  try {
    await driver.get('file:///' + source.replace(/\\/g, '/'));
    const height = await driver.executeScript('return Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);');
    await driver.manage().window().setRect({ width: 1440, height: Math.min(Math.max(height + 80, 900), 4000), x: 0, y: 0 });
    const png = await driver.takeScreenshot();
    await fs.writeFile(target, png, 'base64');
    process.stdout.write(target + '\n');
  } finally {
    await driver.quit();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
