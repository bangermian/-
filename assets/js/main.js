/**
 * 应用入口：装配各模块、处理数据加载与交互。
 *
 * 数据流：文件夹 → parser(解析) → state(合并/重建 K 线) → indices(聚合指数)
 *        → charts(渲染) + storage(缓存)
 * 所有数据入口（加载 / 手录 / 删除 / 恢复缓存）都收敛到 renderActive() + persistState()，
 * 避免出现两套口径。
 */

import { buildMajorSeries, detectOutliers, toCandles } from './aggregate.js';
import { createChartController } from './charts.js';
import { ACCEPTED_EXT, DEFAULT_MA, REGION_LABELS, PLATE_LABELS, REGIONS } from './config.js';
import { computeIndices } from './indices.js';
import { parseWorkbookFile } from './parser.js';
import {
  addMajorRecord, applyParsedFile, countMissingCandidates, countRecords, createState, deserialize,
  listLocations, listMajors, listSchools, removeYear, schoolKey, serialize,
} from './state.js';
import { clearSnapshot, loadSnapshot, saveSnapshot } from './storage.js';
import { formatNumber, formatPercent, round2, safeFilename } from './utils.js';
import {
  $, bindTabs, closeModal, fillSelect, openModal, renderDataList, renderInfoBar,
  resetInfoBar, setEmptyState, setMajorOptions, setSchoolOptions, setStatus, setStatusCount, toast,
} from './ui.js';

/* ============================ 全局状态 ============================ */

let state = createState();
let indexCache = { market: {}, plate: {} };
let chartController = null;

const view = {
  tab: 'market',
  mode: 'heat',
  series: [],
  key: '',
  major: '__all__',
  ma: [...DEFAULT_MA],
};

/* ============================ 依赖加载 ============================ */

const LIBRARIES = {
  echarts: {
    global: 'echarts',
    urls: [
      'vendor/echarts.min.js',
      'https://cdn.jsdelivr.net/npm/echarts@5.4.3/dist/echarts.min.js',
      'https://unpkg.com/echarts@5.4.3/dist/echarts.min.js',
      'https://cdnjs.cloudflare.com/ajax/libs/echarts/5.4.3/echarts.min.js',
    ],
  },
  XLSX: {
    global: 'XLSX',
    urls: [
      'vendor/xlsx.full.min.js',
      'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js',
      'https://unpkg.com/xlsx@0.18.5/dist/xlsx.full.min.js',
      'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
    ],
  },
};

function injectScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    const timer = setTimeout(() => { script.remove(); reject(new Error(`加载超时：${src}`)); }, 12000);
    script.onload = () => { clearTimeout(timer); resolve(src); };
    script.onerror = () => { clearTimeout(timer); script.remove(); reject(new Error(`加载失败：${src}`)); };
    document.head.appendChild(script);
  });
}

async function ensureLibrary({ global, urls }) {
  if (window[global]) return true;
  for (const url of urls) {
    try {
      await injectScript(url);
      if (window[global]) return true;
    } catch {
      // 换下一个源
    }
  }
  return false;
}

/* ============================ 派生数据刷新 ============================ */

function refreshIndices() {
  indexCache = computeIndices(state, listLocations(state));
}

function refreshLocationOptions() {
  const options = [{ value: 'all', label: '全部省份' }]
    .concat(listLocations(state).map((loc) => ({ value: loc, label: `${loc}板块` })));
  const select = $('plate-province');
  const previous = select?.value;
  fillSelect('plate-province', options, previous);
  if (select && !options.some((option) => option.value === select.value)) select.value = 'all';
}

function refreshSchoolOptions() {
  setSchoolOptions(listSchools(state));
}

function updateStatusCount() {
  const schools = Object.keys(state.schools).length;
  const records = countRecords(state);
  setStatusCount(schools ? `院校 ${schools} 所 · 记录 ${records} 条` : '');
}

/* ============================ 渲染 ============================ */

function marketEntry() {
  const key = $('marketSelect')?.value ?? 'east';
  return { key, entry: indexCache.market[key] };
}

