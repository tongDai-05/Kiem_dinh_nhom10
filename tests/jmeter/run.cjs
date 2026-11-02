'use strict';

const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { createFixtures } = require('../selenium/fixtures.cjs');

const ROOT = path.resolve(__dirname, '../..');
const PLAN = path.join(__dirname, 'website-load-test.jmx');
const OUTPUT = path.join(ROOT, 'tests/evidence/jmeter');
const LEVELS = [20, 50, 100, 200, 500];
const JMETER_HOME = process.env.JMETER_HOME || 'D:\\Jmeter\\apache-jmeter-5.6.3';
const JMETER = path.join(JMETER_HOME, 'bin', 'jmeter.bat');
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

function runProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const isBatch = process.platform === 'win32' && /\.(bat|cmd)$/i.test(command);
    const executable = isBatch ? (process.env.ComSpec || 'cmd.exe') : command;
    const quotedArgs = args.map(value => `"${String(value).replace(/"/g, '""')}"`).join(' ');
    const batchCommand = `call "${command}" ${quotedArgs}`;
    const executableArgs = isBatch ? ['/d', '/s', '/c', batchCommand] : args;
    const child = spawn(executable, executableArgs, { ...options, windowsHide: true, windowsVerbatimArguments: isBatch, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('exit', code => resolve({ code, stdout, stderr }));
  });
}

function csvLine(line) {
  const values = [];
  let value = '', quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') { value += '"'; index += 1; }
      else quoted = !quoted;
    } else if (character === ',' && !quoted) { values.push(value); value = ''; }
    else value += character;
  }
  values.push(value);
  return values;
}

async function readJtl(filename) {
  const lines = (await fs.readFile(filename, 'utf8')).trim().split(/\r?\n/);
  const headers = csvLine(lines.shift());
  return lines.filter(Boolean).map(line => Object.fromEntries(headers.map((header, index) => [header, csvLine(line)[index] ?? ''])));
}

function percentile(sorted, ratio) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
}

function round(value) { return Math.round(value * 100) / 100; }
function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }

function summarize(users, rows) {
  const elapsed = rows.map(row => Number(row.elapsed)).sort((a, b) => a - b);
  const failed = rows.filter(row => row.success !== 'true');
  const starts = rows.map(row => Number(row.timeStamp));
  const ends = rows.map(row => Number(row.timeStamp) + Number(row.elapsed));
  const durationMs = Math.max(...ends) - Math.min(...starts);
  const responseCodes = {};
  for (const row of rows) responseCodes[row.responseCode] = (responseCodes[row.responseCode] || 0) + 1;
  return {
    users, requests: rows.length, successfulRequests: rows.length - failed.length, failedRequests: failed.length,
    errorRatePercent: round(failed.length / rows.length * 100), durationMs,
    throughputRequestsPerSecond: round(rows.length / (durationMs / 1000)), responseCodes,
    responseTimeMs: {
      min: elapsed[0], average: round(elapsed.reduce((sum, value) => sum + value, 0) / elapsed.length),
      median: percentile(elapsed, 0.5), p95: percentile(elapsed, 0.95), p99: percentile(elapsed, 0.99), max: elapsed[elapsed.length - 1],
    },
    failureGroups: Object.entries(failed.reduce((groups, row) => {
      const key = `${row.responseCode}: ${row.failureMessage || row.responseMessage}`;
      groups[key] = (groups[key] || 0) + 1;
      return groups;
    }, {})).map(([message, count]) => ({ message, count })).sort((a, b) => b.count - a.count),
    criteria: { errorRatePercent: 0, p95LimitMs: 5000 },
    passed: failed.length === 0 && percentile(elapsed, 0.95) <= 5000,
  };
}

