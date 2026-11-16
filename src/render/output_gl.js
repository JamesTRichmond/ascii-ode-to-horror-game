// GPU output (guide phase 6, task 5-1): one instanced draw call for the whole glyph stream.
// The atlas is sampled as DATA (no sRGB decode, no premultiply); coverage is reconstructed from
// the median of the three distance channels with a screen-space derived pixel range.
import { INSTANCE_FLOATS } from './select.js';

const VS = `#version 300 es
precision highp float;
layout(location=0) in vec2 corner;            // unit quad, -1..1
layout(location=1) in vec4 iCenterAxisA;      // cx, cy, ax, ay
layout(location=2) in vec3 iAxisBGlyph;       // bx, by, glyph
layout(location=3) in vec4 iColor;            // scene-linear rgb, alpha
uniform vec2 uView;                           // G-buffer size in pixels
uniform vec2 uGrid;                           // atlas columns, rows
out vec2 vUv; out vec4 vColor;
void main() {
  vec2 p = iCenterAxisA.xy + iCenterAxisA.zw * corner.x + iAxisBGlyph.xy * corner.y;
  gl_Position = vec4(p / uView * 2.0 - 1.0, 0.0, 1.0); gl_Position.y = -gl_Position.y;
  float g = iAxisBGlyph.z; vec2 tile = vec2(mod(g, uGrid.x), floor(g / uGrid.x));
  vUv = (tile + corner * 0.5 + 0.5) / uGrid; vColor = iColor;
}`;
const FS = `#version 300 es
precision highp float;
uniform sampler2D uAtlas; uniform vec2 uAtlasSize; uniform float uRange; uniform mat3 uCvd;   // colour-vision correction (identity when off)
in vec2 vUv; in vec4 vColor; out vec4 frag;
float median3(vec3 v) { return max(min(v.r, v.g), min(max(v.r, v.g), v.b)); }
void main() {
  float sd = median3(texture(uAtlas, vUv).rgb) - 0.5;
  vec2 texel = fwidth(vUv) * uAtlasSize;                       // atlas texels per screen pixel
  float pxRange = max(uRange / max(max(texel.x, texel.y), 1e-4), 1.0);
  float a = clamp(sd * pxRange + 0.5, 0.0, 1.0) * vColor.a;
  vec3 lin = max(uCvd * vColor.rgb, 0.0);
  vec3 c = pow(clamp(lin / (1.0 + lin), 0.0, 1.0), vec3(0.65));   // same tone curve as the CPU reference
  frag = vec4(c * a, a);
}`;

export function createGLOutput(canvas, atlas, atlasImage) {
  const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, premultipliedAlpha: true, powerPreference: 'high-performance' });
  if (!gl) return null;
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
  const prog = gl.createProgram(); gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
  const quad = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, quad); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const ibuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, ibuf); let capacity = 0;
  const stride = INSTANCE_FLOATS * 4;
  for (const [loc, size, off] of [[1, 4, 0], [2, 3, 16], [3, 4, 28]]) { gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, off); gl.vertexAttribDivisor(loc, 1); }
  const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB8, gl.RGB, gl.UNSIGNED_BYTE, atlasImage);   // RGB8, never SRGB8
  for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
  const U = n => gl.getUniformLocation(prog, n), u = { view: U('uView'), grid: U('uGrid'), atlas: U('uAtlas'), size: U('uAtlasSize'), range: U('uRange'), cvd: U('uCvd') };
  let cvd = Float32Array.of(1, 0, 0, 0, 1, 0, 0, 0, 1);
  const stats = { uploadMs: 0, drawMs: 0, instances: 0, bytes: 0 };
  return {
    kind: 'webgl2', gl, stats,
    /** Column-major 3x3 colour-vision correction (see render/cvd.js). */
    setCvd(m) { cvd = Float32Array.from(m); },
    draw(inst, count, w, h, background = [3 / 255, 5 / 255, 11 / 255]) {
      const t0 = performance.now();
      gl.viewport(0, 0, canvas.width, canvas.height); gl.clearColor(background[0], background[1], background[2], 1); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(prog); gl.bindVertexArray(vao); gl.bindBuffer(gl.ARRAY_BUFFER, ibuf);
      const view = inst.subarray(0, count * INSTANCE_FLOATS);
      if (count > capacity) { capacity = Math.ceil(count * 1.5); gl.bufferData(gl.ARRAY_BUFFER, capacity * stride, gl.DYNAMIC_DRAW); }
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, view);
      const t1 = performance.now();
      gl.uniform2f(u.view, w, h); gl.uniform2f(u.grid, atlas.cols, atlas.rows); gl.uniform2f(u.size, atlas.cols * atlas.tileW, atlas.rows * atlas.tileH); gl.uniform1f(u.range, atlas.range); gl.uniformMatrix3fv(u.cvd, false, cvd);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(u.atlas, 0);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
      stats.uploadMs = t1 - t0; stats.drawMs = performance.now() - t1; stats.instances = count; stats.bytes = view.byteLength;
    },
  };
}