function plateEntry() {
  const location = $('plate-province')?.value ?? 'all';
  const region = $('plate-region')?.value ?? 'east';
  const plate = $('plate-type')?.value ?? 'all';
  const key = location && location !== 'all' ? `loc_${location}_${plate}` : `${region}_${plate}`;
  return { key, entry: indexCache.plate[key] };
}

function stockEntry() {
  const school = $('stock-school')?.value.trim() ?? '';
  const province = $('stock-province')?.value.trim() ?? '';
  const key = school && province ? schoolKey(school, province) : '';
  return { key, school, province, item: key ? state.schools[key] : null };
}

function heatTone(delta) {
  if (!Number.isFinite(delta) || delta === 0) return { tone: '', text: '持平' };
  return delta > 0 ? { tone: 'up', text: '更难' } : { tone: 'down', text: '更易' };
}

function renderHeatView(name, series, emptyHint) {
  view.mode = 'heat';
  view.series = series;

  const candles = toCandles(series);
  const { hasSpread } = chartController.render({ mode: 'heat', series: candles, title: name, ma: view.ma });
  toggleSpread(hasSpread);
  setEmptyState(candles.length === 0, emptyHint);

  if (candles.length === 0) {
    resetInfoBar();
    return candles;
  }

  const latest = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const delta = prev ? latest.close - prev.close : null;
  const percent = prev && prev.close ? (delta / prev.close) * 100 : null;
  const tone = heatTone(delta);

  let high = candles[0];
  let low = candles[0];
  for (const item of candles) {
    if (item.close > high.close) high = item;
    if (item.close < low.close) low = item;
  }

  renderInfoBar({
    name,
    valueLabel: '最新热度',
    value: latest.close.toFixed(2),
    change: prev ? { text: `${formatPercent(percent)} · ${tone.text}`, tone: tone.tone } : { text: '首年', tone: '' },
    volume: `${formatNumber(latest.volume)} 人`,
    high: `${formatNumber(high.close, 2)}（${high.year}）`,
    low: `${formatNumber(low.close, 2)}（${low.year}）`,
  });

  return candles;
}

function renderRankView(name, series, context = {}) {
  view.mode = 'rank';
  view.series = series;

  const candles = toCandles(series);

  // 基准线：同省同板块的平均百分位换算回"位次"，与个股共用纵轴
  const candleByYear = new Map(candles.map((candle) => [candle.year, candle]));
  const benchmark = (context.benchmark ?? [])
    .map((item) => {
      const candle = candleByYear.get(item.year);
      const candidates = candle?.candidates;
      if (!Number.isFinite(item.percentile) || !candidates) return null;
      return { year: item.year, rank: Math.round((item.percentile / 100) * candidates) };
    })
    .filter(Boolean);

  const { flagged } = detectOutliers(candles);
  const { hasSpread } = chartController.render({
    mode: 'rank', series: candles, title: name, ma: view.ma,
    baseline: benchmark, outliers: flagged,
  });
  toggleSpread(hasSpread);
  setEmptyState(candles.length === 0);

  if (candles.length === 0) {
    resetInfoBar();
    return candles;
  }

  const latest = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const delta = prev ? latest.close - prev.close : null;
  // 位次变小 = 更难，用红色（tone=up 表示"更难"，与热度视图一致）
  const tone = !prev || delta === 0
    ? { tone: '', text: '持平' }
    : delta < 0 ? { tone: 'up', text: '更难' } : { tone: 'down', text: '更易' };
  const changeText = prev
    ? `${delta < 0 ? '↓' : '↑'} ${formatNumber(Math.abs(delta))} 位 · ${tone.text}`
    : '首年';

  // 相对强度：本校百分位 − 同省同板块平均百分位（百分点）
  // 百分位越小 = 排名越靠前 = 越难；所以 diff<0 表示"比同类更难"
  const benchLatest = (context.benchmark ?? []).find((item) => item.year === latest.year);
  let relative = { text: '-', tone: '' };
  if (benchLatest && Number.isFinite(benchLatest.percentile) && Number.isFinite(latest.percentile)) {
    const diff = round2(latest.percentile - benchLatest.percentile);
    const relativeTone = diff < 0 ? 'up' : diff > 0 ? 'down' : '';
    relative = {
      text: `${diff > 0 ? '+' : ''}${diff.toFixed(2)}pp · ${diff < 0 ? '更难' : diff > 0 ? '更易' : '持平'}`,
      tone: relativeTone,
    };
  }

  let hardest = candles[0];
  let easiest = candles[0];
  for (const item of candles) {
    if (item.close < hardest.close) hardest = item;
    if (item.close > easiest.close) easiest = item;
  }

  renderInfoBar({
    name,
    valueLabel: '最新位次',
    value: formatNumber(latest.close),
    change: { text: changeText, tone: tone.tone },
    volume: `${formatNumber(latest.volume)} 人`,
    difficulty: { text: Number.isFinite(latest.difficulty) ? `${latest.difficulty.toFixed(2)}%` : '-' },
    relative,
    high: `${formatNumber(hardest.close)}（${hardest.year}）`,
    low: `${formatNumber(easiest.close)}（${easiest.year}）`,
  });

  return candles;
}