async function writeCombined(run, directory) {
  await fs.writeFile(path.join(directory, 'results.json'), JSON.stringify(run, null, 2));
  const rows = run.stages.map(stage => `<tr><td>${stage.users}</td><td>${stage.successfulRequests}/${stage.requests}</td><td>${stage.failedRequests}</td><td>${stage.errorRatePercent}%</td><td>${stage.responseTimeMs.average}</td><td>${stage.responseTimeMs.p95}</td><td>${stage.responseTimeMs.p99}</td><td>${stage.throughputRequestsPerSecond}</td><td class="${stage.passed ? 'pass' : 'fail'}">${stage.passed ? 'ĐẠT' : 'CHƯA ĐẠT'}</td></tr>`).join('');
  const html = `<!doctype html><html lang="vi"><meta charset="utf-8"><title>Kết quả Apache JMeter</title><style>body{font:16px/1.5 Arial;margin:36px auto;max-width:1180px;padding:0 24px;color:#17202a}table{border-collapse:collapse;width:100%;margin:20px 0}td,th{border:1px solid #cfd5db;padding:9px;text-align:center}th{background:#e7eef6}.pass{color:#166534;font-weight:bold}.fail{color:#b91c1c;font-weight:bold}.note{background:#f7f7f7;padding:14px;border-left:4px solid #4b6b8a}</style><h1>Kiểm thử tải bằng Apache JMeter 5.6.3</h1><p>${escapeHtml(run.localTime)}</p><p class="note">Mỗi người dùng thực hiện trang chủ → danh sách → chi tiết. Synchronizing Timer đồng bộ các luồng ở từng bước. MongoDB tạm và cổng ngẫu nhiên, không dùng dữ liệu thật. Tiêu chí: 0% lỗi và p95 ≤ 5.000 ms.</p><table><tr><th>Người dùng</th><th>Thành công</th><th>Lỗi</th><th>Tỷ lệ lỗi</th><th>TB (ms)</th><th>p95</th><th>p99</th><th>req/s</th><th>Kết luận</th></tr>${rows}</table><p><b>Kết luận:</b> <span class="${run.passed ? 'pass' : 'fail'}">${run.passed ? 'ĐẠT' : 'CHƯA ĐẠT'}</span></p><p>Mỗi thư mục level-* có dashboard HTML gốc do JMeter sinh.</p></html>`;
  await fs.writeFile(path.join(directory, 'report.html'), html);
}

