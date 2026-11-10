import type { Project } from '../useProject'
import { fmt } from '../modes'

export default function Frames({ p, go }: { p: Project; go: (i: number) => void }) {
  const rejected = p.reasons.filter(Boolean).length
  const kept = p.frames.length - rejected
  const max = Math.max(1, ...p.frames.map((f) => f.score))
  const N = Math.min(96, p.frames.length)
  const bars = Array.from({ length: N }, (_, i) => {
    const f = p.frames[Math.floor((i * p.frames.length) / N)]
    return { h: Math.max(4, (Math.sqrt(f.score) / Math.sqrt(max)) * 100), c: f.score < p.blur ? '#7a3a30' : '#4a4f57' }
  })
  const shown = p.frames.map((f, i) => ({ f, r: p.reasons[i] })).filter((x) => p.showRej || !x.r)
  return (
    <>
      <div className="hd">
        <div><h1>Frames</h1><p>{p.progress ? `Extracting… ${p.progress.done} / ${p.progress.total}` : p.frames.length
          ? `${fmt(p.frames.length)} frames extracted · ${rejected} rejected for blur, near-duplicate content or manually · ${fmt(kept)} sent to camera solve`
          : 'No frames yet — import footage and press Extract frames.'}</p></div>
        <div className="btns">
          <button className="sec" onClick={() => p.setShowRej(!p.showRej)}>{p.showRej ? 'Hide rejected' : 'Show rejected'}</button>
          <button className="pri" disabled={!kept} onClick={() => go(2)}>Configure →</button>
        </div>
      </div>
      {p.error && <div className="banner"><span>{p.error}</span><button onClick={() => p.setError(null)}>✕</button></div>}
      {p.progress && (
        <div className="prog"><span>Decoding & scoring</span><div className="bar"><div style={{ width: (p.progress.done / p.progress.total) * 100 + '%' }} /></div>
          <button className="sec" style={{ padding: '4px 10px' }} onClick={p.cancelExtract}>Cancel</button></div>
      )}
      <div className="panel">
        <div className="cap"><span>SHARPNESS · LAPLACIAN VARIANCE</span><span>threshold {p.blur} — edit under Blur rejection on Import</span></div>
        <div className="bars">{bars.map((b, i) => <div key={i} style={{ height: b.h + '%', background: b.c }} />)}</div>
      </div>
      <div className="grid">
        {shown.map(({ f, r }) => (
          <button key={f.id} className={'fr' + (r ? ' bad' : '')} onClick={() => p.toggleFrame(f.id)} title="Click to keep / reject">
            <img src={f.thumb} alt="" loading="lazy" />
            <span className="id">{f.id}</span>
            {r && <span className="rs">{r}</span>}
          </button>
        ))}
      </div>
    </>
  )
}
