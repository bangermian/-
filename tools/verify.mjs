/**
 * 回归测试（零依赖）：node tools/verify.mjs
 *
 * 覆盖三个最容易算错的地方：文件名解析、加权聚合、指数分母。
 */

import assert from 'node:assert/strict';
import { movingAverage, toCandles, yearlyAggregate } from '../assets/js/aggregate.js';
import { computeIndices } from '../assets/js/indices.js';
import { parseFileName, parseSheetRows, deriveLocation } from '../assets/js/parser.js';
import {
  addMajorRecord, applyParsedFile, countRecords, createState, deserialize, removeYear, serialize,
} from '../assets/js/state.js';

let passed = 0;
const cases = [];

function test(name, fn) {
  cases.push({ name, fn });
}

/* ---------------------------------- 文件名 ---------------------------------- */

test('完整文件名：年份/省份/院校/板块/考生数', () => {
  const meta = parseFileName('2025 天津 天津工业大学 doublefirst 74000.xlsx');
  assert.equal(meta.year, 2025);
  assert.equal(meta.province, '天津');
  assert.equal(meta.school, '天津工业大学');
  assert.equal(meta.plate, 'doublefirst');
  assert.equal(meta.candidates, 74000);
});

test('CSV 扩展名同样解析', () => {
  const meta = parseFileName('2025 天津 温州肯恩大学 s11 74000.csv');
  assert.equal(meta.plate, 's11');
  assert.equal(meta.candidates, 74000);
});

test('省略板块与考生数时：板块回落到双非', () => {
  const meta = parseFileName('2025 天津 天津工业大学.xlsx');
  assert.equal(meta.school, '天津工业大学');
  assert.equal(meta.plate, 'shuangfei');
  assert.equal(meta.candidates, null);
});

test('院校名带空格时不会被拆碎', () => {
  const meta = parseFileName('2025 天津 中国人民大学 苏州校区 doublefirst 74000.xlsx');
  assert.equal(meta.school, '中国人民大学 苏州校区');
  assert.equal(meta.plate, 'doublefirst');
});

test('非法文件名返回 null', () => {
  assert.equal(parseFileName('随便一个文件.xlsx'), null);
  assert.equal(parseFileName('1999 天津 学校.xlsx'), null);
});

test('未知板块给出告警并按双非处理', () => {
  const meta = parseFileName('2025 天津 某大学 qqq 74000.xlsx');
  assert.equal(meta.plate, 'shuangfei');
  assert.ok(meta.warnings.length > 0);
});

test('从相对路径推断学校所在地', () => {
  assert.equal(deriveLocation('天津/2025 天津 天津工业大学.xlsx'), '天津');
  assert.equal(deriveLocation('2025.xlsx'), '待定');
});

/* ---------------------------------- 表格 ---------------------------------- */

test('表头不在第一行也能定位', () => {
  const rows = [
    ['2025 年天津市普通高校录取统计'],
    [],
    ['专业名称', '最高分', '最低分', '最高位次', '最低位次', '录取人数'],
    ['计算机科学与技术', 600, 590, 9000, 12000, 10],
  ];
  const { records } = parseSheetRows(rows);
  assert.equal(records.length, 1);
  assert.equal(records[0].major, '计算机科学与技术');
  assert.equal(records[0].lowRank, 12000);
});

test('最高位次缺失时用最低位次补齐', () => {
  const rows = [
    ['专业名称', '最低位次'],
    ['软件工程', 15000],
  ];
  const { records } = parseSheetRows(rows);
  assert.equal(records[0].highRank, 15000);
  assert.equal(records[0].lowRank, 15000);
});

test('位次填反时自动交换，全空行被跳过', () => {
  const rows = [
    ['专业名称', '最高位次', '最低位次'],
    ['数学', 20000, 10000],
    ['空行', null, null],
  ];
  const { records, warnings } = parseSheetRows(rows);
  assert.equal(records.length, 1);
  assert.equal(records[0].highRank, 10000);
  assert.equal(records[0].lowRank, 20000);
  assert.ok(warnings.length > 0);
});

test('缺表头时报错而不是静默产出空数据', () => {
  const { records, warnings } = parseSheetRows([['年份', '分数'], [2025, 600]]);
  assert.equal(records.length, 0);
  assert.match(warnings[0], /表头/);
});

/* ---------------------------------- 聚合 ---------------------------------- */

