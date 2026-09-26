// 브라우저 안 자동 저장(IndexedDB). 작업 목록, 녹음 원본, 저장 폴더 핸들.
import type { Transcript } from '../types'

export interface Job {
  id: string
  transcript: Transcript
  /** [저장]으로 본 파일을 쓴 시점의 transcript.updatedAt */
  savedAt?: string
  /** 폴더에 임시저장한 시각(ISO) */
  tempSavedAt?: string
  /** 초벌이 끝난 시점의 updatedAt. 저장 전 "고친 게 있는지"의 기준 */
  doneAt?: string
  /** 폴더 안 파일 이름 바탕(mainFileName/tempFileName에 넘김). 같은 제목의 다른 축어록 파일을 덮지 않게 처음 쓸 때 정한다 */
  fileBase?: string
  /** 절반 쪽지를 이미 보였는지 */
  cheeredHalf?: boolean
  /** 진행 단계 표시용: 이름 가리기를 한 번이라도 한 시각, 내보내기(복사·파일)를 한 시각 */
  maskedAt?: string
  exportedAt?: string
}

type Store = 'jobs' | 'audio' | 'kv'
let dbp: Promise<IDBDatabase> | undefined

function open(): Promise<IDBDatabase> {
  dbp ??= new Promise((ok, fail) => {
    const r = indexedDB.open('transbee', 1)
    r.onupgradeneeded = () => {
      r.result.createObjectStore('jobs', { keyPath: 'id' })
      r.result.createObjectStore('audio')
      r.result.createObjectStore('kv')
    }
    r.onsuccess = () => ok(r.result)
    r.onerror = () => fail(r.error)
  })
  return dbp
}

async function req<T>(store: Store, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await open()
  return new Promise((ok, fail) => {
    const tx = db.transaction(store, mode)
    const r = fn(tx.objectStore(store))
    tx.oncomplete = () => ok(r.result as T)
    tx.onerror = () => fail(tx.error)
    tx.onabort = () => fail(tx.error)
  })
}

/** id가 없던 때(Transcript.id 도입 전) 만든 작업은 작업 id를 축어록 id로 쓴다 */
const withId = (j: Job): Job => (j.transcript.id ? j : { ...j, transcript: { ...j.transcript, id: j.id } })
export const getJobs = () => req<Job[]>('jobs', 'readonly', (s) => s.getAll()).then((js) => js.map(withId))
export const putJob = (job: Job) => req<void>('jobs', 'readwrite', (s) => s.put(job))
export const getAudio = (id: string) => req<Blob | undefined>('audio', 'readonly', (s) => s.get(id))
export const putAudio = (id: string, blob: Blob) => req<void>('audio', 'readwrite', (s) => s.put(blob, id))
export async function deleteJob(id: string) {
  await req('jobs', 'readwrite', (s) => s.delete(id))
  await req('audio', 'readwrite', (s) => s.delete(id))
}
export const getKV = <T>(key: string) => req<T | undefined>('kv', 'readonly', (s) => s.get(key))
export const setKV = (key: string, value: unknown) => req<void>('kv', 'readwrite', (s) => s.put(value, key))

/** 브라우저가 공간이 모자랄 때 지우지 않도록 요청(한 번) */
export const askPersist = () => navigator.storage?.persist?.().catch(() => false)
