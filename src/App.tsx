// 화면 흐름: 첫 화면 → (처음 한 번 준비) → 초벌 → 듣고 고치기(상담자 확인·내보내기 포함). 예외는 "이럴 때는" 화면.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { GUIDE_ID } from './app/About'
import { FORMAT_VERSION, type Transcript } from './types'
import type { EngineError, Support } from './engine/api'
import { engine } from './app/engine'
import { Home } from './app/Home'
import { Prepare } from './app/Prepare'
import { Processing } from './app/Processing'
import { Logo, Problem, durText, mbText } from './app/ui'
import { getSettings } from './app/settings'
import { Editor } from './editor/Editor'
import { askPersist, getAudio, getJobs, putAudio, putJob, type Job } from './storage/db'
import { BadFileError, mainFileName, unpack } from './storage/file'
import { getFolder, hasPermission, readFile } from './storage/folder'
import { acquireJob, releaseJobs } from './storage/lock'

type Screen =
  | { k: 'loading' }
  | { k: 'home' }
  | { k: 'prepare'; job: Job; audio: Blob }
  | { k: 'processing'; job: Job; audio: Blob; fresh: boolean }
  | { k: 'editor'; job: Job; audio: Blob }
  | { k: 'problem'; title: string; desc: ReactNode; action: string; run: () => void }
  | { k: 'choose'; title: string; desc: string; a: [string, () => void]; b: [string, () => void] }

const AUDIO_EXT = /\.(m4a|mp3|wav|aac|ogg|oga|flac|webm|mp4)$/i

function stub(fileName: string, mime: string, title: string): Transcript {
  const now = new Date().toISOString()
  const { silenceMin, silenceFormat } = getSettings()
  return {
    formatVersion: FORMAT_VERSION,
    id: crypto.randomUUID(),
    title,
    createdAt: now,
    updatedAt: now,
    audio: { fileName, mime, duration: 0 },
    speakers: { roles: [null, null] },
    utterances: [],
    sections: [],
    model: { asr: '', diarization: '', vad: '', app: '' },
    processing: { status: 'running', processedUntil: 0 },
    settings: { silenceMin, silenceFormat },
  }
}

