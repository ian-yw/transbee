// 저장 세 단계: (1) 고칠 때마다 IndexedDB (2) 1분마다·재생 멈출 때 폴더에 임시저장 (3) [저장] 본 파일
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Transcript } from '../types'
import { putJob, type Job } from './db'
import { mainFileName, pack, readHead, readId, safeName, tempFileName } from './file'
import { canPickFolder, getFolder, hasPermission, pickFolder, readFile, removeFile, writeFile } from './folder'

export type SaveResult = 'folder' | 'download' | 'cancel' | 'error' | 'newer' | 'gone'

export function useSave(job: Job, t: Transcript, audio: Blob) {
  const meta = useRef<Job>(job)
  const tRef = useRef(t)
  const ver = useRef({ now: 0, temp: 0 })
  const [st, setSt] = useState({ savedAt: job.savedAt, tempAt: job.tempSavedAt, folder: undefined as string | undefined, needsAllow: false, lost: false, autoAt: 0 })
  const bytes = useRef<Promise<Uint8Array>>(undefined)
  const audioBytes = () => (bytes.current ??= audio.arrayBuffer().then((b) => new Uint8Array(b)))

  // 폴더 쓰기는 한 번에 하나: 임시저장이 쓰는 도중에 [저장]이 임시 파일을 지우면, 늦게 끝난 임시저장이 옛 파일을 되살린다
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const p = queue.current.then(fn, fn)
    queue.current = p.catch(() => {})
    return p
  }

  /**
   * 폴더 안 이 작업의 파일 이름 바탕: 같은 이름 파일이 다른 축어록(id가 다름)이면 "제목 (2)"…
   * — 같은 녹음 파일 이름에서 온 두 작업이 서로의 파일을 덮지 않게. 폴더가 바뀌면(또는 창을 새로 열면) 다시 확인한다.
   */
  const baseDir = useRef<FileSystemDirectoryHandle>(undefined)
  const baseIn = async (dir: FileSystemDirectoryHandle): Promise<string> => {
    const known = meta.current.fileBase
    if (known && baseDir.current && (await baseDir.current.isSameEntry(dir))) return known
    const cur = tRef.current
    const mine = async (base: string) => {
      const f = (await readFile(dir, mainFileName(base))) ?? (await readFile(dir, tempFileName(base)))
      return !f || readId(f) === cur.id
    }
    let base = known && (await mine(known)) ? known : undefined
    for (let k = 1; !base; k++) {
      const b = k === 1 ? safeName(cur.title) : `${safeName(cur.title)} (${k})`
      if (await mine(b)) base = b
    }
    meta.current = { ...meta.current, fileBase: base }
    baseDir.current = dir
    return base
  }

  // 브라우저 저장이 실패하면(저장 공간 부족 등) 알린다 — 폴더를 고르지 않은 사람에게는 이것이 유일한 저장이다
  const persist = useCallback(
    () =>
      putJob({ ...meta.current, transcript: tRef.current }).then(
        () => setSt((s) => ({ ...s, lost: false, autoAt: Date.now() })),
        () => setSt((s) => (s.lost ? s : { ...s, lost: true })),
      ),
    [],
  )

  // (1) 브라우저 안 자동 저장: 고친 뒤 0.4초
  useEffect(() => {
    tRef.current = t
    ver.current.now++
    const id = setTimeout(persist, 400)
    return () => clearTimeout(id)
  }, [t, persist])
  useEffect(() => () => void persist(), [persist])

  useEffect(() => {
    getFolder().then(async (d) => d && setSt((s) => ({ ...s, folder: d.name })))
  }, [])

  // (2) 임시저장: 허락된 폴더가 있을 때만 조용히
  const temp = useCallback(async () => {
    const v = ver.current.now
    if (v === ver.current.temp) return
    const dir = await getFolder()
    if (!dir) return
    if (!(await hasPermission(dir))) return setSt((s) => ({ ...s, needsAllow: true }))
    await serial(async () => {
      if (v <= ver.current.temp) return // 기다리는 동안 [저장]이 더 새것을 썼다
      try {
        await writeFile(dir, tempFileName(await baseIn(dir)), await pack(tRef.current, await audioBytes()))
        ver.current.temp = v
        meta.current = { ...meta.current, tempSavedAt: new Date().toISOString() }
        persist()
        setSt((s) => ({ ...s, tempAt: meta.current.tempSavedAt, folder: dir.name, needsAllow: false }))
      } catch {
        /* 폴더가 사라졌거나 공간이 없으면 브라우저 저장이 안전망. [저장]을 누르면 무슨 일인지 알린다 */
      }
    })
  }, [persist])
  useEffect(() => {
    const id = setInterval(temp, 60_000)
    return () => clearInterval(id)
  }, [temp])

  /** 사용자 클릭 안에서: 폴더 저장 허락 다시 받기 */
  const allow = useCallback(async () => {
    const dir = await getFolder()
    if (dir && (await hasPermission(dir, true))) {
      setSt((s) => ({ ...s, needsAllow: false }))
      temp()
    }
  }, [temp])

  /** 사용자 클릭 안에서: 저장 폴더 (다시) 고르기. 고르면 바로 그 폴더에 임시저장한다. */
  const changeFolder = useCallback(async () => {
    const d = await pickFolder()
    if (!d) return false
    setSt((s) => ({ ...s, folder: d.name, needsAllow: false }))
    ver.current.temp = -1
    temp()
    return true
  }, [temp])

  // (3) [저장] 본 파일. 사용자 클릭(또는 Ctrl+S) 안에서 부른다.
  // overwrite=false면, 폴더의 본 파일이 마지막 저장 뒤에 다른 곳(다른 컴퓨터 등)에서 고쳐졌을 때 덮지 않고 'newer'
  const save = useCallback(async (overwrite = false): Promise<SaveResult> => {
    let dir = await getFolder()
    if (dir && !(await hasPermission(dir, true))) dir = undefined
    if (!dir && canPickFolder()) {
      dir = await pickFolder()
      if (!dir) return 'cancel'
    }
    const cur = tRef.current
    const v = ver.current.now
    return serial(async (): Promise<SaveResult> => {
      try {
        const data = await pack(cur, await audioBytes())
        if (dir) {
          const base = await baseIn(dir)
          const old = overwrite ? undefined : await readFile(dir, mainFileName(base))
          const head = old && readHead(old)
          if (head?.id === cur.id && head.updatedAt && head.updatedAt > (meta.current.savedAt ?? '') && head.updatedAt !== cur.updatedAt) return 'newer'
          await writeFile(dir, mainFileName(base), data)
          await removeFile(dir, tempFileName(base))
        } else {
          const a = document.createElement('a')
          a.href = URL.createObjectURL(new Blob([data as BlobPart], { type: 'application/zip' }))
          a.download = mainFileName(cur.title)
          a.click()
          setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
        }
        meta.current = { ...meta.current, savedAt: cur.updatedAt, tempSavedAt: undefined }
        ver.current.temp = v
        persist()
        setSt((s) => ({ ...s, savedAt: cur.updatedAt, tempAt: undefined, folder: dir?.name ?? s.folder, needsAllow: false }))
        return dir ? 'folder' : 'download'
      } catch (e) {
        // 폴더를 옮기거나 지웠거나 USB를 뺐다
        return (e as DOMException)?.name === 'NotFoundError' ? 'gone' : 'error'
      }
    })
  }, [persist])

  const dirty = t.updatedAt !== (st.savedAt ?? meta.current.doneAt)

  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => {
      persist()
      e.preventDefault()
      e.returnValue = ''
    }
    addEventListener('beforeunload', warn)
    return () => removeEventListener('beforeunload', warn)
  }, [dirty, persist])

  const setMeta = useCallback((patch: Partial<Job>) => {
    meta.current = { ...meta.current, ...patch }
    persist()
  }, [persist])

  return { ...st, dirty, save, temp, allow, changeFolder, meta, setMeta }
}
