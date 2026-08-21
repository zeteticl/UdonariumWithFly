/**
 * Browser harness: expand a model ZIP and try FBX / glTF load with local patched three.
 * Usage: node scripts/repro-model-load.mjs <path-to.zip>
 */
import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from '@playwright/test';
import { BlobReader, ZipReader, Uint8ArrayWriter } from '@zip.js/zip.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const threeRoot = path.join(root, 'node_modules', 'three');

const zipPath = process.argv[2];
if (!zipPath) {
  console.error('Usage: node scripts/repro-model-load.mjs <zip>');
  process.exit(2);
}

const zipBuf = fs.readFileSync(zipPath);
const reader = new ZipReader(new BlobReader(new Blob([zipBuf])));
const entries = await reader.getEntries();
const files = [];
for (const e of entries) {
  if (e.directory) continue;
  const data = await e.getData(new Uint8ArrayWriter());
  files.push({
    name: e.filename.replace(/\\/g, '/'),
    b64: Buffer.from(data).toString('base64'),
  });
}
await reader.close();
console.log('zip', path.basename(zipPath), 'entries', files.length);
console.log(files.map(f => f.name).join('\n'));

const mime = {
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
};

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  const rel = urlPath.replace(/^\/+/, '');
  const filePath = path.normalize(path.join(threeRoot, rel));
  if (!filePath.startsWith(threeRoot)) {
    res.writeHead(403); res.end('forbidden'); return;
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404); res.end('missing ' + rel); return;
  }
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, {
    'Content-Type': mime[ext] || 'application/octet-stream',
    'Access-Control-Allow-Origin': '*',
  });
  fs.createReadStream(filePath).pipe(res);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();
const threeBase = `http://127.0.0.1:${port}`;

const browser = await chromium.launch();
const page = await browser.newPage();
page.on('console', msg => console.log('BROWSER', msg.type(), msg.text()));
page.on('pageerror', err => console.log('PAGEERROR', err.message));
await page.setContent(`<!doctype html><html><head>
<script type="importmap">
{
  "imports": {
    "three": "${threeBase}/build/three.module.js",
    "three/addons/": "${threeBase}/examples/jsm/"
  }
}
</script>
</head><body>model load harness</body></html>`);

