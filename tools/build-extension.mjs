/**
 * 把用户脚本同步成扩展的 collector.js，并生成配套的 manifest.json。
 *
 * 单一数据源：tools/gaokao-exporter.user.js
 * 生成物：  tools/extension/collector.js、tools/extension/manifest.json
 *
 * 用法：node tools/build-extension.mjs
 *
 * 两条必须和用户脚本保持一致的设置：
 *   · run_at 必须是 document_start —— 采集靠的是 hook fetch/XHR，
 *     晚一步页面请求就已经发完了，会一条数据都抓不到（踩过）
 *   · version 直接取用户脚本头部的 @version，避免两边漂移
 *
 * 为什么能直接用 content script 跑（而不是注入页面主世界）：
 *   content script 默认跑在隔离世界，patch 页面主世界的 fetch/XHR 是无效的，
 *   所以这里用 "world": "MAIN"（Chrome 111+）让脚本在主世界执行。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(here, 'gaokao-exporter.user.js');
const outDir = path.join(here, 'extension');
const dstJs = path.join(outDir, 'collector.js');
const dstManifest = path.join(outDir, 'manifest.json');

const source = fs.readFileSync(src, 'utf8');

const version = (source.match(/@version\s+([\d.]+)/) || [])[1] || '0.0.0';
const name = (source.match(/@name\s+(.+)/) || [])[1]?.trim() || '高考顺 · 数据采集器';
const description = (source.match(/@description\s+(.+)/) || [])[1]?.trim() || '';

const banner = '/* 自动生成，请勿直接编辑 —— 改 tools/gaokao-exporter.user.js 后运行 node tools/build-extension.mjs */\n';
fs.writeFileSync(dstJs, banner + source, 'utf8');

const manifest = {
  manifest_version: 3,
  name,
  version,
  description: description.slice(0, 120),
  content_scripts: [
    {
      matches: ['*://*/*'],
      js: ['collector.js'],
      run_at: 'document_start',
      world: 'MAIN',
      all_frames: false,
    },
  ],
};
fs.writeFileSync(dstManifest, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

console.log(`已生成 ${path.relative(process.cwd(), dstJs)}（${(source.length / 1024).toFixed(1)} KB）`);
console.log(`已生成 ${path.relative(process.cwd(), dstManifest)}（v${version}，document_start，MAIN world）`);
