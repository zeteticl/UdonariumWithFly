import {
  MeshIR,
  aabbFromPositions,
  assertTriangleBudget,
  computeSmoothNormals,
  transformPositionsZUpToYUp,
} from './mesh-ir';

/**
 * Parse binary or ASCII STL into MeshIR (no color).
 * Applies Z-up → Y-up for print-convention files.
 */
export function parseStl(buffer: ArrayBuffer, fileName = ''): MeshIR {
  const isAscii = looksLikeAsciiStl(buffer);
  const positions = isAscii ? parseAsciiStl(buffer) : parseBinaryStl(buffer);
  const triangleCount = positions.length / 9;
  assertTriangleBudget(triangleCount);
  transformPositionsZUpToYUp(positions);
  const normals = computeSmoothNormals(positions);
  return {
    positions,
    normals,
    triangleCount,
    aabb: aabbFromPositions(positions),
    sourceFormat: 'stl',
    hadColor: false,
    warnings: [],
  };
}

function looksLikeAsciiStl(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < 84) {
    const head = new TextDecoder('ascii', { fatal: false }).decode(buffer.slice(0, Math.min(64, buffer.byteLength)));
    return /^\s*solid\b/i.test(head) && !/\0/.test(head);
  }
  // Binary STL: 80-byte header + uint32 tri count + 50*n bytes.
  const view = new DataView(buffer);
  const tri = view.getUint32(80, true);
  const expected = 84 + tri * 50;
  if (tri > 0 && expected === buffer.byteLength) return false;
  const head = new TextDecoder('ascii', { fatal: false }).decode(buffer.slice(0, 80));
  return /^\s*solid\b/i.test(head) && !head.includes('\0');
}

function parseBinaryStl(buffer: ArrayBuffer): Float32Array {
  if (buffer.byteLength < 84) throw new Error('MODEL_INVALID_STL');
  const view = new DataView(buffer);
  const triCount = view.getUint32(80, true);
  assertTriangleBudget(triCount);
  if (buffer.byteLength < 84 + triCount * 50) throw new Error('MODEL_INVALID_STL');
  const positions = new Float32Array(triCount * 9);
  let o = 0;
  let offset = 84;
  for (let t = 0; t < triCount; t++) {
    offset += 12; // skip normal
    for (let v = 0; v < 3; v++) {
      positions[o++] = view.getFloat32(offset, true); offset += 4;
      positions[o++] = view.getFloat32(offset, true); offset += 4;
      positions[o++] = view.getFloat32(offset, true); offset += 4;
    }
    offset += 2; // attribute
  }
  return positions;
}

function parseAsciiStl(buffer: ArrayBuffer): Float32Array {
  const text = new TextDecoder('ascii', { fatal: false }).decode(buffer);
  const verts: number[] = [];
  const re = /vertex\s+([-+eE0-9.]+)\s+([-+eE0-9.]+)\s+([-+eE0-9.]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    verts.push(+m[1], +m[2], +m[3]);
  }
  if (verts.length < 9 || verts.length % 9 !== 0) throw new Error('MODEL_INVALID_STL');
  const triangleCount = verts.length / 9;
  assertTriangleBudget(triangleCount);
  return Float32Array.from(verts);
}