function toggleSpread(hasSpread) {
  const el = $('spreadChart');
  if (el) el.classList.toggle('is-hidden', !hasSpread);
}

function renderMarketTab() {
  const { key, entry } = marketEntry();
  view.key = key;
  const label = REGION_LABELS[key] ?? key;
  const series = entry?.data ?? [];
  const name = series.length ? label : `${label}（暂无数据）`;
  renderHeatView(name, series, series.length ? null
    : `「${label}」没有数据：当前数据里没有位于该区域的院校。<br>区域归属在 <a href="help.html" target="_blank">说明</a> 里按省份划分。`);
  renderDataList('market-data-list', seriesRows(series), null);
}

function renderPlateTab() {
  const location = $('plate-province')?.value ?? 'all';
  const region = $('plate-region')?.value ?? 'east';
  const plate = $('plate-type')?.value ?? 'all';
  const { key, entry } = plateEntry();
  view.key = key;

  const parts = [];
  parts.push(location && location !== 'all' ? `${location}` : REGION_LABELS[region] ?? region);
  parts.push(plate === 'all' ? '全部板块' : PLATE_LABELS[plate] ?? plate);
  const series = entry?.data ?? [];
  const name = series.length ? parts.join(' · ') : `${parts.join(' · ')}（暂无数据）`;

  const hint = series.length ? null
    : `「${parts.join(' · ')}」没有数据。<br>
       当前数据里没有同时满足这个「所在地 + 板块」组合的院校。`
      + `<br>试试把「学校所在地」改成「全部省份」，或者换个板块。`;

  renderHeatView(name, series, hint);
  renderDataList('plate-data-list', seriesRows(series), null);
}

function renderStockTab() {
  const { key, school, province, item } = stockEntry();
  view.key = key;

  if (!school || !province) {
    view.series = [];
    chartController.clear();
    setEmptyState(true);
    resetInfoBar();
    setMajorOptions([], '__all__');
    renderDataList('stock-data-list', [], null);
    return;
  }

  if (!item) {
    view.series = [];
    chartController.clear();
    setEmptyState(true);
    resetInfoBar();
    setMajorOptions([], '__all__');
    renderDataList('stock-data-list', [], null);
    const name = $('currentName');
    if (name) name.textContent = `${school}（${province}招生）· 未找到数据`;
    return;
  }

  const majors = listMajors(item);
  setMajorOptions(majors, view.major);
  if (view.major !== '__all__' && !majors.includes(view.major)) view.major = '__all__';

  const series = view.major === '__all__'
    ? item.series
    : buildMajorSeries(item.majors[view.major] ?? []);

  const name = view.major === '__all__' ? `${item.name}` : `${item.name} · ${view.major}`;
  const benchSeries = indexCache.benchmarks?.[`${item.province}|${item.plate}`]
    ?? indexCache.benchmarks?.[`${item.province}|all`]
    ?? [];
  const candles = renderRankView(name, series, { benchmark: benchSeries });

  const rows = candles.map((candle) => ({
    year: candle.year,
    text: formatNumber(candle.close),
    meta: `招生 ${formatNumber(candle.volume)}`,
    deletable: true,
  }));
  renderDataList('stock-data-list', rows.reverse(), (year) => handleDeleteYear(year));
}

