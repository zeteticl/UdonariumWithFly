import { TerrainFaceName } from '@udonarium/terrain';

import { MeshAabb, MeshIR, MODEL_BAKE_SIZE_DEFAULT, MODEL_BAKE_SIZE_MAX } from './mesh-ir';
import {
  FACE_VIEWS,
  aabbCenter as aabbCenterOf,
  aabbMaxExtent,
  canvasSizeForFace,
  faceOrthoSize,
} from './ortho-face-views';

export type BakedFaceBlobs = Partial<Record<TerrainFaceName, Blob>>;

/**
 * Bake six orthographic PNGs. Uses a temporary WebGL context then loses it.
 */
export async function bakeSixOrthoFaces(
  mesh: MeshIR,
  size: number = MODEL_BAKE_SIZE_DEFAULT,
  aabb: MeshAabb = mesh.aabb,
): Promise<BakedFaceBlobs> {
  const dim = Math.max(64, Math.min(MODEL_BAKE_SIZE_MAX, size | 0));
  const canvas = document.createElement('canvas');
  canvas.width = dim;
  canvas.height = dim;
  const gl = canvas.getContext('webgl', {
    alpha: true,
    antialias: true,
    preserveDrawingBuffer: true,
    premultipliedAlpha: false,
  });
  if (!gl) throw new Error('MODEL_NO_WEBGL');

  try {
    const program = createProgram(gl);
    const buffers = uploadMesh(gl, mesh);
    const albedoTex = mesh.albedoImage ? createTexture(gl, mesh.albedoImage) : null;
    const center = aabbCenterOf(aabb);
    const maxExtent = aabbMaxExtent(aabb);
    const out: BakedFaceBlobs = {};

    for (const view of FACE_VIEWS) {
      const face = faceOrthoSize(aabb, view.eye);
      const { width, height } = canvasSizeForFace(
        face.width,
        face.height,
        dim,
        aabbMaxExtent(mesh.aabb),
      );
      canvas.width = width;
      canvas.height = height;
      drawView(gl, program, buffers, albedoTex, !!mesh.albedoImage, {
        width,
        height,
        center,
        maxExtent,
        faceWidth: face.width,
        faceHeight: face.height,
        eyeDir: view.eye,
        up: view.up,
        useVertexColor: !!mesh.vertexColors,
      });
      out[view.face] = await canvasToPngBlob(canvas);
    }
    return out;
  } finally {
    const lose = (gl as any).getExtension?.('WEBGL_lose_context');
    lose?.loseContext?.();
  }
}

type GpuBuffers = {
  pos: WebGLBuffer;
  nrm: WebGLBuffer;
  uv: WebGLBuffer;
  col: WebGLBuffer;
  count: number;
};

function uploadMesh(gl: WebGLRenderingContext, mesh: MeshIR): GpuBuffers {
  const pos = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, pos);
  gl.bufferData(gl.ARRAY_BUFFER, mesh.positions, gl.STATIC_DRAW);

  const nrmData = mesh.normals || new Float32Array(mesh.positions.length);
  const nrm = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, nrm);
  gl.bufferData(gl.ARRAY_BUFFER, nrmData, gl.STATIC_DRAW);

  const uvData = mesh.uvs || new Float32Array((mesh.positions.length / 3) * 2);
  const uv = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, uv);
  gl.bufferData(gl.ARRAY_BUFFER, uvData, gl.STATIC_DRAW);

  const colData = mesh.vertexColors || flatColor(mesh.positions.length / 3, 0.75, 0.75, 0.75);
  const col = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, col);
  gl.bufferData(gl.ARRAY_BUFFER, colData, gl.STATIC_DRAW);

  return { pos, nrm, uv, col, count: mesh.positions.length / 3 };
}

function flatColor(vertCount: number, r: number, g: number, b: number): Float32Array {
  const a = new Float32Array(vertCount * 3);
  for (let i = 0; i < vertCount; i++) {
    a[i * 3] = r; a[i * 3 + 1] = g; a[i * 3 + 2] = b;
  }
  return a;
}

function createTexture(gl: WebGLRenderingContext, image: CanvasImageSource): WebGLTexture {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image as any);
  return tex;
}

function createProgram(gl: WebGLRenderingContext): WebGLProgram {
  const vs = `
    attribute vec3 aPos;
    attribute vec3 aNrm;
    attribute vec2 aUv;
    attribute vec3 aCol;
    uniform mat4 uMVP;
    uniform mat3 uNMat;
    varying vec3 vNrm;
    varying vec2 vUv;
    varying vec3 vCol;
    void main() {
      vNrm = normalize(uNMat * aNrm);
      vUv = aUv;
      vCol = aCol;
      gl_Position = uMVP * vec4(aPos, 1.0);
    }
  `;
  const fs = `
    precision mediump float;
    varying vec3 vNrm;
    varying vec2 vUv;
    varying vec3 vCol;
    uniform sampler2D uAlbedo;
    uniform float uUseAlbedo;
    uniform vec3 uLightDir;
    void main() {
      vec3 base = vCol;
      if (uUseAlbedo > 0.5) {
        vec4 t = texture2D(uAlbedo, vUv);
        if (t.a < 0.05) discard;
        base = t.rgb * vCol;
      }
      float ndl = max(dot(normalize(vNrm), normalize(uLightDir)), 0.0);
      float shade = 0.35 + 0.65 * ndl;
      gl_FragColor = vec4(base * shade, 1.0);
    }
  `;
  const prog = gl.createProgram()!;
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    throw new Error('MODEL_NO_WEBGL');
  }
  return prog;
}

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    throw new Error('MODEL_NO_WEBGL');
  }
  return sh;
}

