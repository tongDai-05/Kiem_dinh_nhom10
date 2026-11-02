'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { createFixtures } = require('../selenium/fixtures.cjs');

const ROOT = path.resolve(__dirname, '../..');
const OUTPUT = path.join(ROOT, 'tests/evidence/load');
const LEVELS = [20, 50, 100, 200, 500];
const REQUEST_TIMEOUT_MS = 30000;
const P95_LIMIT_MS = 5000;
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

function percentile(sorted, ratio) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
}

function round(value) {
  return Math.round(value * 100) / 100;
}

async function request(baseUrl, route, virtualUser, step) {
  const started = performance.now();
  try {
    const response = await fetch(baseUrl + route, {
      redirect: 'manual',
      headers: { Accept: 'text/html', 'User-Agent': `LocalLoadTest/VU-${virtualUser}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    await response.arrayBuffer();
    const durationMs = round(performance.now() - started);
    return {
      virtualUser, step, route, status: response.status, durationMs,
      passed: response.status === 200, error: null,
    };
  } catch (error) {
    const cause = error.cause;
    const causeDetail = cause
      ? [cause.code, cause.name, cause.message].filter(Boolean).join(' - ')
      : '';
    return {
      virtualUser, step, route, status: null,
      durationMs: round(performance.now() - started), passed: false,
      error: error.name + ': ' + error.message + (causeDetail ? ` (${causeDetail})` : ''),
    };
  }
}

async function runStage(baseUrl, users, productName) {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const routes = ['/', '/products', '/products/' + encodeURIComponent(productName)];
  const tasks = Array.from({ length: users }, (_, index) => (async () => {
    const virtualUser = index + 1;
    await gate;
    const results = [];
    for (let step = 0; step < routes.length; step += 1) {
      results.push(await request(baseUrl, routes[step], virtualUser, step + 1));
    }
    return results;
  })());

  const startedAt = new Date();
  const started = performance.now();
  release();
  const requests = (await Promise.all(tasks)).flat();
  const durationMs = round(performance.now() - started);
  const durations = requests.map(item => item.durationMs).sort((a, b) => a - b);
  const successfulRequests = requests.filter(item => item.passed).length;
  const successfulUsers = Array.from({ length: users }, (_, index) => index + 1)
    .filter(user => requests.filter(item => item.virtualUser === user).every(item => item.passed)).length;
  const statuses = {};
  for (const item of requests) {
    const key = item.status === null ? 'NETWORK_ERROR' : String(item.status);
    statuses[key] = (statuses[key] || 0) + 1;
  }
  const errors = requests.length - successfulRequests;
  const summary = {
    users,
    requests: requests.length,
    successfulUsers,
    failedUsers: users - successfulUsers,
    successfulRequests,
    failedRequests: errors,
    errorRatePercent: round(errors / requests.length * 100),
    durationMs,
    throughputRequestsPerSecond: round(requests.length / (durationMs / 1000)),
    responseTimeMs: {
      min: durations[0] || 0,
      average: round(durations.reduce((sum, value) => sum + value, 0) / (durations.length || 1)),
      median: percentile(durations, 0.5),
      p95: percentile(durations, 0.95),
      p99: percentile(durations, 0.99),
      max: durations[durations.length - 1] || 0,
    },
    statuses,
    criteria: { errorRatePercent: 0, p95LimitMs: P95_LIMIT_MS },
    passed: errors === 0 && percentile(durations, 0.95) <= P95_LIMIT_MS,
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
  };
  return { summary, requests };
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

async function writeEvidence(run, directory) {
  await fs.writeFile(path.join(directory, 'results.json'), JSON.stringify(run, null, 2));
  const csv = ['level_users,virtual_user,step,route,status,duration_ms,passed,error'];
  for (const stage of run.stages) {
    for (const item of stage.requests) {
      const values = [stage.summary.users, item.virtualUser, item.step, item.route, item.status ?? '', item.durationMs, item.passed, item.error || ''];
      csv.push(values.map(value => `"${String(value).replace(/"/g, '""')}"`).join(','));
    }
  }
  await fs.writeFile(path.join(directory, 'requests.csv'), '\ufeff' + csv.join('\n'));
  const rows = run.stages.map(({ summary }) => `<tr><td>${summary.users}</td><td>${summary.requests}</td><td>${summary.successfulUsers}/${summary.users}</td><td>${summary.failedRequests}</td><td>${summary.errorRatePercent}%</td><td>${summary.responseTimeMs.average}</td><td>${summary.responseTimeMs.p95}</td><td>${summary.responseTimeMs.p99}</td><td>${summary.throughputRequestsPerSecond}</td><td class="${summary.passed ? 'pass' : 'fail'}">${summary.passed ? 'ĐẠT' : 'CHƯA ĐẠT'}</td></tr>`).join('');
  const html = `<!doctype html><html lang="vi"><meta charset="utf-8"><title>Kết quả kiểm thử tải</title><style>body{font:16px/1.5 Arial;margin:36px auto;max-width:1180px;padding:0 24px;color:#17202a}table{border-collapse:collapse;width:100%;margin:20px 0}td,th{border:1px solid #cfd5db;padding:9px;text-align:center}th{background:#e7eef6}.pass{color:#166534;font-weight:bold}.fail{color:#b91c1c;font-weight:bold}.note{background:#f7f7f7;padding:14px;border-left:4px solid #4b6b8a}</style><h1>Kết quả kiểm thử tải đồng thời</h1><p>${escapeHtml(run.localTime)}</p><p class="note">Mỗi người dùng ảo thực hiện 3 bước: trang chủ → danh sách sản phẩm → chi tiết sản phẩm. Môi trường dùng MongoDB tạm và cổng ngẫu nhiên, không tác động dữ liệu thật. Tiêu chí: không có yêu cầu lỗi và p95 không quá ${P95_LIMIT_MS} ms.</p><table><tr><th>Người dùng</th><th>Yêu cầu</th><th>VU thành công</th><th>Yêu cầu lỗi</th><th>Tỷ lệ lỗi</th><th>TB (ms)</th><th>p95 (ms)</th><th>p99 (ms)</th><th>req/s</th><th>Kết luận</th></tr>${rows}</table><p><b>Kết luận toàn bộ:</b> <span class="${run.passed ? 'pass' : 'fail'}">${run.passed ? 'ĐẠT' : 'CHƯA ĐẠT'}</span></p></html>`;
  await fs.writeFile(path.join(directory, 'report.html'), html);
}