function seriesRows(series) {
  return [...series]
    .sort((a, b) => b.year - a.year)
    .map((item) => ({
      year: item.year,
      text: formatNumber(item.close, 2),
      meta: `${Number.isFinite(item.percentile) ? `百分位 ${item.percentile.toFixed(2)}%` : ''}`
        + `${item.schools ? ` · ${item.schools} 校` : ''}`,
      deletable: false,
    }));
}

function renderActive() {
  updateStatusCount();
  if (view.tab === 'market') renderMarketTab();
  else if (view.tab === 'plate') renderPlateTab();
  else renderStockTab();
}

/* ============================ 交互 ============================ */

function readMaInputs() {
  const ids = ['ma1', 'ma2', 'ma3', 'ma4'];
  const values = ids.map((id) => {
    const raw = Number($(id)?.value);
    return Number.isFinite(raw) && raw >= 1 && raw <= 60 ? Math.floor(raw) : null;
  });
  return values.map((value, index) => value ?? DEFAULT_MA[index]);
}

function persistMa() {
  try {
    localStorage.setItem('gaokaoshun:ma', JSON.stringify(view.ma));
  } catch {
    // 忽略隐私模式下的写入失败
  }
}

function restoreMa() {
  try {
    const raw = localStorage.getItem('gaokaoshun:ma');
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length === 4) view.ma = parsed.map(Number);
  } catch {
    // 忽略
  }
  ['ma1', 'ma2', 'ma3', 'ma4'].forEach((id, index) => {
    const el = $(id);
    if (el) el.value = view.ma[index];
  });
}

function applyMa() {
  view.ma = readMaInputs();
  persistMa();
  renderActive();
}

async function handleDeleteYear(year) {
  if (!view.key) return;
  if (!window.confirm(`确定删除 ${year} 年的数据吗？`)) return;
  const removed = removeYear(state, view.key, year, view.major === '__all__' ? null : view.major);
  if (!removed) {
    toast('没有找到可删除的记录', 'err');
    return;
  }
  refreshIndices();
  renderActive();
  await persistState();
  toast(`已删除 ${year} 年数据`, 'ok');
}

function readNumberInput(id) {
  const raw = $(id)?.value;
  if (raw === undefined || raw === '') return null;
  const num = Number(raw);
  return Number.isFinite(num) ? num : null;
}

async function handleAddMajor() {
  const { school, province, item } = stockEntry();
  if (!school || !province) {
    toast('请先填写院校名称与招生省份', 'err');
    return;
  }

  const existingLocation = item?.location && item.location !== '待定' ? item.location : null;
  const location = existingLocation || window.prompt('该院校所在省份/城市（用于板块聚合，如：天津、浙江）', '') || '待定';

  const result = addMajorRecord(state, {
    school,
    province,
    plate: $('stock-plate')?.value ?? 'shuangfei',
    location,
    major: $('stock-major')?.value.trim() ?? '',
    year: readNumberInput('stock-year'),
    highScore: readNumberInput('stock-highScore'),
    lowScore: readNumberInput('stock-lowScore'),
    highRank: readNumberInput('stock-highRank'),
    lowRank: readNumberInput('stock-lowRank'),
    volume: readNumberInput('stock-volume'),
  });

  if (!result.ok) {
    toast(result.message, 'err');
    return;
  }

  ['stock-major', 'stock-year', 'stock-highScore', 'stock-lowScore', 'stock-highRank', 'stock-lowRank', 'stock-volume']
    .forEach((id) => { const el = $(id); if (el) el.value = ''; });

  state.loaded = true;
  refreshIndices();
  refreshLocationOptions();
  refreshSchoolOptions();
  renderActive();
  await persistState();
  toast('已保存该条记录', 'ok');
}

