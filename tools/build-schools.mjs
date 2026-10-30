/**
 * 把 data/软科前100.csv 里的学校清单注入用户脚本的 SCHOOLS 常量。
 *
 * 用法：node tools/build-schools.mjs && node tools/build-extension.mjs
 *
 * 单独拆出来的原因：这批学校 ID/板块是会变的（分类调整、榜单更新），
 * 必须保证用户脚本里的清单和数据文件永远同源，不靠手工复制。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const csvPath = path.join(here, '..', 'data', '软科前100.csv');
const jsPath = path.join(here, 'gaokao-exporter.user.js');

const lines = fs.readFileSync(csvPath, 'utf8').replace(/^\uFEFF/, '').trim().split(/\r?\n/);
const rows = lines.slice(1).map((line) => line.split(',')).filter((c) => c.length >= 7);

// [排名, school_id, 校名, 所在地, 板块]
const list = rows.map((c) => [Number(c[0]), Number(c[1]), c[2], c[3], c[6]]);

const source = fs.readFileSync(jsPath, 'utf8');
const marker = /const SCHOOLS = (?:\[\]|\/\*__SCHOOLS__\*\/ \[\]|\[[\s\S]*?\]);/;
if (!marker.test(source)) {
  console.error('没找到 SCHOOLS 常量，脚本结构可能变了');
  process.exit(1);
}

const next = source.replace(marker, `const SCHOOLS = ${JSON.stringify(list)};`);
fs.writeFileSync(jsPath, next, 'utf8');

console.log(`已注入 ${list.length} 所学校`);
const counts = {};
for (const s of list) counts[s[4]] = (counts[s[4]] || 0) + 1;
console.log('板块分布:', JSON.stringify(counts));
