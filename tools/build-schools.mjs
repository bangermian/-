/**
 * 把 data/软科排名.csv 里的学校清单注入用户脚本的 SCHOOLS 常量。
 *
 * 用法：node tools/build-schools.mjs && node tools/build-extension.mjs
 *
 * 单独拆出来的原因：这批学校 ID/板块是会变的（分类调整、榜单更新），
 * 必须保证用户脚本里的清单和数据文件永远同源，不靠手工复制。
 *
 * 数据来源：掌上高考 v1/school/rank（sort_type=ruanke_zongbang），全榜 814 所。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const csvPath = path.join(here, '..', 'data', '软科排名.csv');
const jsPath = path.join(here, 'gaokao-exporter.user.js');

/** 简易 CSV 解析：支持双引号包裹和 "" 转义 */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (ch !== '\r') cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.length > 1);
}

const table = parseCsv(fs.readFileSync(csvPath, 'utf8').replace(/^\uFEFF/, ''));
const header = table[0];
const col = (name) => header.indexOf(name);
const iRank = col('排名');
const iId = col('学校ID');
const iName = col('学校名称');
const iProv = col('所在省份');
const iPlate = col('板块');

if ([iRank, iId, iName, iProv, iPlate].some((i) => i < 0)) {
  console.error('表头不符合预期:', header.join(','));
  process.exit(1);
}

// [排名, school_id, 校名, 所在地, 板块]
const list = table.slice(1)
  .filter((c) => c[iId] && Number.isFinite(Number(c[iId])))
  .map((c) => [Number(c[iRank]), Number(c[iId]), c[iName], c[iProv], c[iPlate]])
  .sort((a, b) => a[0] - b[0]);

const source = fs.readFileSync(jsPath, 'utf8');
const marker = /const SCHOOLS = (?:\[\]|\/\*__SCHOOLS__\*\/ \[\]|\[[\s\S]*?\]);\s*\n/;
if (!marker.test(source)) {
  console.error('没找到 SCHOOLS 常量，脚本结构可能变了');
  process.exit(1);
}

const next = source.replace(marker, `const SCHOOLS = ${JSON.stringify(list)};\n`);
fs.writeFileSync(jsPath, next, 'utf8');

console.log(`已注入 ${list.length} 所学校（名次 ${list[0][0]}–${list[list.length - 1][0]}）`);
const counts = {};
for (const s of list) counts[s[4]] = (counts[s[4]] || 0) + 1;
console.log('板块分布:', JSON.stringify(counts));