function drawView(
  gl: WebGLRenderingContext,
  program: WebGLProgram,
  buffers: GpuBuffers,
  albedoTex: WebGLTexture | null,
  useAlbedo: boolean,
  opts: {
    width: number;
    height: number;
    center: [number, number, number];
    maxExtent: number;
    faceWidth: number;
    faceHeight: number;
    eyeDir: [number, number, number];
    up: [number, number, number];
    useVertexColor: boolean;
  },
): void {
  gl.viewport(0, 0, opts.width, opts.height);
  gl.clearColor(0, 0, 0, 0);
  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.CULL_FACE);
  gl.cullFace(gl.BACK);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  gl.useProgram(program);
  bindAttrib(gl, program, 'aPos', buffers.pos, 3);
  bindAttrib(gl, program, 'aNrm', buffers.nrm, 3);
  bindAttrib(gl, program, 'aUv', buffers.uv, 2);
  bindAttrib(gl, program, 'aCol', buffers.col, 3);

  const hw = Math.max(opts.faceWidth * 0.5 * 1.05, 1e-3);
  const hh = Math.max(opts.faceHeight * 0.5 * 1.05, 1e-3);
  const camDist = Math.max(opts.maxExtent * 2, 1e-3);
  const eye: [number, number, number] = [
    opts.center[0] + opts.eyeDir[0] * camDist,
    opts.center[1] + opts.eyeDir[1] * camDist,
    opts.center[2] + opts.eyeDir[2] * camDist,
  ];
  const view = lookAt(eye, opts.center, opts.up);
  const proj = ortho(-hw, hw, -hh, hh, 0.01, camDist * 2);
  const mvp = mul4(proj, view);
  const nMat = [
    view[0], view[1], view[2],
    view[4], view[5], view[6],
    view[8], view[9], view[10],
  ];

  gl.uniformMatrix4fv(gl.getUniformLocation(program, 'uMVP'), false, mvp);
  gl.uniformMatrix3fv(gl.getUniformLocation(program, 'uNMat'), false, new Float32Array(nMat));
  gl.uniform3fv(gl.getUniformLocation(program, 'uLightDir'), new Float32Array([0.4, 0.85, 0.35]));
  gl.uniform1f(gl.getUniformLocation(program, 'uUseAlbedo'), useAlbedo && albedoTex ? 1 : 0);
  if (albedoTex) {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, albedoTex);
    gl.uniform1i(gl.getUniformLocation(program, 'uAlbedo'), 0);
  }
  gl.drawArrays(gl.TRIANGLES, 0, buffers.count);
}

function bindAttrib(
  gl: WebGLRenderingContext,
  program: WebGLProgram,
  name: string,
  buffer: WebGLBuffer,
  size: number,
): void {
  const loc = gl.getAttribLocation(program, name);
  if (loc < 0) return;
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
}

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('MODEL_BAKE_FAILED'))), 'image/png');
  });
}

function lookAt(
  eye: [number, number, number],
  center: [number, number, number],
  up: [number, number, number],
): Float32Array {
  const zx = eye[0] - center[0];
  const zy = eye[1] - center[1];
  const zz = eye[2] - center[2];
  let zl = Math.hypot(zx, zy, zz) || 1;
  const z0 = zx / zl; const z1 = zy / zl; const z2 = zz / zl;
  let xx = up[1] * z2 - up[2] * z1;
  let xy = up[2] * z0 - up[0] * z2;
  let xz = up[0] * z1 - up[1] * z0;
  let xl = Math.hypot(xx, xy, xz) || 1;
  xx /= xl; xy /= xl; xz /= xl;
  const y0 = z1 * xz - z2 * xy;
  const y1 = z2 * xx - z0 * xz;
  const y2 = z0 * xy - z1 * xx;
  return new Float32Array([
    xx, y0, z0, 0,
    xy, y1, z1, 0,
    xz, y2, z2, 0,
    -(xx * eye[0] + xy * eye[1] + xz * eye[2]),
    -(y0 * eye[0] + y1 * eye[1] + y2 * eye[2]),
    -(z0 * eye[0] + z1 * eye[1] + z2 * eye[2]),
    1,
  ]);
}

function ortho(l: number, r: number, b: number, t: number, n: number, f: number): Float32Array {
  const out = new Float32Array(16);
  out[0] = 2 / (r - l);
  out[5] = 2 / (t - b);
  out[10] = -2 / (f - n);
  out[12] = -(r + l) / (r - l);
  out[13] = -(t + b) / (t - b);
  out[14] = -(f + n) / (f - n);
  out[15] = 1;
  return out;
}

function mul4(a: Float32Array, b: Float32Array): Float32Array {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      o[c * 4 + r] =
        a[0 * 4 + r] * b[c * 4 + 0] +
        a[1 * 4 + r] * b[c * 4 + 1] +
        a[2 * 4 + r] * b[c * 4 + 2] +
        a[3 * 4 + r] * b[c * 4 + 3];
    }
  }
  return o;
}
