/**
 * 聚合计算：专业记录 → 院校年度 K 线。
 *
 * 口径（与 help.html 的公式一致）：
 *   专业平均位次 = (最高位次 + 最低位次) / 2
 *   院校收盘位次 = Σ(专业平均位次 × 该专业录取人数) / Σ(录取人数)
 *   开盘位次     = 上一年的收盘位次（首年为当年收盘）
 *   上下影线     = 当年所有专业里最好 / 最差的位次
 *   百分位       = 收盘位次 / 该省当年考生数 × 100
 *
 * 百分位是跨省可比的量纲，指数层只聚合百分位，不再直接平均位次。
 */

import { DEFAULT_CANDIDATES } from './config.js';
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
 * 给每年补上百分位。
 * 缺少考生数时用默认值估算，并打上 estimated 标记（界面上会提示）。
 * @param {Array<object>} years yearlyAggregate 的结果
 * @param {Record<string|number, number>} candidatesByYear 该省逐年考生数
 */
export function attachPercentiles(years, candidatesByYear = {}) {
  return years.map((item) => {
    const declared = candidatesByYear?.[item.year];
    const candidates = declared > 0 ? declared : DEFAULT_CANDIDATES;
    return {
      ...item,
      candidates,
      percentile: item.close > 0 ? round2((item.close / candidates) * 100) : null,
      percentileEstimated: !(declared > 0),
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
      percentile: item.percentile ?? null,
      percentileEstimated: Boolean(item.percentileEstimated),
      candidates: item.candidates ?? null,
    };
  });
}

/**
 * 专业字典 → 院校整体 K 线
 * @param {object} majors
 * @param {Record<string|number, number>} candidatesByYear
 */
export function buildSchoolSeries(majors, candidatesByYear = {}) {
  return toCandles(attachPercentiles(yearlyAggregate(majors), candidatesByYear));
}

/** 单个专业 → K 线 */
export function buildMajorSeries(records, candidatesByYear = {}) {
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
  return toCandles(attachPercentiles(yearly, candidatesByYear));
}

/**
 * 移动平均。前 n-1 个点用 '-' 占位，保持与横轴等长（ECharts 会跳过）。
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

/** 年度涨跌（位次变化）。 */
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

/** 波动率：年度涨跌幅的标准差（越小越稳定），用于给"稳定性"排序 */
export function volatility(candles) {
  const changes = [];
  for (let i = 1; i < (candles?.length ?? 0); i += 1) {
    const prev = candles[i - 1].close;
    if (!prev) continue;
    changes.push((candles[i].close - prev) / prev);
  }
  if (changes.length < 2) return null;
  const mean = changes.reduce((a, b) => a + b, 0) / changes.length;
  const variance = changes.reduce((a, b) => a + (b - mean) ** 2, 0) / (changes.length - 1);
  return round2(Math.sqrt(variance) * 100);
}