async function main() {
  const unexpected = process.argv.slice(2);
  if (unexpected.length) throw new Error('Bộ kiểm thử tự chạy đủ 5 mức 20, 50, 100, 200, 500; không cần tham số.');
  const startedAt = new Date();
  const runId = startedAt.toISOString().replace(/[:.]/g, '-');
  const directory = path.join(OUTPUT, runId);
  await fs.mkdir(directory, { recursive: true });
  const run = {
    id: runId,
    startedAt: startedAt.toISOString(),
    localTime: new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Bangkok', dateStyle: 'full', timeStyle: 'long' }).format(startedAt),
    environment: 'Ứng dụng user thật trên cổng ngẫu nhiên, MongoDB tạm riêng và dữ liệu giả.',
    workload: 'Mỗi người dùng ảo đồng thời thực hiện tuần tự GET /, GET /products và GET /products/:name.',
    levels: LEVELS,
    stages: [],
    sourceHashes: {},
    cleanupErrors: [],
  };
  for (const filename of ['user/server.js', 'user/controllers/pageController.js', 'user/controllers/productController.js', 'tests/load/run.cjs']) {
    run.sourceHashes[filename] = crypto.createHash('sha256').update(await fs.readFile(path.join(ROOT, filename))).digest('hex');
  }

  let environment;
  let child;
  let log;
  try {
    environment = await createFixtures();
    await environment.reset('load');
    const port = await freePort();
    log = await fs.open(path.join(directory, 'user-app.log'), 'w');
    child = spawn(process.execPath, ['server.js'], {
      cwd: path.join(ROOT, 'user'), windowsHide: true,
      env: {
        ...process.env, NODE_ENV: 'test', PORT: String(port), MONGODB_URI: environment.uri,
        SESSION_SECRET: 'load-' + crypto.randomBytes(24).toString('hex'),
      },
      stdio: ['ignore', log.fd, log.fd],
    });
    const baseUrl = `http://127.0.0.1:${port}`;
    const limit = Date.now() + 30000;
    while (Date.now() < limit) {
      if (child.exitCode !== null) throw new Error('Ứng dụng user dừng khi khởi động; xem user-app.log.');
      try {
        const response = await fetch(baseUrl + '/products', { signal: AbortSignal.timeout(1500) });
        await response.arrayBuffer();
        if (response.status === 200) break;
      } catch { /* wait */ }
      await sleep(200);
    }
    if (Date.now() >= limit) throw new Error('Không khởi động được ứng dụng user trong 30 giây.');
    run.baseUrl = baseUrl;
    for (const users of LEVELS) {
      console.log(`Bắt đầu mức ${users} người dùng đồng thời...`);
      const stage = await runStage(baseUrl, users, environment.fixture.product.name);
      run.stages.push(stage);
      const s = stage.summary;
      console.log(`${users} VU: ${s.successfulRequests}/${s.requests} yêu cầu thành công; p95=${s.responseTimeMs.p95} ms; ${s.throughputRequestsPerSecond} req/s; ${s.passed ? 'ĐẠT' : 'CHƯA ĐẠT'}`);
      await writeEvidence(run, directory);
    }
  } finally {
    if (child && child.exitCode === null) {
      child.kill();
      await Promise.race([new Promise(resolve => child.once('exit', resolve)), sleep(2000)]);
    }
    if (log) await log.close().catch(error => run.cleanupErrors.push(error.message));
    if (environment) await environment.close().catch(error => run.cleanupErrors.push(error.message));
  }
  run.finishedAt = new Date().toISOString();
  run.passed = run.stages.length === LEVELS.length && run.stages.every(stage => stage.summary.passed);
  await writeEvidence(run, directory);
  console.log('Báo cáo: ' + path.join(directory, 'report.html'));
  process.exitCode = run.passed ? 0 : 1;
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 2;
});
