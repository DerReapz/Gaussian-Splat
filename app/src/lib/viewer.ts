import type { Splat } from './splat'

export type ViewMode = 'rgb' | 'depth' | 'ellipsoids'

const VS = `#version 300 es
precision highp float;
in vec3 aPos; in vec3 aScale; in vec4 aCol;
uniform mat4 uView; uniform mat4 uProj; uniform float uFocal; uniform float uMode; uniform float uDpr; uniform vec2 uDepth;
out vec4 vCol; out float vT;
void main(){
  vec4 v = uView * vec4(aPos,1.0);
  float d = max(-v.z, 0.01);
  gl_Position = uProj * v;
  float r = (aScale.x + aScale.y + aScale.z) / 3.0;
  float px = clamp(6.0 * r * uFocal / d, 1.5 * uDpr, 160.0 * uDpr);
  gl_PointSize = px;
  vCol = aCol;
  vT = clamp((d - uDepth.x) / max(uDepth.y - uDepth.x, 1e-4), 0.0, 1.0);
}`
const FS = `#version 300 es
precision highp float;
in vec4 vCol; in float vT;
uniform float uMode;
out vec4 o;
vec3 ramp(float t){ return clamp(vec3(1.5 - abs(4.0*t-3.0), 1.5 - abs(4.0*t-2.0), 1.5 - abs(4.0*t-1.0)), 0.0, 1.0); }
void main(){
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(c, c);
  if (r2 > 1.0) discard;
  float a = uMode > 1.5 ? (r2 > 0.55 ? 0.0 : max(vCol.a, 0.6)) : vCol.a * exp(-r2 * 4.5);
  if (a < 0.004) discard;
  vec3 rgb = uMode > 0.5 && uMode < 1.5 ? ramp(1.0 - vT) : vCol.rgb;
  o = vec4(rgb, a);
}`

type M = Float32Array

function perspective(fov: number, asp: number, n: number, f: number): M {
  const t = 1 / Math.tan(fov / 2)
  return new Float32Array([t / asp, 0, 0, 0, 0, t, 0, 0, 0, 0, (f + n) / (n - f), -1, 0, 0, (2 * f * n) / (n - f), 0])
}
function lookAt(e: number[], c: number[], up: number[]): M {
  const sub = (a: number[], b: number[]) => a.map((x, i) => x - b[i])
  const norm = (a: number[]) => { const l = Math.hypot(...a) || 1; return a.map((x) => x / l) }
  const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
  const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
  const z = norm(sub(e, c)), x = norm(cross(up, z)), y = cross(z, x)
  return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, e), -dot(y, e), -dot(z, e), 1])
}

export class SplatViewer {
  private gl: WebGL2RenderingContext
  private prog: WebGLProgram
  private vbo: WebGLBuffer
  private ebo: WebGLBuffer
  private n = 0
  private idx = new Uint32Array(0)
  private depthKeys = new Float32Array(0)
  private pos: Float32Array = new Float32Array(0)
  private center = [0, 0, 0]
  private radius = 1
  private yaw = 0.6
  private pitch = 0.25
  private dist = 3
  private flip = 1
  private mode: ViewMode = 'rgb'
  private dirty = true
  private lastSort = 0
  private lastInput = 0
  private raf = 0
  private dragging = false
  private px = 0
  private py = 0
  private ro: ResizeObserver
  private off: (() => void)[] = []
  autoRotate = true

