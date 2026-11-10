import { useEffect, useRef, useState } from 'react'
import type { Project } from '../useProject'
import { fmt } from '../modes'
import { SplatViewer, type ViewMode } from '../lib/viewer'
import { loadSplatFile, stats, writePly, writeSplat } from '../lib/splat'
import { buildBundle } from '../lib/bundle'
import { download, filesFromDrop, fmtBytes, isSplatFile } from '../lib/files'

export default function Train({ p }: { p: Project }) {
  const cv = useRef<HTMLCanvasElement>(null)
  const viewer = useRef<SplatViewer | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const [vm, setVm] = useState<ViewMode>('rgb')
  const [flip, setFlip] = useState(false)
  const [over, setOver] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    try { viewer.current = new SplatViewer(cv.current!) } catch (e) { setErr((e as Error).message); return }
    viewer.current.setSplat(p.splat?.data ?? null)
    return () => { viewer.current?.dispose(); viewer.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => { viewer.current?.setMode(vm) }, [vm])
  useEffect(() => { viewer.current?.setFlip(flip) }, [flip])

  const open = async (files: File[]) => {
    const f = files.find(isSplatFile)
    if (!f) { setErr('Drop a trained .ply or .splat file.'); return }
    setErr(null); setBusy('Parsing ' + f.name + '…')
    await new Promise((r) => setTimeout(r, 30))
    try {
      const data = await loadSplatFile(f)
      p.setSplat({ name: f.name, size: f.size, data })
      viewer.current?.setSplat(data)
    } catch (e) { setErr((e as Error).message) }
    setBusy(null)
  }

  const keptCount = p.reasons.filter((r) => !r).length
  const exportBundle = async () => {
    setErr(null)
    try {
      const names = Object.fromEntries(p.clips.map((c) => [c.id, c.name]))
      const blob = await buildBundle({ mode: p.mode, settings: p.settings, project: p.project, frames: p.frames, reasons: p.reasons, clipNames: names }, (x) => setBusy(`Packing bundle… ${Math.round(x * 100)}%`))
      download(blob, `${p.project}_${p.mode}_bundle.zip`)
    } catch (e) { setErr((e as Error).message) }
    setBusy(null)
  }

  const s = p.splat
  const st = s ? stats(s.data) : null
  return (
    <>
      <div className="hd">
        <div><h1>Train &amp; view</h1><p>
          {s ? `${p.def.label} preset · viewing ${s.name}` : `${keptCount} frames ready for the ${p.def.label.toLowerCase()} preset. Export the training bundle, run it on a CUDA machine, then open the resulting .ply or .splat here.`}</p></div>
        <div className="btns">
          <button className="sec" disabled={!keptCount || !!busy} onClick={exportBundle}>Training bundle</button>
          <button className="sec" onClick={() => input.current?.click()}>Open…</button>
          <button className="sec" disabled={!s} onClick={() => s && download(writePly(s.data), s.name.replace(/\.\w+$/, '') + '.ply')}>Export .ply</button>
          <button className="sec" disabled={!s} onClick={() => s && download(writeSplat(s.data), s.name.replace(/\.\w+$/, '') + '.splat')}>Export .splat</button>
          <input ref={input} type="file" accept=".ply,.splat" hidden onChange={(e) => { open(Array.from(e.target.files ?? [])); e.target.value = '' }} />
        </div>
      </div>
      {(err || busy) && <div className={err ? 'banner' : 'prog'}><span>{err ?? busy}</span></div>}
      <div className="view"
        onDragOver={(e) => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)}
        onDrop={async (e) => { e.preventDefault(); setOver(false); open(await filesFromDrop(e.dataTransfer)) }}>
        <canvas ref={cv} />
        {!s && <div className={'vdrop' + (over ? ' over' : '')} style={{ pointerEvents: 'none' }}>
          <div style={{ fontSize: 14, fontWeight: 500 }}>Drop a trained .ply or .splat to view it</div>
          <div className="mono" style={{ fontSize: 12, color: '#7d828a' }}>3DGS .ply (binary) · antimatter15 .splat · drag to orbit, scroll to zoom</div>
        </div>}
        <div style={{ position: 'absolute', left: 12, bottom: 24, display: 'flex', gap: 6 }}>
          <button className="tag" style={{ cursor: 'pointer', color: flip ? '#f0b25a' : undefined }} title="Flip vertical (COLMAP scenes are often Y-down)" onClick={() => setFlip(!flip)}>Flip Y</button>
          <button className="tag" style={{ cursor: 'pointer' }} onClick={() => viewer.current?.resetView()}>Reset view</button>
        </div>
        <div className="tl"><span className="tag">{p.def.label} · {s ? 'live preview' : 'viewer'}</span>{s && <span className="tag" style={{ color: '#f0b25a' }}>{fmt(s.data.count)} splats</span>}</div>
        <div className="tr">
          {([['rgb', 'RGB'], ['depth', 'Depth'], ['ellipsoids', 'Ellipsoids']] as [ViewMode, string][]).map(([k, l]) => (
            <button key={k} className={vm === k ? 'on' : ''} onClick={() => setVm(k)}>{l}</button>
          ))}
          <button disabled title="Needs solved camera poses (available after training)" style={{ opacity: 0.6, cursor: 'default' }}>Cameras</button>
        </div>
      </div>
      <div className="cards">
        <div className="card"><span>Gaussians</span><span className="v">{s ? fmt(s.data.count) : '—'}</span></div>
        <div className="card"><span>File size</span><span className="v">{s ? fmtBytes(s.size) : '—'}</span></div>
        <div className="card"><span>Extent (x · y · z)</span><span className="v" style={{ fontSize: 14 }}>{st ? st.size.map((x) => x.toFixed(1)).join(' · ') : '—'}</span></div>
        <div className="card"><span>Frames in bundle</span><span className="v">{fmt(keptCount)}</span></div>
      </div>
    </>
  )
}