export default function App() {
  const [s, setS] = useState<Screen>({ k: 'loading' })
  const [support, setSupport] = useState<Support>()
  const check = useCallback(async () => {
    const sp = await engine.checkSupport()
    setSupport(sp)
    return sp
  }, [])
  const home = useCallback(() => {
    releaseJobs()
    setS({ k: 'home' })
    check() // 처음 준비를 마쳤으면 첫 화면 안내("이미 받아 두었어요")가 바뀐다
  }, [check])

  const unsupported = useCallback(
    () =>
      setS({
        k: 'problem',
        title: '이 브라우저에서는 열 수 없어요',
        desc: (
          <>
            transbee는 컴퓨터(Windows·Mac)의 Chrome이나 Edge에서 열어 주세요. 주소({location.origin})를 복사해 Chrome이나 Edge 주소창에 붙여 넣으세요.{' '}
            {GUIDE_ID && (
              <a href={`https://www.youtube.com/shorts/${GUIDE_ID}`} target="_blank" rel="noopener noreferrer">
                1분 사용법 영상 보기
              </a>
            )}
          </>
        ),
        action: '주소 복사하기',
        run: () =>
          navigator.clipboard
            .writeText(location.origin)
            .then(() => setS((x) => (x.k === 'problem' ? { ...x, action: '복사했어요' } : x)))
            .catch(() => {}),
      }),
    [],
  )


  useEffect(() => {
    check().then((sp) => (sp.ok || sp.reason !== 'not-chromium' ? setS({ k: 'home' }) : unsupported()))
  }, [check, unsupported])

  const engineProblem = useCallback(
    (e: EngineError, job: Job, audio: Blob) => {
      const again = () => run(job, audio)
      if (e.code === 'bad-file')
        return setS({ k: 'problem', title: '이 파일은 열 수 없어요', desc: 'm4a, mp3, wav 녹음 파일이나 transbee 작업 파일만 열 수 있어요. 영상 파일이라면 녹음 앱에서 소리 파일로 내보내 주세요.', action: '다른 파일 고르기', run: home })
      if (e.code === 'network')
        return setS({ k: 'problem', title: '인터넷이 끊겨 멈췄어요', desc: 'AI 모델을 받던 중이었어요. 다시 연결되면 받던 곳부터 이어서 받아요.', action: '이어서 받기', run: again })
      if (e.code === 'no-storage')
        return setS({ k: 'problem', title: '저장 공간이 부족해요', desc: '다운로드 폴더 등에서 쓰지 않는 파일을 지운 뒤 다시 눌러 주세요.', action: '다시 확인하기', run: again })
      if (e.code === 'unsupported-browser') return unsupported()
      const until = job.transcript.processing.processedUntil
      setS({
        k: 'problem',
        title: until > 0 ? `${durText(until)}까지 받아 적어 두었어요` : '받아 적다가 멈췄어요',
        desc: e.code === 'out-of-memory' ? '컴퓨터 메모리가 모자라 멈췄어요. 다른 창과 프로그램을 닫고 이어서 해 주세요. 받아 적은 부분은 그대로 있어요.' : '창이 닫히거나 컴퓨터가 잠들어서 멈췄어요. 받아 적은 부분은 그대로 있어요.',
        action: '이어서 받아 적기',
        run: again,
      })
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [home, unsupported],
  )

  const busy = () =>
    setS({
      k: 'problem',
      title: '이 작업은 다른 창에서 열려 있어요',
      desc: '같은 작업을 두 창에서 고치면 한쪽에서 고친 내용이 사라질 수 있어요. 열려 있는 창에서 이어 해 주세요. 그 창을 닫았다면 다시 눌러 주세요.',
      action: '첫 화면으로',
      run: home,
    })

  /** 받아 적기까지 가는 길: 저장 공간 → 느린 컴퓨터 안내 → 처음 준비 → 초벌 */
  const slowDevice = useRef(false) // 그래픽 기능 없이 CPU로 받아 적는 컴퓨터
  async function run(job: Job, audio: Blob, slowOk = false) {
    if (!(await acquireJob(job.id))) return busy()
    const sp = await check()
    if (!sp.ok && sp.reason === 'not-chromium') return unsupported()
    if (!sp.modelsReady && sp.storageFree !== undefined && sp.storageFree < sp.storageNeeded)
      return setS({
        k: 'problem',
        title: '저장 공간이 부족해요',
        desc: `처음 준비에 약 ${mbText(sp.storageNeeded)}가 필요한데 지금 ${mbText(sp.storageFree)} 남았어요. 다운로드 폴더 등에서 파일을 지운 뒤 다시 눌러 주세요.`,
        action: '다시 확인하기',
        run: () => run(job, audio, slowOk),
      })
    slowDevice.current = sp.reason === 'no-webgpu-slow'
    if (sp.reason === 'no-webgpu-slow' && !slowOk)
      return setS({
        k: 'problem',
        title: '이 컴퓨터에서는 조금 오래 걸려요',
        desc: '받아 적는 데 그래픽 기능을 쓸 수 없는 컴퓨터예요. 녹음 길이보다 오래 걸릴 수 있어요. 그동안 다른 일을 하셔도 돼요.',
        action: '그래도 시작하기',
        run: () => run(job, audio, true),
      })
    setS(sp.modelsReady ? { k: 'processing', job, audio, fresh: false } : { k: 'prepare', job, audio })
  }

  // 브라우저 저장 공간이 모자라 녹음·작업을 넣지 못했을 때(그 밖의 뜻밖의 오류도 같은 안내로: 첫 화면이 말없이 그대로면 더 헷갈린다)
  const storageProblem = () =>
    setS({ k: 'problem', title: '저장 공간이 부족해요', desc: '녹음을 이 컴퓨터에 넣어 두지 못했어요. 다운로드 폴더 등에서 쓰지 않는 파일을 지운 뒤 다시 놓아 주세요.', action: '첫 화면으로', run: home })
  // 파일을 연달아 두 번 놓거나 예시를 두 번 눌러도 작업은 하나만
  const starting = useRef(false)
  const once = (fn: () => Promise<unknown>) => {
    if (starting.current) return
    starting.current = true
    fn()
      .catch(storageProblem)
      .finally(() => (starting.current = false))
  }

  const badFile = () =>
    setS({ k: 'problem', title: '이 파일은 열 수 없어요', desc: 'm4a, mp3, wav 녹음 파일이나 transbee 작업 파일만 열 수 있어요. 영상 파일이라면 녹음 앱에서 소리 파일로 내보내 주세요.', action: '다른 파일 고르기', run: home })

  async function startAudio(file: Blob, fileName: string, title: string) {
    const transcript = stub(fileName, file.type || 'audio/mp4', title)
    const job: Job = { id: transcript.id, transcript }
    await putAudio(job.id, file)
    await putJob(job)
    askPersist()
    await run(job, file)
  }

  async function openWorkFile(file: File) {
    let x: Awaited<ReturnType<typeof unpack>>
    try {
      x = await unpack(new Uint8Array(await file.arrayBuffer()))
    } catch (e) {
      if (e instanceof BadFileError) return badFile()
      throw e // once()가 저장 공간 안내로
    }
    const jobs = await getJobs()
    // 같은 작업 = 같은 축어록 id. id가 없던 옛 파일만 제목으로 찾고, 찾으면 그 작업의 id를 이어 쓴다.
    const same = jobs.find((j) => j.transcript.id === x.transcript.id) ?? (x.legacyId ? jobs.find((j) => j.transcript.title === x.transcript.title) : undefined)
    if (same) x.transcript.id = same.transcript.id
    // 임시저장 파일은 본 파일이 아니다: 저장한 것으로 치지 않는다(목록 표시·창 닫을 때 경고)
    const isTemp = /\(임시저장\)\.transbee$/i.test(file.name)
    const open = async (useFile: boolean) => {
      if (!useFile && same) return openJob(same, true)
      if (!(await acquireJob(same?.id ?? x.transcript.id))) return busy()
      const job: Job = { id: same?.id ?? x.transcript.id, transcript: x.transcript, savedAt: isTemp ? undefined : x.transcript.updatedAt, doneAt: x.transcript.updatedAt }
      await putAudio(job.id, x.audio)
      await putJob(job)
      if (job.transcript.processing.status !== 'done') return run(job, x.audio)
      setS({ k: 'editor', job, audio: x.audio })
    }
    // 이 브라우저 쪽이 더 나중이거나, 저장하지 않은 고침이 남아 있으면 묻는다(놓은 파일이 더 나중이어도 말없이 덮지 않게)
    const unsaved = same && same.transcript.updatedAt !== (same.savedAt ?? same.doneAt)
    if (same && same.transcript.updatedAt !== x.transcript.updatedAt && (same.transcript.updatedAt > x.transcript.updatedAt || unsaved))
      return setS({
        k: 'choose',
        title: same.transcript.updatedAt > x.transcript.updatedAt ? '이 컴퓨터에 더 나중에 고친 내용이 있어요' : '이 컴퓨터에 저장하지 않은 고친 내용이 있어요',
        desc: `"${x.transcript.title}"을 이 브라우저에서 고친 뒤 저장하지 않은 내용이 있어요. 놓은 파일로 열면 그 내용은 사라져요. 어느 쪽으로 열까요?`,
        a: ['이어 하던 것 열기', () => once(() => open(false))],
        b: ['놓은 파일 그대로 열기', () => once(() => open(true))],
      })
    await open(true)
  }

  function onFile(f: File) {
    if (/\.transbee$/i.test(f.name)) return once(() => openWorkFile(f))
    if (!f.type.startsWith('audio/') && !AUDIO_EXT.test(f.name)) return badFile()
    once(() => startAudio(f, f.name, f.name.replace(/\.[^.]+$/, '')))
  }



  async function openJob(job: Job, skipAsk = false) {
    if (!(await acquireJob(job.id))) return busy()
    const audio = await getAudio(job.id)
    if (!audio)
      return setS({
        k: 'problem',
        title: '이 작업의 녹음이 브라우저에 없어요',
        desc: '브라우저를 정리하면서 녹음이 지워졌을 수 있어요. 저장해 둔 작업 파일(.transbee)이 있으면 첫 화면에 놓아 주세요. 작업 파일에 녹음이 들어 있어요.',
        action: '첫 화면으로',
        run: home,
      })
    const t = job.transcript
    if (t.processing.status !== 'done') {
      return setS({
        k: 'problem',
        title: t.processing.processedUntil > 0 ? `${durText(t.processing.processedUntil)}까지 받아 적어 두었어요` : '받아 적기를 마치지 못했어요',
        desc: '창이 닫히거나 컴퓨터가 잠들어서 멈췄어요. 받아 적은 부분은 그대로 있어요.',
        action: '이어서 받아 적기',
        run: () => run(job, audio),
      })
    }
    // 저장한 본 파일보다 나중에 고친 내용(임시저장·브라우저)이 있으면 어느 쪽으로 열지 묻기
    if (!skipAsk && job.savedAt && t.updatedAt > job.savedAt) {
      return setS({
        k: 'choose',
        title: '저장하지 않은 고친 내용이 있어요',
        desc: `"${t.title}"을 마지막으로 저장한 뒤에 더 고친 내용이 있어요. 어느 쪽으로 열까요?`,
        a: [job.tempSavedAt ? '임시저장에서 이어 하기' : '이어 하던 것 열기', () => setS({ k: 'editor', job, audio })],
        b: [
          '마지막 저장본 열기',
          async () => {
            const dir = await getFolder()
            const data = dir && (await hasPermission(dir, true)) ? await readFile(dir, mainFileName(job.fileBase ?? t.title)) : undefined
            const x = data && (await unpack(data).catch(() => undefined))
            // 같은 이름의 다른 축어록 파일이면 저장본이 아니다
            if (!x || (!x.legacyId && x.transcript.id !== t.id)) return setS({ k: 'problem', title: '저장본을 찾지 못했어요', desc: '폴더에서 저장한 파일을 찾지 못했어요. 이어 하던 것으로 열게요.', action: '이어 하던 것 열기', run: () => setS({ k: 'editor', job, audio }) })
            const saved: Job = { ...job, transcript: { ...x.transcript, id: t.id }, savedAt: x.transcript.updatedAt }
            await putJob(saved)
            setS({ k: 'editor', job: saved, audio })
          },
        ],
      })
    }
    setS({ k: 'editor', job, audio })
  }

  // 화면이 바뀌면 새 화면 제목으로 초점을 옮긴다(키보드·화면 읽기 프로그램이 첫 화면 위에 남지 않게). 처음 열 때와 창이 떠 있을 때는 그대로.
  const first = useRef(true)
  useEffect(() => {
    if (s.k === 'loading') return
    if (first.current) return void (first.current = false)
    const h = document.querySelector<HTMLElement>('h1')
    if (h && document.activeElement === document.body && !document.querySelector('dialog[open]')) {
      h.tabIndex = -1
      h.focus({ preventScroll: true })
    }
  }, [s.k])

  const now = useRef(s)
  now.current = s
  const stillPreparing = (job: Job) => now.current.k === 'prepare' && now.current.job.id === job.id

  switch (s.k) {
    case 'loading':
      return <div className="page" aria-busy="true" />
    case 'home':
      return <Home onFile={onFile} onOpen={(j) => openJob(j)} downloadBytes={support?.downloadBytes} />
    case 'prepare':
      return (
        <Prepare
          title={s.job.transcript.title}
          bytes={support?.downloadBytes}
          updating={support?.updating}
          // 받기는 첫 화면으로 나가도 계속된다: 끝났을 때 아직 이 준비 화면이면 넘어가고, 아니면 조용히 둔다
          onDone={() => stillPreparing(s.job) && setS({ k: 'processing', job: s.job, audio: s.audio, fresh: true })}
          onError={(e) => stillPreparing(s.job) && engineProblem(e.code === 'unknown' ? { ...e, code: 'network' } : e, s.job, s.audio)}
          onHome={home}
        />
      )
    case 'processing':
      return (
        <Processing
          job={s.job}
          audio={s.audio}
          fresh={s.fresh}
          slow={slowDevice.current}
          onDone={(job) => {
            putJob(job)
            setS({ k: 'editor', job, audio: s.audio })
          }}
          onError={(e, job) => engineProblem(e, job, s.audio)}
          onStop={home}
        />
      )
    case 'editor':
      return <Editor key={s.job.id} job={s.job} audio={s.audio} onHome={home} />
    case 'problem':
      return (
        <div className="page">
          <header className="topbar">
            <Logo onClick={home} />
          </header>
          <Problem title={s.title} desc={s.desc} action={s.action} onAction={s.run} onHome={support?.ok === false && support.reason === 'not-chromium' ? undefined : home} />
        </div>
      )
    case 'choose':
      return (
        <div className="page">
          <header className="topbar">
            <Logo onClick={home} />
          </header>
          <main className="center">
            <section className="card state">
              <h1 className="h">{s.title}</h1>
              <p>{s.desc}</p>
              <button type="button" className="btn pri" onClick={s.a[1]}>
                {s.a[0]}
              </button>
              <button type="button" className="btn" onClick={s.b[1]}>
                {s.b[0]}
              </button>
            </section>
          </main>
        </div>
      )
  }
}
