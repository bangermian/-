/**
 * 应用状态与数据变更。
 *
 * 状态是唯一事实来源，派生数据（series）在每次变更后重建，
 * 这样「加载 / 手录 / 删除 / 读缓存」永远走同一条计算路径。
 */

import { buildSchoolSeries, buildMajorSeries } from './aggregate.js';
import { STORAGE } from './config.js';
import { round2 } from './utils.js';

export function createState() {
  return {
    schemaVersion: STORAGE.schemaVersion,
    loaded: false,
    savedAt: null,
    schools: {},
    provinceCandidates: {},
    // 一分一段表：{ 省份: { 年份: [{score, cumulative}] } }，按分数降序
    segments: {},
  };
}

export function schoolKey(school, province) {
  return `${school}_${province}`;
}

/** 某省逐年的考生数 */
export function candidatesFor(state, province) {
  return state.provinceCandidates[province] ?? {};
}

/** 重建单个院校的 K 线 */
export function rebuildSchool(state, key) {
  const item = state.schools[key];
  if (!item) return null;
  item.series = buildSchoolSeries(item.majors, candidatesFor(state, item.province));
  return item.series;
}

/** 全量重建（加载缓存、批量导入后调用） */
export function rebuildAll(state) {
  for (const key of Object.keys(state.schools)) rebuildSchool(state, key);
  return state;
}

/** 记录某省某年考生数（同一省份同年以先写入者为准） */
function rememberCandidates(state, province, year, candidates) {
  if (!candidates || !province || !year) return false;
  const bucket = state.provinceCandidates[province] ?? (state.provinceCandidates[province] = {});
  if (bucket[year]) return false;
  bucket[year] = Math.round(candidates);
  return true;
}

/** 批量写入考生数；返回写入条数 */
export function applyCandidateRecords(state, list) {
  let written = 0;
  for (const item of list ?? []) {
    if (rememberCandidates(state, item.province, item.year, item.candidates)) written += 1;
  }
  if (written > 0) rebuildAll(state);
  return written;
}

/* ------------------------------ 一分一段表 ------------------------------ */

/** 批量写入一分一段数据；返回写入的「省份-年份」份数 */
export function applySegmentRecords(state, list) {
  const touched = new Set();
  for (const item of list ?? []) {
    if (!item?.province || !item?.year || !Number.isFinite(item.score) || !Number.isFinite(item.cumulative)) continue;
    const byProvince = state.segments[item.province] ?? (state.segments[item.province] = {});
    const rows = byProvince[item.year] ?? (byProvince[item.year] = []);
    rows.push({ score: item.score, cumulative: item.cumulative });
    touched.add(`${item.province}|${item.year}`);
  }
  // 按分数降序整理，并去重（同分保留最后一条）
  for (const key of touched) {
    const [province, year] = key.split('|');
    const rows = state.segments[province][year];
    const dedup = new Map(rows.map((r) => [r.score, r]));
    state.segments[province][year] = [...dedup.values()].sort((a, b) => b.score - a.score);
  }
  return touched.size;
}

/** 该省该年的一分一段表（按分数降序），没有则 null */
export function segmentTableFor(state, province, year) {
  return state.segments?.[province]?.[year] ?? null;
}

/**
 * 分数 → 位次（累计人数）。
 * 表按分数降序；找第一个 score <= 目标分的行，它的累计人数就是该分的位次。
 * @returns {number|null} 表中查不到（低于表尾）时返回 null
 */
export function rankForScore(state, province, year, score) {
  const table = segmentTableFor(state, province, year);
  if (!table || !Number.isFinite(score)) return null;
  for (const row of table) {
    if (score >= row.score) return row.cumulative;
  }
  return null;
}

/** 已有哪些省份/年份的一分一段表 */
export function listSegments(state) {
  const out = [];
  for (const [province, years] of Object.entries(state.segments ?? {})) {
    for (const [year, rows] of Object.entries(years)) {
      out.push({ province, year: Number(year), rows: rows.length });
    }
  }
  return out.sort((a, b) => a.province.localeCompare(b.province, 'zh-CN') || a.year - b.year);
}

/** 确保院校存在，返回其对象 */
function ensureSchool(state, { school, province, plate, location }) {
  const key = schoolKey(school, province);
  let item = state.schools[key];
  if (!item) {
    item = {
      name: `${school}（${province}招生）`,
      school,
      province,
      plate: plate ?? 'shuangfei',
      location: location || '待定',
      majors: {},
      series: [],
    };
    state.schools[key] = item;
  } else {
    if ((!item.location || item.location === '待定' || item.location === '未知') && location) {
      item.location = location;
    }
    if (plate && item.plate !== plate) item.plate = plate;
  }
  return item;
}

