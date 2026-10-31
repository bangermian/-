#!/usr/bin/env node
/**
 * 直连抓取专业分数线（不用浏览器）
 *
 * 为什么快：掌上高考的分数线接口 api.zjzw.cn/web/api/ 其实**不校验签名**，
 * page 参数直接可翻页。所以不需要打开页面、不需要点分页器、不需要等渲染，
 * 一个请求 80ms，4 路并发下 200 所 × 6 年约 5 分钟（浏览器方案约 2 小时）。
 *
 * 用法：
 *   node tools/crawl.mjs --province 天津 --from 1 --to 200
 *   node tools/crawl.mjs --province 天津 --from 1 --to 50 --years 2024,2025 --concurrency 6
 *   node tools/crawl.mjs --province 天津 --from 1 --to 200 --dry-run
 *
 * 说明：
 *   · 招生计划（人数）走的是加密接口（1071 接口加密请求缺失），这里拿不到，
 *     仍然用插件的「一键抓取」补；本工具只抓分数线与院校线。
 *   · 按「专业大类」聚合：专业名只取第一个「（」之前，同大类合并，
 *     人数相加、最低分取最低、最低位次取最大（最差）——和插件口径一致。
 *   · 支持断点续跑：进度写在 .cache/ 下，中断后重跑会自动跳过已完成的任务。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CACHE_DIR = path.join(ROOT, '.cache');

const API = 'https://api.zjzw.cn/web/api/';
const UA = 'Mozilla/5.0 (compatible; Baiduspider-render/2.0; +http://www.baidu.com/search/spider.html)';
const PAGE_SIZE = 10;

const DEFAULT_YEARS = [2026, 2025, 2024, 2023, 2022, 2021];
const CSV_HEAD = ['年份', '招生省份', '院校名称', '院校所在地', '板块', '专业名称', '最高分', '最低分', '最高位次', '最低位次', '录取人数'];

const PROVINCE_IDS = {
  北京: 11, 天津: 12, 河北: 13, 山西: 14, 内蒙古: 15,
  辽宁: 21, 吉林: 22, 黑龙江: 23,
  上海: 31, 江苏: 32, 浙江: 33, 安徽: 34, 福建: 35, 江西: 36, 山东: 37,
  河南: 41, 湖北: 42, 湖南: 43, 广东: 44, 广西: 45, 海南: 46,
  重庆: 50, 四川: 51, 贵州: 52, 云南: 53, 西藏: 54,
  陕西: 61, 甘肃: 62, 青海: 63, 宁夏: 64, 新疆: 65,
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ */
/* 参数                                                                */
/* ------------------------------------------------------------------ */

export function parseArgs(argv) {
  const out = {
    province: '天津',
    from: 1,
    to: 200,
    years: [...DEFAULT_YEARS],
    concurrency: 4,
    out: '',
    dryRun: false,
    resume: true,
    quiet: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => argv[i + 1];
    if (a === '--province' || a === '-p') out.province = next();
    else if (a === '--from') out.from = Number(next());
    else if (a === '--to') out.to = Number(next());
    else if (a === '--years' || a === '-y') out.years = String(next()).split(',').map((s) => Number(s.trim())).filter(Boolean);
    else if (a === '--concurrency' || a === '-c') out.concurrency = Number(next());
    else if (a === '--out' || a === '-o') out.out = next();
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--no-resume') out.resume = false;
    else if (a === '--quiet' || a === '-q') out.quiet = true;
    else if (a === '--help' || a === '-h') out.help = true;
    i += 1;
  }
  if (!Number.isFinite(out.from) || out.from < 1) out.from = 1;
  if (!Number.isFinite(out.to) || out.to < out.from) out.to = out.from;
  if (!Number.isFinite(out.concurrency) || out.concurrency < 1) out.concurrency = 1;
  out.concurrency = Math.min(8, out.concurrency);
  if (!out.years.length) out.years = [...DEFAULT_YEARS];
  return out;
}

/* ------------------------------------------------------------------ */
/* CSV                                                                 */
/* ------------------------------------------------------------------ */

/** 极简 CSV 解析（支持引号包裹与字段内逗号） */
export function parseCsv(text) {
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
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => String(c).trim() !== ''));
}

