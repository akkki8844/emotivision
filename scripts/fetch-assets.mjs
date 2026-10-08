// Prepares everything the app needs at runtime so that it can run with no third-party requests:
//   1. copies the MediaPipe Face Mesh runtime + models (from the npm package) into public/mediapipe/face_mesh
//   2. copies the ONNX Runtime Web WASM runtime into public/ort
//   3. downloads the facial-expression ONNX model and verifies its SHA-256
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pub = join(root, 'public');

const MODEL = {
  file: 'models/enet_b0_8_va_mtl.onnx',
  url: 'https://raw.githubusercontent.com/sb-ai-lab/EmotiEffLib/main/models/affectnet_emotions/onnx/enet_b0_8_va_mtl.onnx',
  // SHA-256 of the file as published at the time this project was built.
  sha256: 'c43e056ad388d4a8dc911832b8291435b2af537f967e5870ebd731574ec7e812',
};

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

function copyDir(srcRel, dstRel, filter = () => true) {
  const src = join(root, 'node_modules', srcRel);
  const dst = join(pub, dstRel);
  if (!existsSync(src)) throw new Error(`Missing ${src}. Run "npm install" first.`);
  mkdirSync(dst, { recursive: true });
  let n = 0;
  for (const f of readdirSync(src)) {
    if (!filter(f)) continue;
    copyFileSync(join(src, f), join(dst, f));
    n++;
  }
  console.log(`  copied ${n} files -> public/${dstRel}`);
}

async function ensureModel() {
  const dst = join(pub, MODEL.file);
  mkdirSync(dirname(dst), { recursive: true });
  if (existsSync(dst) && sha256(readFileSync(dst)) === MODEL.sha256) {
    console.log('  model already present and verified');
    return;
  }
  console.log(`  downloading ${MODEL.url}`);
  const res = await fetch(MODEL.url);
  if (!res.ok) throw new Error(`Model download failed: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const got = sha256(buf);
  if (got !== MODEL.sha256) {
    throw new Error(`Model checksum mismatch.\n expected ${MODEL.sha256}\n got      ${got}`);
  }
  writeFileSync(dst, buf);
  console.log(`  model saved (${(buf.length / 1e6).toFixed(1)} MB, sha256 verified)`);
}

console.log('[1/3] MediaPipe Face Mesh runtime');
copyDir('@mediapipe/face_mesh', 'mediapipe/face_mesh', (f) => !/\.(md|d\.ts|json)$/.test(f));
console.log('[2/3] ONNX Runtime Web (WASM)');
copyDir('onnxruntime-web/dist', 'ort', (f) => /^ort-wasm-simd-threaded(\.(jsep|asyncify))?\.(mjs|wasm)$/.test(f));
console.log('[3/3] Expression model');
await ensureModel();
console.log('Done.');
