/* 自动生成，请勿直接编辑 —— 改 tools/gaokao-exporter.user.js 后运行 node tools/build-extension.mjs */
// ==UserScript==
// @name         高考顺 · 数据采集器
// @namespace    gaokaoshun
// @version      3.0.0
// @description  ① 掌上高考批量抓院校分数线 ② 招生计划（招生人数）采集 ③ 任意网页表格抓取 → 导出高考顺模板 CSV
// @author       gaokaoshun
// @match        *://*/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

/*
 * 三条采集路径：
 *   A. 掌上高考批量：从页面自己发出的请求里拿到已签名的 URL，只替换 year 重放，逐校抓 6 年院校线。
 *   A2. 招生计划（招生人数）：
 *       招生计划接口的签名**只有第 1 页能重放**，第 2 页往后会返回 1010800。
 *       所以改走页面本身：用 ?year=YYYY 指定年份 → 合成点击页码让页面自己请求
 *       → 直接读渲染出来的表格，把「计划招生」列求和。
 *   B. 通用表格：扫描当前页所有 <table>，自动识别表头并把列映射到高考顺字段，
 *      支持「分数/位次」合并在一个单元格（如 670/1301）的写法。
 *      表头含「分数 + 累计人数」时自动判定为一分一段表，导出成换算表。
 */