/**
 * 写入统一记录（新旧格式都会先归一成这个形状）。
 * 同一「院校 + 专业 + 年份」会覆盖旧值，因此重复导入是幂等的。
 * @returns {{keys:string[], added:number}}
 */
export function applyRecords(state, records) {
  if (!records?.length) return { keys: [], added: 0, skipped: 0, converted: 0 };

  const touched = new Map();
  let added = 0;
  let skipped = 0;
  let converted = 0;

  for (const record of records) {
    if (!record?.school || !record?.province || !record?.major || !record?.year) { skipped += 1; continue; }

    const year = Number(record.year);
    let highRank = record.highRank ?? null;
    let lowRank = record.lowRank ?? null;

    // 只有分数没有位次时，用一分一段表换算（这是「官网/表格只给分数」的自动补位）
    if (highRank === null || lowRank === null) {
      const hasScore = Number.isFinite(record.lowScore) || Number.isFinite(record.highScore);
      if (hasScore) {
        if (lowRank === null && Number.isFinite(record.lowScore)) {
          const r = rankForScore(state, record.province, year, record.lowScore);
          if (r !== null) { lowRank = r; converted += 1; }
        }
        if (highRank === null && Number.isFinite(record.highScore)) {
          const r = rankForScore(state, record.province, year, record.highScore);
          if (r !== null) { highRank = r; converted += 1; }
        }
        if (highRank === null) highRank = lowRank;
        if (lowRank === null) lowRank = highRank;
      }
    }

    if (highRank === null || lowRank === null) { skipped += 1; continue; }

    const item = ensureSchool(state, {
      school: record.school,
      province: record.province,
      plate: record.plate,
      location: record.location,
    });
    const key = schoolKey(record.school, record.province);
    touched.set(key, item);

    const bucket = item.majors[record.major] ?? (item.majors[record.major] = []);
    const next = {
      year,
      highScore: record.highScore ?? null,
      lowScore: record.lowScore ?? null,
      highRank,
      lowRank,
      volume: Math.round(record.volume ?? 0),
    };
    const index = bucket.findIndex((entry) => entry.year === next.year);
    if (index >= 0) bucket[index] = next;
    else bucket.push(next);
    added += 1;
  }

  for (const key of touched.keys()) rebuildSchool(state, key);
  return { keys: [...touched.keys()], added, skipped, converted };
}

/**
 * 写入一个文件的解析结果（parser.parseWorkbookFile 的返回值）。
 */
export function applyParsedFile(state, parsed) {
  const result = { keys: [], added: 0, candidates: 0, segments: 0, skipped: 0, converted: 0 };
  if (!parsed) return result;

  if (parsed.candidates?.length) {
    result.candidates = applyCandidateRecords(state, parsed.candidates);
  }
  // 先写一分一段表，再写记录，这样同一批数据里的分数也能立刻换算
  if (parsed.segments?.length) {
    result.segments = applySegmentRecords(state, parsed.segments);
  }
  if (parsed.records?.length) {
    const applied = applyRecords(state, parsed.records);
    result.keys = applied.keys;
    result.added = applied.added;
    result.skipped = applied.skipped;
    result.converted = applied.converted;
  }
  return result;
}

/**
 * 手动添加 / 覆盖一条专业记录。
 * @returns {{ok:boolean, message?:string, key?:string}}
 */
export function addMajorRecord(state, input) {
  const required = ['school', 'province', 'major', 'year', 'highRank', 'lowRank'];
  for (const field of required) {
    if (input[field] === null || input[field] === undefined || input[field] === '') {
      return { ok: false, message: '请完整填写院校、省份、专业、年份与最高/最低位次' };
    }
  }
  if (input.highRank > input.lowRank) {
    [input.highRank, input.lowRank] = [input.lowRank, input.highRank];
  }

  const item = ensureSchool(state, {
    school: input.school,
    province: input.province,
    plate: input.plate,
    location: input.location,
  });

  const bucket = item.majors[input.major] ?? (item.majors[input.major] = []);
  const record = {
    year: Number(input.year),
    highScore: input.highScore ?? null,
    lowScore: input.lowScore ?? null,
    highRank: Math.round(input.highRank),
    lowRank: Math.round(input.lowRank),
    volume: Math.round(input.volume ?? 0),
  };
  const index = bucket.findIndex((entry) => entry.year === record.year);
  if (index >= 0) bucket[index] = record;
  else bucket.push(record);

  const key = schoolKey(input.school, input.province);
  rebuildSchool(state, key);
  return { ok: true, key };
}

