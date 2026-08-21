const fs = require('fs');
const http = require('http');
const path = require('path');

const MODEL_DIR = path.resolve(__dirname, 'out-tsc', '3dmodel');
const LISTEN_PORT = 47821;

function isSafeBasename(name) {
  return !!name && !name.includes('..') && !name.includes('/') && !name.includes('\\');
}

function isModelPackageName(name) {
  const n = (name || '').toLowerCase();
  return n.endsWith('.zip') || n.endsWith('.glb') || n.endsWith('.gltf');
}

function listModelFiles() {
  try {
    return fs.readdirSync(MODEL_DIR).filter(isModelPackageName).sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

function handleDev3dmodel(req, res) {
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  const pathname = decodeURIComponent(url.pathname);

  if (pathname === '/' || pathname === '/manifest.json') {
    const body = JSON.stringify({ files: listModelFiles() });
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    res.end(body);
    return;
  }

  const name = pathname.replace(/^\//, '');
  if (!isSafeBasename(name) || !isModelPackageName(name)) {
    res.writeHead(400);
    res.end('bad name');
    return;
  }

  const filePath = path.resolve(MODEL_DIR, name);
  const rel = path.relative(MODEL_DIR, filePath);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    res.writeHead(400);
    res.end('bad path');
    return;
  }

  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    res.writeHead(404);
    res.end('not found');
    return;
  }
  if (!stat.isFile()) {
    res.writeHead(404);
    res.end('not found');
    return;
  }

  const ext = path.extname(name).toLowerCase();
  const type = ext === '.zip' ? 'application/zip'
    : ext === '.glb' ? 'model/gltf-binary'
    : ext === '.gltf' ? 'model/gltf+json'
    : 'application/octet-stream';
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': stat.size,
    'Cache-Control': 'no-store',
  });
  fs.createReadStream(filePath).pipe(res);
}

function startDev3dmodelServer() {
  const g = globalThis;
  if (g.__udonariumDev3dmodelServer) return;
  const server = http.createServer(handleDev3dmodel);
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`[dev-3dmodel] port ${LISTEN_PORT} in use; reusing existing server`);
      return;
    }
    console.error('[dev-3dmodel]', err);
  });
  server.listen(LISTEN_PORT, '127.0.0.1', () => {
    console.log(`[dev-3dmodel] serving ${MODEL_DIR} → http://127.0.0.1:${LISTEN_PORT}`);
  });
  g.__udonariumDev3dmodelServer = server;
}

startDev3dmodelServer();

module.exports = {
  '/dev-3dmodel': {
    target: `http://127.0.0.1:${LISTEN_PORT}`,
    secure: false,
    changeOrigin: true,
    pathRewrite: { '^/dev-3dmodel': '' },
    logLevel: 'info',
  },
  '/v1': {
    target: 'http://127.0.0.1:8787',
    secure: false,
    changeOrigin: true,
    logLevel: 'info',
    onProxyReq(proxyReq, req) {
      // Forward the browser Origin (localhost or 127.0.0.1) so CORS checks match the page.
      const origin = req.headers.origin || `https://${req.headers.host || '127.0.0.1:4200'}`;
      proxyReq.setHeader('Origin', origin);
    },
  },
};
