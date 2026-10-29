/**
 * 数据解析层：把「文件名 + 表格内容」变成结构化记录。
 *
 * 文件名规范：`年份 招生省份 院校名称 板块 考生数.xlsx`
 *   - 板块、考生数可省略；板块缺省按双非处理（与旧版一致）
 *   - 院校名称允许包含空格
 *
 * 表格规范：至少包含 专业名称 / 最低位次；其余列尽量提供
 *
 * 这一层是纯函数（除了需要全局 XLSX），不碰 DOM，便于单测。
 */

import { PLATE_ALIASES, PLATES } from './config.js';
import { isBlank, toNumber } from './utils.js';

const PLATE_LOOKING = /^[a-z][a-z0-9]{0,11}$/i;

/**
 * 解析文件名。
 * @returns {{year:number, province:string, school:string, plate:string,
 *            candidates:number|null, warnings:string[]}|null}
 */
export function parseFileName(fileName) {
  const stem = String(fileName).replace(/\.[^.]+$/, '').trim();
  const tokens = stem.split(/\s+/).filter(Boolean);
  if (tokens.length < 3) return null;

  const warnings = [];
  const year = Number(tokens[0]);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return null;

  const province = tokens[1];
  if (!province) return null;

  let rest = tokens.slice(2);
  let candidates = null;

  // 末尾 4~6 位纯数字视为该省当年考生总数
  const lastToken = rest[rest.length - 1];
  if (rest.length >= 2 && /^\d{4,6}$/.test(lastToken)) {
    candidates = Number(lastToken);
    rest = rest.slice(0, -1);
  }

  let plate = 'shuangfei';
  if (rest.length >= 2) {
    const maybePlate = rest[rest.length - 1].toLowerCase();
    if (PLATE_ALIASES[maybePlate]) {
      plate = PLATE_ALIASES[maybePlate];
      rest = rest.slice(0, -1);
    } else if (PLATE_LOOKING.test(maybePlate)) {
      warnings.push(`未知板块「${rest[rest.length - 1]}」，按双非处理`);
      rest = rest.slice(0, -1);
    }
  }

  const school = rest.join(' ').trim();
  if (!school) return null;

  return { year, province, school, plate, candidates, warnings };
}

/** 表头模糊匹配：返回列索引表 */
function mapHeader(header) {
  const map = { major: -1, highScore: -1, lowScore: -1, highRank: -1, lowRank: -1, volume: -1 };
  header.forEach((cell, index) => {
    const text = String(cell ?? '').trim();
    if (!text) return;
    if (map.major === -1 && text.includes('专业')) map.major = index;
    else if (map.highScore === -1 && text.includes('最高分')) map.highScore = index;
    else if (map.lowScore === -1 && text.includes('最低分')) map.lowScore = index;
    else if (map.highRank === -1 && (text.includes('最高位次') || text.includes('最高排名'))) map.highRank = index;
    else if (map.lowRank === -1 && (text.includes('最低位次') || text.includes('最低排名'))) map.lowRank = index;
    else if (map.volume === -1 && (text.includes('人数') || text.includes('录取'))) map.volume = index;
  });
  return map;
}

/** 在前若干行里找到真正的表头行（有些表格上面有标题、备注） */
function locateHeader(rows, probeRows = 12) {
  const limit = Math.min(rows.length, probeRows);
  for (let i = 0; i < limit; i += 1) {
    const map = mapHeader(rows[i] ?? []);
    if (map.major !== -1 && (map.highRank !== -1 || map.lowRank !== -1)) {
      return { headerIndex: i, map };
    }
  }
  return null;
}

/**
 * 表格行 → 记录数组。
 * @param {Array<Array<unknown>>} rows
 * @returns {{records:Array<object>, warnings:string[]}}
 */
