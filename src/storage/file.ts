// 작업 파일 .transbee = zip(transcript.json + audio/<원본 녹음>)
import { strFromU8, strToU8, unzip, unzipSync, zip } from 'fflate'
import { FORMAT_VERSION, type Transcript } from '../types'

export class BadFileError extends Error {}

const AUDIO_DIR = 'audio/'

export async function pack(t: Transcript, audio: Uint8Array): Promise<Uint8Array> {
  const name = AUDIO_DIR + (t.audio.fileName.replace(/[\\/]/g, '_') || 'recording')
  return new Promise((ok, fail) =>
    zip(
      {
        'transcript.json': [strToU8(JSON.stringify(t)), { level: 6 }],
        // 녹음은 이미 압축된 형식이라 다시 압축하지 않는다(빠르게)
        [name]: [audio, { level: 0 }],
      },
      (err, data) => (err ? fail(err) : ok(data)),
    ),
  )
}

/** legacyId: id가 없던 옛 파일이라 여기서 새 id를 붙였음(짝짓기는 제목으로 해야 함) */
// 받은 파일이 풀면서 수 GB로 부풀지 않게(zip bomb) 풀기 전에 크기를 본다.
// 축어록 JSON은 50분 녹음도 수 MB라 64MB면 넉넉하고, 녹음은 압축하지 않고 넣으므로 파일 크기를 넘을 수 없다.
const JSON_MAX = 64 * 1024 * 1024
function sizeGuard(total: number) {
  let bad = false
  const filter = (f: { name: string; originalSize: number }) => {
    const max = f.name === 'transcript.json' ? JSON_MAX : f.name.startsWith(AUDIO_DIR) ? total + 1024 * 1024 : 0
    if (f.originalSize > max) bad = true
    return !bad && max > 0
  }
  return { filter, bad: () => bad }
}

export async function unpack(data: Uint8Array): Promise<{ transcript: Transcript; audio: Blob; legacyId?: boolean }> {
  const guard = sizeGuard(data.length)
  const files = await new Promise<Record<string, Uint8Array>>((ok, fail) =>
    unzip(data, { filter: guard.filter }, (err, f) => (err ? fail(new BadFileError(String(err))) : ok(f))),
  )
  if (guard.bad()) throw new BadFileError('too large')
  const json = files['transcript.json']
  const audioName = Object.keys(files).find((k) => k.startsWith(AUDIO_DIR))
  if (!json || !audioName) throw new BadFileError('missing entries')
  let t: Transcript
  try {
    t = JSON.parse(strFromU8(json))
  } catch {
    throw new BadFileError('bad json')
  }
  if (t?.formatVersion !== FORMAT_VERSION || !Array.isArray(t.utterances) || !Array.isArray(t.sections))
    throw new BadFileError('unknown format')
  const legacyId = !t.id
  if (legacyId) t.id = crypto.randomUUID()
  return { transcript: t, legacyId: legacyId || undefined, audio: new Blob([files[audioName] as BlobPart], { type: t.audio?.mime || 'audio/mp4' }) }
}

/** 작업 파일의 축어록 id·마지막 고친 시각(녹음은 풀지 않음). 작업 파일이 아니면 undefined */
export function readHead(data: Uint8Array): { id?: string; updatedAt?: string } | undefined {
  try {
    const json = unzipSync(data, { filter: (f) => f.name === 'transcript.json' && f.originalSize <= JSON_MAX })['transcript.json']
    if (!json) return undefined
    const { id, updatedAt } = JSON.parse(strFromU8(json)) as Partial<Transcript>
    return { id, updatedAt }
  } catch {
    return undefined
  }
}
export const readId = (data: Uint8Array) => readHead(data)?.id

/** 파일 이름에 못 쓰는 글자 빼기 */
export const safeName = (title: string) => title.replace(/[\\/:*?"<>|]/g, '_').trim() || '축어록'
/** base = 폴더 안 이 작업의 이름(보통 제목, 같은 제목의 다른 축어록이 있으면 "제목 (2)") */
export const mainFileName = (base: string) => `${safeName(base)}.transbee`
export const tempFileName = (base: string) => `${safeName(base)} (임시저장).transbee`
