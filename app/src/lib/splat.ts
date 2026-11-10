export type Splat = {
  count: number
  pos: Float32Array // xyz
  scale: Float32Array // linear xyz
  rgba: Uint8Array
  rot: Uint8Array // quaternion wxyz, (q*128+128)
}

const SH0 = 0.28209479177387814
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x))
const clamp8 = (x: number) => Math.max(0, Math.min(255, Math.round(x)))

const TYPES: Record<string, [number, (d: DataView, o: number) => number]> = {
  float: [4, (d, o) => d.getFloat32(o, true)], float32: [4, (d, o) => d.getFloat32(o, true)],
  double: [8, (d, o) => d.getFloat64(o, true)], float64: [8, (d, o) => d.getFloat64(o, true)],
  uchar: [1, (d, o) => d.getUint8(o)], uint8: [1, (d, o) => d.getUint8(o)],
  char: [1, (d, o) => d.getInt8(o)], int8: [1, (d, o) => d.getInt8(o)],
  ushort: [2, (d, o) => d.getUint16(o, true)], uint16: [2, (d, o) => d.getUint16(o, true)],
  short: [2, (d, o) => d.getInt16(o, true)], int16: [2, (d, o) => d.getInt16(o, true)],
  uint: [4, (d, o) => d.getUint32(o, true)], uint32: [4, (d, o) => d.getUint32(o, true)],
  int: [4, (d, o) => d.getInt32(o, true)], int32: [4, (d, o) => d.getInt32(o, true)],
}

export function parsePly(buf: ArrayBuffer): Splat {
  const head = new TextDecoder().decode(new Uint8Array(buf, 0, Math.min(buf.byteLength, 16384)))
  const endIdx = head.indexOf('end_header')
  if (!head.startsWith('ply') || endIdx < 0) throw new Error('Not a PLY file')
  const bodyStart = head.indexOf('\n', endIdx) + 1
  const lines = head.slice(0, endIdx).split(/\r?\n/)
  if (!lines.some((l) => l.includes('binary_little_endian'))) throw new Error('Only binary little-endian PLY is supported')
  let count = 0, inVertex = false, stride = 0
  const props: Record<string, { off: number; read: (d: DataView, o: number) => number; type: string }> = {}
  for (const l of lines) {
    const p = l.trim().split(/\s+/)
    if (p[0] === 'element') { inVertex = p[1] === 'vertex'; if (inVertex) count = parseInt(p[2]) }
    else if (p[0] === 'property' && inVertex) {
      const t = TYPES[p[1]]
      if (!t) throw new Error('Unsupported PLY property type ' + p[1])
      props[p[2]] = { off: stride, read: t[1], type: p[1] }
      stride += t[0]
    }
  }
  if (!props.x || !props.y || !props.z) throw new Error('PLY has no x/y/z vertex positions')
  const dv = new DataView(buf, bodyStart)
  if (dv.byteLength < count * stride) throw new Error('PLY file is truncated')
  const out: Splat = {
    count, pos: new Float32Array(count * 3), scale: new Float32Array(count * 3),
    rgba: new Uint8Array(count * 4), rot: new Uint8Array(count * 4),
  }
  const g = (n: string, o: number, def: number) => (props[n] ? props[n].read(dv, o + props[n].off) : def)
  const gaussian = !!props.scale_0 && !!props.f_dc_0
  for (let i = 0; i < count; i++) {
    const o = i * stride
    out.pos[i * 3] = g('x', o, 0); out.pos[i * 3 + 1] = g('y', o, 0); out.pos[i * 3 + 2] = g('z', o, 0)
    if (gaussian) {
      for (let k = 0; k < 3; k++) {
        out.scale[i * 3 + k] = Math.exp(g('scale_' + k, o, -5))
        out.rgba[i * 4 + k] = clamp8((0.5 + SH0 * g('f_dc_' + k, o, 0)) * 255)
      }
      out.rgba[i * 4 + 3] = clamp8(sigmoid(g('opacity', o, 4)) * 255)
      let q = [g('rot_0', o, 1), g('rot_1', o, 0), g('rot_2', o, 0), g('rot_3', o, 0)]
      const n = Math.hypot(...q) || 1
      q = q.map((x) => x / n)
      for (let k = 0; k < 4; k++) out.rot[i * 4 + k] = clamp8(q[k] * 128 + 128)
    } else { // plain coloured point cloud
      const colourScale = props.red && props.red.type.startsWith('f') ? 255 : 1
      out.rgba[i * 4] = clamp8(g('red', o, 200) * colourScale)
      out.rgba[i * 4 + 1] = clamp8(g('green', o, 200) * colourScale)
      out.rgba[i * 4 + 2] = clamp8(g('blue', o, 200) * colourScale)
      out.rgba[i * 4 + 3] = 255
      out.scale.fill(0.01, i * 3, i * 3 + 3)
      out.rot[i * 4] = 255
    }
  }
  return out
}

