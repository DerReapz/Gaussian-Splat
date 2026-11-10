export type Clip = {
  id: string
  file: File
  name: string
  kind: 'video' | 'image'
  codec: string
  dur: number
  w: number
  h: number
  fps: number | null
  status: 'Probing' | 'Ready' | 'Unsupported' | 'Extracted'
  error?: string
  thumb?: string
}

export type Frame = {
  id: string // zero padded global index
  clipId: string
  t: number
  score: number // Laplacian variance (640px long edge, 0-255 gray)
  hash: [number, number] // 64-bit dHash
  thumb: string
  blob: Blob
  w: number
  h: number
  manual?: 'keep' | 'reject'
}

const FPS_SNAP = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60, 120]

function loadVideo(file: File): Promise<HTMLVideoElement> {
  return new Promise((res, rej) => {
    const v = document.createElement('video')
    v.muted = true
    v.playsInline = true
    v.preload = 'auto'
    v.crossOrigin = 'anonymous'
    v.onloadeddata = () => res(v)
    v.onerror = () => rej(new Error('This browser cannot decode this file (codec unsupported)'))
    v.src = URL.createObjectURL(file)
  })
}

async function estimateFps(v: HTMLVideoElement): Promise<number | null> {
  const vfc = (v as HTMLVideoElement & { requestVideoFrameCallback?: (cb: (n: number, m: { mediaTime: number }) => void) => void }).requestVideoFrameCallback
  if (!vfc) return null
  const times: number[] = []
  const done = new Promise<void>((resolve) => {
    const cb = (_: number, m: { mediaTime: number }) => {
      times.push(m.mediaTime)
      if (times.length >= 14) resolve()
      else vfc.call(v, cb)
    }
    vfc.call(v, cb)
    setTimeout(resolve, 1500)
  })
  try { await v.play() } catch { return null }
  await done
  v.pause()
  v.currentTime = 0
  const d = times.slice(1).map((t, i) => t - times[i]).filter((x) => x > 0).sort((a, b) => a - b)
  if (!d.length) return null
  const raw = 1 / d[Math.floor(d.length / 2)]
  const snap = FPS_SNAP.reduce((a, b) => (Math.abs(b - raw) < Math.abs(a - raw) ? b : a))
  return Math.abs(snap - raw) / snap < 0.06 ? snap : Math.round(raw)
}

export async function probeClip(file: File, kind: 'video' | 'image'): Promise<Partial<Clip>> {
  if (kind === 'image') {
    const bmp = await createImageBitmap(file)
    const out = { w: bmp.width, h: bmp.height, dur: 0, fps: null, codec: (file.type || file.name.split('.').pop() || 'image').toUpperCase() }
    bmp.close()
    return out
  }
  const v = await loadVideo(file)
  const info = { w: v.videoWidth, h: v.videoHeight, dur: v.duration, codec: file.type || file.name.split('.').pop()!.toUpperCase(), fps: null as number | null }
  info.fps = await estimateFps(v)
  URL.revokeObjectURL(v.src)
  return info
}

/** How many frames each clip contributes: time-based sampling, scaled down evenly to `max`. */
export function plan(clips: Clip[], fps: number, max: number): Map<string, number> {
  const raw = clips.map((c) => (c.kind === 'image' ? 1 : Math.max(1, c.dur * fps)))
  const total = raw.reduce((a, b) => a + b, 0)
  const k = total > max ? max / total : 1
  return new Map(clips.map((c, i) => [c.id, Math.max(1, Math.round(raw[i] * k))]))
}

// ---- image analysis -------------------------------------------------------

const small = document.createElement('canvas')
const tiny = document.createElement('canvas')
tiny.width = 9
tiny.height = 8

