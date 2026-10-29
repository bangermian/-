/**
 * 指数计算：把个股 K 线聚合成大盘 / 板块指数。
 *
 * 口径（相对旧版的三处修正）：
 *  1. 旧版把所有省份的考生数混用"第一个文件"的值当全局分母，跨省跨年都会算错。
 *     这里为每个桶记录「实际参与的招生省份」，分母 = 这些省份当年考生数之和，
 *     既不会把没数据的省份算进来，也不会跨年串号。
 *  2. 旧版在 4 处循环里反复遍历全部院校来收集年份（O(n²)），
 *     这里只遍历一次，先建桶再出结果。
 *  3. 指数统一换算成「热度指数 = 100 - 百分位」，数值越大越难考，
 *     和个股"越靠上越难"的视觉方向保持一致。
 */

import { DEFAULT_CANDIDATES, PLATES, REGIONS } from './config.js';
import { round2 } from './utils.js';

/** 建一个空桶 */
function emptyAcc() {
  return { rv: 0, v: 0, rankMin: Infinity, rankMax: -Infinity, provinces: new Set() };
}

/** 单次遍历建立聚合桶：分组 × 板块 × 年份 */
function buildBuckets(schools) {
  const byLocation = new Map();
  const byProvince = new Map();

  const add = (store, groupKey, plate, year, close, volume, province) => {
    let group = store.get(groupKey);
    if (!group) { group = new Map(); store.set(groupKey, group); }
    let plates = group.get(plate);
    if (!plates) { plates = new Map(); group.set(plate, plates); }
    let acc = plates.get(year);
    if (!acc) { acc = emptyAcc(); plates.set(year, acc); }
    acc.rv += close * volume;
    acc.v += volume;
    acc.rankMin = Math.min(acc.rankMin, close);
    acc.rankMax = Math.max(acc.rankMax, close);
    acc.provinces.add(province);
  };

  for (const school of Object.values(schools)) {
    const location = school.location || '待定';
    for (const candle of school.series ?? []) {
      const close = candle.close;
      if (!Number.isFinite(close)) continue;
      const volume = candle.volume ?? 0;
      add(byLocation, location, 'all', candle.year, close, volume, school.province);
      add(byLocation, location, school.plate, candle.year, close, volume, school.province);
      add(byProvince, school.province, 'all', candle.year, close, volume, school.province);
      add(byProvince, school.province, school.plate, candle.year, close, volume, school.province);
    }
  }

  return { byLocation, byProvince };
}

/** 合并同一分组键集合、某板块、某一年的桶 */
function mergeBuckets(store, groupKeys, plate, year) {
  const merged = emptyAcc();
  for (const key of groupKeys) {
    const acc = store.get(key)?.get(plate)?.get(year);
    if (!acc) continue;
    merged.rv += acc.rv;
    merged.v += acc.v;
    merged.rankMin = Math.min(merged.rankMin, acc.rankMin);
    merged.rankMax = Math.max(merged.rankMax, acc.rankMax);
    for (const province of acc.provinces) merged.provinces.add(province);
  }
  return merged;
}

/** 该分组集合在某板块下出现过的年份 */
function collectYears(store, groupKeys, plate) {
  const years = new Set();
  for (const key of groupKeys) {
    const plateMap = store.get(key)?.get(plate);
    if (!plateMap) continue;
    for (const year of plateMap.keys()) years.add(year);
  }
  return [...years].sort((a, b) => a - b);
}

/** 分母：参与该桶的各招生省份当年考生数之和 */
function resolveCandidates(provinceCandidates, provinces, year) {
  let sum = 0;
  let known = false;
  for (const province of provinces) {
    const value = provinceCandidates?.[province]?.[year];
    if (value > 0) { sum += value; known = true; }
  }
  return known ? { total: sum, known: true } : { total: DEFAULT_CANDIDATES, known: false };
}

/** 加权结果 → 展示序列（热度空间，数值越大越难） */
function toIndexItem(year, merged, provinceCandidates) {
  if (merged.v <= 0 || merged.provinces.size === 0) return null;

  const rank = round2(merged.rv / merged.v);
  if (rank === null) return null;

  const { total, known } = resolveCandidates(provinceCandidates, merged.provinces, year);
  const percentile = round2((rank / total) * 100);
  if (percentile === null) return null;

  const pctMin = round2((merged.rankMin / total) * 100);
  const pctMax = round2((merged.rankMax / total) * 100);

  return {
    year,
    close: round2(100 - percentile),
    best: round2(100 - pctMax),
    worst: round2(100 - pctMin),
    volume: merged.v,
    rank,
    percentile,
    candidates: total,
    candidatesKnown: known,
    provinces: [...merged.provinces].sort((a, b) => a.localeCompare(b, 'zh-CN')),
  };
}

/** 某个分组集合 × 板块 → 完整序列 */
function buildSeries(store, groupKeys, plate, provinceCandidates) {
  const series = [];
  for (const year of collectYears(store, groupKeys, plate)) {
    const merged = mergeBuckets(store, groupKeys, plate, year);
    const item = toIndexItem(year, merged, provinceCandidates);
    if (item) series.push(item);
  }
  return series;
}

/**
 * 计算全部大盘 / 板块指数。
 * @param {{schools:object, provinceCandidates:object}} state
 * @param {string[]} extraLocations 额外需要生成板块键的地点
 */
export function computeIndices(state, extraLocations = []) {
  const { byLocation, byProvince } = buildBuckets(state.schools);
  const market = {};
  const plate = {};

  // ---- 大盘：按学校所在地聚合到区域 ----
  for (const [regionKey, provinces] of Object.entries(REGIONS)) {
    market[regionKey] = {
      key: regionKey,
      mode: 'heat',
      data: buildSeries(byLocation, provinces, 'all', state.provinceCandidates),
    };
  }

  // ---- 区域 × 板块 ----
  for (const [regionKey, provinces] of Object.entries(REGIONS)) {
    for (const plateKey of PLATES) {
      plate[`${regionKey}_${plateKey}`] = {
        key: `${regionKey}_${plateKey}`,
        mode: 'heat',
        data: buildSeries(byProvince, provinces, plateKey, state.provinceCandidates),
      };
    }
  }

  // ---- 地点 × (板块 | 全部) ----
  // 以「学校所在地」分组：真正回答"某地高校整体热度"
  const locations = new Set([...byLocation.keys(), ...extraLocations]);
  for (const location of locations) {
    for (const plateKey of ['all', ...PLATES]) {
      plate[`loc_${location}_${plateKey}`] = {
        key: `loc_${location}_${plateKey}`,
        mode: 'heat',
        data: buildSeries(byLocation, [location], plateKey, state.provinceCandidates),
      };
    }
  }

  return { market, plate };
}

/** 该指数是否有数据 */
export function hasSeries(entry) {
  return Boolean(entry && Array.isArray(entry.data) && entry.data.length > 0);
}