/* ============================ 数据加载 ============================ */

const nextTick = () => new Promise((resolve) => setTimeout(resolve, 0));

async function handleFolderChange(event) {
  const input = event.target;
  const files = [...(input.files ?? [])];
  input.value = '';
  if (files.length === 0) return;

  const targets = files.filter((file) => ACCEPTED_EXT.test(file.name));
  if (targets.length === 0) {
    toast('所选文件夹里没有 .xlsx / .xls / .csv 文件', 'err');
    return;
  }

  const started = performance.now();
  let done = 0;
  let succeeded = 0;
  let recordCount = 0;
  let candidateCount = 0;
  let segmentCount = 0;
  let convertedCount = 0;
  let skippedRows = 0;
  const skipped = [];
  const failed = [];

  setStatus(`正在解析 0/${targets.length} …`, '');
  setEmptyState(true);

  for (const file of targets) {
    const relPath = file.webkitRelativePath || file.name;
    try {
      const buffer = await file.arrayBuffer();
      const parsed = parseWorkbookFile({ name: file.name, relPath, buffer, XLSX: window.XLSX });

      const empty = parsed.records.length === 0
        && parsed.candidates.length === 0
        && (parsed.segments?.length ?? 0) === 0;
      if (empty) {
        skipped.push(`${file.name}：${parsed.warnings[0] ?? '没有有效行'}`);
      } else {
        const applied = applyParsedFile(state, parsed);
        recordCount += applied.added;
        candidateCount += applied.candidates;
        segmentCount += applied.segments ?? 0;
        convertedCount += applied.converted ?? 0;
        skippedRows += applied.skipped ?? 0;
        if (applied.added > 0 || applied.candidates > 0 || applied.segments > 0) succeeded += 1;
      }
    } catch (error) {
      failed.push(`${file.name}：${error?.message ?? '解析异常'}`);
    }

    done += 1;
    if (done % 4 === 0 || done === targets.length) {
      setStatus(`正在解析 ${done}/${targets.length} …`, '');
      await nextTick();
    }
  }

  if (Object.keys(state.schools).length === 0 && candidateCount === 0 && segmentCount === 0) {
    setStatus('未能从所选文件夹中读到有效数据', 'warn');
    setEmptyState(true);
    toast(`没有读到有效数据${skipped.length ? `：${skipped[0]}` : ''}`, 'err', 6000);
    reportProblems(skipped, failed, '跳过', '失败');
    return;
  }

  state.loaded = true;
  refreshIndices();
  refreshLocationOptions();
  refreshSchoolOptions();
  await persistState();
  renderActive();

  const elapsed = ((performance.now() - started) / 1000).toFixed(1);
  const schools = Object.keys(state.schools).length;
  setStatus(`已加载 ${succeeded} 个文件 · 用时 ${elapsed}s`, 'ok');

  if (schools === 0 && segmentCount > 0) {
    toast(`已载入 ${segmentCount} 份一分一段表，现在可以加载分数数据了`, 'ok', 5000);
    reportProblems(skipped, failed, '跳过', '失败');
    return;
  }

  const parts = [`${succeeded} 个文件`, `${recordCount} 条记录`, `${schools} 所院校`];
  if (candidateCount > 0) parts.push(`${candidateCount} 条考生数`);
  if (segmentCount > 0) parts.push(`${segmentCount} 份一分一段表`);
  toast(`加载完成：${parts.join(' / ')}`, 'ok', 4200);

  if (convertedCount > 0) {
    toast(`${convertedCount} 个位次由「一分一段表」从分数换算得到`, 'ok', 5000);
  }
  if (skippedRows > 0) {
    toast(`${skippedRows} 行既没有位次、也无法用分数换算，已跳过（先加载一分一段表再导入可解决）`, 'err', 8000);
  }

  const missing = countMissingCandidates(state);
  if (missing > 0) {
    toast(`${missing} 个「院校-年份」没有考生数，百分位按 7 万估算（可在模板里的「考生数」表补齐）`, 'err', 8000);
  }
  reportProblems(skipped, failed, '跳过', '失败');
}

