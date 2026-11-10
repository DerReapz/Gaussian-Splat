import type { Project } from '../useProject'

export default function Configure({ p, go }: { p: Project; go: (i: number) => void }) {
  return (
    <>
      <div className="hd">
        <div><h1>Configure · {p.def.label}</h1><p>{p.def.desc}</p></div>
        <button className="pri" onClick={() => go(3)}>Start training →</button>
      </div>
      <div className="cfg">
        {p.def.groups.map((g) => (
          <div className="grp" key={g.title}>
            <div className="gh"><b>{g.title}</b><span>{g.tag}</span></div>
            {g.rows.map((r) => {
              const v = p.settings.rows[r.id]
              return (
                <div className="opt" key={r.id}>
                  <div className="l"><span>{r.label}</span>{r.hint && <span>{r.hint}</span>}</div>
                  {r.kind === 'toggle' && <button className={'tg' + (v ? ' on' : '')} role="switch" aria-checked={!!v} onClick={() => p.setRow(r.id, !v)} />}
                  {r.kind === 'select' && <select className="val" value={String(v)} onChange={(e) => p.setRow(r.id, e.target.value)}>{r.options!.map((o) => <option key={o} style={{ background: '#121316' }}>{o}</option>)}</select>}
                  {r.kind === 'text' && <input className="val" value={String(v)} onChange={(e) => p.setRow(r.id, e.target.value)} />}
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </>
  )
}
