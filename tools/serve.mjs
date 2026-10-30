/**
 * 零依赖静态服务器（需要 Node.js 18+）。
 *
 *   node tools/serve.mjs [--port 8137] [--root .]
 *
 * 只用于本地开发预览：ES Module 无法通过 file:// 加载，所以必须走 HTTP。
 */

import http from 'node:http';
import { createReadStream, promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(HERE, '..');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.csv': 'text/csv; charset=utf-8',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls': 'application/vnd.ms-excel',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

function parseArgs(argv) {
  const options = { port: 8137, root: PROJECT_ROOT };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--port' || argv[i] === '-p') options.port = Number(argv[++i]);
    else if (argv[i] === '--root' || argv[i] === '-r') options.root = path.resolve(argv[++i]);
  }
  return options;
}

const { port, root } = parseArgs(process.argv.slice(2));

/* ---------- data/ 目录索引 ---------- */

const DATA_DIR = path.join(root, 'data');
const DATA_EXT = /\.(xlsx|xls|csv)$/i;
// 元数据文件（学校清单之类）不是行情数据，别让前端去解析它
const DATA_IGNORE = /^(软科|schools|README)/i;

/** 递归列出 data/ 下的数据文件，路径用 / 分隔，前端拿它当「所在文件夹」 */
async function listDataFiles(dir, base = '', depth = 0) {
  if (depth > 6) return [];
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const out = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      out.push(...await listDataFiles(path.join(dir, entry.name), rel, depth + 1));
    } else if (DATA_EXT.test(entry.name) && !DATA_IGNORE.test(entry.name)) {
      const st = await fs.stat(path.join(dir, entry.name)).catch(() => null);
      out.push({ rel, size: st?.size ?? 0, mtime: Math.round(st?.mtimeMs ?? 0) });
    }
  }
  return out;
}

/** 文件集合的指纹：数量 + 总字节 + 最新修改时间，任一变化就重新加载 */
async function dataIndex() {
  const files = await listDataFiles(DATA_DIR);
  const signature = `${files.length}:${files.reduce((s, f) => s + f.size, 0)}:${Math.max(0, ...files.map((f) => f.mtime))}`;
  return { files, signature };
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    let pathname = decodeURIComponent(url.pathname);

    // 让前端自动发现 data/ 里的数据，不用手动选文件夹
    if (pathname === '/api/data-index') {
      const payload = await dataIndex();
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      }).end(JSON.stringify(payload));
      return;
    }

    if (pathname.endsWith('/')) pathname += 'index.html';

    const target = path.resolve(root, '.' + pathname);
    // 防目录穿越
    if (!target.startsWith(root)) {
      res.writeHead(403).end('Forbidden');
      return;
    }

    const stat = await fs.stat(target).catch(() => null);
    if (!stat || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404 Not Found');
      return;
    }

    res.writeHead(200, {
      'Content-Type': MIME[path.extname(target).toLowerCase()] ?? 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': 'no-cache',
    });
    createReadStream(target).pipe(res);
  } catch (error) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' }).end(`500 ${error.message}`);
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`高考顺 本地预览: http://127.0.0.1:${port}/`);
  console.log(`服务目录: ${root}`);
  console.log('按 Ctrl+C 停止');
});
