// 고른 폴더에 파일 쓰기(File System Access). 핸들은 IndexedDB에 보관.
import { getKV, setKV } from './db'

type Perm = 'granted' | 'denied' | 'prompt'
interface Dir extends FileSystemDirectoryHandle {
  queryPermission?(o: { mode: 'readwrite' }): Promise<Perm>
  requestPermission?(o: { mode: 'readwrite' }): Promise<Perm>
}
type Picker = (o?: { id?: string; mode?: 'readwrite'; startIn?: string }) => Promise<Dir>
const picker = () => (window as unknown as { showDirectoryPicker?: Picker }).showDirectoryPicker

export const canPickFolder = () => typeof picker() === 'function'

export const getFolder = () => getKV<Dir>('folder')

/** 사용자 클릭 안에서만 부를 것. 취소하면 undefined. */
export async function pickFolder(): Promise<Dir | undefined> {
  const pick = picker()
  if (!pick) return undefined
  try {
    const dir = await pick({ id: 'transbee', mode: 'readwrite', startIn: 'documents' })
    await setKV('folder', dir)
    return dir
  } catch {
    return undefined
  }
}

/** ask=true는 사용자 클릭 안에서만(브라우저가 허락 창을 띄움) */
export async function hasPermission(dir: Dir, ask = false): Promise<boolean> {
  const o = { mode: 'readwrite' as const }
  if ((await dir.queryPermission?.(o)) === 'granted') return true
  if (!ask) return false
  return (await dir.requestPermission?.(o)) === 'granted'
}

export async function writeFile(dir: Dir, name: string, data: Uint8Array) {
  const fh = await dir.getFileHandle(name, { create: true })
  const w = await fh.createWritable()
  await w.write(data as BlobPart)
  await w.close()
}

export async function readFile(dir: Dir, name: string): Promise<Uint8Array | undefined> {
  try {
    const f = await (await dir.getFileHandle(name)).getFile()
    return new Uint8Array(await f.arrayBuffer())
  } catch {
    return undefined
  }
}

export const removeFile = (dir: Dir, name: string) => dir.removeEntry(name).catch(() => {})

type OpenPicker = (o: { id?: string; startIn?: FileSystemDirectoryHandle | string; types?: { description: string; accept: Record<string, string[]> }[] }) => Promise<FileSystemFileHandle[]>

/** 작업 폴더에서 작업 파일(.transbee) 하나 고르기(폴더 창이 그 폴더에서 열린다). 사용자 클릭 안에서만. 취소하면 undefined. */
export async function openFromFolder(): Promise<File | undefined> {
  const pick = (window as unknown as { showOpenFilePicker?: OpenPicker }).showOpenFilePicker
  if (!pick) return undefined
  const dir = await getFolder()
  try {
    const [h] = await pick({ id: 'transbee-open', startIn: dir ?? 'documents', types: [{ description: 'transbee 작업 파일', accept: { 'application/zip': ['.transbee'] } }] })
    return await h.getFile()
  } catch {
    return undefined
  }
}
