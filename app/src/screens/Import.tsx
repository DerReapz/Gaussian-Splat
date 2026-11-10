import { useRef, useState } from 'react'
import type { Project } from '../useProject'
import { RES_OPTIONS, fmt, parseNum } from '../modes'
import { plan } from '../lib/extract'
import { filesFromDrop, fmtDur } from '../lib/files'

export default function Import({ p, go }: { p: Project; go: (i: number) => void }) {
  const [over, setOver] = useState(false)
  const files = useRef<HTMLInputElement>(null)
  const folder = useRef<HTMLInputElement>(null)
  const ex = p.settings.extract
  const counts = plan(p.clips.filter((c) => c.status === 'Ready' || c.status === 'Extracted'), parseNum(ex.fps, 2), parseNum(ex.max, 600))
  const ready = p.clips.filter((c) => c.status !== 'Unsupported' && c.status !== 'Probing').length
  const pick = (e: React.ChangeEvent<HTMLInputElement>) => { p.addFiles(Array.from(e.target.files ?? [])); e.target.value = '' }

  const fields: [string, 'fps' | 'max' | 'blur' | 'res', string][] = [
    ['Sample rate (fps)', 'fps', 'Preset for ' + p.def.label.toLowerCase() + ' captures'],
    ['Max frames', 'max', 'Evenly spaced if exceeded'],
    ['Blur rejection', 'blur', 'Min. Laplacian variance'],
    ['Output resolution', 'res', 'Long edge, JPEG q95'],
  ]
  return (
    <>
      <div className="hd">
        <div><h1>Import video</h1><p>Clips and image sets are decoded and sampled into still frames for camera solving.</p></div>
        <button className="pri" disabled={!ready} onClick={async () => { if (await p.extract()) go(1) }}>Extract frames →</button>
      </div>
      {p.error && <div className="banner"><span>{p.error}</span><button onClick={() => p.setError(null)}>✕</button></div>}
      <div className={'drop' + (over ? ' over' : '')}
        onDragOver={(e) => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)}
        onDrop={async (e) => { e.preventDefault(); setOver(false); p.addFiles(await filesFromDrop(e.dataTransfer)) }}
        onClick={() => files.current?.click()}>
        <div className="ic">↑</div>
        <div className="t">Drop video files, photos or a folder</div>
        <div className="s">MP4 · MOV · MKV · WebM · JPG · PNG · 360° equirect — decoded by your browser</div>
        <div className="links" onClick={(e) => e.stopPropagation()}>
          <button onClick={() => files.current?.click()}>Choose files</button>
          <button onClick={() => folder.current?.click()}>Choose folder</button>
        </div>
        <input ref={files} type="file" multiple accept="video/*,image/*,.mkv,.mov" hidden onChange={pick} />
        <input ref={folder} type="file" multiple hidden onChange={pick} {...({ webkitdirectory: '' } as object)} />
      </div>
      <div className="tbl">
        <div className="row h"><span /><span>File</span><span>Duration</span><span>Resolution</span><span>Frame rate</span><span>Est. frames</span><span>Status</span><span /></div>
        {!p.clips.length && <div className="empty">No clips yet. Add your own footage above.</div>}
        {p.clips.map((c) => (
          <div className="row" key={c.id}>
            <div className="thumb" />
            <div className="nm"><span title={c.name}>{c.name}</span><span title={c.error}>{c.error ?? c.codec}</span></div>
            <span className="m">{c.kind === 'image' ? '—' : c.dur ? fmtDur(c.dur) : '…'}</span>
            <span className="m">{c.w ? `${c.w}×${c.h}` : '…'}</span>
            <span className="m">{c.fps ? +c.fps.toFixed(2) : '—'}</span>
            <span className="m" style={{ color: '#e8e6e1' }}>{counts.has(c.id) ? fmt(counts.get(c.id)!) : '—'}</span>
            <span className={'st' + (c.status === 'Unsupported' ? ' bad' : c.status === 'Probing' ? ' wait' : '')}>● {c.status}</span>
            <button className="x" title="Remove" onClick={() => p.removeClip(c.id)}>×</button>
          </div>
        ))}
      </div>
      <div className="cards">
        {fields.map(([k, f, hint]) => (
          <div className="card" key={f}>
            <span>{k}</span>
            {f === 'res'
              ? <select className="in" value={ex.res} onChange={(e) => p.setExtract('res', e.target.value)}>{RES_OPTIONS.map((o) => <option key={o} style={{ background: '#121316' }}>{o}</option>)}</select>
              : <input className="in" inputMode="decimal" value={ex[f]} onChange={(e) => p.setExtract(f, e.target.value)} />}
            <span className="h2">{hint}</span>
          </div>
        ))}
      </div>
    </>
  )
}