const majors = {
  计算机: [
    { year: 2024, highScore: 620, lowScore: 600, highRank: 8000, lowRank: 12000, volume: 10 },
    { year: 2025, highScore: 630, lowScore: 610, highRank: 7000, lowRank: 11000, volume: 12 },
  ],
  材料: [
    { year: 2024, highScore: 610, lowScore: 590, highRank: 15000, lowRank: 20000, volume: 30 },
    { year: 2025, highScore: 615, lowScore: 595, highRank: 14000, lowRank: 19000, volume: 28 },
  ],
};

test('收盘位次 = 按录取人数加权的专业平均位次', () => {
  const series = yearlyAggregate(majors);
  assert.equal(series.length, 2);
  // 2024: (10000*10 + 17500*30) / 40 = 15625
  assert.equal(series[0].close, 15625);
  // 2025: (9000*12 + 16500*28) / 40 = 14250
  assert.equal(series[1].close, 14250);
});

test('影线取当年最好/最差位次，招生数求和', () => {
  const [y2024] = yearlyAggregate(majors);
  assert.equal(y2024.best, 8000);
  assert.equal(y2024.worst, 20000);
  assert.equal(y2024.volume, 40);
  assert.equal(y2024.maxHighScore, 620);
  assert.equal(y2024.minScore, 590);
});

test('开盘 = 上一年收盘，low ≤ high', () => {
  const candles = toCandles(yearlyAggregate(majors));
  assert.equal(candles[0].open, candles[0].close);
  assert.equal(candles[1].open, candles[0].close);
  for (const candle of candles) {
    assert.ok(candle.low <= candle.high, 'candlestick 要求 low <= high');
    assert.ok(candle.low <= Math.min(candle.open, candle.close));
    assert.ok(candle.high >= Math.max(candle.open, candle.close));
  }
});

test('均线：前 n-1 个点为占位符', () => {
  const series = [{ close: 10 }, { close: 20 }, { close: 30 }];
  assert.deepEqual(movingAverage(series, 2), ['-', 15, 25]);
  assert.deepEqual(movingAverage(series, 3), ['-', '-', 20]);
});

/* ---------------------------------- 指数 ---------------------------------- */

function fixtureState() {
  const state = createState();
  state.schools = {
    A: { name: 'A（天津招生）', school: 'A', province: '天津', plate: 'doublefirst', location: '天津', majors: {}, series: [{ year: 2024, close: 10000, volume: 10 }] },
    B: { name: 'B（天津招生）', school: 'B', province: '天津', plate: 's11', location: '浙江', majors: {}, series: [{ year: 2024, close: 20000, volume: 30 }] },
    C: { name: 'C（浙江招生）', school: 'C', province: '浙江', plate: 's11', location: '浙江', majors: {}, series: [{ year: 2024, close: 30000, volume: 10 }] },
  };
  state.provinceCandidates = { 天津: { 2024: 70000 }, 浙江: { 2024: 50000 } };
  return state;
}

test('地点板块：分母只累加参与院校的招生省份考生数', () => {
  const { plate } = computeIndices(fixtureState(), ['天津', '浙江']);
  // 天津：只有 A，且 A 在天津招生 → 10000 / 70000 * 100 = 14.29 → 热度 85.71
  assert.equal(plate.loc_天津_all.data[0].close, 85.71);
  // 浙江：B(天津招生) + C(浙江招生) → 分母 70000 + 50000 = 120000
  //      加权位次 = (20000*30 + 30000*10) / 40 = 22500 → 18.75% → 热度 81.25
  assert.equal(plate.loc_浙江_all.data[0].close, 81.25);
  assert.equal(plate.loc_浙江_all.data[0].candidates, 120000);
});

test('大盘：分母是成员院校实际参与省份之和', () => {
  const { market } = computeIndices(fixtureState(), []);
  const east = market.east.data[0];
  // 加权位次 = (10000*10 + 20000*30 + 30000*10) / 50 = 20000
  assert.equal(east.rank, 20000);
  // 20000 / (70000 + 50000) * 100 = 16.6667 → 16.67 → 热度 83.33
  assert.equal(east.close, 83.33);
  assert.equal(east.candidates, 120000);
});

test('考生数缺失时回落到默认值并标记', () => {
  const state = fixtureState();
  state.provinceCandidates = {};
  const { market } = computeIndices(state, []);
  const east = market.east.data[0];
  assert.equal(east.candidatesKnown, false);
  assert.equal(east.candidates, 70000);
});

