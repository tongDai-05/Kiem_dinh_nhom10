'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createFixtures } = require('../selenium/fixtures.cjs');

const root = path.resolve(__dirname, '../..');
const out = path.join(root, 'evidence', 'db');

(async () => {
  const environment = await createFixtures();
  try {
    await environment.reset('DB-EVIDENCE');
    const collections = {};
    for (const name of ['users', 'products', 'categories', 'orders', 'shippers']) {
      const documents = await environment.db.collection(name).find({}).limit(5).toArray();
      collections[name] = { count: await environment.db.collection(name).countDocuments({}), documents };
    }
    const replacer = (_key, value) => Buffer.isBuffer(value) || value?.type === 'Buffer' ? '[binary image]' : value;
    const raw = JSON.stringify({ capturedAt: new Date().toISOString(), database: environment.db.databaseName, uri: environment.uri.replace(/:\/\/[^/]+/, '://127.0.0.1:<temporary-port>'), collections }, replacer, 2);
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, 'collections.json'), raw, 'utf8');
    const escaped = raw.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
    fs.writeFileSync(path.join(out, 'collections.html'), `<!doctype html><html lang="vi"><meta charset="utf-8"><title>MongoDB temporary collections</title><style>body{background:#0f172a;color:#e2e8f0;font:15px Consolas,monospace;padding:28px}h1{color:#5eead4}pre{white-space:pre-wrap}</style><h1>MongoDB tạm: webbtl_selenium</h1><p>Kết xuất trực tiếp bằng MongoDB Node.js client do mongosh/Compass không có sẵn.</p><pre>${escaped}</pre></html>`, 'utf8');
    console.log(path.join(out, 'collections.json'));
  } finally {
    await environment.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
