#!/usr/bin/env node
// Zero-dependency static file server for local play. Usage: node tools/serve.mjs [port] [root]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(process.argv[3] || path.join(path.dirname(fileURLToPath(import.meta.url)), '..')), port = +(process.argv[2] || 8080);
// Apply the production response headers from vercel.json (CSP etc.) so local play matches deployment.
let PROD_HEADERS = {};
try { const v = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'vercel.json'), 'utf8')); for (const h of v.headers?.[0]?.headers || []) PROD_HEADERS[h.key] = h.value; } catch { /* no vercel.json */ }
delete PROD_HEADERS['Cache-Control'];
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.bin': 'application/octet-stream', '.svg': 'image/svg+xml' };
http.createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname), file = path.join(root, rel.endsWith('/') ? rel + 'index.html' : rel);
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  if (rel === '/version.json' && !fs.existsSync(file)) { // dev tree: synthesise from package.json so the update check is quiet
    let version = '0.0.0'; try { version = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8')).version; } catch { /* keep default */ }
    res.writeHead(200, { ...PROD_HEADERS, 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify({ version, dev: true })); return;
  }
  fs.readFile(file, (err, data) => { if (err) { res.writeHead(404).end('not found'); return; } res.writeHead(200, { ...PROD_HEADERS, 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' }).end(data); });
}).listen(port, () => console.log(`ODE: http://localhost:${port}/`));
