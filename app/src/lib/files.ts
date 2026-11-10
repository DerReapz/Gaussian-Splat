const VIDEO_EXT = /\.(mp4|m4v|mov|mkv|webm|avi|ogv)$/i
const IMAGE_EXT = /\.(jpe?g|png|webp|bmp|gif|avif)$/i

export const isVideo = (f: File) => f.type.startsWith('video/') || VIDEO_EXT.test(f.name)
export const isImage = (f: File) => f.type.startsWith('image/') || IMAGE_EXT.test(f.name)
export const isSplatFile = (f: File) => /\.(ply|splat)$/i.test(f.name)

type FsEntry = { isFile: boolean; isDirectory: boolean; file?: (cb: (f: File) => void, err: (e: unknown) => void) => void; createReader?: () => { readEntries: (cb: (e: FsEntry[]) => void, err: (e: unknown) => void) => void } }

async function walk(entry: FsEntry, out: File[]) {
  if (entry.isFile && entry.file) {
    out.push(await new Promise<File>((res, rej) => entry.file!(res, rej)))
  } else if (entry.isDirectory && entry.createReader) {
    const reader = entry.createReader()
    for (;;) {
      const batch = await new Promise<FsEntry[]>((res, rej) => reader.readEntries(res, rej))
      if (!batch.length) break
      for (const e of batch) await walk(e, out)
    }
  }
}

/** Collects files from a drop event, descending into dropped folders. */
export async function filesFromDrop(dt: DataTransfer): Promise<File[]> {
  const out: File[] = []
  const entries: FsEntry[] = []
  for (const item of Array.from(dt.items)) {
    const e = (item as unknown as { webkitGetAsEntry?: () => FsEntry | null }).webkitGetAsEntry?.()
    if (e) entries.push(e)
  }
  if (entries.length) for (const e of entries) await walk(e, out)
  else out.push(...Array.from(dt.files))
  return out
}

export function download(blob: Blob, name: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 10000)
}

export const fmtBytes = (n: number) =>
  n > 1e9 ? (n / 1e9).toFixed(2) + ' GB' : n > 1e6 ? (n / 1e6).toFixed(1) + ' MB' : (n / 1e3).toFixed(0) + ' KB'

export const fmtDur = (s: number) => {
  const m = Math.floor(s / 60), r = Math.round(s % 60)
  return String(m).padStart(2, '0') + ':' + String(r).padStart(2, '0')
}