function reportProblems(skipped, failed, skipLabel, failLabel) {
  if (skipped.length) console.warn(`[高考顺] ${skipLabel} ${skipped.length} 个文件`, skipped);
  if (failed.length) console.error(`[高考顺] ${failLabel} ${failed.length} 个文件`, failed);
  const total = skipped.length + failed.length;
  if (total === 0) return;
  const first = [...skipped, ...failed][0];
  toast(`另有 ${total} 个文件未导入，首个原因：${first}（详见控制台）`, 'err', 7000);
}

async function persistState() {
  const result = await saveSnapshot(serialize(state));
  if (!result.ok) console.warn('[高考顺] 本地缓存写入失败', result.reason);
}

/* ============================ 导出 ============================ */

function buildVerticalRows(item) {
  const schoolName = item.school;
  const rows = [];
  for (const [major, records] of Object.entries(item.majors)) {
    for (const record of records) {
      rows.push([
        schoolName, major, record.year,
        record.highScore ?? '', record.lowScore ?? '',
        record.highRank, record.lowRank, record.volume ?? 0,
      ]);
    }
  }
  rows.sort((a, b) => String(a[1]).localeCompare(String(b[1]), 'zh-CN') || a[2] - b[2]);
  return rows;
}

const VERTICAL_HEADER = ['院校名称', '专业名称', '年份', '最高分', '最低分', '最高位次', '最低位次', '录取人数'];

function buildHorizontalRow(item) {
  const sorted = [...item.series].sort((a, b) => a.year - b.year);
  return {
    header: ['院校名称', ...sorted.map((row) => `${row.year}年位次`)],
    row: [item.school, ...sorted.map((row) => row.close)],
  };
}

function appendSheet(workbook, name, header, rows, widths) {
  const sheet = XLSX.utils.aoa_to_sheet([header, ...rows]);
  sheet['!cols'] = widths.map((wch) => ({ wch }));
  XLSX.utils.book_append_sheet(workbook, sheet, name);
}

function uniqueSheetName(workbook, base) {
  const cleaned = safeFilename(base).replace(/[[\]:*?/\\]/g, '_').slice(0, 28) || 'Sheet';
  let name = cleaned;
  let n = 2;
  while (workbook.SheetNames.includes(name)) {
    name = `${cleaned.slice(0, 26)}(${n})`;
    n += 1;
  }
  return name;
}

function exportStockData() {
  const { item } = stockEntry();
  if (!item) {
    toast('请先加载个股', 'err');
    closeModal('exportModal');
    return;
  }
  const format = $('exportFormat')?.value ?? 'vertical';
  const workbook = XLSX.utils.book_new();

  if (format === 'vertical') {
    const rows = buildVerticalRows(item);
    if (rows.length === 0) {
      toast('该院校没有专业明细', 'err');
      closeModal('exportModal');
      return;
    }
    appendSheet(workbook, '专业数据', VERTICAL_HEADER, rows, [18, 28, 8, 10, 10, 12, 12, 10]);
  } else {
    const { header, row } = buildHorizontalRow(item);
    appendSheet(workbook, '整体位次', header, [row], header.map((_, index) => (index === 0 ? 20 : 12)));
  }

  const suffix = format === 'vertical' ? '专业' : '整体';
  XLSX.writeFile(workbook, `${safeFilename(item.school)}_${suffix}.xlsx`);
  closeModal('exportModal');
  toast('已导出', 'ok');
}

