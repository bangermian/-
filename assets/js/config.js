/**
 * 全局配置：区域划分、板块枚举、配色、默认参数。
 * 所有"业务口径"都集中在这里，改阈值/配色/省市归属只需要动这一个文件。
 */

/** 区域 → 省份。用于大盘指数聚合与城市归属（键名即 <option> 的 value） */
export const REGIONS = {
  east: ['北京', '天津', '上海', '江苏', '浙江', '福建', '广东'],
  jiaodong: ['山东'],
  central: ['河北', '河南', '湖北', '湖南', '江西', '安徽'],
  southwest: ['四川', '重庆', '云南', '贵州'],
  beibuwan: ['广西', '海南'],
  northeast: ['黑龙江', '吉林', '辽宁'],
  northwest: ['陕西', '山西'],
};

export const REGION_LABELS = {
  east: '东部指数',
  jiaodong: '胶东指数',
  central: '中部指数',
  southwest: '西南指数',
  beibuwan: '北部湾指数',
  northeast: '东北指数',
  northwest: '西北指数',
};

/** 院校板块枚举，顺序即下拉顺序 */
export const PLATES = ['92', 'doublefirst', 'newresearch', 's11', 'shuangfei'];

export const PLATE_LABELS = {
  92: '92板块',
  doublefirst: '双一流板块',
  newresearch: '新型研究型大学板块',
  s11: 'S11中外合办板块',
  shuangfei: '双非板块',
};

/** 文件名里板块字段的别名 → 规范键；未命中时回落到 shuangfei（与旧版一致） */
export const PLATE_ALIASES = {
  92: '92',
  doublefirst: 'doublefirst',
  newresearch: 'newresearch',
  s11: 's11',
  shuangfei: 'shuangfei',
};

export const COLORS = {
  up: '#ec0000',
  upBorder: '#8a0000',
  down: '#00da3c',
  downBorder: '#008f28',
  neutral: '#666',
  ma: ['#f39c12', '#9b59b6', '#3498db', '#1abc9c'],
  axis: '#8f9bb3',
  grid: '#1d2a4a',
  tooltipBg: 'rgba(22, 33, 62, 0.96)',
  tooltipBorder: '#0f3460',
};

/** 均线默认周期 */
export const DEFAULT_MA = [5, 10, 20, 30];

/** 文件名缺失考生数时的兜底值（仅用于把位次换算成百分位） */
export const DEFAULT_CANDIDATES = 70000;

/** 允许加载的数据文件扩展名 */
export const ACCEPTED_EXT = /\.(xlsx|xls|csv)$/i;

/** 指数口径说明：个股以"位次"作图（纵轴翻转，越小越难）；指数以"热度"作图（越大越难） */
export const SERIES_MODE = {
  rank: 'rank',
  heat: 'heat',
  spread: 'spread',
  volume: 'volume',
};

export const STORAGE = {
  dbName: 'gaokaoshun',
  storeName: 'snapshots',
  key: 'latest',
  /** 数据结构版本：不一致时直接丢弃旧缓存，避免解析出诡异数据 */
  schemaVersion: 3,
};