function analyse(src: CanvasImageSource, sw: number, sh: number): { score: number; hash: [number, number] } {
  const k = Math.min(1, 640 / Math.max(sw, sh))
  const w = Math.max(3, Math.round(sw * k)), h = Math.max(3, Math.round(sh * k))
  small.width = w; small.height = h
  const sc = small.getContext('2d', { willReadFrequently: true })!
  sc.drawImage(src, 0, 0, w, h)
  const d = sc.getImageData(0, 0, w, h).data
  const g = new Float32Array(w * h)
  for (let i = 0, j = 0; i < g.length; i++, j += 4) g[i] = 0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2]
  let sum = 0, sum2 = 0, n = 0
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x
    const l = g[i - 1] + g[i + 1] + g[i - w] + g[i + w] - 4 * g[i]
    sum += l; sum2 += l * l; n++
  }
  const score = sum2 / n - (sum / n) ** 2

  const tc = tiny.getContext('2d', { willReadFrequently: true })!
  tc.drawImage(small, 0, 0, 9, 8)
  const t = tc.getImageData(0, 0, 9, 8).data
  let hi = 0, lo = 0, bit = 0
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    const a = t[(y * 9 + x) * 4 + 1], b = t[(y * 9 + x + 1) * 4 + 1]
    const v = a > b ? 1 : 0
    if (bit < 32) lo = (lo | (v << bit)) >>> 0; else hi = (hi | (v << (bit - 32))) >>> 0
    bit++
  }
  return { score, hash: [hi, lo] }
}

const pop = (x: number) => { x >>>= 0; let c = 0; while (x) { c += x & 1; x &= x - 1 } return c }
export const hamming = (a: [number, number], b: [number, number]) => pop(a[0] ^ b[0]) + pop(a[1] ^ b[1])

export type Reason = 'BLUR' | 'DUPLICATE' | 'MANUAL' | null

/** Recomputed live from stored scores, so the threshold slider/field is instant. */
export function classify(frames: Frame[], blur: number): Reason[] {
  const out: Reason[] = []
  const lastKept = new Map<string, Frame>()
  for (const f of frames) {
    let r: Reason = null
    if (f.manual === 'reject') r = 'MANUAL'
    else if (f.manual === 'keep') r = null
    else if (f.score < blur) r = 'BLUR'
    else {
      const prev = lastKept.get(f.clipId)
      if (prev && hamming(prev.hash, f.hash) <= 2) r = 'DUPLICATE'
    }
    if (!r) lastKept.set(f.clipId, f)
    out.push(r)
  }
  return out
}

const toBlob = (c: HTMLCanvasElement, q: number) => new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('encode failed'))), 'image/jpeg', q))

const big = document.createElement('canvas')
const th = document.createElement('canvas')

async function emit(src: CanvasImageSource, sw: number, sh: number, edge: number, clipId: string, t: number): Promise<Omit<Frame, 'id'>> {
  const k = Math.min(1, edge / Math.max(sw, sh))
  const w = Math.round(sw * k), h = Math.round(sh * k)
  big.width = w; big.height = h
  big.getContext('2d')!.drawImage(src, 0, 0, w, h)
  const { score, hash } = analyse(big, w, h)
  const blob = await toBlob(big, 0.95)
  const tk = 240 / Math.max(w, h)
  th.width = Math.round(w * tk); th.height = Math.round(h * tk)
  th.getContext('2d')!.drawImage(big, 0, 0, th.width, th.height)
  const thumb = URL.createObjectURL(await toBlob(th, 0.7))
  return { clipId, t, score, hash, thumb, blob, w, h }
}

function seek(v: HTMLVideoElement, t: number) {
  return new Promise<void>((res) => {
    const done = () => { v.removeEventListener('seeked', done); clearTimeout(to); res() }
    const to = setTimeout(done, 4000)
    v.addEventListener('seeked', done)
    v.currentTime = t
  })
}

export async function extractClip(
  clip: Clip, count: number, edge: number, signal: AbortSignal, onFrame: (f: Omit<Frame, 'id'>) => void,
) {
  if (clip.kind === 'image') {
    const bmp = await createImageBitmap(clip.file)
    onFrame(await emit(bmp, bmp.width, bmp.height, edge, clip.id, 0))
    bmp.close()
    return
  }
  const v = await loadVideo(clip.file)
  try {
    for (let i = 0; i < count; i++) {
      if (signal.aborted) return
      const t = Math.min(clip.dur - 0.01, ((i + 0.5) * clip.dur) / count)
      await seek(v, t)
      onFrame(await emit(v, v.videoWidth, v.videoHeight, edge, clip.id, t))
    }
  } finally {
    URL.revokeObjectURL(v.src)
  }
}