(function () {
  'use strict';

  const IS_GK = /(^|\.)gaokao\.cn$/.test(location.hostname);

  /* ============================ 配置 ============================ */

  const SCHOOLS = [[1,140,"清华大学","北京","92"],[2,31,"北京大学","北京","92"],[3,114,"浙江大学","浙江","92"],[4,125,"上海交通大学","上海","92"],[5,132,"复旦大学","上海","92"],[6,111,"南京大学","江苏","92"],[7,66,"中国科学技术大学","安徽","92"],[8,42,"武汉大学","湖北","92"],[9,127,"华中科技大学","湖北","92"],[10,330,"西安交通大学","陕西","92"],[11,47,"北京航空航天大学","北京","92"],[12,104,"中山大学","广东","92"],[13,143,"北京理工大学","北京","92"],[14,573,"北京协和医学院","北京","doublefirst"],[15,34,"哈尔滨工业大学","黑龙江","92"],[16,99,"四川大学","四川","92"],[17,109,"东南大学","江苏","92"],[18,46,"中国人民大学","北京","92"],[19,73,"同济大学","上海","92"],[20,52,"北京师范大学","北京","92"],[21,60,"天津大学","天津","92"],[22,107,"西北工业大学","陕西","92"],[23,126,"山东大学","山东","92"],[24,59,"南开大学","天津","92"],[25,102,"厦门大学","福建","92"],[26,557,"中国农业大学","北京","92"],[27,122,"吉林大学","吉林","92"],[28,123,"中南大学","湖南","92"],[29,138,"大连理工大学","辽宁","92"],[30,44,"湖南大学","湖南","92"],[31,131,"华东师范大学","上海","92"],[32,105,"华南理工大学","广东","92"],[33,2941,"南方科技大学","广东","newresearch"],[34,661,"电子科技大学","四川","92"],[35,119,"重庆大学","重庆","92"],[36,144,"北京科技大学","北京","92"],[37,130,"上海财经大学","上海","92"],[38,584,"首都医科大学","北京","shuangfei"],[39,77,"南京航空航天大学","江苏","92"],[40,134,"东北大学","辽宁","92"],[41,112,"南京理工大学","江苏","92"],[42,97,"兰州大学","甘肃","92"],[43,960,"南方医科大学","广东","shuangfei"],[44,57,"西安电子科技大学","陕西","92"],[45,3151,"上海科技大学","上海","newresearch"],[46,38,"北京交通大学","北京","92"],[47,124,"哈尔滨工程大学","黑龙江","92"],[48,133,"华东理工大学","上海","92"],[49,142,"东北师范大学","吉林","92"],[50,566,"中央财经大学","北京","92"],[51,3202,"香港中文大学（深圳）","广东","shuangfei"],[52,118,"苏州大学","江苏","92"],[53,417,"华中农业大学","湖北","92"],[54,128,"武汉理工大学","湖北","92"],[55,832,"中国石油大学（北京）","北京","92"],[56,62,"郑州大学","河南","92"],[57,86,"江南大学","江苏","92"],[58,51,"西南交通大学","四川","92"],[59,168,"南京医科大学","江苏","doublefirst"],[60,113,"南京农业大学","江苏","92"],[61,121,"中国地质大学（武汉）","湖北","92"],[62,53,"对外经济贸易大学","北京","92"],[63,106,"暨南大学","广东","92"],[64,420,"华中师范大学","湖北","92"],[65,61,"中国海洋大学","山东","92"],[66,569,"中国政法大学","北京","92"],[67,115,"南京师范大学","江苏","92"],[68,110,"中国矿业大学","江苏","92"],[69,78,"天津医科大学","天津","92"],[70,230,"中国医科大学","辽宁","shuangfei"],[71,48,"北京邮电大学","北京","92"],[72,76,"上海大学","上海","92"],[73,49,"北京中医药大学","北京","92"],[74,242,"浙江工业大学","浙江","shuangfei"],[75,414,"中南财经政法大学","湖北","92"],[76,556,"北京化工大学","北京","92"],[77,116,"河海大学","江苏","92"],[78,334,"陕西师范大学","陕西","92"],[79,101,"西南财经大学","四川","92"],[80,934,"西南大学","重庆","92"],[81,120,"中国石油大学（华东）","山东","92"],[82,284,"深圳大学","广东","shuangfei"],[83,310,"上海中医药大学","上海","doublefirst"],[84,35,"云南大学","云南","92"],[85,37,"西北大学","陕西","92"],[86,332,"西北农林科技大学","陕西","92"],[87,30,"北京工业大学","北京","92"],[88,108,"南昌大学","江西","92"],[89,3039,"上海纽约大学","上海","s11"],[90,135,"东华大学","上海","92"],[91,830,"中国地质大学（北京）","北京","92"],[92,1006,"中国矿业大学（北京）","北京","92"],[93,1216,"宁波诺丁汉大学","浙江","s11"],[94,429,"哈尔滨医科大学","黑龙江","shuangfei"],[95,295,"广州医科大学","广东","doublefirst"],[96,103,"福州大学","福建","92"],[97,240,"宁波大学","浙江","doublefirst"],[98,63,"合肥工业大学","安徽","92"],[99,98,"华南师范大学","广东","92"],[100,45,"中央民族大学","北京","92"]];

  const PROVINCES = [
    ['北京', 11], ['天津', 12], ['河北', 13], ['山西', 14], ['内蒙古', 15],
    ['辽宁', 21], ['吉林', 22], ['黑龙江', 23], ['上海', 31], ['江苏', 32],
    ['浙江', 33], ['安徽', 34], ['福建', 35], ['江西', 36], ['山东', 37],
    ['河南', 41], ['湖北', 42], ['湖南', 43], ['广东', 44], ['广西', 45],
    ['海南', 46], ['重庆', 50], ['四川', 51], ['贵州', 52], ['云南', 53],
    ['西藏', 54], ['陕西', 61], ['甘肃', 62], ['青海', 63], ['宁夏', 64], ['新疆', 65],
  ];

  const YEARS = ['2026', '2025', '2024', '2023', '2022', '2021'];
  const STATE_KEY = 'gaokaoshun.state.v2';
  const MAP_KEY = 'gaokaoshun.mapping.v1';
  const CAPTURE_TIMEOUT = 15000;
  const BETWEEN_SCHOOLS = 2500;

  const FIELDS = [
    ['year', '年份'],
    ['province', '招生省份'],
    ['school', '院校名称'],
    ['location', '院校所在地'],
    ['major', '专业名称'],
    ['highScore', '最高分'],
    ['lowScore', '最低分'],
    ['highRank', '最高位次'],
    ['lowRank', '最低位次'],
    ['volume', '录取人数'],
    ['score', '分数(一分一段)'],
    ['cumulative', '累计人数'],
  ];

  const HEADER_RULES = [
    ['year', /^年份$|^年度$/],
    ['school', /院校|学校/],
    ['major', /专业/],
    ['province', /^省份$|招生省份|生源省/],
    ['location', /所在地|城市/],
    ['cumulative', /累计/],
    ['score', /^分数$|^成绩$/],
    ['highScore', /最高分/],
    ['lowScore', /最低分|投档线|^分数/],
    ['highRank', /最高位次|最高排名/],
    ['lowRank', /最低位次|位次|排名/],
    ['volume', /人数|计划/],
  ];

  /* ============================ 状态 ============================ */

  let state = loadState();
  state.rows = state.rows || {};
  state.queue = state.queue || [];
  state.index = state.index || 0;
  state.running = Boolean(state.running);
  state.province = state.province || '天津';
  state.log = state.log || [];
  state.scores = state.scores || [];      // 通用表格抓到的分数行
  state.segments = state.segments || [];  // 一分一段行
  // 招生计划采集：{ running, queue:[{id,year}], index, results:{ id:{name,years:{年份:{total,rows,majors}}} } }
  state.plan = state.plan || { running: false, queue: [], index: 0, results: {} };

  function loadState() {
    try { return JSON.parse(localStorage.getItem(STATE_KEY)) || {}; } catch { return {}; }
  }
  function saveState() {
    try { localStorage.setItem(STATE_KEY, JSON.stringify(state)); } catch { /* 配额满了也不影响抓取 */ }
  }
  function log(message) {
    state.log.unshift(`[${new Date().toLocaleTimeString('zh-CN')}] ${message}`);
    state.log = state.log.slice(0, 40);
    saveState();
    render();
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function waitFor(fn, timeout = 10000, interval = 300) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const v = fn();
      if (v) return v;
      await sleep(interval);
    }
    return null;
  }

  /* ============================ A. 掌上高考批量 ============================ */

  const schoolById = new Map(SCHOOLS.map((s) => [String(s[1]), s]));
  const currentSchoolId = () => (/\/school\/(\d+)/.exec(location.pathname) || [])[1] || null;

  function findSignedUrl(part) {
    const urls = performance.getEntriesByType('resource').map((r) => r.name)
      .filter((n) => n.includes(part) && n.includes('signsafe='));
    return urls.length ? urls[urls.length - 1] : null;
  }

  function clickHistoryTab() {
    const hit = [...document.querySelectorAll('a,div,span,li')]
      .find((el) => (el.textContent || '').trim() === '历年分数' && el.offsetParent !== null);
    if (hit) hit.click();
    return Boolean(hit);
  }

  async function fetchYears(signedUrl, years) {
    const params = Object.fromEntries(new URL(signedUrl).searchParams);
    const out = {};
    for (const year of years) {
      const url = signedUrl.replace(/year=\d{4}/, `year=${year}`);
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...params, year }),
        });
        const json = await res.json();
        const items = (json?.data?.item ?? []).filter((it) => it.min && it.min !== '-');
        if (json.code === 0 && items.length > 0) {
          const isRegular = (it) => /本科批/.test(it.local_batch_name || '')
            && !/提前|专项|民族|中外/.test(it.local_batch_name || '');
          const isCommon = (it) => (it.zslx_name || '').includes('普通');
          const hit = items.find((it) => isRegular(it) && isCommon(it))
            ?? items.find(isRegular) ?? items.find(isCommon) ?? items[0];
          out[year] = {
            min: hit.min ?? '',
            rank: hit.min_section && hit.min_section !== '-' ? hit.min_section : '',
            batch: hit.local_batch_name ?? '',
          };
        }
      } catch { /* 单年失败不影响其它年份 */ }
      await sleep(260);
    }
    return out;
  }

  async function collectCurrentSchool() {
    const id = currentSchoolId();
    if (!id) return { ok: false, reason: '当前不在院校页' };
    if (!document.querySelector('table.tb-normal')) {
      clickHistoryTab();
      await sleep(1500);
    }
    const signed = await waitFor(() => findSignedUrl('province_score') || findSignedUrl('special_score'), CAPTURE_TIMEOUT);
    if (!signed) return { ok: false, reason: '没捕获到分数线请求（页面可能没加载完）' };

    const years = await fetchYears(signed, YEARS);
    if (!Object.keys(years).length) return { ok: false, reason: '接口没返回任何年份数据' };

    const meta = schoolById.get(id);
    const name = meta ? meta[2] : (document.title.split('—')[0].trim() || `学校${id}`);
    state.rows[id] = {
      name,
      location: meta ? meta[3] : '',
      plate: meta ? meta[4] : 'shuangfei',
      years,
    };
    saveState();
    return { ok: true, name, years: Object.keys(years).length, ranks: Object.values(years).filter((y) => y.rank).length };
  }

  function applyProvince() {
    const entry = PROVINCES.find(([name]) => name === state.province);
    if (!entry) return;
    localStorage.setItem('localprovinceid', String(entry[1]));
    localStorage.setItem('localprovincename', entry[0]);
  }

  async function runIfBatch() {
    if (!state.running || !IS_GK) return;
    const id = currentSchoolId();
    if (!id || String(state.queue[state.index]) !== String(id)) return;

    const result = await collectCurrentSchool();
    log(result.ok ? `✓ ${result.name}：${result.years} 年（${result.ranks} 年有位次）` : `✗ ${id}：${result.reason}`);

    state.index += 1;
    saveState();
    if (state.index >= state.queue.length) {
      state.running = false;
      saveState();
      log(`全部完成：${Object.keys(state.rows).length} 所`);
      return;
    }
    await sleep(BETWEEN_SCHOOLS);
    location.href = `https://www.gaokao.cn/school/${state.queue[state.index]}/special`;
  }

  /* ============================ A2. 招生计划 ============================ */
  /*
   * 为什么不用重放接口：
   *   招生计划接口第 2 页往后的签名重放会被拒（code 1010800），只有第 1 页能重放。
   *   但页面自己是能发请求的——所以改成：
   *     1) 用 ?year=YYYY 直接指定年份（实测有效，下拉框也跟着变）
   *     2) 合成点击页码，让页面自己请求下一页
   *     3) 直接读渲染出来的表格，把「计划招生」列求和
   *   这样既不碰签名，也不依赖登录以外的任何权限。
   */

  const PLAN_YEARS = ['2026', '2025', '2024', '2023', '2022', '2021'];
  const PLAN_GAP = 1200;

  const planResults = () => state.plan.results || (state.plan.results = {});
  const planUrl = (id, year) => `https://www.gaokao.cn/school/${id}/sturule?year=${year}`;

  function startPlanQueue(ids, years) {
    const queue = [];
    for (const id of ids) for (const year of years) queue.push({ id: String(id), year: String(year) });
    state.plan.queue = queue;
    state.plan.index = 0;
    state.plan.running = true;
    saveState();
    gotoPlanTask();
  }

  function stopPlanQueue() {
    state.plan.running = false;
    saveState();
    render();
  }

  function gotoPlanTask() {
    const task = state.plan.queue[state.plan.index];
    if (!task) {
      state.plan.running = false;
      saveState();
      render();
      log(`招生计划采集完成：${Object.keys(planResults()).length} 所`);
      return;
    }
    location.href = planUrl(task.id, task.year);
  }

  const planTable = () => [...document.querySelectorAll('table')]
    .find((t) => (t.innerText || '').includes('专业名称'));

  /** 读当前页的「计划招生」列 */
  function readPlanPage() {
    const table = planTable();
    if (!table) return null;
    const headCells = [...(table.querySelector('tr')?.children || [])].map((td) => (td.innerText || '').trim());
    let col = headCells.findIndex((h) => /计划/.test(h));
    if (col < 0) col = 1;

    const trs = [...table.querySelectorAll('tr')].slice(1);
    let sum = 0;
    let parsed = 0;
    const majors = [];
    for (const tr of trs) {
      const cells = [...tr.children].map((td) => (td.innerText || '').replace(/\s+/g, ' ').trim());
      const num = parseInt(String(cells[col] ?? '').replace(/[^0-9]/g, ''), 10);
      if (!Number.isFinite(num)) continue;
      sum += num;
      parsed += 1;
      majors.push({ name: cells[0] || '', plan: num });
    }
    return { rows: trs.length, parsed, sum, majors };
  }

  /** 合成点击页码（实测能触发页面自己发请求） */
  function clickPlanPage(n) {
    const li = [...document.querySelectorAll('.ant-pagination-item')]
      .find((x) => (x.textContent || '').trim() === String(n));
    if (!li) return false;
    const a = li.querySelector('a') || li;
    a.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    a.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    return true;
  }

  const planRequestCount = () => performance.getEntriesByType('resource')
    .filter((r) => r.name.includes('special_plan')).length;

  /** 把当前页（含翻页）的所有专业计划加总 */
  async function collectPlanOnPage() {
    const ready = await waitFor(() => document.querySelectorAll('table tr').length > 1, 15000, 500);
    if (!ready) return { total: 0, rows: 0, majors: [] };

    let total = 0;
    let rows = 0;
    const majors = [];
    for (let page = 1; page <= 15; page += 1) {
      const data = readPlanPage();
      if (!data) break;
      total += data.sum;
      rows += data.parsed;
      majors.push(...data.majors);
      if (data.rows < 10) break;          // 不满一页 → 到底了
      const before = planRequestCount();
      if (!clickPlanPage(page + 1)) break;
      await sleep(1500);
      if (planRequestCount() <= before) break;
    }
    return { total, rows, majors };
  }

  /** 页面加载后，如果队头正是当前页，就采这一条并前进 */
  async function runPlanTaskIfNeeded() {
    if (!state.plan.running || !IS_GK) return;
    if (!/\/sturule/.test(location.pathname)) return;

    const task = state.plan.queue[state.plan.index];
    if (!task) { state.plan.running = false; saveState(); render(); return; }

    const id = currentSchoolId();
    const urlYear = new URL(location.href).searchParams.get('year');
    if (String(id) !== String(task.id) || String(urlYear) !== String(task.year)) return;

    const meta = schoolById.get(String(task.id));
    const name = meta ? meta[2] : `学校${task.id}`;
    log(`采集中：${name} ${task.year}`);

    const data = await collectPlanOnPage();
    const results = planResults();
    results[String(task.id)] = results[String(task.id)] || { name, years: {} };
    results[String(task.id)].years[task.year] = data;

    state.plan.index += 1;
    saveState();
    render();
    log(`${name} ${task.year}：${data.total} 人 / ${data.rows} 条`);

    await sleep(PLAN_GAP);
    gotoPlanTask();
  }

  function buildPlanCsv(detail = false) {
    const lines = [];
    if (detail) {
      lines.push('院校ID,院校名称,年份,专业名称,计划人数');
      for (const [id, item] of Object.entries(planResults())) {
        for (const year of Object.keys(item.years).sort()) {
          for (const m of item.years[year].majors || []) {
            lines.push([id, item.name, year, `"${String(m.name).replace(/"/g, '""')}"`, m.plan].join(','));
          }
        }
      }
    } else {
      lines.push('院校ID,院校名称,年份,计划人数,专业条数');
      for (const [id, item] of Object.entries(planResults())) {
        for (const year of Object.keys(item.years).sort()) {
          const y = item.years[year];
          lines.push([id, item.name, year, y.total, y.rows].join(','));
        }
      }
    }
    return lines.join('\r\n');
  }

  /* ============================ B. 通用表格 ============================ */

  function tableToMatrix(table) {
    const rows = [...table.querySelectorAll('tr')].map((tr) =>
      [...tr.querySelectorAll('th,td')].map((td) => (td.innerText || '').replace(/\s+/g, ' ').trim()));
    return rows.filter((r) => r.length > 0);
  }

  /** 表格"像数据表"的程度：行数 × 数字密度 */
  function scoreTable(matrix) {
    if (matrix.length < 2) return 0;
    const cols = Math.max(...matrix.map((r) => r.length));
    if (cols < 2) return 0;
    let numeric = 0;
    let total = 0;
    for (const row of matrix.slice(1)) {
      for (const cell of row) {
        total += 1;
        if (/^-?\d+(\.\d+)?$|^\d{3}\s*\/\s*\d+$/.test(cell)) numeric += 1;
      }
    }
    return matrix.length * (total ? numeric / total : 0);
  }

  function scanTables() {
    return [...document.querySelectorAll('table')]
      .map((el, index) => {
        const matrix = tableToMatrix(el);
        return { index, el, matrix, score: scoreTable(matrix) };
      })
      .filter((t) => t.matrix.length >= 2 && Math.max(...t.matrix.map((r) => r.length)) >= 2)
      .sort((a, b) => b.score - a.score);
  }

  function guessMapping(headerRow) {
    const map = {};
    for (const [field] of FIELDS) map[field] = -1;
    headerRow.forEach((text, index) => {
      if (!text) return;
      for (const [field, pattern] of HEADER_RULES) {
        if (map[field] === -1 && pattern.test(text)) { map[field] = index; return; }
      }
    });
    return map;
  }

  const MAPPING_CACHE = (() => {
    try { return JSON.parse(localStorage.getItem(MAP_KEY)) || {}; } catch { return {}; }
  })();

  function saveMapping(host, mapping) {
    MAPPING_CACHE[host] = mapping;
    try { localStorage.setItem(MAP_KEY, JSON.stringify(MAPPING_CACHE)); } catch { /* ignore */ }
  }

  /** 把单元格里的 "670/1301" 拆成分数与位次 */
  function splitScoreRank(cell) {
    const m = String(cell || '').match(/^(\d{3}(?:\.\d+)?)\s*\/\s*(\d+)$/);
    return m ? { score: m[1], rank: m[2] } : null;
  }

  function extractRows(table, mapping, ctx) {
    const header = table.matrix[0] ?? [];
    const isSegment = mapping.cumulative !== -1 && mapping.score !== -1;
    const out = [];
    let bad = 0;

    for (const row of table.matrix.slice(1)) {
      const cell = (field) => (mapping[field] >= 0 ? String(row[mapping[field]] ?? '').trim() : '');

      if (isSegment) {
        const scoreText = cell('score');
        const cumulative = Number(cell('cumulative').replace(/[^\d]/g, ''));
        const score = Number((scoreText.match(/\d{2,3}/) || [])[0]);
        if (!Number.isFinite(score) || !Number.isFinite(cumulative) || !cumulative) { bad += 1; continue; }
        out.push({
          year: Number(cell('year')) || ctx.year,
          province: cell('province') || ctx.province,
          score,
          cumulative,
        });
        continue;
      }

      const major = cell('major') || ctx.defaultMajor;
      if (!major) { bad += 1; continue; }

      let lowScore = cell('lowScore');
      let lowRank = cell('lowRank');
      const combo = splitScoreRank(lowScore);
      if (combo && !lowRank) { lowScore = combo.score; lowRank = combo.rank; }

      if (!lowScore && !lowRank) { bad += 1; continue; }

      out.push({
        year: Number(cell('year')) || ctx.year,
        province: cell('province') || ctx.province,
        school: cell('school') || ctx.school,
        location: cell('location') || ctx.location,
        major,
        highScore: cell('highScore'),
        lowScore,
        highRank: cell('highRank'),
        lowRank,
        volume: cell('volume'),
      });
    }

    return { rows: out, bad, header };
  }

  /* ============================ 导出 ============================ */

  const csvCell = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  function download(filename, text) {
    const blob = new Blob(['\uFEFF' + text], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  function buildScoreCsv() {
    const header = ['年份', '招生省份', '院校名称', '院校所在地', '板块', '专业名称',
      '最高分', '最低分', '最高位次', '最低位次', '录取人数'];
    const lines = [header.join(',')];

    for (const row of Object.values(state.rows)) {
      for (const [year, d] of Object.entries(row.years)) {
        if (!d.rank) continue;
        lines.push([year, state.province, csvCell(row.name), csvCell(row.location), row.plate,
          '院校最低线', '', d.min, '', d.rank, ''].join(','));
      }
    }
    for (const r of state.scores) {
      lines.push([r.year, csvCell(r.province), csvCell(r.school), csvCell(r.location), '',
        csvCell(r.major), r.highScore, r.lowScore, r.highRank, r.lowRank, r.volume].join(','));
    }
    return lines.join('\r\n');
  }

  function buildSegmentCsv() {
    const lines = ['年份,省份,分数,累计人数'];
    for (const r of state.segments) lines.push([r.year, csvCell(r.province), r.score, r.cumulative].join(','));
    return lines.join('\r\n');
  }

  /* ============================ 面板 ============================ */

  let panel = null;
  let currentTable = null;
  let currentMapping = null;
  let expanded = IS_GK;

  function render() {
    if (!panel) return;
    const planTotal = Object.keys(planResults()).length;
    panel.querySelector('.gk-status').textContent =
      `${state.running ? '运行中' : '空闲'} · 院校 ${Object.keys(state.rows).length} 所 · 分数行 ${state.scores.length} · 一分一段 ${state.segments.length} · 计划 ${planTotal} 所`;
    panel.querySelector('.gk-log').innerHTML = state.log.slice(0, 4)
      .map((l) => `<div>${l.replace(/</g, '&lt;')}</div>`).join('');

    const batchBtn = panel.querySelector('.gk-batch');
    if (batchBtn) {
      batchBtn.textContent = state.running ? '暂停' : (state.index > 0 && state.index < state.queue.length ? '继续' : '批量抓前 100');
    }

    const planStatus = panel.querySelector('.gk-plan-status');
    if (planStatus) {
      const q = state.plan.queue.length;
      const i = state.plan.index;
      if (state.plan.running) {
        const task = state.plan.queue[i];
        const meta = task ? schoolById.get(String(task.id)) : null;
        planStatus.textContent = `采集中 ${i + 1}/${q}：${meta ? meta[2] : task?.id ?? ''} ${task?.year ?? ''}`;
      } else if (q > 0) {
        planStatus.textContent = `已停止 / 已完成（${Math.min(i, q)}/${q}）`;
      } else {
        planStatus.textContent = '';
      }
    }
  }

  function buildPanel() {
    panel = document.createElement('div');
    panel.id = 'gk-panel-root';
    panel.style.cssText = [
      'position:fixed', 'right:16px', 'bottom:16px', 'z-index:2147483647', 'width:300px',
      'background:#16213e', 'color:#e9edf5', 'border:1px solid #0f3460', 'border-radius:10px',
      'padding:12px', 'font-size:12px', 'line-height:1.6', 'box-shadow:0 8px 24px rgba(0,0,0,.45)',
      'font-family:"Microsoft YaHei",sans-serif', 'max-height:80vh', 'overflow:auto',
    ].join(';');

    const provinceOptions = PROVINCES.map(([n]) => `<option value="${n}">${n}</option>`).join('');
    const fieldOptions = (header, selected) => ['<option value="-1">（无）</option>']
      .concat(header.map((h, i) => `<option value="${i}"${i === selected ? ' selected' : ''}>${i + 1}. ${(h || '(空)').slice(0, 12)}</option>`))
      .join('');

    panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
        <b style="color:#ec0000;">高考顺 · 采集器</b>
        <span class="gk-toggle" style="cursor:pointer;color:#6b7793;">收起</span>
      </div>
      <div class="gk-body">
        <div class="gk-status" style="color:#9aa6bd;margin-bottom:8px;"></div>

        <details class="gk-sec-a" ${IS_GK ? 'open' : ''}>
          <summary style="cursor:pointer;color:#f39c12;">掌上高考批量</summary>
          <div style="padding-top:8px;">
            <label style="display:block;margin-bottom:6px;">招生省份
              <select class="gk-province" style="width:100%;margin-top:4px;background:#0b1a33;color:#fff;border:1px solid #0f3460;border-radius:4px;padding:4px;">
                ${provinceOptions}
              </select>
            </label>
            <button class="gk-batch" style="width:100%;padding:7px;background:#ec0000;color:#fff;border:none;border-radius:5px;font-weight:700;cursor:pointer;margin-bottom:6px;">批量抓前 100</button>
            <div style="display:flex;gap:6px;">
              <button class="gk-one" style="flex:1;padding:6px;background:#0f3460;color:#fff;border:none;border-radius:5px;cursor:pointer;">抓当前页</button>
              <button class="gk-export-gk" style="flex:1;padding:6px;background:#1f9d55;color:#fff;border:none;border-radius:5px;cursor:pointer;">导出院校线</button>
            </div>
          </div>
        </details>

        <details class="gk-sec-plan" ${IS_GK ? 'open' : ''}>
          <summary style="cursor:pointer;color:#f39c12;margin-top:8px;">招生计划（招生人数）</summary>
          <div style="padding-top:8px;">
            <div style="color:#6b7793;font-size:11px;margin-bottom:6px;">
              按年份逐个打开 → 自动翻页 → 把「计划招生」列求和
            </div>
            <div style="display:flex;gap:6px;margin-bottom:6px;">
              <button class="gk-plan-one" style="flex:1;padding:6px;background:#0f3460;color:#fff;border:none;border-radius:5px;cursor:pointer;">采本校 6 年</button>
              <button class="gk-plan-all" style="flex:1;padding:6px;background:#ec0000;color:#fff;border:none;border-radius:5px;cursor:pointer;">批量 100 校</button>
            </div>
            <div style="display:flex;gap:6px;">
              <button class="gk-plan-stop" style="flex:1;padding:6px;background:#4a5568;color:#fff;border:none;border-radius:5px;cursor:pointer;">停止</button>
              <button class="gk-plan-export" style="flex:1;padding:6px;background:#1f9d55;color:#fff;border:none;border-radius:5px;cursor:pointer;">导出计划</button>
            </div>
            <div class="gk-plan-status" style="margin-top:6px;color:#9aa6bd;font-size:11px;"></div>
          </div>
        </details>

        <details class="gk-sec-b" open>
          <summary style="cursor:pointer;color:#f39c12;margin-top:8px;">本页表格抓取</summary>
          <div style="padding-top:8px;">
            <button class="gk-scan" style="width:100%;padding:6px;background:#0f3460;color:#fff;border:none;border-radius:5px;cursor:pointer;">扫描本页表格</button>
            <select class="gk-table-pick" style="width:100%;margin-top:6px;background:#0b1a33;color:#fff;border:1px solid #0f3460;border-radius:4px;padding:4px;display:none;"></select>
            <div class="gk-map" style="display:none;margin-top:8px;max-height:210px;overflow:auto;"></div>
            <div class="gk-ctx" style="display:none;margin-top:8px;grid-template-columns:1fr 1fr;gap:6px;">
              <label>年份<input class="gk-ctx-year" type="number" placeholder="2025" style="width:100%;background:#0b1a33;color:#fff;border:1px solid #0f3460;border-radius:4px;padding:4px;"></label>
              <label>省份<input class="gk-ctx-province" type="text" placeholder="天津" style="width:100%;background:#0b1a33;color:#fff;border:1px solid #0f3460;border-radius:4px;padding:4px;"></label>
              <label style="grid-column:1/-1;">院校名（表里没有时用）<input class="gk-ctx-school" type="text" style="width:100%;background:#0b1a33;color:#fff;border:1px solid #0f3460;border-radius:4px;padding:4px;"></label>
              <label style="grid-column:1/-1;">默认专业名（表里没有时用）<input class="gk-ctx-major" type="text" value="院校最低线" style="width:100%;background:#0b1a33;color:#fff;border:1px solid #0f3460;border-radius:4px;padding:4px;"></label>
            </div>
            <div class="gk-preview" style="margin-top:8px;color:#9aa6bd;font-size:11px;"></div>
            <div style="display:flex;gap:6px;margin-top:6px;">
              <button class="gk-add" style="flex:1;padding:6px;background:#27ae60;color:#fff;border:none;border-radius:5px;cursor:pointer;display:none;">加入数据</button>
              <button class="gk-export-seg" style="flex:1;padding:6px;background:#8e44ad;color:#fff;border:none;border-radius:5px;cursor:pointer;">导出一分一段</button>
            </div>
          </div>
        </details>

        <div class="gk-log" style="margin-top:8px;color:#6b7793;font-size:11px;max-height:80px;overflow:auto;"></div>
        <div style="margin-top:6px;color:#6b7793;font-size:10px;">数据存在浏览器本地；导出后拖进高考顺即可</div>
      </div>
    `;

    document.body.appendChild(panel);

    panel.querySelector('.gk-toggle').addEventListener('click', () => {
      expanded = !expanded;
      panel.querySelector('.gk-body').style.display = expanded ? 'block' : 'none';
      panel.querySelector('.gk-toggle').textContent = expanded ? '收起' : '展开';
    });

    const $ = (sel) => panel.querySelector(sel);

    $('.gk-province').addEventListener('change', (e) => {
      state.province = e.target.value;
      saveState();
      applyProvince();
      log(`省份切到 ${state.province}，刷新页面生效`);
    });

    $('.gk-batch').addEventListener('click', () => {
      if (state.running) { state.running = false; saveState(); render(); log('已暂停'); return; }
      if (state.index > 0 && state.index < state.queue.length) {
        state.running = true; saveState(); applyProvince();
        const next = state.queue[state.index];
        if (next) location.href = `https://www.gaokao.cn/school/${next}/special`;
        return;
      }
      if (!confirm('从第 1 所开始逐校抓取软科前 100（约 20–30 分钟）？')) return;
      state.queue = SCHOOLS.map((s) => String(s[1]));
      state.index = 0;
      state.rows = {};
      state.running = true;
      saveState();
      applyProvince();
      location.href = `https://www.gaokao.cn/school/${state.queue[0]}/special`;
    });

    $('.gk-one').addEventListener('click', async () => {
      const btn = $('.gk-one');
      btn.disabled = true; btn.textContent = '抓取中…';
      const r = await collectCurrentSchool();
      btn.disabled = false; btn.textContent = '抓当前页';
      log(r.ok ? `✓ ${r.name}：${r.years} 年` : `✗ ${r.reason}`);
    });

    $('.gk-export-gk').addEventListener('click', () => {
      const csv = buildScoreCsv();
      if (csv.split('\r\n').length <= 1) { alert('还没有数据'); return; }
      download(`高考顺_院校线_${state.province}.csv`, csv);
    });

    $('.gk-plan-one').addEventListener('click', () => {
      const id = currentSchoolId();
      if (!id) { alert('请先打开某所学校的页面'); return; }
      if (!confirm('采集本校 2021–2026 的招生计划？（约 1 分钟，会连续跳转 6 次）')) return;
      startPlanQueue([id], PLAN_YEARS);
    });

    $('.gk-plan-all').addEventListener('click', () => {
      if (state.plan.running) { log('已经在跑了，先停止再重开'); return; }
      if (!confirm('采集软科前 100 校 × 6 年的招生计划？\n约 2–3 小时，可以随时点「停止」。')) return;
      startPlanQueue(SCHOOLS.map((s) => String(s[1])), PLAN_YEARS);
    });

    $('.gk-plan-stop').addEventListener('click', () => {
      stopPlanQueue();
      log('已停止招生计划采集');
    });

    $('.gk-plan-export').addEventListener('click', () => {
      const csv = buildPlanCsv();
      if (csv.split('\r\n').length <= 1) { alert('还没有招生计划数据'); return; }
      download(`高考顺_招生计划_${state.province}.csv`, csv);
    });

    $('.gk-export-seg').addEventListener('click', () => {
      if (!state.segments.length) { alert('还没有一分一段数据'); return; }
      download('高考顺_一分一段.csv', buildSegmentCsv());
    });

    $('.gk-scan').addEventListener('click', () => {
      const tables = scanTables();
      if (!tables.length) { log('本页没有可用的表格'); return; }
      const pick = $('.gk-table-pick');
      pick.style.display = 'block';
      pick.innerHTML = tables.map((t, i) =>
        `<option value="${i}">表${i + 1}：${t.matrix.length} 行 × ${Math.max(...t.matrix.map((r) => r.length))} 列｜${(t.matrix[0] || []).slice(0, 3).join(' / ').slice(0, 30)}</option>`).join('');
      pick.onchange = () => chooseTable(tables[Number(pick.value)]);
      chooseTable(tables[0]);
      log(`找到 ${tables.length} 个表格`);
    });

    function chooseTable(t) {
      currentTable = t;
      const header = t.matrix[0] ?? [];
      const cached = MAPPING_CACHE[location.hostname];
      currentMapping = (cached && Object.keys(cached).length) ? { ...guessMapping(header), ...cached } : guessMapping(header);

      const mapBox = $('.gk-map');
      mapBox.style.display = 'block';
      mapBox.innerHTML = FIELDS.map(([field, label]) =>
        `<label style="display:flex;justify-content:space-between;gap:6px;margin-bottom:3px;">
          <span style="color:#9aa6bd;">${label}</span>
          <select data-field="${field}" style="flex:1;max-width:150px;background:#0b1a33;color:#fff;border:1px solid #0f3460;border-radius:4px;">${fieldOptions(header, currentMapping[field])}</select>
        </label>`).join('');

      mapBox.querySelectorAll('select').forEach((sel) => {
        sel.addEventListener('change', () => updatePreview());
      });

      $('.gk-ctx').style.display = 'grid';
      $('.gk-add').style.display = 'block';
      updatePreview();
    }

    function readMapping() {
      const map = {};
      panel.querySelectorAll('.gk-map select').forEach((sel) => {
        map[sel.dataset.field] = Number(sel.value);
      });
      return map;
    }

    function readCtx() {
      return {
        year: Number($('.gk-ctx-year').value) || new Date().getFullYear(),
        province: $('.gk-ctx-province').value.trim() || state.province,
        school: $('.gk-ctx-school').value.trim(),
        location: '',
        defaultMajor: $('.gk-ctx-major').value.trim(),
      };
    }

    function updatePreview() {
      if (!currentTable) return;
      currentMapping = readMapping();
      const { rows, bad } = extractRows(currentTable, currentMapping, readCtx());
      const isSeg = currentMapping.cumulative !== -1 && currentMapping.score !== -1;
      const head = rows.slice(0, 2).map((r) => isSeg
        ? `${r.year} ${r.province} ${r.score}→${r.cumulative}`
        : `${r.year} ${r.school || '(未填院校)'} ${r.major} 分${r.lowScore || '-'} 位${r.lowRank || '-'}`).join('<br>');
      $('.gk-preview').innerHTML = `识别为 <b style="color:#f39c12;">${isSeg ? '一分一段表' : '分数数据'}</b>：${rows.length} 行可入库，${bad} 行跳过<br>${head}`;
    }

    $('.gk-add').addEventListener('click', () => {
      if (!currentTable) return;
      const mapping = readMapping();
      const ctx = readCtx();
      const { rows, bad } = extractRows(currentTable, mapping, ctx);
      const isSeg = mapping.cumulative !== -1 && mapping.score !== -1;

      if (isSeg) {
        state.segments.push(...rows);
        saveMapping(location.hostname, mapping);
        saveState();
        log(`加入一分一段 ${rows.length} 行（跳过 ${bad}）`);
      } else {
        state.scores.push(...rows);
        saveMapping(location.hostname, mapping);
        saveState();
        log(`加入分数 ${rows.length} 行（跳过 ${bad}）`);
      }
      render();
    });

    render();
  }

  /* ============================ 启动 ============================ */

  function boot() {
    if (document.getElementById('gk-panel-root')) return;
    const hasTable = document.querySelector('table');
    if (!IS_GK && !hasTable) return;   // 其它站点没有表格就别打扰

    buildPanel();
    if (!expanded) {
      panel.querySelector('.gk-body').style.display = 'none';
      panel.querySelector('.gk-toggle').textContent = '展开';
    }
    if (IS_GK) {
      applyProvinceIfNeeded();
      runIfBatch().catch((e) => log('异常：' + e.message));
      runPlanTaskIfNeeded().catch((e) => log('计划采集异常：' + e.message));
    }
  }

  function applyProvinceIfNeeded() {
    const current = localStorage.getItem('localprovinceid');
    const want = PROVINCES.find(([n]) => n === state.province);
    if (want && current !== String(want[1])) applyProvince();
  }

  // 页面可能长时间停在 loading（广告/统计脚本拖住），所以除了 DOMContentLoaded
  // 再挂定时兜底；boot 本身幂等，重复调用无副作用。
  function scheduleBoot() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => setTimeout(boot, 1200), { once: true });
      setTimeout(boot, 6000);
      setTimeout(boot, 12000);
    } else {
      setTimeout(boot, 1200);
    }
  }

  scheduleBoot();
})();
