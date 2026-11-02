'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const escape = (v) => String(v ?? '').replace(/[&<>"']/g, (s) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[s]));
const show = (v) => typeof v === 'string' ? v : JSON.stringify(v, null, 2);

async function writeReports(run, directory) {
  run.totals = { PASS: 0, PARTIAL: 0, FAIL: 0, ERROR: 0 };
  for (const test of run.tests) run.totals[test.status]++;
  await fs.writeFile(path.join(directory, 'results.json'), JSON.stringify(run, null, 2), 'utf8');
  const cards = run.tests.map((t) => `<section id="${t.id}">
    <h2><span class="badge ${t.status}">${t.status}</span> ${escape(t.id)} — ${escape(t.title)}</h2>
    <p>Thời gian: ${(t.durationMs / 1000).toFixed(1)} giây · ${t.assertions.length} bước đối chiếu</p>
    ${t.error ? `<div class="error"><strong>${escape(t.error.name)}</strong><p>${escape(t.error.message)}</p></div>` : ''}
    ${t.assertions.length ? `<div class="scroll"><table><thead><tr><th>Bước kiểm tra</th><th>Mong đợi</th><th>Thực tế</th><th>Kết quả</th></tr></thead><tbody>${t.assertions.map((a) => `<tr><td>${escape(a.message)}</td><td><pre>${escape(show(a.expected))}</pre></td><td><pre>${escape(show(a.actual))}</pre></td><td class="${a.passed ? 'PASS' : 'FAIL'}">${a.passed ? 'Đạt' : 'Không đạt'}</td></tr>`).join('')}</tbody></table></div>` : ''}
    ${t.screenshots.length ? `<div class="gallery">${t.screenshots.map((s) => `<figure><a href="${escape(s.path)}"><img src="${escape(s.path)}" alt="${escape(s.name)}" loading="lazy"></a><figcaption>${escape(s.name)}</figcaption></figure>`).join('')}</div>` : '<p>Chưa có ảnh: xem lỗi chuẩn bị hoặc khởi động trình duyệt.</p>'}
    ${t.observations.length ? `<details><summary>Dữ liệu và quan sát đã ghi</summary>${t.observations.map((o) => `<h3>${escape(o.label)}</h3><pre>${escape(show(o.data))}</pre>`).join('')}</details>` : ''}
    ${t.error?.stack ? `<details><summary>Chi tiết kỹ thuật để tìm nguyên nhân</summary><pre>${escape(t.error.stack)}</pre></details>` : ''}
  </section>`).join('\n');
  const html = `<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Kết quả Selenium ${escape(run.id)}</title>
  <style>*{box-sizing:border-box}body{margin:0;background:#f2f5fa;color:#182437;font:16px/1.6 "Segoe UI",Arial,sans-serif}main{max-width:1200px;margin:auto;padding:36px 24px}h1{font-size:30px;margin:0 0 8px}h2{font-size:21px}h3{font-size:16px}.intro,section{background:white;padding:24px;border:1px solid #d9e0eb;border-radius:12px;margin-bottom:24px}.summary{display:flex;gap:16px;flex-wrap:wrap}.count{padding:12px 24px;border-radius:8px;background:#edf2f9}.badge{border-radius:5px;font-size:14px;padding:4px 9px;margin-right:8px}.PASS{color:#09643a}.PARTIAL{color:#6b4f00}.FAIL{color:#a21a24}.ERROR{color:#8c4c00}.badge.PASS{background:#dcf5e8}.badge.PARTIAL{background:#fff5c2}.badge.FAIL{background:#ffe2e4}.badge.ERROR{background:#fff0d3}.scroll{overflow:auto}table{border-collapse:collapse;width:100%;font-size:14px}td,th{padding:12px;text-align:left;vertical-align:top;border:1px solid #dbe2ec}th{background:#edf2f9}pre{font:13px/1.5 Consolas,monospace;white-space:pre-wrap;word-break:break-word;margin:0}.gallery{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:16px;margin-top:24px}figure{margin:0}img{width:100%;height:auto;border:1px solid #cdd6e5}figcaption{font-size:14px;margin:8px 0 16px}.error{border-left:4px solid #b02b35;background:#fff1f2;padding:12px 16px}details{margin-top:16px}summary{cursor:pointer;font-weight:600}a{color:#1757b8}.muted{color:#52627b}nav{display:flex;gap:16px;flex-wrap:wrap}</style><main>
  <div class="intro"><h1>Kiểm thử website bán quần áo bằng Selenium</h1><p>Mã lần chạy: <strong>${escape(run.id)}</strong></p><p>${escape(run.localTime)} · ${escape(run.browser?.name || run.requestedBrowser)} ${escape(run.browser?.version || '')} · Node ${escape(run.nodeVersion)}</p>
  <div class="summary">${Object.entries(run.totals).map(([name, count]) => `<div class="count ${name}"><strong>${count} ${name}</strong></div>`).join('')}</div>
  <p>Đối tượng: hai ứng dụng thật và MongoDB tạm được tạo riêng cho lần chạy. Mỗi ca có phiên trình duyệt và dữ liệu ban đầu riêng. Kết quả này không phải độ bao phủ mã nguồn hoặc chứng nhận bảo mật.</p>
  <p class="muted">Ảnh chứng minh màn hình tại thời điểm chụp. PASS là ca hoàn tất và đúng; PARTIAL là phần đã chạy đúng nhưng phạm vi ca chưa đầy đủ; FAIL là sai lệch; ERROR là ca không hoàn tất.</p>
  ${run.cleanupErrors?.length ? `<div class="error"><strong>Lỗi khi đóng môi trường kiểm thử</strong><pre>${escape(run.cleanupErrors.join('\n'))}</pre></div>` : ''}
  <nav>${run.tests.map((t) => `<a href="#${t.id}">${t.id}: ${t.status}</a>`).join('')}</nav></div>${cards}
  <p><a href="results.json">Dữ liệu kết quả JSON</a> · <a href="junit.xml">Kết quả JUnit XML</a></p></main></html>`;
  await fs.writeFile(path.join(directory, 'report.html'), html, 'utf8');
  const seconds = (t) => (t.durationMs / 1000).toFixed(3);
  const xml = `<?xml version="1.0" encoding="UTF-8"?><testsuite name="Selenium Clothing Website" tests="${run.tests.length}" failures="${run.totals.FAIL}" errors="${run.totals.ERROR}" skipped="${run.totals.PARTIAL}" time="${seconds(run)}" timestamp="${escape(run.startedAt)}">${run.tests.map((t) => `<testcase classname="selenium.${escape(run.requestedBrowser)}" name="${escape(t.id + ' ' + t.title)}" time="${seconds(t)}">${t.status === 'FAIL' ? `<failure message="${escape(t.error?.message || 'Kết quả không khớp mong đợi')}">${escape(JSON.stringify(t.assertions.filter((a) => !a.passed)))}</failure>` : t.status === 'ERROR' ? `<error message="${escape(t.error?.message)}">${escape(t.error?.stack)}</error>` : t.status === 'PARTIAL' ? '<skipped message="Phạm vi ca chưa được tự động hóa đầy đủ"/>' : ''}<system-out>${escape(t.screenshots.map((s) => s.path).join('\n'))}</system-out></testcase>`).join('')}</testsuite>`;
  await fs.writeFile(path.join(directory, 'junit.xml'), xml, 'utf8');
  await fs.writeFile(path.join(directory, '../latest.json'), JSON.stringify({ runId: run.id, report: `${run.id}/report.html`, results: `${run.id}/results.json`, totals: run.totals }, null, 2), 'utf8');
}

module.exports = { writeReports };