export function parseSheetRows(rows) {
  const warnings = [];
  if (!Array.isArray(rows) || rows.length < 2) {
    return { records: [], warnings: ['表格为空或只有表头'] };
  }

  const located = locateHeader(rows);
  if (!located) {
    return { records: [], warnings: ['未找到表头：需要包含「专业」以及「最高位次/最低位次」列'] };
  }

  const { headerIndex, map } = located;
  const records = [];
  let skipped = 0;

  for (let i = headerIndex + 1; i < rows.length; i += 1) {
    const row = rows[i] ?? [];
    if (row.every((cell) => isBlank(cell))) continue;

    const major = String(row[map.major] ?? '').trim();
    if (!major) continue;

    let lowRank = map.lowRank !== -1 ? toNumber(row[map.lowRank]) : null;
    let highRank = map.highRank !== -1 ? toNumber(row[map.highRank]) : null;

    // 位次缺失时互相兜底；两者都没有则丢弃该行
    if (lowRank === null && highRank === null) { skipped += 1; continue; }
    if (highRank === null) highRank = lowRank;
    if (lowRank === null) lowRank = highRank;
    if (highRank > lowRank) [highRank, lowRank] = [lowRank, highRank];

    let highScore = map.highScore !== -1 ? toNumber(row[map.highScore]) : null;
    let lowScore = map.lowScore !== -1 ? toNumber(row[map.lowScore]) : null;
    if (highScore === null && lowScore !== null) highScore = lowScore;
    if (lowScore === null && highScore !== null) lowScore = highScore;

    const volume = map.volume !== -1 ? toNumber(row[map.volume]) : null;

    records.push({
      major,
      highScore,
      lowScore,
      highRank: Math.round(highRank),
      lowRank: Math.round(lowRank),
      volume: volume && volume > 0 ? Math.round(volume) : 0,
    });
  }

  if (skipped > 0) warnings.push(`跳过 ${skipped} 行（位次为空）`);
  return { records, warnings };
}

/**
 * 文本解码：优先 UTF-8，出现乱码时回退 GB18030（Excel 导出的中文 CSV 常见）。
 */
export function decodeText(buffer) {
  const bytes = new Uint8Array(buffer);
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  // U+FFFD 说明 UTF-8 解码失败，多半是 GBK 系编码
  if (utf8.includes('\uFFFD')) {
    try {
      return new TextDecoder('gb18030').decode(bytes);
    } catch {
      return utf8;
    }
  }
  return utf8;
}

/**
 * 解析单个数据文件（xlsx / xls / csv）。
 * @param {{name:string, relPath:string, buffer:ArrayBuffer, XLSX:object}} input
 * @returns {{meta:object, records:Array<object>, warnings:string[]}|null}
 */
export function parseWorkbookFile({ name, relPath, buffer, XLSX }) {
  if (!XLSX) throw new Error('表格解析库 XLSX 未加载');

  const meta = parseFileName(name);
  if (!meta) {
    return { meta: null, records: [], warnings: [`文件名不符合「年份 招生省份 院校 板块 考生数」：${name}`] };
  }

  const lower = name.toLowerCase();
  const workbook = lower.endsWith('.csv')
    ? XLSX.read(decodeText(buffer), { type: 'string' })
    : XLSX.read(new Uint8Array(buffer), { type: 'array', cellDates: false });

  const sheetNames = workbook.SheetNames ?? [];
  if (sheetNames.length === 0) {
    return { meta, records: [], warnings: [`文件没有工作表：${name}`] };
  }

  let result = { records: [], warnings: [] };
  for (const sheetName of sheetNames) {
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
      header: 1,
      blankrows: false,
      defval: null,
      raw: true,
    });
    const parsed = parseSheetRows(rows);
    if (parsed.records.length > 0) { result = parsed; break; }
    result = parsed;
  }

  const location = deriveLocation(relPath);
  return { meta: { ...meta, location }, records: result.records, warnings: result.warnings };
}

/**
 * 从相对路径推断「学校所在地」= 数据根目录下的一级文件夹。
 * 例：`天津/2025 天津 天津工业大学 doublefirst 74000.xlsx` → 天津
 */
export function deriveLocation(relPath) {
  const normalized = String(relPath ?? '').replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length < 2) return '待定';
  const folder = parts[0].trim();
  return folder && folder !== '未知' ? folder : '待定';
}

/** 板块是否合法（供 UI 下拉校验） */
export function isKnownPlate(plate) {
  return PLATES.includes(plate);
}
