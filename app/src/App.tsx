import { useEffect, useState } from 'react'
import { MODES, estimates, fmt, parseNum, type ModeKey } from './modes'
import { useProject } from './useProject'
import Import from './screens/Import'
import Frames from './screens/Frames'
import Configure from './screens/Configure'
import Train from './screens/Train'

const STEPS = ['Import', 'Frames', 'Configure', 'Train & view']

async function gpuName(): Promise<string> {
  try {
    const gpu = (navigator as unknown as { gpu?: { requestAdapter: () => Promise<{ info?: { description?: string; vendor?: string; architecture?: string } } | null> } }).gpu
    const a = await gpu?.requestAdapter()
    if (a?.info) return a.info.description || [a.info.vendor, a.info.architecture].filter(Boolean).join(' ') || 'WebGPU adapter'
  } catch { /* ignore */ }
  const c = document.createElement('canvas').getContext('webgl2')
  const ext = c?.getExtension('WEBGL_debug_renderer_info')
  return ext && c ? String(c.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'Not detected'
}

export default function App() {
  const p = useProject()
  const [gpu, setGpu] = useState('…')
  useEffect(() => { gpuName().then(setGpu) }, [])
  const d = MODES[p.mode]
  const e = estimates(p.settings)
  const r = p.settings.rows
  const profile: [string, string][] = [
    ['Sample rate', p.settings.extract.fps + ' fps'], ['Max frames', fmt(parseNum(p.settings.extract.max))],
    ['Blur threshold', p.settings.extract.blur], ['Camera model', String(r.camera)], ['Matcher', String(r.matcher)],
    ['Iterations', fmt(parseNum(r.iters))], ['SH degree', String(r.sh)], ['Target gaussians', String(r.maxg)],
  ]
  const go = (i: number) => p.setStep(i)
  const screen = [<Import p={p} go={go} />, <Frames p={p} go={go} />, <Configure p={p} go={go} />, <Train p={p} />][p.step]

  return (
    <div className="app">
      <header className="top">
        <div className="brand"><div className="orb" /><div><b>Splat Studio</b><span>{p.project}</span></div></div>
        <nav>{STEPS.map((s, i) => (
          <button key={s} className={'step' + (i === p.step ? ' on' : '')} onClick={() => go(i)}><i>0{i + 1}</i>{s}</button>
        ))}</nav>
        <div className="seg"><span>Capture type</span><div>
          {(Object.keys(MODES) as ModeKey[]).map((k) => (
            <button key={k} className={k === p.mode ? 'on' : ''} onClick={() => p.setMode(k)}>{MODES[k].label}</button>
          ))}</div></div>
      </header>
      <div className="body">
        <main>{screen}</main>
        <aside>
          <div className="ph"><span className="k">PRESET PROFILE</span><b>{d.label}</b><span>{d.short}</span></div>
          <div style={{ padding: '8px 0' }}>{profile.map(([k, v]) => <div className="pr" key={k}><span>{k}</span><span>{v}</span></div>)}</div>
          <div className="gpu">
            <div className="r"><span>GPU</span><span>{gpu}</span></div>
            <div className="r"><span>Est. VRAM</span><span style={{ color: '#f0b25a' }}>{e.vramGb.toFixed(1)} GB</span></div>
            <div className="bar"><div style={{ width: Math.min(100, (e.vramGb / 24) * 100) + '%' }} /></div>
            <div className="r"><span>Est. train time</span><span>{e.eta}</span></div>
          </div>
        </aside>
      </div>
    </div>
  )
}