export function csvCell(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csvRow(values) {
  return values.map(csvCell).join(',');
}

/* ------------------------------------------------------------------ */
/* 数据整理                                                            */
/* ------------------------------------------------------------------ */

const num = (v) => {
  if (v == null || v === '-' || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const baseName = (s) => String(s || '').split(/[（(]/)[0].trim() || '（未命名专业）';

/**
 * 把一个「校×年」的原始条目聚合成大类。
 * 人数相加、最低分取最低（最好考的线）、最低位次取最大（最差的名次）。
 */
export function aggregateMajors(items) {
  const groups = new Map();
  for (const it of items ?? []) {
    const name = baseName(it.sp_name);
    const min = num(it.min);
    const max = num(it.max);
    const rank = num(it.min_section);
    const lq = num(it.lq_num);

    let g = groups.get(name);
    if (!g) {
      g = { major: name, minScore: null, maxScore: null, minRank: null, volume: null, hasVolume: false, variants: 0 };
      groups.set(name, g);
    }
    g.variants += 1;
    if (min != null) g.minScore = g.minScore == null ? min : Math.min(g.minScore, min);
    if (max != null) g.maxScore = g.maxScore == null ? max : Math.max(g.maxScore, max);
    if (rank != null) g.minRank = g.minRank == null ? rank : Math.max(g.minRank, rank);
    if (lq != null) { g.volume = (g.volume || 0) + lq; g.hasVolume = true; }
  }
  return [...groups.values()];
}

/* ------------------------------------------------------------------ */
/* 请求层：并发 + 自适应退避                                            */
/* ------------------------------------------------------------------ */

export function createLimiter({ concurrency, minGapMs = 40 }) {
  const state = {
    concurrency,
    baseConcurrency: concurrency,
    active: 0,
    queue: [],
    gap: minGapMs,
    lastAt: 0,
    okStreak: 0,
    throttleCount: 0,
    stats: { requests: 0, throttled: 0, errors: 0 },
  };

  const pump = () => {
    while (state.active < state.concurrency && state.queue.length) {
      const { fn, resolve, reject } = state.queue.shift();
      state.active += 1;
      (async () => {
        try {
          const wait = state.lastAt + state.gap - Date.now();
          if (wait > 0) await sleep(wait);
          state.lastAt = Date.now();
          resolve(await fn());
        } catch (e) {
          reject(e);
        } finally {
          state.active -= 1;
          pump();
        }
      })();
    }
  };

  const run = (fn) => new Promise((resolve, reject) => {
    state.queue.push({ fn, resolve, reject });
    pump();
  });

  /**
   * 被限流：先拉长间隔；只有反复被限流才降并发。
   * 而且一旦连续成功够多，就把并发和间隔**逐步恢复**——
   * 之前"一降不返"的写法会让后面 100 多个任务都跑在低速档上。
   */
  state.throttle = () => {
    state.stats.throttled += 1;
    state.throttleCount += 1;
    state.okStreak = 0;
    state.gap = Math.min(1200, Math.round(state.gap * 1.6) + 20);
    if (state.throttleCount >= 3 && state.concurrency > 1) {
      state.concurrency -= 1;
      state.throttleCount = 0;
    }
  };

  /** 每次成功都记一笔，连续成功到阈值就恢复一档 */
  state.success = () => {
    state.okStreak += 1;
    if (state.okStreak >= 150) {
      state.okStreak = 0;
      if (state.gap > minGapMs) state.gap = Math.max(minGapMs, Math.round(state.gap * 0.7));
      if (state.concurrency < state.baseConcurrency) state.concurrency += 1;
    }
  };

  state.reset = () => {
    state.gap = minGapMs;
    state.concurrency = state.baseConcurrency;
    state.okStreak = 0;
    state.throttleCount = 0;
  };

  return { run, state };
}

async function apiGet(limiter, params, { retries = 4 } = {}) {
  const q = new URLSearchParams(params).toString();
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    const res = await limiter.run(async () => {
      limiter.state.stats.requests += 1;
      const resp = await fetch(`${API}?${q}`, { headers: { 'User-Agent': UA } });
      const text = await resp.text();
      try { return JSON.parse(text); } catch { return { code: 'HTTP', message: text.slice(0, 80) }; }
    });

    if (res?.code === '0000') {
      limiter.state.success();
      return { ok: true, data: res.data ?? {} };
    }

    const msg = String(res?.message ?? '');
    if (/请求过多|频繁|限流/.test(msg)) {
      limiter.state.throttle();
      await sleep(600 * attempt * attempt);
      continue;
    }
    limiter.state.stats.errors += 1;
    // 1062/1071/1064 这类是确定性的接口错误，重试无意义
    if (['1062', '1064', '1071'].includes(String(res?.code))) {
      return { ok: false, error: `code ${res.code}: ${msg}` };
    }
    await sleep(300 * attempt);
  }
  return { ok: false, error: 'retry exhausted' };
}

/** 抓一个「校×年」的全部专业（自动翻完所有页） */
async function fetchMajors(limiter, { schoolId, provinceId, year }) {
  const common = {
    local_province_id: String(provinceId),
    school_id: String(schoolId),
    size: String(PAGE_SIZE),
    uri: 'apidata/api/gk/score/special',
    year: String(year),
  };

  const first = await apiGet(limiter, { ...common, page: '1' });
  if (!first.ok) return { ok: false, error: first.error, items: [] };

  const items = [...(first.data.item ?? [])];
  const total = Number(first.data.numFound) || items.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  if (pages > 1) {
    const rest = await Promise.all(
      Array.from({ length: pages - 1 }, (_, k) => apiGet(limiter, { ...common, page: String(k + 2) })),
    );
    for (const r of rest) if (r.ok) items.push(...(r.data.item ?? []));
  }
  return { ok: true, items, pages, total };
}

/** 抓院校线（批次/类型/最低分/最低位次） */
async function fetchSchoolLines(limiter, { schoolId, provinceId, year }) {
  const r = await apiGet(limiter, {
    local_province_id: String(provinceId),
    school_id: String(schoolId),
    size: String(PAGE_SIZE),
    uri: 'apidata/api/gk/score/province',
    year: String(year),
    page: '1',
  });
  if (!r.ok) return [];
  return r.data.item ?? [];
}

/* ------------------------------------------------------------------ */
/* 主流程                                                              */
/* ------------------------------------------------------------------ */

function loadSchools() {
  const csvPath = path.join(ROOT, 'data', '软科排名.csv');
  const rows = parseCsv(fs.readFileSync(csvPath, 'utf8'));
  const head = rows.shift();
  const idx = (name) => head.indexOf(name);
  const iRank = idx('排名');
  const iId = idx('学校ID');
  const iName = idx('学校名称');
  const iLoc = idx('所在省份');
  const iPlate = idx('板块');
  return rows.map((r) => ({
    rank: Number(r[iRank]) || 0,
    id: String(r[iId]).trim(),
    name: String(r[iName]).trim(),
    location: String(r[iLoc] ?? '').trim(),
    plate: String(r[iPlate] ?? '').trim(),
  })).filter((s) => s.id && s.name);
}

function loadProgress(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return { done: {} }; }
}

function saveProgress(file, progress) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(progress), 'utf8');
}