  private canvas: HTMLCanvasElement
  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false })
    if (!gl) throw new Error('WebGL2 is not available in this browser')
    this.gl = gl
    const sh = (t: number, s: string) => { const o = gl.createShader(t)!; gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o) || 'shader'); return o }
    this.prog = gl.createProgram()!
    gl.attachShader(this.prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(this.prog, sh(gl.FRAGMENT_SHADER, FS))
    gl.bindAttribLocation(this.prog, 0, 'aPos'); gl.bindAttribLocation(this.prog, 1, 'aScale'); gl.bindAttribLocation(this.prog, 2, 'aCol')
    gl.linkProgram(this.prog)
    if (!gl.getProgramParameter(this.prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(this.prog) || 'link')
    this.vbo = gl.createBuffer()!; this.ebo = gl.createBuffer()!

    const on = <K extends keyof HTMLElementEventMap>(t: K, f: (e: HTMLElementEventMap[K]) => void, o?: AddEventListenerOptions) => {
      canvas.addEventListener(t, f as EventListener, o); this.off.push(() => canvas.removeEventListener(t, f as EventListener))
    }
    on('pointerdown', (e) => { this.dragging = true; this.px = e.clientX; this.py = e.clientY; canvas.setPointerCapture(e.pointerId); this.autoRotate = false })
    on('pointerup', () => { this.dragging = false })
    on('pointermove', (e) => {
      if (!this.dragging) return
      this.yaw -= (e.clientX - this.px) * 0.006
      this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch + (e.clientY - this.py) * 0.006 * this.flip))
      this.px = e.clientX; this.py = e.clientY; this.touch()
    })
    on('wheel', (e) => { e.preventDefault(); this.dist = Math.max(this.radius * 0.05, this.dist * Math.exp(e.deltaY * 0.001)); this.touch() }, { passive: false })
    this.ro = new ResizeObserver(() => { this.dirty = true })
    this.ro.observe(canvas)
    const loop = () => { this.raf = requestAnimationFrame(loop); this.frame() }
    this.raf = requestAnimationFrame(loop)
  }

  private touch() { this.dirty = true; this.lastInput = performance.now() }

  setMode(m: ViewMode) { this.mode = m; this.dirty = true }
  setFlip(f: boolean) { this.flip = f ? -1 : 1; this.dirty = true; this.lastSort = 0 }
  resetView() { this.yaw = 0.6; this.pitch = 0.25; this.dist = this.radius * 2.4; this.autoRotate = true; this.dirty = true }

  setSplat(s: Splat | null) {
    const gl = this.gl
    if (!s || !s.count) { this.n = 0; this.dirty = true; return }
    this.n = s.count; this.pos = s.pos
    // robust centre / radius from a strided sample (median + 90th pct distance)
    const step = Math.max(1, Math.floor(s.count / 20000))
    const xs: number[][] = [[], [], []]
    for (let i = 0; i < s.count; i += step) for (let k = 0; k < 3; k++) xs[k].push(s.pos[i * 3 + k])
    this.center = xs.map((a) => { a.sort((p, q) => p - q); return a[a.length >> 1] })
    const ds = xs[0].map((_, i) => Math.hypot(xs[0][i] - this.center[0], xs[1][i] - this.center[1], xs[2][i] - this.center[2])).sort((p, q) => p - q)
    this.radius = Math.max(1e-3, ds[Math.floor(ds.length * 0.9)])
    this.dist = this.radius * 2.4

    // interleave: pos(12) scale(12) rgba(4) = 28 bytes
    const buf = new ArrayBuffer(s.count * 28)
    const f = new Float32Array(buf), u = new Uint8Array(buf)
    for (let i = 0; i < s.count; i++) {
      const o = i * 7
      f[o] = s.pos[i * 3]; f[o + 1] = s.pos[i * 3 + 1]; f[o + 2] = s.pos[i * 3 + 2]
      f[o + 3] = s.scale[i * 3]; f[o + 4] = s.scale[i * 3 + 1]; f[o + 5] = s.scale[i * 3 + 2]
      u.set(s.rgba.subarray(i * 4, i * 4 + 4), i * 28 + 24)
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo)
    gl.bufferData(gl.ARRAY_BUFFER, buf, gl.STATIC_DRAW)
    this.idx = new Uint32Array(s.count)
    this.depthKeys = new Float32Array(s.count)
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ebo)
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, this.idx.byteLength, gl.DYNAMIC_DRAW)
    this.lastSort = 0; this.autoRotate = true; this.dirty = true
  }

  private eye(): number[] {
    const cy = Math.cos(this.pitch), c = this.center
    return [c[0] + this.dist * cy * Math.sin(this.yaw), c[1] + this.flip * this.dist * Math.sin(this.pitch), c[2] + this.dist * cy * Math.cos(this.yaw)]
  }

  private sort(eye: number[], fwd: number[]) {
    const n = this.n, p = this.pos, k = this.depthKeys
    let mn = Infinity, mx = -Infinity
    for (let i = 0; i < n; i++) {
      const d = (p[i * 3] - eye[0]) * fwd[0] + (p[i * 3 + 1] - eye[1]) * fwd[1] + (p[i * 3 + 2] - eye[2]) * fwd[2]
      k[i] = d; if (d < mn) mn = d; if (d > mx) mx = d
    }
    const B = 65535, scale = B / Math.max(mx - mn, 1e-6)
    const counts = new Uint32Array(B + 2)
    for (let i = 0; i < n; i++) counts[B - ((k[i] - mn) * scale | 0) + 1]++ // far first
    for (let i = 1; i < counts.length; i++) counts[i] += counts[i - 1]
    for (let i = 0; i < n; i++) this.idx[counts[B - ((k[i] - mn) * scale | 0)]++] = i
    const gl = this.gl
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ebo)
    gl.bufferSubData(gl.ELEMENT_ARRAY_BUFFER, 0, this.idx)
    this.depthRange = [Math.max(0.01, mn), mx]
  }
  private depthRange = [0.1, 10]

  private frame() {
    const now = performance.now()
    if (this.autoRotate && this.n && !this.dragging) { this.yaw += 0.003; this.dirty = true }
    const c = this.canvas, dpr = Math.min(window.devicePixelRatio || 1, 2)
    const W = Math.max(1, Math.round(c.clientWidth * dpr)), H = Math.max(1, Math.round(c.clientHeight * dpr))
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; this.dirty = true }
    if (!this.dirty) return
    this.dirty = false
    const gl = this.gl
    gl.viewport(0, 0, W, H)
    gl.clearColor(0.031, 0.035, 0.039, 1); gl.clear(gl.COLOR_BUFFER_BIT)
    if (!this.n) return
    const fov = 0.9, eye = this.eye()
    const view = lookAt(eye, this.center, [0, this.flip, 0])
    const fwd = [-view[2], -view[6], -view[10]]
    if (now - this.lastSort > 80 || this.lastSort === 0) { this.sort(eye, fwd); this.lastSort = now }
    gl.useProgram(this.prog)
    const u = (n: string) => gl.getUniformLocation(this.prog, n)
    gl.uniformMatrix4fv(u('uView'), false, view)
    gl.uniformMatrix4fv(u('uProj'), false, perspective(fov, W / H, this.radius * 0.01, this.radius * 60))
    gl.uniform1f(u('uFocal'), (0.5 * H) / Math.tan(fov / 2))
    gl.uniform1f(u('uMode'), this.mode === 'rgb' ? 0 : this.mode === 'depth' ? 1 : 2)
    gl.uniform1f(u('uDpr'), dpr)
    gl.uniform2f(u('uDepth'), this.depthRange[0], this.depthRange[1])
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo)
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 28, 0)
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 28, 12)
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.UNSIGNED_BYTE, true, 28, 24)
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ebo)
    gl.drawElements(gl.POINTS, this.n, gl.UNSIGNED_INT, 0)
    // keep re-sorting shortly after interaction stops so the final frame is correct
    if (now - this.lastInput < 300) this.dirty = true
  }

  dispose() {
    cancelAnimationFrame(this.raf); this.ro.disconnect(); this.off.forEach((f) => f())
  }
}
