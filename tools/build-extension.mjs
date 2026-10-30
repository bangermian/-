/**
 * 把用户脚本同步成扩展的 collector.js。
 *
 * 单一数据源：tools/gaokao-exporter.user.js
 * 生成物：  tools/extension/collector.js
 *
 * 用法：node tools/build-extension.mjs
 *
 * 为什么能直接用 content script 跑（而不是注入页面主世界）：
 *   实测隔离世界里 performance.getEntriesByType 仍能看到页面发出的请求、
 *   localStorage 与 DOM 都可访问、跨域 fetch 也正常，
 *   所以不需要 <script src="chrome-extension://..."> 那一层，也就不会被页面 CSP 拦。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(here, 'gaokao-exporter.user.js');
const dst = path.join(here, 'extension', 'collector.js');

const source = fs.readFileSync(src, 'utf8');
const banner = '/* 自动生成，请勿直接编辑 —— 改 tools/gaokao-exporter.user.js 后运行 node tools/build-extension.mjs */\n';

fs.writeFileSync(dst, banner + source, 'utf8');
console.log(`已生成 ${path.relative(process.cwd(), dst)}（${(source.length / 1024).toFixed(1)} KB）`);