/** 删除某院校某年的数据；指定专业时只删该专业 */
export function removeYear(state, key, year, major = null) {
  const item = state.schools[key];
  if (!item) return false;
  let removed = 0;
  const targets = major && item.majors[major] ? [major] : Object.keys(item.majors);
  for (const name of targets) {
    const before = item.majors[name].length;
    item.majors[name] = item.majors[name].filter((entry) => entry.year !== Number(year));
    removed += before - item.majors[name].length;
    if (item.majors[name].length === 0) delete item.majors[name];
  }
  rebuildSchool(state, key);
  return removed > 0;
}

/** 已出现的学校所在地 */
export function listLocations(state) {
  const set = new Set();
  for (const item of Object.values(state.schools)) {
    if (item.location && item.location !== '待定' && item.location !== '未知') set.add(item.location);
  }
  return [...set].sort((a, b) => a.localeCompare(b, 'zh-CN'));
}

/** 院校列表（用于 datalist 提示） */
export function listSchools(state) {
  return Object.values(state.schools)
    .map((item) => ({ key: schoolKey(item.school, item.province), school: item.school, province: item.province, name: item.name }))
    .sort((a, b) => a.school.localeCompare(b.school, 'zh-CN'));
}

/** 记录条数（一个专业一年算一条） */
export function countRecords(state) {
  let total = 0;
  for (const item of Object.values(state.schools)) {
    for (const records of Object.values(item.majors)) total += records.length;
  }
  return total;
}

/** 有多少个「院校-年份」缺少考生数（百分位会被估算） */
export function countMissingCandidates(state) {
  let missing = 0;
  for (const item of Object.values(state.schools)) {
    const map = candidatesFor(state, item.province);
    for (const candle of item.series ?? []) {
      if (!map[candle.year]) missing += 1;
    }
  }
  return missing;
}

/** 专业名列表 */
export function listMajors(item) {
  return Object.keys(item?.majors ?? {}).sort((a, b) => a.localeCompare(b, 'zh-CN'));
}

/** 取某个专业（或整体）的展示序列 */
export function seriesFor(state, key, major) {
  const item = state.schools[key];
  if (!item) return [];
  if (!major || major === '__all__') return item.series ?? [];
  return buildMajorSeries(item.majors[major] ?? [], candidatesFor(state, item.province));
}

/** 序列末值与上一年对比 */
export function latestChange(series) {
  if (!series || series.length === 0) return null;
  const latest = series[series.length - 1];
  const prev = series[series.length - 2];
  if (!prev) return { latest, prev: null, delta: 0, percent: null, direction: 'flat' };
  const delta = round2(latest.close - prev.close);
  const percent = prev.close ? round2((delta / prev.close) * 100) : null;
  return { latest, prev, delta, percent, direction: delta === 0 ? 'flat' : delta > 0 ? 'up' : 'down' };
}

/** 序列的最值（位次最小 = 最难） */
export function extremes(series) {
  if (!series || series.length === 0) return { hardest: null, easiest: null };
  let hardest = series[0];
  let easiest = series[0];
  for (const item of series) {
    if (item.close < hardest.close) hardest = item;
    if (item.close > easiest.close) easiest = item;
  }
  return { hardest, easiest };
}

/** 序列化：丢掉派生字段 */
export function serialize(state) {
  return JSON.stringify({
    schemaVersion: STORAGE.schemaVersion,
    savedAt: Date.now(),
    provinceCandidates: state.provinceCandidates,
    segments: state.segments,
    schools: Object.fromEntries(
      Object.entries(state.schools).map(([key, item]) => [key, {
        name: item.name,
        school: item.school,
        province: item.province,
        plate: item.plate,
        location: item.location,
        majors: item.majors,
      }]),
    ),
  });
}

/** 反序列化：校验版本后重建派生数据 */
export function deserialize(raw) {
  if (!raw) return null;
  let parsed;
  try {
    parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
  if (!parsed || parsed.schemaVersion !== STORAGE.schemaVersion) return null;

  const state = createState();
  state.provinceCandidates = parsed.provinceCandidates ?? {};
  state.segments = parsed.segments ?? {};
  for (const [key, item] of Object.entries(parsed.schools ?? {})) {
    state.schools[key] = {
      name: item.name,
      school: item.school,
      province: item.province,
      plate: item.plate ?? 'shuangfei',
      location: item.location ?? '待定',
      majors: item.majors ?? {},
      series: [],
    };
  }
  rebuildAll(state);
  state.loaded = Object.keys(state.schools).length > 0;
  state.savedAt = parsed.savedAt ?? null;
  return state;
}