export async function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  if (opts.help) {
    console.log(`用法: node tools/crawl.mjs --province 天津 --from 1 --to 200 [--years 2026,2025] [--concurrency 4] [--out 文件] [--dry-run] [--no-resume]`);
    return 0;
  }

  const provinceId = PROVINCE_IDS[opts.province];
  if (!provinceId) {
    console.error(`✗ 不认识的省份「${opts.province}」。可选：${Object.keys(PROVINCE_IDS).join('、')}`);
    return 2;
  }

  const all = loadSchools();
  const picked = all.filter((s) => s.rank >= opts.from && s.rank <= opts.to).sort((a, b) => a.rank - b.rank);
  if (!picked.length) {
    console.error(`✗ 第 ${opts.from}–${opts.to} 名范围内没有学校（榜单共 ${all.length} 所）`);
    return 2;
  }

  const tasks = [];
  for (const s of picked) for (const y of opts.years) tasks.push({ school: s, year: y });

  const outFile = opts.out || path.join(ROOT, 'out', `专业分数线_${opts.province}_${opts.from}-${opts.to}.csv`);
  const progressFile = path.join(CACHE_DIR, `crawl-${opts.province}-${opts.from}-${opts.to}.json`);

  console.log(`省份 ${opts.province}（id ${provinceId}）· 学校 ${picked.length} 所 · 年份 ${opts.years.join('、')}`);
  console.log(`任务 ${tasks.length} 个「校×年」· 并发 ${opts.concurrency} · 输出 ${path.relative(ROOT, outFile)}`);

  if (opts.dryRun) {
    console.log('（dry-run：不实际请求，只打印计划）');
    picked.slice(0, 10).forEach((s) => console.log(`  ${s.rank}. ${s.name}（${s.id}）${s.location}`));
    if (picked.length > 10) console.log(`  … 其余 ${picked.length - 10} 所`);
    return 0;
  }

  const progress = opts.resume ? loadProgress(progressFile) : { done: {} };
  const todo = tasks.filter((t) => !progress.done[`${t.school.id}|${t.year}`]);
  const skipped = tasks.length - todo.length;
  if (skipped) console.log(`断点续跑：跳过已完成 ${skipped} 个任务`);

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const needHeader = !fs.existsSync(outFile) || fs.statSync(outFile).size === 0;
  const stream = fs.createWriteStream(outFile, { flags: 'a' });
  if (needHeader) stream.write(`${csvRow(CSV_HEAD)}\n`);

  const limiter = createLimiter({ concurrency: opts.concurrency });
  const t0 = Date.now();
  let finished = 0;
  let rowsWritten = 0;
  let failed = 0;
  const schoolLines = [];

  const concurrency = Math.min(opts.concurrency, todo.length) || 1;
  let cursor = 0;

  const worker = async () => {
    while (cursor < todo.length) {
      const task = todo[cursor];
      cursor += 1;
      const { school, year } = task;
      const key = `${school.id}|${year}`;

      const [majors, lines] = await Promise.all([
        fetchMajors(limiter, { schoolId: school.id, provinceId, year }),
        fetchSchoolLines(limiter, { schoolId: school.id, provinceId, year }),
      ]);

      if (!majors.ok) {
        failed += 1;
        if (!opts.quiet) console.log(`  ✗ ${school.name} ${year}：${majors.error}`);
        continue;
      }

      const agg = aggregateMajors(majors.items);
      let lines2 = '';
      for (const g of agg) {
        lines2 += `${csvRow([year, opts.province, school.name, school.location, school.plate,
          g.major, g.maxScore ?? '', g.minScore ?? '', '', g.minRank ?? '', g.volume ?? ''])}\n`;
        rowsWritten += 1;
      }
      if (lines2) stream.write(lines2);

      for (const l of lines) {
        schoolLines.push({
          year, school: school.name, location: school.location, plate: school.plate,
          batch: l.local_batch_name || '', type: l.zslx_name || '',
          minScore: num(l.min), minRank: num(l.min_section),
        });
      }

      progress.done[key] = { rows: agg.length, raw: majors.items.length, at: Date.now() };
      finished += 1;

      if (finished % 20 === 0 || finished === todo.length) {
        saveProgress(progressFile, progress);
        const elapsed = (Date.now() - t0) / 1000;
        const rate = finished / elapsed;
        const eta = rate > 0 ? Math.round((todo.length - finished) / rate) : 0;
        console.log(`  ${finished}/${todo.length} 所次 · ${rowsWritten} 行 · ${rate.toFixed(1)}/秒 · 剩余约 ${eta} 秒`);
      }
    }
  };

  await Promise.all(Array.from({ length: concurrency }, worker));
  await new Promise((r) => stream.end(r));
  saveProgress(progressFile, progress);

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n完成：${finished} 个「校×年」，${rowsWritten} 行，失败 ${failed} 个，耗时 ${elapsed}s`);
  console.log(`请求 ${limiter.state.stats.requests} 次（被限流 ${limiter.state.stats.throttled} 次）`);
  console.log(`输出：${outFile}`);

  if (schoolLines.length) {
    const sFile = outFile.replace(/\.csv$/i, '_院校线.csv');
    const sHead = '年份,招生省份,院校名称,院校所在地,板块,批次,招生类型,最低分,最低位次';
    const body = schoolLines.map((l) => csvRow([l.year, opts.province, l.school, l.location, l.plate, l.batch, l.type, l.minScore ?? '', l.minRank ?? '']));
    fs.writeFileSync(sFile, `${sHead}\n${body.join('\n')}\n`, 'utf8');
    console.log(`院校线：${sFile}（${schoolLines.length} 行）`);
  }

  return failed === 0 ? 0 : 1;
}

// 工作区可能是 junction（C: 指向 G:），argv[1] 与 import.meta.url 的字面路径会对不上，
// 必须用 realpath 比较，否则脚本"静默不执行"。
const isMain = (() => {
  if (!process.argv[1]) return false;
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();
if (isMain) {
  main().then((code) => process.exit(code)).catch((e) => {
    console.error('✗ 抓取失败：', e?.message ?? e);
    process.exit(1);
  });
}