export function parseSplat(buf: ArrayBuffer): Splat {
  if (buf.byteLength % 32) throw new Error('Not a valid .splat file (size is not a multiple of 32 bytes)')
  const count = buf.byteLength / 32
  const f = new Float32Array(buf), u = new Uint8Array(buf)
  const out: Splat = { count, pos: new Float32Array(count * 3), scale: new Float32Array(count * 3), rgba: new Uint8Array(count * 4), rot: new Uint8Array(count * 4) }
  for (let i = 0; i < count; i++) {
    for (let k = 0; k < 3; k++) { out.pos[i * 3 + k] = f[i * 8 + k]; out.scale[i * 3 + k] = f[i * 8 + 3 + k] }
    out.rgba.set(u.subarray(i * 32 + 24, i * 32 + 28), i * 4)
    out.rot.set(u.subarray(i * 32 + 28, i * 32 + 32), i * 4)
  }
  return out
}

export async function loadSplatFile(file: File): Promise<Splat> {
  const buf = await file.arrayBuffer()
  return /\.splat$/i.test(file.name) ? parseSplat(buf) : parsePly(buf)
}

export function writeSplat(s: Splat): Blob {
  const buf = new ArrayBuffer(s.count * 32)
  const f = new Float32Array(buf), u = new Uint8Array(buf)
  for (let i = 0; i < s.count; i++) {
    for (let k = 0; k < 3; k++) { f[i * 8 + k] = s.pos[i * 3 + k]; f[i * 8 + 3 + k] = s.scale[i * 3 + k] }
    u.set(s.rgba.subarray(i * 4, i * 4 + 4), i * 32 + 24)
    u.set(s.rot.subarray(i * 4, i * 4 + 4), i * 32 + 28)
  }
  return new Blob([buf], { type: 'application/octet-stream' })
}

export function writePly(s: Splat): Blob {
  const names = ['x', 'y', 'z', 'nx', 'ny', 'nz', 'f_dc_0', 'f_dc_1', 'f_dc_2', 'opacity', 'scale_0', 'scale_1', 'scale_2', 'rot_0', 'rot_1', 'rot_2', 'rot_3']
  const header = `ply\nformat binary_little_endian 1.0\nelement vertex ${s.count}\n${names.map((n) => `property float ${n}`).join('\n')}\nend_header\n`
  const hb = new TextEncoder().encode(header)
  const buf = new ArrayBuffer(hb.length + s.count * names.length * 4)
  new Uint8Array(buf).set(hb)
  const f = new Float32Array(buf, hb.length)
  const logit = (p: number) => { p = Math.min(0.9999, Math.max(0.0001, p)); return Math.log(p / (1 - p)) }
  for (let i = 0; i < s.count; i++) {
    const o = i * names.length
    f[o] = s.pos[i * 3]; f[o + 1] = s.pos[i * 3 + 1]; f[o + 2] = s.pos[i * 3 + 2]
    for (let k = 0; k < 3; k++) {
      f[o + 6 + k] = (s.rgba[i * 4 + k] / 255 - 0.5) / SH0
      f[o + 10 + k] = Math.log(Math.max(1e-7, s.scale[i * 3 + k]))
    }
    f[o + 9] = logit(s.rgba[i * 4 + 3] / 255)
    const q = [0, 1, 2, 3].map((k) => (s.rot[i * 4 + k] - 128) / 128)
    const n = Math.hypot(...q) || 1
    for (let k = 0; k < 4; k++) f[o + 13 + k] = q[k] / n
  }
  return new Blob([buf], { type: 'application/octet-stream' })
}

export function stats(s: Splat) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < s.count; i++) for (let k = 0; k < 3; k++) {
    const v = s.pos[i * 3 + k]
    if (v < lo[k]) lo[k] = v
    if (v > hi[k]) hi[k] = v
  }
  return { lo, hi, size: hi.map((h, k) => h - lo[k]) }
}
