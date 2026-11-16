#!/usr/bin/env node
// Zero-dependency static file server for local play. Usage: node tools/serve.mjs [port] [root]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), root = path.resolve(process.argv[3] || repo), port = +(process.argv[2] || 8080);
// The source tree has no version.json (tools/build.mjs writes it into dist/). Serving the source, answer the title
// screen's update check with this checkout's own version; any other root (dist/) keeps a real 404 for a missing manifest.
const SOURCE_VERSION = root === repo ? (pkg => JSON.stringify({ name: pkg.name, version: pkg.version, commit: 'source', source: true }))(JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8'))) : null;
// Apply the production response headers from vercel.json (CSP etc.) so local play matches deployment.
let PROD_HEADERS = {};
try { const v = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'vercel.json'), 'utf8')); for (const h of v.headers?.[0]?.headers || []) PROD_HEADERS[h.key] = h.value; } catch { /* no vercel.json */ }
delete PROD_HEADERS['Cache-Control'];
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.bin': 'application/octet-stream', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
http.createServer((req, res) => {
  let rel; try { rel = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400).end(); return; }
  const file = path.join(root, rel.endsWith('/') ? rel + 'index.html' : rel), inside = path.relative(root, file);
  if (inside.startsWith('..') || path.isAbsolute(inside)) { res.writeHead(403).end(); return; } // by path segments, so a sibling named root-* is outside
  fs.readFile(file, (err, data) => {
    if (err && SOURCE_VERSION && inside === 'version.json') data = SOURCE_VERSION, err = null;
    if (err) { res.writeHead(404).end('not found'); return; } res.writeHead(200, { ...PROD_HEADERS, 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' }).end(data); });
}).listen(port, () => console.log(`ODE: http://localhost:${port}/`));
