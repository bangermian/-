// ==UserScript==
// @name         掌上高考 → 高考顺 导出
// @namespace    gaokaoshun.export
// @version      1.0.0
// @description  在掌上高考院校页抓取历年「院校分数线」，导出为高考顺可直接加载的 CSV
// @author       gaokaoshun
// @match        https://www.gaokao.cn/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

/*
 * 工作原理（不需要破解签名）：
 *   1. 打开院校的「历年分数」页，页面自己会发一条带 signsafe 的请求；
 *   2. 从性能时间线里把这条已经签好名的 URL 捞出来；
 *   3. 实测该签名**不覆盖 year 参数**，于是原样重放、只替换年份，即可拿到其它年份的数据；
 *   4. 逐校循环，结果存 localStorage，最后拼成高考顺模板 CSV。
 *
 * 已知限制（脚本不会替你掩盖）：
 *   · 只能拿到院校级「最低分/最低位次」，拿不到最高位次与分差；
 *   · 部分年份官方不公布位次（返回 "-"），这些年会留空，高考顺会自动跳过；
 *   · 专业级数据未登录只给前 5 个专业，是偏样本，故不采用。
 */

(function () {
  'use strict';

  /* ============================ 配置 ============================ */

  // 由 data/软科前100.csv 生成：[排名, school_id, 校名, 所在地, 板块]
  const SCHOOLS = [[1,140,"清华大学","北京","92"],[2,31,"北京大学","北京","92"],[3,114,"浙江大学","浙江","92"],[4,125,"上海交通大学","上海","92"],[5,132,"复旦大学","上海","92"],[6,111,"南京大学","江苏","92"],[7,66,"中国科学技术大学","安徽","92"],[8,42,"武汉大学","湖北","92"],[9,127,"华中科技大学","湖北","92"],[10,330,"西安交通大学","陕西","92"],[11,47,"北京航空航天大学","北京","92"],[12,104,"中山大学","广东","92"],[13,143,"北京理工大学","北京","92"],[14,573,"北京协和医学院","北京","doublefirst"],[15,34,"哈尔滨工业大学","黑龙江","92"],[16,99,"四川大学","四川","92"],[17,109,"东南大学","江苏","92"],[18,46,"中国人民大学","北京","92"],[19,73,"同济大学","上海","92"],[20,52,"北京师范大学","北京","92"],[21,60,"天津大学","天津","92"],[22,107,"西北工业大学","陕西","92"],[23,126,"山东大学","山东","92"],[24,59,"南开大学","天津","92"],[25,102,"厦门大学","福建","92"],[26,557,"中国农业大学","北京","92"],[27,122,"吉林大学","吉林","92"],[28,123,"中南大学","湖南","92"],[29,138,"大连理工大学","辽宁","92"],[30,44,"湖南大学","湖南","92"],[31,131,"华东师范大学","上海","92"],[32,105,"华南理工大学","广东","92"],[33,2941,"南方科技大学","广东","doublefirst"],[34,661,"电子科技大学","四川","92"],[35,119,"重庆大学","重庆","92"],[36,144,"北京科技大学","北京","92"],[37,130,"上海财经大学","上海","92"],[38,584,"首都医科大学","北京","shuangfei"],[39,77,"南京航空航天大学","江苏","92"],[40,134,"东北大学","辽宁","92"],[41,112,"南京理工大学","江苏","92"],[42,97,"兰州大学","甘肃","92"],[43,960,"南方医科大学","广东","shuangfei"],[44,57,"西安电子科技大学","陕西","92"],[45,3151,"上海科技大学","上海","doublefirst"],[46,38,"北京交通大学","北京","92"],[47,124,"哈尔滨工程大学","黑龙江","92"],[48,133,"华东理工大学","上海","92"],[49,142,"东北师范大学","吉林","92"],[50,566,"中央财经大学","北京","92"],[51,3202,"香港中文大学（深圳）","广东","shuangfei"],[52,118,"苏州大学","江苏","92"],[53,417,"华中农业大学","湖北","92"],[54,128,"武汉理工大学","湖北","92"],[55,832,"中国石油大学（北京）","北京","92"],[56,62,"郑州大学","河南","92"],[57,86,"江南大学","江苏","92"],[58,51,"西南交通大学","四川","92"],[59,168,"南京医科大学","江苏","doublefirst"],[60,113,"南京农业大学","江苏","92"],[61,121,"中国地质大学（武汉）","湖北","92"],[62,53,"对外经济贸易大学","北京","92"],[63,106,"暨南大学","广东","92"],[64,420,"华中师范大学","湖北","92"],[65,61,"中国海洋大学","山东","92"],[66,569,"中国政法大学","北京","92"],[67,115,"南京师范大学","江苏","92"],[68,110,"中国矿业大学","江苏","92"],[69,78,"天津医科大学","天津","92"],[70,230,"中国医科大学","辽宁","shuangfei"],[71,48,"北京邮电大学","北京","92"],[72,76,"上海大学","上海","92"],[73,49,"北京中医药大学","北京","92"],[74,242,"浙江工业大学","浙江","shuangfei"],[75,414,"中南财经政法大学","湖北","92"],[76,556,"北京化工大学","北京","92"],[77,116,"河海大学","江苏","92"],[78,334,"陕西师范大学","陕西","92"],[79,101,"西南财经大学","四川","92"],[80,934,"西南大学","重庆","92"],[81,120,"中国石油大学（华东）","山东","92"],[82,284,"深圳大学","广东","shuangfei"],[83,310,"上海中医药大学","上海","doublefirst"],[84,35,"云南大学","云南","92"],[85,37,"西北大学","陕西","92"],[86,332,"西北农林科技大学","陕西","92"],[87,30,"北京工业大学","北京","92"],[88,108,"南昌大学","江西","92"],[89,3039,"上海纽约大学","上海","shuangfei"],[90,135,"东华大学","上海","92"],[91,830,"中国地质大学（北京）","北京","92"],[92,1006,"中国矿业大学（北京）","北京","92"],[93,1216,"宁波诺丁汉大学","浙江","shuangfei"],[94,429,"哈尔滨医科大学","黑龙江","shuangfei"],[95,295,"广州医科大学","广东","doublefirst"],[96,103,"福州大学","福建","92"],[97,240,"宁波大学","浙江","doublefirst"],[98,63,"合肥工业大学","安徽","92"],[99,98,"华南师范大学","广东","92"],[100,45,"中央民族大学","北京","92"]];

  const PROVINCES = [
    ['北京', 11], ['天津', 12], ['河北', 13], ['山西', 14], ['内蒙古', 15],
    ['辽宁', 21], ['吉林', 22], ['黑龙江', 23], ['上海', 31], ['江苏', 32],
    ['浙江', 33], ['安徽', 34], ['福建', 35], ['江西', 36], ['山东', 37],
    ['河南', 41], ['湖北', 42], ['湖南', 43], ['广东', 44], ['广西', 45],
    ['海南', 46], ['重庆', 50], ['四川', 51], ['贵州', 52], ['云南', 53],
    ['西藏', 54], ['陕西', 61], ['甘肃', 62], ['青海', 63], ['宁夏', 64], ['新疆', 65],
  ];

  const YEARS = ['2026', '2025', '2024', '2023', '2022', '2021'];
  const STORE_KEY = 'gaokaoshun.batch.v1';
  const CAPTURE_TIMEOUT = 15000;
  const BETWEEN_SCHOOLS = 2500;

  /* ============================ 状态 ============================ */

  function loadState() {
    try {
      return JSON.parse(localStorage.getItem(STORE_KEY)) || {};
    } catch {
      return {};
    }
  }

  function saveState(state) {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  }

  let state = loadState();
  state.rows = state.rows || {};      // { schoolId: { name, location, plate, years: {2025: {min, rank}} } }
  state.queue = state.queue || [];    // 待处理 schoolId
  state.index = state.index || 0;
  state.running = Boolean(state.running);
  state.province = state.province || '天津';
  state.log = state.log || [];

  const schoolById = new Map(SCHOOLS.map((s) => [String(s[1]), s]));

  /* ============================ 工具 ============================ */

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function waitFor(fn, timeout = 10000, interval = 300) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const value = fn();
      if (value) return value;
      await sleep(interval);
    }
    return null;
  }

  function currentSchoolId() {
    const m = location.pathname.match(/\/school\/(\d+)/);
    return m ? m[1] : null;
  }

  function findSignedUrl(uriPart) {
    const urls = performance.getEntriesByType('resource')
      .map((r) => r.name)
      .filter((n) => n.includes(uriPart) && n.includes('signsafe='));
    return urls.length ? urls[urls.length - 1] : null;
  }

  function clickHistoryTab() {
    const hit = [...document.querySelectorAll('a,div,span,li')]
      .find((el) => (el.textContent || '').trim() === '历年分数' && el.offsetParent !== null);
    if (hit) hit.click();
    return Boolean(hit);
  }

  /* ============================ 抓取 ============================ */

  /**
   * 用页面自己签好的 URL，按年份重放。
   * @returns {Promise<Record<string,{min:string,rank:string,batch:string}>>}
   */
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
          // 同一年可能同时有「本科批」和「提前批/专项/中外合作」，必须固定挑同一条线，
          // 否则序列会在批次之间跳变。优先级：普通类+本科批 > 本科批 > 普通类 > 第一条。
          const isRegular = (it) => /本科批/.test(it.local_batch_name || '')
            && !/提前|专项|民族|中外/.test(it.local_batch_name || '');
          const isCommon = (it) => (it.zslx_name || '').includes('普通');
          const hit = items.find((it) => isRegular(it) && isCommon(it))
            ?? items.find(isRegular)
            ?? items.find(isCommon)
            ?? items[0];
          out[year] = {
            min: hit.min ?? '',
            rank: hit.min_section && hit.min_section !== '-' ? hit.min_section : '',
            batch: hit.local_batch_name ?? '',
          };
        }
      } catch {
        // 单年失败不影响其它年份
      }
      await sleep(260);
    }
    return out;
  }

  async function collectCurrentSchool() {
    const id = currentSchoolId();
    if (!id) return { ok: false, reason: '当前不在院校页（URL 里没有 /school/<id>）' };

    if (!document.querySelector('table.tb-normal')) {
      clickHistoryTab();
      await sleep(1500);
    }

    const signed = await waitFor(
      () => findSignedUrl('province_score') || findSignedUrl('special_score'),
      CAPTURE_TIMEOUT,
    );
    if (!signed) return { ok: false, reason: '没有捕获到页面发出的分数线请求（可能页面还没加载完，或该省无数据）' };

    const years = await fetchYears(signed, YEARS);
    const found = Object.keys(years).length;
    if (!found) return { ok: false, reason: '接口没有返回任何年份的数据' };

    const meta = schoolById.get(id);
    const name = meta ? meta[2] : (document.title.split('—')[0].trim() || `学校${id}`);
    const location = meta ? meta[3] : '';
    const plate = meta ? meta[4] : 'shuangfei';

    state.rows[id] = { name, location, plate, years };
    saveState(state);
    return { ok: true, id, name, years: found, ranks: Object.values(years).filter((y) => y.rank).length };
  }

  /* ============================ 批量 ============================ */

  function applyProvince() {
    const entry = PROVINCES.find(([name]) => name === state.province);
    if (!entry) return;
    localStorage.setItem('localprovinceid', String(entry[1]));
    localStorage.setItem('localprovincename', entry[0]);
  }

  function startBatch() {
    state.queue = SCHOOLS.map((s) => String(s[1]));
    state.index = 0;
    state.running = true;
    state.rows = {};
    state.log = [];
    saveState(state);
    applyProvince();
    log(`批量开始：${state.queue.length} 所，省份 ${state.province}`);
    location.href = `https://www.gaokao.cn/school/${state.queue[0]}/special`;
  }

  function stopBatch() {
    state.running = false;
    saveState(state);
    log('已暂停（进度已保存，可点「继续」接着跑）');
    render();
  }

  function resumeBatch() {
    state.running = true;
    saveState(state);
    applyProvince();
    const next = state.queue[state.index];
    if (next) location.href = `https://www.gaokao.cn/school/${next}/special`;
  }

  function log(message) {
    state.log.unshift(`[${new Date().toLocaleTimeString('zh-CN')}] ${message}`);
    state.log = state.log.slice(0, 40);
    saveState(state);
    render();
  }

  async function runIfBatch() {
    if (!state.running) return;
    const id = currentSchoolId();
    if (!id) return;
    if (state.queue[state.index] && String(state.queue[state.index]) !== id) return;

    const result = await collectCurrentSchool();
    if (result.ok) {
      log(`✓ ${result.name}：${result.years} 年，其中 ${result.ranks} 年有位次`);
    } else {
      log(`✗ ${id}：${result.reason}`);
    }

    state.index += 1;
    saveState(state);

    if (state.index >= state.queue.length) {
      state.running = false;
      saveState(state);
      log(`全部完成：${Object.keys(state.rows).length} 所`);
      render();
      return;
    }

    await sleep(BETWEEN_SCHOOLS);
    location.href = `https://www.gaokao.cn/school/${state.queue[state.index]}/special`;
  }

  /* ============================ 导出 ============================ */

  function buildCsv() {
    const header = ['年份', '招生省份', '院校名称', '院校所在地', '板块', '专业名称',
      '最高分', '最低分', '最高位次', '最低位次', '录取人数'];
    const lines = [header.join(',')];
    let skipped = 0;

    for (const row of Object.values(state.rows)) {
      for (const [year, data] of Object.entries(row.years)) {
        if (!data.rank) { skipped += 1; continue; }
        lines.push([
          year, state.province, csvCell(row.name), csvCell(row.location), row.plate, '院校最低线',
          '', data.min, '', data.rank, '',
        ].join(','));
      }
    }
    return { csv: '\uFEFF' + lines.join('\r\n'), rows: lines.length - 1, skipped };
  }

  const csvCell = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  function downloadCsv() {
    const { csv, rows, skipped } = buildCsv();
    if (rows === 0) { alert('还没有可导出的数据'); return; }
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `掌上高考_${state.province}_院校线.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    alert(`已导出 ${rows} 行。\n另有 ${skipped} 个「学校-年份」因官方未公布位次被跳过（无法画 K 线）。`);
  }

  /* ============================ 面板 ============================ */

  let panel = null;

  function render() {
    if (!panel) return;
    const done = Object.keys(state.rows).length;
    const total = state.queue.length || SCHOOLS.length;
    panel.querySelector('.gk-status').textContent =
      `${state.running ? '运行中' : '空闲'} · 已存 ${done} 所 · 进度 ${Math.min(state.index, total)}/${total}`;
    panel.querySelector('.gk-log').innerHTML = state.log.slice(0, 6)
      .map((line) => `<div>${line.replace(/</g, '&lt;')}</div>`).join('');

    const button = panel.querySelector('.gk-batch');
    if (state.running) button.textContent = '暂停';
    else if (state.index > 0 && state.index < state.queue.length) button.textContent = '继续';
    else button.textContent = '批量抓取前 100';

    panel.querySelector('.gk-province').value = state.province;
  }

  function buildPanel() {
    panel = document.createElement('div');
    panel.style.cssText = [
      'position:fixed', 'right:16px', 'bottom:16px', 'z-index:2147483647',
      'width:280px', 'background:#16213e', 'color:#e9edf5', 'border:1px solid #0f3460',
      'border-radius:10px', 'padding:12px', 'font-size:12px', 'line-height:1.6',
      'box-shadow:0 8px 24px rgba(0,0,0,.45)', 'font-family:"Microsoft YaHei",sans-serif',
    ].join(';');

    panel.innerHTML = `
      <div style="font-weight:700;color:#ec0000;margin-bottom:6px;">掌上高考 → 高考顺</div>
      <div class="gk-status" style="color:#9aa6bd;margin-bottom:8px;"></div>
      <label style="display:block;margin-bottom:6px;">招生省份
        <select class="gk-province" style="width:100%;margin-top:4px;background:#0b1a33;color:#fff;border:1px solid #0f3460;border-radius:4px;padding:4px;">
          ${PROVINCES.map(([name]) => `<option value="${name}">${name}</option>`).join('')}
        </select>
      </label>
      <button class="gk-batch" style="width:100%;padding:7px;background:#ec0000;color:#fff;border:none;border-radius:5px;font-weight:700;cursor:pointer;margin-bottom:6px;">批量抓取前 100</button>
      <div style="display:flex;gap:6px;">
        <button class="gk-one" style="flex:1;padding:6px;background:#0f3460;color:#fff;border:none;border-radius:5px;cursor:pointer;">抓当前</button>
        <button class="gk-csv" style="flex:1;padding:6px;background:#1f9d55;color:#fff;border:none;border-radius:5px;cursor:pointer;">导出 CSV</button>
        <button class="gk-clear" style="padding:6px 8px;background:transparent;color:#9aa6bd;border:1px solid #0f3460;border-radius:5px;cursor:pointer;">清空</button>
      </div>
      <div class="gk-log" style="margin-top:8px;color:#6b7793;font-size:11px;max-height:100px;overflow:auto;"></div>
      <div style="margin-top:6px;color:#6b7793;font-size:10px;">换省份后需刷新页面生效 · 仅院校级最低线</div>
    `;

    document.body.appendChild(panel);

    panel.querySelector('.gk-province').addEventListener('change', (event) => {
      state.province = event.target.value;
      saveState(state);
      applyProvince();
      log(`省份切到 ${state.province}，请刷新页面`);
    });

    panel.querySelector('.gk-batch').addEventListener('click', () => {
      if (state.running) { stopBatch(); return; }
      if (state.index > 0 && state.index < state.queue.length) { resumeBatch(); return; }
      if (!confirm('将从第 1 所开始，逐校抓取软科前 100（约 20–30 分钟，期间不要关标签页）。继续？')) return;
      startBatch();
    });

    panel.querySelector('.gk-one').addEventListener('click', async () => {
      const button = panel.querySelector('.gk-one');
      button.disabled = true;
      button.textContent = '抓取中…';
      const result = await collectCurrentSchool();
      button.disabled = false;
      button.textContent = '抓当前';
      if (result.ok) log(`✓ ${result.name}：${result.years} 年`);
      else log(`✗ ${result.reason}`);
    });

    panel.querySelector('.gk-csv').addEventListener('click', downloadCsv);

    panel.querySelector('.gk-clear').addEventListener('click', () => {
      if (!confirm('清空已抓取的数据？')) return;
      state.rows = {};
      state.index = 0;
      state.queue = [];
      state.running = false;
      state.log = [];
      saveState(state);
      render();
    });

    render();
  }

  /* ============================ 启动 ============================ */

  function boot() {
    if (!/\/school\/\d+/.test(location.pathname)) {
      // 只在院校页显示面板
      return;
    }
    if (document.getElementById('gk-panel-root')) return;
    buildPanel();
    panel.id = 'gk-panel-root';
    runIfBatch().catch((error) => log('异常：' + error.message));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(boot, 1500));
  } else {
    setTimeout(boot, 1500);
  }
})();