function exportAllData() {
  const schools = Object.values(state.schools);
  if (schools.length === 0) {
    toast('没有可导出的数据', 'err');
    return;
  }

  const workbook = XLSX.utils.book_new();
  let sheetCount = 0;

  for (const item of schools) {
    const rows = buildVerticalRows(item);
    if (rows.length === 0) continue;
    const name = uniqueSheetName(workbook, item.school);
    appendSheet(workbook, name, VERTICAL_HEADER, rows, [18, 28, 8, 10, 10, 12, 12, 10]);
    sheetCount += 1;
  }

  if (sheetCount === 0) {
    toast('没有可导出的专业数据', 'err');
    return;
  }

  const stamp = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(workbook, `高考顺_全部数据_${stamp}.xlsx`);
  toast(`已导出 ${sheetCount} 所院校（每校一个工作表）`, 'ok');
}

/* ============================ 模板 ============================ */

const TEMPLATE_SCORE_HEADER = [
  '年份', '招生省份', '院校名称', '院校所在地', '板块', '专业名称',
  '最高分', '最低分', '最高位次', '最低位次', '录取人数',
];

const TEMPLATE_CANDIDATE_HEADER = ['年份', '省份', '考生数'];

const TEMPLATE_GUIDE = [
  ['使用说明'],
  [''],
  ['1. 只需要一个「分数数据」表：一行 = 一所学校的一个专业在某一年的录取情况。'],
  ['2. 必填列：年份、招生省份、院校名称、专业名称、最低位次（最高位次缺失时自动用最低位次补）。'],
  ['3. 可选列：院校所在地（缺省取文件所在文件夹名）、板块（92/双一流/新型研究型/S11/双非）、'],
  ['   最高分、最低分、录取人数。'],
  ['4. 「考生数」表用来把位次换算成百分位，跨省才能比较；缺省时按 7 万估算并在界面提示。'],
  ['5. 一个文件可以放任意多行、任意多学校；也兼容旧格式（一个文件一所学校一年，元数据写在文件名里）。'],
  [''],
  ['板块取值：92 / doublefirst / newresearch / s11 / shuangfei，也可以直接写中文：'],
  ['         92 / 双一流 / 新型研究型 / 中外合办 / 双非'],
  [''],
  ['示例（可直接删除）：'],
  ['2025  天津  天津工业大学  天津  doublefirst  计算机科学与技术  630  610  7000  11000  10'],
];

function downloadTemplate() {
  if (!window.XLSX) {
    toast('表格库还没加载好，请稍后重试', 'err');
    return;
  }
  const workbook = XLSX.utils.book_new();

  const scoreSheet = XLSX.utils.aoa_to_sheet([
    TEMPLATE_SCORE_HEADER,
    ['2025', '天津', '天津工业大学', '天津', 'doublefirst', '计算机科学与技术', 630, 610, 7000, 11000, 10],
    ['2025', '天津', '天津工业大学', '天津', 'doublefirst', '材料科学与工程', 615, 595, 14000, 19000, 30],
    ['2024', '天津', '天津工业大学', '天津', 'doublefirst', '计算机科学与技术', 620, 600, 8000, 12000, 10],
  ]);
  scoreSheet['!cols'] = [8, 10, 18, 12, 14, 26, 10, 10, 12, 12, 10].map((wch) => ({ wch }));
  XLSX.utils.book_append_sheet(workbook, scoreSheet, '分数数据');

  const candidateSheet = XLSX.utils.aoa_to_sheet([
    TEMPLATE_CANDIDATE_HEADER,
    ['2024', '天津', 70800],
    ['2025', '天津', 74000],
  ]);
  candidateSheet['!cols'] = [8, 10, 12].map((wch) => ({ wch }));
  XLSX.utils.book_append_sheet(workbook, candidateSheet, '考生数');

  const guideSheet = XLSX.utils.aoa_to_sheet(TEMPLATE_GUIDE);
  guideSheet['!cols'] = [{ wch: 100 }];
  XLSX.utils.book_append_sheet(workbook, guideSheet, '填写说明');

  XLSX.writeFile(workbook, '高考顺_数据模板.xlsx');
  toast('模板已下载：填好「分数数据」表即可直接加载', 'ok');
}

/* ============================ 启动 ============================ */