async function main() {
  if (!fsSync.existsSync(JMETER)) throw new Error(`Không tìm thấy JMeter: ${JMETER}. Đặt JMETER_HOME nếu cài ở nơi khác.`);
  const startedAt = new Date();
  const runId = startedAt.toISOString().replace(/[:.]/g, '-');
  const directory = path.join(OUTPUT, runId);
  const staging = path.join(os.tmpdir(), 'website-jmeter-' + runId);
  await fs.mkdir(directory, { recursive: true });
  await fs.mkdir(staging, { recursive: true });
  const stagedPlan = path.join(staging, 'website-load-test.jmx');
  await fs.copyFile(PLAN, stagedPlan);
  const run = {
    id: runId, startedAt: startedAt.toISOString(),
    localTime: new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Bangkok', dateStyle: 'full', timeStyle: 'long' }).format(startedAt),
    tool: 'Apache JMeter 5.6.3', jmeterHome: JMETER_HOME,
    environment: 'Ứng dụng User thật trên cổng ngẫu nhiên, MongoDB tạm và dữ liệu giả.',
    levels: LEVELS, stages: [], cleanupErrors: [], sourceHashes: {},
  };
  for (const filename of ['tests/jmeter/website-load-test.jmx', 'tests/jmeter/run.cjs', 'user/server.js', 'user/controllers/productController.js']) {
    run.sourceHashes[filename] = crypto.createHash('sha256').update(await fs.readFile(path.join(ROOT, filename))).digest('hex');
  }
  let environment, child, appLog;
  try {
    environment = await createFixtures();
    await environment.reset('jmeter');
    const productName = 'Ao-JMeter-Alpha';
    await environment.db.collection('products').updateOne(
      { _id: environment.fixture.product.id },
      { $set: { name: productName } },
    );
    environment.fixture.product.name = productName;
    const port = await freePort();
    appLog = await fs.open(path.join(directory, 'user-app.log'), 'w');
    child = spawn(process.execPath, ['server.js'], {
      cwd: path.join(ROOT, 'user'), windowsHide: true,
      env: { ...process.env, NODE_ENV: 'test', PORT: String(port), MONGODB_URI: environment.uri, SESSION_SECRET: 'jmeter-' + crypto.randomBytes(24).toString('hex') },
      stdio: ['ignore', appLog.fd, appLog.fd],
    });
    const baseUrl = `http://127.0.0.1:${port}`;
    const deadline = Date.now() + 30000;
    let ready = false;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) throw new Error('Ứng dụng User dừng khi khởi động.');
      try { const response = await fetch(baseUrl + '/products', { signal: AbortSignal.timeout(1500) }); await response.arrayBuffer(); if (response.status === 200) { ready = true; break; } } catch { /* wait */ }
      await sleep(200);
    }
    if (!ready) throw new Error('Không khởi động được ứng dụng User trong 30 giây.');
    run.baseUrl = baseUrl;
    const productPath = '/products/' + productName;
    for (const users of LEVELS) {
      const levelDirectory = path.join(directory, `level-${users}`);
      const stagedLevel = path.join(staging, `level-${users}`);
      const jtl = path.join(stagedLevel, 'results.jtl');
      const dashboard = path.join(stagedLevel, 'dashboard');
      await fs.mkdir(stagedLevel, { recursive: true });
      console.log(`JMeter: bắt đầu ${users} người dùng đồng thời...`);
      const execution = await runProcess(JMETER, [
        '-n', '-t', stagedPlan, `-Jhost=127.0.0.1`, `-Jport=${port}`, `-Jusers=${users}`, `-JproductPath=${productPath}`,
        '-Jjmeter.save.saveservice.output_format=csv', '-Jjmeter.save.saveservice.assertion_results_failure_message=true',
        '-l', jtl, '-e', '-o', dashboard,
      ], { cwd: staging, env: { ...process.env, JMETER_HOME } });
      await fs.writeFile(path.join(stagedLevel, 'jmeter.log.txt'), execution.stdout + '\n' + execution.stderr);
      await fs.cp(stagedLevel, levelDirectory, { recursive: true });
      if (!fsSync.existsSync(jtl)) throw new Error(`JMeter mức ${users} không tạo JTL (mã ${execution.code}). Xem jmeter.log.txt.`);
      const summary = summarize(users, await readJtl(jtl));
      summary.jmeterExitCode = execution.code;
      summary.files = { jtl: `level-${users}/results.jtl`, dashboard: `level-${users}/dashboard/index.html`, log: `level-${users}/jmeter.log.txt` };
      run.stages.push(summary);
      console.log(`${users} VU: ${summary.successfulRequests}/${summary.requests}; p95=${summary.responseTimeMs.p95} ms; ${summary.throughputRequestsPerSecond} req/s; ${summary.passed ? 'ĐẠT' : 'CHƯA ĐẠT'}`);
      await writeCombined(run, directory);
    }
  } finally {
    if (child && child.exitCode === null) { child.kill(); await Promise.race([new Promise(resolve => child.once('exit', resolve)), sleep(2000)]); }
    if (appLog) await appLog.close().catch(error => run.cleanupErrors.push(error.message));
    if (environment) await environment.close().catch(error => run.cleanupErrors.push(error.message));
    const tempRoot = path.resolve(os.tmpdir()) + path.sep;
    if (path.resolve(staging).startsWith(tempRoot)) await fs.rm(staging, { recursive: true, force: true }).catch(error => run.cleanupErrors.push(error.message));
  }
  run.finishedAt = new Date().toISOString();
  run.passed = run.stages.length === LEVELS.length && run.stages.every(stage => stage.passed);
  await writeCombined(run, directory);
  console.log('Báo cáo tổng hợp: ' + path.join(directory, 'report.html'));
  process.exitCode = run.passed ? 0 : 1;
}

main().catch(error => { console.error(error.stack || error.message); process.exitCode = 2; });
