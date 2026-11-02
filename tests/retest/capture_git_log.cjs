'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '../..');
const output = execFileSync('git', ['log', '--graph', '--all', '--oneline', '--decorate'], { cwd: root, encoding: 'utf8' });
const escaped = output.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const target = path.join(root, 'evidence', 'git-log.html');
fs.writeFileSync(target, `<!doctype html><html lang="vi"><meta charset="utf-8"><title>Git log</title><style>body{background:#111827;color:#e5e7eb;font:22px Consolas,monospace;padding:42px}h1{color:#60a5fa}pre{line-height:1.7}</style><h1>git log --graph --all --oneline --decorate</h1><pre>${escaped}</pre></html>`, 'utf8');
console.log(target);
