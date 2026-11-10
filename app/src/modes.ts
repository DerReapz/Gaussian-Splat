export type ModeKey = 'object' | 'room' | 'env'

export type RowDef = {
  id: string
  label: string
  hint: string
  kind: 'toggle' | 'select' | 'text'
  options?: string[]
  def: string | boolean
}
export type GroupDef = { title: string; tag: string; rows: RowDef[] }
export type ExtractSettings = { fps: string; max: string; blur: string; res: string }

export type ModeDef = {
  label: string
  short: string
  desc: string
  extract: ExtractSettings
  groups: GroupDef[]
}

export const RES_OPTIONS = ['1080p', '1440p', '2160p', '4320p']
export const resToEdge = (r: string) => parseInt(r) * (16 / 9) | 0

const CAMERA = ['Pinhole', 'Simple radial', 'OpenCV', 'OpenCV fisheye']
const MATCHER = ['Sequential', 'Sequential + loop', 'Sequential + vocab tree', 'Spatial (GPS) + vocab tree', 'Exhaustive']

const t = (id: string, label: string, hint: string, def: string): RowDef => ({ id, label, hint, kind: 'text', def })
const b = (id: string, label: string, hint: string, def: boolean): RowDef => ({ id, label, hint, kind: 'toggle', def })
const s = (id: string, label: string, hint: string, options: string[], def: string): RowDef => ({ id, label, hint, kind: 'select', options, def })

export const MODES: Record<ModeKey, ModeDef> = {
  object: {
    label: 'Object',
    short: 'Tight orbit around a single subject. Background is masked out.',
    desc: 'Tuned for turntable or orbit captures of a single subject. The background is segmented away, the scene is normalized to a unit sphere, and densification is aggressive to resolve fine surface detail.',
    extract: { fps: '4', max: '300', blur: '120', res: '2160p' },
    groups: [
      { title: 'Camera solve', tag: 'SfM', rows: [
        s('camera', 'Camera model', 'Single shared intrinsics', CAMERA, 'Pinhole'),
        s('matcher', 'Matcher', 'Orbit closes on itself', MATCHER, 'Sequential + loop'),
        t('features', 'Feature count', 'Per frame', '8192'),
        b('maskFeatures', 'Mask features to subject', 'Ignores background keypoints', true),
      ] },
      { title: 'Subject & bounds', tag: 'SCENE', rows: [
        b('bgRemoval', 'Background removal', 'Auto-segment subject', true),
        b('unitSphere', 'Normalize to unit sphere', 'Centers on subject', true),
        t('bounds', 'Bounding volume', 'Culls floaters outside', 'Tight · 1.1×'),
        b('ground', 'Ground plane', 'Off for turntables', false),
      ] },
      { title: 'Training', tag: '3DGS', rows: [
        t('iters', 'Iterations', '', '30000'),
        t('sh', 'SH degree', 'View-dependent color', '3'),
        t('densifyUntil', 'Densify until', 'Stop splitting after', '15000'),
        t('extra', 'Densify grad threshold', 'Lower = more detail', '0.0001'),
        t('maxg', 'Max gaussians', 'Hard cap', '1.5M'),
      ] },
    ],
  },
  room: {
    label: 'Room',
    short: 'Inside-out walkthrough of an interior. Handles exposure shifts and flat walls.',
    desc: 'Tuned for handheld walkthroughs of interior spaces. Exposure is compensated between frames, depth priors regularize flat walls and floors, and the scene is aligned so the floor sits at Y = 0.',
    extract: { fps: '2', max: '600', blur: '100', res: '1440p' },
    groups: [
      { title: 'Camera solve', tag: 'SfM', rows: [
        s('camera', 'Camera model', 'Corrects phone lens distortion', CAMERA, 'Simple radial'),
        s('matcher', 'Matcher', 'Recovers revisited corners', MATCHER, 'Sequential + vocab tree'),
        t('features', 'Feature count', 'Per frame', '12000'),
        b('rig', 'Rig / IMU priors', 'Use device metadata if present', true),
      ] },
      { title: 'Interior', tag: 'SCENE', rows: [
        b('exposure', 'Exposure compensation', 'Per-frame affine color', true),
        b('depthReg', 'Depth regularization', 'Monocular depth prior', true),
        b('floor', 'Floor alignment', 'Gravity-up, floor at Y = 0', true),
        b('windowMask', 'Window masking', 'Mask blown-out glass', false),
      ] },
      { title: 'Training', tag: '3DGS', rows: [
        t('iters', 'Iterations', '', '30000'),
        t('sh', 'SH degree', '', '3'),
        t('densifyUntil', 'Densify until', '', '15000'),
        t('extra', 'Opacity reset interval', 'Removes floaters', '3000'),
        t('maxg', 'Max gaussians', 'Hard cap', '3.5M'),
      ] },
    ],
  },
  env: {
    label: 'Environment',
    short: 'Large outdoor or open area. Sky handled separately, scales to millions of splats.',
    desc: 'Tuned for large outdoor captures such as drone flights, streets and landscapes. Sky is masked to a background model, appearance embeddings absorb lighting changes, and output is built with level-of-detail chunks.',
    extract: { fps: '1', max: '1500', blur: '80', res: '2160p' },
    groups: [
      { title: 'Camera solve', tag: 'SfM', rows: [
        s('camera', 'Camera model', 'Wide / action cams', CAMERA, 'OpenCV fisheye'),
        s('matcher', 'Matcher', 'Uses EXIF / SRT GPS', MATCHER, 'Spatial (GPS) + vocab tree'),
        t('features', 'Feature count', 'Per frame', '16000'),
        b('georef', 'Georeference', 'Output in metric world units', true),
      ] },
      { title: 'Outdoor', tag: 'SCENE', rows: [
        b('sky', 'Sky segmentation', 'Sky to background sphere', true),
        b('appearance', 'Appearance embeddings', 'Absorbs sun / cloud changes', true),
        b('transient', 'Transient object masking', 'People, cars', true),
        b('lod', 'Chunked LOD output', 'Streams large scenes', true),
      ] },
      { title: 'Training', tag: '3DGS', rows: [
        t('iters', 'Iterations', '', '60000'),
        t('sh', 'SH degree', 'Saves memory at scale', '2'),
        t('densifyUntil', 'Densify until', '', '30000'),
        t('extra', 'Scale regularization', 'Prevents giant splats', '0.01'),
        t('maxg', 'Max gaussians', 'Hard cap', '8M'),
      ] },
    ],
  },
}

