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

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    let pathname = decodeURIComponent(url.pathname);
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