function bindEvents() {
  $('btnLoad')?.addEventListener('click', () => $('folderInput')?.click());
  $('folderInput')?.addEventListener('change', handleFolderChange);
  $('btnTemplate')?.addEventListener('click', downloadTemplate);
  $('btnExportAll')?.addEventListener('click', exportAllData);
  $('btnExportStock')?.addEventListener('click', () => {
    if (!stockEntry().item) { toast('请先加载个股', 'err'); return; }
    openModal('exportModal');
  });
  $('btnExportCancel')?.addEventListener('click', () => closeModal('exportModal'));
  $('btnExportConfirm')?.addEventListener('click', exportStockData);
  $('btnLoadStock')?.addEventListener('click', () => {
    view.major = '__all__';
    renderStockTab();
  });
  $('btnAddMajor')?.addEventListener('click', handleAddMajor);

  $('btnClear')?.addEventListener('click', async () => {
    if (!window.confirm('清空浏览器本地缓存的数据？（不会删除你磁盘上的 Excel 文件）')) return;
    await clearSnapshot();
    state = createState();
    refreshIndices();
    refreshLocationOptions();
    refreshSchoolOptions();
    renderActive();
    setEmptyState(true);
    setStatus('已清空本地缓存，请重新加载文件夹', 'warn');
    toast('已清空', 'ok');
  });

  ['marketSelect'].forEach((id) => $(id)?.addEventListener('change', renderMarketTab));
  ['plate-province', 'plate-region', 'plate-type'].forEach((id) => $(id)?.addEventListener('change', renderPlateTab));
  $('majorSelect')?.addEventListener('change', (event) => {
    view.major = event.target.value;
    renderStockTab();
  });

  ['ma1', 'ma2', 'ma3', 'ma4'].forEach((id) => {
    let timer = null;
    $(id)?.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(applyMa, 350);
    });
    $(id)?.addEventListener('change', applyMa);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeModal('exportModal');
  });

  document.querySelectorAll('.modal-overlay').forEach((overlay) => {
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) closeModal(overlay.id);
    });
  });

  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => chartController?.resize(), 120);
  });

  bindTabs((tab) => {
    view.tab = tab;
    renderActive();
  });
}

async function boot() {
  const [hasEcharts, hasXlsx] = await Promise.all([
    ensureLibrary(LIBRARIES.echarts),
    ensureLibrary(LIBRARIES.XLSX),
  ]);

  if (!hasEcharts || !hasXlsx) {
    setStatus('图表库加载失败，请检查网络后刷新页面', 'warn');
    toast('无法加载 ECharts / SheetJS：可把库文件放到 vendor/ 目录以离线使用', 'err', 8000);
    return;
  }

  chartController = createChartController(window.echarts, {
    kline: $('klineChart'),
    volume: $('volumeChart'),
    spread: $('spreadChart'),
  });

  restoreMa();
  bindEvents();

  // 先把大盘下拉补全为配置里的区域（HTML 已内置，这里保证顺序一致）
  fillSelect('marketSelect', Object.keys(REGIONS).map((key) => ({ value: key, label: REGION_LABELS[key] })), 'east');

  const raw = await loadSnapshot();
  const restored = deserialize(raw);

  if (restored && Object.keys(restored.schools).length > 0) {
    state = restored;
    refreshIndices();
    refreshLocationOptions();
    refreshSchoolOptions();
    renderActive();
    const when = state.savedAt ? new Date(state.savedAt).toLocaleString('zh-CN') : '';
    const schools = Object.keys(state.schools).length;
    setStatus(`已从本地缓存恢复 ${schools} 所院校${when ? `（${when}）` : ''}`, 'ok');
  } else {
    setEmptyState(true);
    setStatus('请点击「📁 加载文件夹」导入 Excel / CSV 数据', '');
  }

  updateStatusCount();
}

boot().catch((error) => {
  console.error('[高考顺] 启动失败', error);
  setStatus(`启动失败：${error?.message ?? error}`, 'warn');
  toast(`启动失败：${error?.message ?? error}`, 'err', 8000);
});