const result = await page.evaluate(async (payload) => {
  function convertSpecularGlossinessMaterials(json) {
    const SPEC = 'KHR_materials_pbrSpecularGlossiness';
    if (!json || !Array.isArray(json.materials)) return false;
    const used = Array.isArray(json.extensionsUsed) ? json.extensionsUsed : [];
    const has = used.includes(SPEC) || json.materials.some(m => m?.extensions?.[SPEC]);
    if (!has) return false;
    for (const mat of json.materials) {
      const sg = mat?.extensions?.[SPEC];
      if (!sg) continue;
      const pbr = mat.pbrMetallicRoughness || (mat.pbrMetallicRoughness = {});
      if (Array.isArray(sg.diffuseFactor) && pbr.baseColorFactor == null) pbr.baseColorFactor = sg.diffuseFactor.slice();
      if (sg.diffuseTexture && pbr.baseColorTexture == null) pbr.baseColorTexture = { ...sg.diffuseTexture };
      if (pbr.metallicFactor == null) pbr.metallicFactor = 0;
      if (pbr.roughnessFactor == null && typeof sg.glossinessFactor === 'number') {
        pbr.roughnessFactor = Math.min(1, Math.max(0, 1 - sg.glossinessFactor));
      }
      delete mat.extensions[SPEC];
      if (mat.extensions && !Object.keys(mat.extensions).length) delete mat.extensions;
    }
    if (Array.isArray(json.extensionsUsed)) {
      json.extensionsUsed = json.extensionsUsed.filter(x => x !== SPEC);
      if (!json.extensionsUsed.length) delete json.extensionsUsed;
    }
    if (Array.isArray(json.extensionsRequired)) {
      json.extensionsRequired = json.extensionsRequired.filter(x => x !== SPEC);
      if (!json.extensionsRequired.length) delete json.extensionsRequired;
    }
    return true;
  }

  const THREE = await import('three');
  const { FBXLoader } = await import('three/addons/loaders/FBXLoader.js');
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');

  const b64ToU8 = (b64) => {
    const bin = atob(b64);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return u8;
  };

  const fileMap = new Map();
  for (const f of payload) {
    const p = f.name.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
    const u8 = b64ToU8(f.b64);
    const file = new File([u8], p.split('/').pop(), { type: 'application/octet-stream' });
    fileMap.set(p, file);
  }

  const resolve = (url) => {
    const cut = String(url || '').split('?')[0].split('#')[0]
      .replace(/\\/g, '/')
      .replace(/^\.\//, '')
      .replace(/^\/+/, '')
      .toLowerCase();
    if (!cut || cut.startsWith('blob:') || cut.startsWith('data:')) return null;
    const base = cut.split('/').pop();
    if (fileMap.has(cut)) return fileMap.get(cut);
    if (fileMap.has(base)) return fileMap.get(base);
    for (const [k, v] of fileMap) {
      if (k.endsWith('/' + cut) || k.endsWith('/' + base)) return v;
    }
    return null;
  };

  const manager = new THREE.LoadingManager();
  const blobUrls = [];
  manager.setURLModifier((url) => {
    if (/^(blob:|data:)/i.test(url || '')) return url;
    const file = resolve(url);
    if (!file) return url;
    const u = URL.createObjectURL(file);
    blobUrls.push(u);
    return u;
  });

  const fbxMeta = payload.find(f => /\.fbx$/i.test(f.name));
  const gltfMeta = payload.find(f => /\.gltf$/i.test(f.name));
  const glbMeta = payload.find(f => /\.glb$/i.test(f.name));

  const out = { fbx: null, gltf: null };

  if (fbxMeta) {
    try {
      const loader = new FBXLoader(manager);
      const buffer = b64ToU8(fbxMeta.b64).buffer;
      const scene = loader.parse(buffer, '');
      let meshes = 0;
      scene.traverse((o) => { if (o.isMesh) meshes++; });
      out.fbx = { ok: true, meshes, children: scene.children.length };
    } catch (e) {
      out.fbx = {
        ok: false,
        message: String(e && e.message || e),
        stack: String(e && e.stack || '').split('\n').slice(0, 12),
      };
    }
  }

  if (gltfMeta || glbMeta) {
    try {
      const loader = new GLTFLoader(manager);
      let buffer;
      if (glbMeta) {
        buffer = b64ToU8(glbMeta.b64).buffer;
      } else {
        const json = JSON.parse(new TextDecoder().decode(b64ToU8(gltfMeta.b64)));
        convertSpecularGlossinessMaterials(json);
        buffer = JSON.stringify(json);
      }
      const gltf = await new Promise((resolveOk, reject) => {
        loader.parse(buffer, '', resolveOk, reject);
      });
      let meshes = 0;
      let withMap = 0;
      gltf.scene.traverse((o) => {
        if (!o.isMesh) return;
        meshes++;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        if (mats.some(m => m && m.map)) withMap++;
      });
      out.gltf = { ok: true, meshes, withMap };
    } catch (e) {
      out.gltf = {
        ok: false,
        message: String(e && e.message || e),
        stack: String(e && e.stack || '').split('\n').slice(0, 12),
      };
    }
  }

  for (const u of blobUrls) URL.revokeObjectURL(u);
  return out;
}, files);

console.log(JSON.stringify(result, null, 2));
await browser.close();
server.close();
const failed = (result.fbx && result.fbx.ok === false) || (result.gltf && result.gltf.ok === false)
  || (result.gltf && result.gltf.ok && result.gltf.withMap === 0);
process.exit(failed ? 1 : 0);