test('板块筛选：区域 × 板块只统计对应板块', () => {
  const { plate } = computeIndices(fixtureState(), []);
  // s11 = B + C，分母 120000，加权位次 22500 → 18.75% → 热度 81.25
  assert.equal(plate.east_s11.data[0].close, 81.25);
  // doublefirst = 只有 A，分母 70000 → 14.29% → 热度 85.71
  assert.equal(plate.east_doublefirst.data[0].close, 85.71);
  assert.equal(plate.east_92.data.length, 0);
});

/* ---------------------------------- 状态 ---------------------------------- */

test('重复加载同一文件是幂等的', () => {
  const state = createState();
  const meta = { year: 2025, province: '天津', school: '天津工业大学', plate: 'doublefirst', candidates: 74000, location: '天津' };
  const records = [{ major: '计算机', highScore: 600, lowScore: 590, highRank: 9000, lowRank: 12000, volume: 10 }];
  applyParsedFile(state, { meta, records });
  applyParsedFile(state, { meta, records });
  assert.equal(countRecords(state), 1);
  assert.equal(Object.keys(state.schools['天津工业大学_天津'].majors).length, 1);
});

test('同一年不同专业分别计入', () => {
  const state = createState();
  const meta = { year: 2025, province: '天津', school: 'S', plate: 's11', candidates: null, location: '天津' };
  applyParsedFile(state, { meta, records: [{ major: 'A', highRank: 100, lowRank: 200, volume: 1, highScore: null, lowScore: null }] });
  applyParsedFile(state, { meta, records: [{ major: 'B', highRank: 300, lowRank: 400, volume: 1, highScore: null, lowScore: null }] });
  assert.equal(countRecords(state), 2);
  const series = state.schools['S_天津'].series;
  assert.equal(series.length, 1);
  assert.equal(series[0].close, 250);
});

test('手动录入会覆盖同年记录', () => {
  const state = createState();
  const meta = { year: 2025, province: '天津', school: 'S', plate: 's11', candidates: null, location: '天津' };
  applyParsedFile(state, { meta, records: [{ major: 'A', highRank: 100, lowRank: 200, volume: 1 }] });
  const result = addMajorRecord(state, { school: 'S', province: '天津', major: 'A', year: 2025, highRank: 50, lowRank: 60, volume: 2 });
  assert.ok(result.ok);
  assert.equal(countRecords(state), 1);
  assert.equal(state.schools['S_天津'].series[0].close, 55);
});

test('删除某年后派生数据同步更新', () => {
  const state = createState();
  const meta = { year: 2024, province: '天津', school: 'S', plate: 's11', candidates: null, location: '天津' };
  applyParsedFile(state, { meta, records: [{ major: 'A', highRank: 100, lowRank: 200, volume: 1 }] });
  applyParsedFile(state, { meta: { ...meta, year: 2025 }, records: [{ major: 'A', highRank: 50, lowRank: 60, volume: 1 }] });
  assert.equal(state.schools['S_天津'].series.length, 2);
  removeYear(state, 'S_天津', 2024);
  assert.equal(state.schools['S_天津'].series.length, 1);
  assert.equal(state.schools['S_天津'].series[0].year, 2025);
});

test('缓存序列化后可完整还原', () => {
  const state = createState();
  const meta = { year: 2025, province: '天津', school: 'S', plate: 's11', candidates: 74000, location: '天津' };
  applyParsedFile(state, { meta, records: [{ major: 'A', highRank: 100, lowRank: 200, volume: 1 }] });
  const restored = deserialize(serialize(state));
  assert.ok(restored);
  assert.equal(countRecords(restored), 1);
  assert.equal(restored.schools['S_天津'].series[0].close, 150);
});

test('版本不一致的缓存会被丢弃', () => {
  assert.equal(deserialize('{"schemaVersion":1,"schools":{}}'), null);
  assert.equal(deserialize('not json'), null);
});

/* ---------------------------------- 执行 ---------------------------------- */

let failed = 0;
for (const { name, fn } of cases) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`  ✗ ${name}`);
    console.error(`    ${error.message}`);
  }
}

console.log(`\n${passed} passed, ${failed} failed, ${cases.length} total`);
process.exit(failed === 0 ? 0 : 1);
