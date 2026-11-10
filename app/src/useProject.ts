import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MODES, defaultSettings, parseNum, resToEdge, type ModeKey, type Settings } from './modes'
import { classify, extractClip, plan, probeClip, type Clip, type Frame } from './lib/extract'
import { isImage, isVideo } from './lib/files'
import type { Splat } from './lib/splat'

let uid = 0

export function useProject() {
  const [mode, setMode] = useState<ModeKey>('room')
  const [step, setStep] = useState(0)
  const [settings, setSettings] = useState<Record<ModeKey, Settings>>({
    object: defaultSettings('object'), room: defaultSettings('room'), env: defaultSettings('env'),
  })
  const [clips, setClips] = useState<Clip[]>([])
  const [frames, setFrames] = useState<Frame[]>([])
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showRej, setShowRej] = useState(true)
  const [splat, setSplat] = useState<{ name: string; size: number; data: Splat } | null>(null)
  const abort = useRef<AbortController | null>(null)
  const clipsRef = useRef(clips)
  clipsRef.current = clips

  const cur = settings[mode]
  const setExtract = (k: keyof Settings['extract'], v: string) =>
    setSettings((s) => ({ ...s, [mode]: { ...s[mode], extract: { ...s[mode].extract, [k]: v } } }))
  const setRow = (id: string, v: string | boolean) =>
    setSettings((s) => ({ ...s, [mode]: { ...s[mode], rows: { ...s[mode].rows, [id]: v } } }))

  const addFiles = useCallback(async (files: File[]) => {
    const items = files
      .filter((f) => isVideo(f) || isImage(f))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    const added: Clip[] = items.map((file) => ({
      id: 'c' + ++uid, file, name: file.name, kind: isVideo(file) ? 'video' : 'image', codec: '…',
      dur: 0, w: 0, h: 0, fps: null, status: 'Probing',
    }))
    if (!added.length) { setError('No video or image files found.'); return }
    setError(null)
    setClips((c) => [...c, ...added])
    for (const c of added) {
      try {
        const info = await probeClip(c.file, c.kind)
        setClips((all) => all.map((x) => (x.id === c.id ? { ...x, ...info, status: 'Ready' } : x)))
      } catch (e) {
        setClips((all) => all.map((x) => (x.id === c.id ? { ...x, status: 'Unsupported', error: (e as Error).message, codec: x.file.type || 'unknown' } : x)))
      }
    }
  }, [])

  const removeClip = (id: string) => setClips((c) => c.filter((x) => x.id !== id))

  const clearFrames = useCallback(() => {
    setFrames((fs) => { fs.forEach((f) => URL.revokeObjectURL(f.thumb)); return [] })
  }, [])

  const extract = useCallback(async () => {
    const ready = clipsRef.current.filter((c) => c.status === 'Ready' || c.status === 'Extracted')
    if (!ready.length) { setError('Add at least one readable video or image first.'); return false }
    abort.current?.abort()
    const ac = (abort.current = new AbortController())
    const ex = settings[mode].extract
    const counts = plan(ready, parseNum(ex.fps, 2), parseNum(ex.max, 600))
    const total = [...counts.values()].reduce((a, b) => a + b, 0)
    clearFrames()
    setError(null)
    setProgress({ done: 0, total })
    let n = 0
    void (async () => {
    try {
      for (const c of ready) {
        if (ac.signal.aborted) break
        const batch: Frame[] = []
        await extractClip(c, counts.get(c.id)!, resToEdge(ex.res), ac.signal, (f) => {
          batch.push({ ...f, id: String(++n).padStart(5, '0') })
          if (batch.length >= 4) { const b = batch.splice(0); setFrames((fs) => [...fs, ...b]) }
          setProgress({ done: n, total })
        })
        if (batch.length) setFrames((fs) => [...fs, ...batch])
        setClips((all) => all.map((x) => (x.id === c.id ? { ...x, status: 'Extracted' } : x)))
      }
    } catch (e) {
      setError('Extraction failed: ' + (e as Error).message)
    }
    if (!ac.signal.aborted) setProgress(null)
    })()
    return true
  }, [mode, settings, clearFrames])

  const cancelExtract = () => { abort.current?.abort(); setProgress(null) }
  useEffect(() => () => abort.current?.abort(), [])

  const blur = parseNum(cur.extract.blur, 100)
  const reasons = useMemo(() => classify(frames, blur), [frames, blur])
  const toggleFrame = (id: string) =>
    setFrames((fs) => fs.map((f, i) => (f.id !== id ? f : { ...f, manual: reasons[i] ? 'keep' : 'reject' })))

  return {
    mode, setMode, step, setStep, settings: cur, setExtract, setRow, def: MODES[mode],
    clips, addFiles, removeClip, frames, reasons, progress, error, setError, extract, cancelExtract, toggleFrame,
    showRej, setShowRej, splat, setSplat, blur, project: 'untitled_scan',
  }
}
export type Project = ReturnType<typeof useProject>