export type Settings = { extract: ExtractSettings; rows: Record<string, string | boolean> }

export function defaultSettings(m: ModeKey): Settings {
  const rows: Record<string, string | boolean> = {}
  for (const g of MODES[m].groups) for (const r of g.rows) rows[r.id] = r.def
  return { extract: { ...MODES[m].extract }, rows }
}

/** Parses "1.5M", "250k", "30,000" → number. */
export function parseNum(v: string | boolean | undefined, fallback = 0): number {
  if (typeof v !== 'string') return fallback
  const m = v.trim().replace(/,/g, '').match(/^([\d.]+)\s*([kKmM]?)/)
  if (!m) return fallback
  const n = parseFloat(m[1])
  return m[2].toLowerCase() === 'm' ? n * 1e6 : m[2].toLowerCase() === 'k' ? n * 1e3 : n
}

export const fmt = (n: number) => Math.round(n).toLocaleString('en-US')

/** Rough planning estimates (not measurements). */
export function estimates(settings: Settings) {
  const iters = parseNum(settings.rows.iters, 30000)
  const maxM = parseNum(settings.rows.maxg, 1.5e6) / 1e6
  const vramGb = 2 + 1.1 * maxM + 0.15 * Math.max(0, parseNum(settings.rows.sh, 3) - 1) * maxM
  const minutes = (iters / 1000) * (0.3 + maxM * 0.2)
  const eta = minutes >= 90 ? `${Math.floor(minutes / 60)} h ${Math.round(minutes % 60)} min` : `${Math.round(minutes)} min`
  return { vramGb, eta }
}
