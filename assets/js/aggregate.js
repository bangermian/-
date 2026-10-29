/**
 * 聚合计算：专业记录 → 院校年度 K 线。
 *
 * 口径（与 help.html 中的公式一致）：
 *   专业平均位次 = (最高位次 + 最低位次) / 2
 *   院校收盘位次 = Σ(专业平均位次 × 该专业录取人数) / Σ(录取人数)
 *   开盘位次     = 上一年的收盘位次（首年为当年收盘）
 *   上影线/下影线 = 当年所有专业里最好 / 最差的位次
 */

import { round2, sortByYear } from './utils.js';

/**
 * 按年度聚合某个院校的全部专业记录。
 * @param {Record<string, Array<object>>} majors 专业名 → 记录数组
 * @returns {Array<object>} 按年份升序
 */
export function yearlyAggregate(majors) {
  const byYear = new Map();

  for (const records of Object.values(majors ?? {})) {
    for (const record of records) {
      const year = record.year;
      if (!Number.isFinite(year)) continue;

      let acc = byYear.get(year);
      if (!acc) {
        acc = {
          sumWeightedRank: 0,
          weight: 0,
          volume: 0,
          best: Infinity,
          worst: -Infinity,
          maxLowScore: null,
          minLowScore: null,
          maxHighScore: null,
        };
        byYear.set(year, acc);
      }

      const volume = Number(record.volume) || 0;
      const weight = volume > 0 ? volume : 1;
      const avgRank = (record.highRank + record.lowRank) / 2;

      acc.sumWeightedRank += avgRank * weight;
      acc.weight += weight;
      acc.volume += volume;

      if (Number.isFinite(record.highRank)) acc.best = Math.min(acc.best, record.highRank);
      if (Number.isFinite(record.lowRank)) acc.worst = Math.max(acc.worst, record.lowRank);

      if (Number.isFinite(record.lowScore)) {
        acc.maxLowScore = acc.maxLowScore === null ? record.lowScore : Math.max(acc.maxLowScore, record.lowScore);
        acc.minLowScore = acc.minLowScore === null ? record.lowScore : Math.min(acc.minLowScore, record.lowScore);
      }
      if (Number.isFinite(record.highScore)) {
        acc.maxHighScore = acc.maxHighScore === null ? record.highScore : Math.max(acc.maxHighScore, record.highScore);
      }
    }
  }

  return [...byYear.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([year, acc]) => {
      const close = acc.weight > 0 ? round2(acc.sumWeightedRank / acc.weight) : 0;
      const best = Number.isFinite(acc.best) ? acc.best : close;
      const worst = Number.isFinite(acc.worst) ? acc.worst : close;
      return {
        year,
        close,
        best,
        worst,
        volume: acc.volume,
        maxScore: acc.maxLowScore,
        minScore: acc.minLowScore,
        maxHighScore: acc.maxHighScore,
      };
    });
}

/**
 * 给年度聚合结果补上 open / low / high，得到可直接喂给 ECharts 的 K 线数据。
 *
 * 注意：位次"越小越难"，best 是数值最小的位次。ECharts 的 candlestick 要求
 * low ≤ high（纯数值比较），所以这里让 low 取四者最小值、high 取最大值，
 * 视觉方向由 yAxis.inverse 负责。
 */
export function toCandles(series) {
  const sorted = sortByYear(series ?? []);
  return sorted.map((item, index) => {
    const open = index === 0 ? item.close : sorted[index - 1].close;
    const best = item.best ?? item.close;
    const worst = item.worst ?? item.close;
    return {
      year: item.year,
      open,
      close: item.close,
      low: Math.min(open, item.close, best),
      high: Math.max(open, item.close, worst),
      best,
      worst,
      volume: item.volume ?? 0,
      maxScore: item.maxScore ?? null,
      minScore: item.minScore ?? null,
      maxHighScore: item.maxHighScore ?? null,
      rank: item.rank ?? null,
      percentile: item.percentile ?? null,
      candidates: item.candidates ?? null,
      candidatesKnown: item.candidatesKnown ?? null,
    };
  });
}

/** 专业字典 → 院校整体 K 线 */
export function buildSchoolSeries(majors) {
  return toCandles(yearlyAggregate(majors));
}

/** 单个专业 → K 线（只保留该专业的记录） */
export function buildMajorSeries(records) {
  const yearly = sortByYear(records ?? []).map((record) => ({
    year: record.year,
    close: round2((record.highRank + record.lowRank) / 2),
    best: record.highRank,
    worst: record.lowRank,
    volume: record.volume ?? 0,
    maxScore: record.lowScore ?? null,
    minScore: record.lowScore ?? null,
    maxHighScore: record.highScore ?? null,
  }));
  return toCandles(yearly);
}

/**
 * 移动平均。前 n-1 个点用 '-' 占位，保持与横轴等长（ECharts 会跳过）。
 * @param {Array<{close:number}>} data
 * @param {number} period
 */
export function movingAverage(data, period) {
  const window = Math.max(1, Math.floor(period));
  const result = new Array(data.length).fill('-');
  let sum = 0;
  for (let i = 0; i < data.length; i += 1) {
    sum += data[i].close;
    if (i >= window) sum -= data[i - window].close;
    if (i >= window - 1) result[i] = round2(sum / window);
  }
  return result;
}

/** 年度涨跌（位次变化）。返回 {delta, percent, direction} */
export function changeOfLatest(candles) {
  if (!candles || candles.length === 0) return null;
  const latest = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  if (!prev || !prev.close) return { latest, prev: null, delta: 0, percent: null, direction: 'flat' };
  const delta = round2(latest.close - prev.close);
  const percent = round2((delta / prev.close) * 100);
  const direction = delta === 0 ? 'flat' : delta > 0 ? 'up' : 'down';
  return { latest, prev, delta, percent, direction };
}
