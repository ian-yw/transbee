// 초벌 만들기: 진행 줄 + 받아 적은 부분이 쌓이는 문서
import { useEffect, useRef, useState } from 'react'
import type { EngineError, Progress } from '../engine/api'
import type { Transcript } from '../types'
import { utteranceLabels } from '../labels'
import { putJob, type Job } from '../storage/db'
import { engine } from './engine'
import { Cheer, Logo, durText, etaText } from './ui'

function stageText(p?: Progress): string {
  if (!p) return '받아 적기를 시작하고 있어요'
  if (p.stage === 'decode') return '녹음을 열고 있어요'
  if (p.stage === 'diarize') return p.totalSec && p.processedSec ? `두 목소리를 나누고 있어요 · ${durText(p.totalSec)} 중 ${durText(p.processedSec, p.totalSec >= 600)}까지` : '두 목소리를 나누고 있어요'
  if (p.stage === 'finish') return '거의 다 됐어요'
  if (p.stage === 'transcribe' && p.totalSec) return `${durText(p.totalSec)} 녹음 중 ${durText(p.processedSec ?? 0, p.totalSec >= 600)}까지 받아 적었어요`
  return '받아 적고 있어요'
}

export function Processing(props: {
  job: Job
  audio: Blob
  fresh: boolean
  /** 그래픽 기능 없이 CPU로 받아 적는 컴퓨터(오래 걸림) */
  slow?: boolean
  onDone: (job: Job) => void
  onError: (e: EngineError, job: Job) => void
  onStop: () => void
}) {
  const { job, audio, fresh } = props
  const [p, setP] = useState<Progress>()
  const [t, setT] = useState<Transcript>(job.transcript)
  const cbs = useRef(props)
  cbs.current = props

  useEffect(() => {
    let latest = job
    const save = (tr: Transcript) => {
      latest = { ...latest, transcript: tr }
      putJob(latest).catch(() => {})
    }
    // 처리 중에는 화면이 꺼져 잠들지 않게(노트북 덮기는 막을 수 없음). 다른 창에 가면 브라우저가 풀므로 돌아올 때 다시 건다
    let lock: { release(): Promise<void> } | undefined
    const keepAwake = () => {
      if (document.visibilityState !== 'visible') return
      ;(navigator as unknown as { wakeLock?: { request(t: 'screen'): Promise<typeof lock> } }).wakeLock
        ?.request('screen')
        .then((l) => (lock = l))
        .catch(() => {})
    }
    keepAwake()
    document.addEventListener('visibilitychange', keepAwake)
    const resume = job.transcript.processing.processedUntil > 0 ? job.transcript : undefined
    const run = engine.transcribe(
      audio,
      { fileName: job.transcript.audio.fileName, mime: job.transcript.audio.mime },
      {
        onProgress: setP,
        onPartial: (tr) => {
          const x = { ...tr, id: job.transcript.id, title: job.transcript.title }
          setT(x)
          save(x)
        },
        onDone: (tr) => {
          const x = { ...tr, id: job.transcript.id, title: job.transcript.title }
          save(x)
          cbs.current.onDone({ ...latest, doneAt: x.updatedAt })
        },
        onError: (e) => cbs.current.onError(e, latest),
      },
      { resume, settings: job.transcript.settings },
    )
    return () => {
      run.cancel()
      document.removeEventListener('visibilitychange', keepAwake)
      lock?.release().catch(() => {})
    }
  }, [job, audio])

  const labels = utteranceLabels(t)
  // 막대는 전체 진행: 녹음 열기 2% → 목소리 나누기 15% → 받아 적기 나머지
  const r = p?.ratio ?? 0
  const ratio = !p ? 0 : p.stage === 'decode' ? 0.02 * r : p.stage === 'diarize' ? 0.02 + 0.13 * r : p.stage === 'transcribe' ? 0.15 + 0.85 * r : p.stage === 'finish' ? 1 : 0
  // 멈춘 게 아니라는 표시: 시작한 뒤 흐른 시간(1초마다)
  const [started] = useState(() => Date.now())
  const [, tick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => tick((x) => x + 1), 1000)
    return () => clearInterval(id)
  }, [])
  const elapsed = Math.floor((Date.now() - started) / 1000)
  const elapsedText = `시작한 지 ${elapsed >= 60 ? `${Math.floor(elapsed / 60)}분 ` : ''}${elapsed % 60}초`
  return (
    <div className="page proc">
      <header className="topbar">
        <Logo onClick={props.onStop} />
        <span className="title">{job.transcript.title}</span>
        <span className="gap" />
        <button type="button" className="btn quiet sm" onClick={props.onStop}>
          멈추고 첫 화면으로
        </button>
      </header>
      <div className="strip" aria-live="polite">
        <span className="what">{stageText(p)}</span>
        <span className="bar run" role="progressbar" aria-label="받아 적기" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(ratio * 100)}>
          <i style={{ width: `${Math.max(ratio * 100, 2)}%` }} />
        </span>
        <span className="small muted">
          {elapsedText}
          {p?.stage === 'transcribe' && etaText(p.etaSec) ? ` · ${etaText(p.etaSec)}` : ''}
        </span>
      </div>
      <p className="note-line">
        {props.slow && <>이 컴퓨터는 그래픽 기능을 쓸 수 없어 천천히 받아 적어요. 시간이 계속 늘어나고 있으면 잘 되고 있는 거예요. </>}
        노트북을 덮으면 멈춰요. 전원을 연결해 두세요. 다른 창에서 일해도 괜찮아요.
      </p>
      {fresh && (
        <p className="box safe ready">
          <b>준비가 끝났어요. 원하면 지금 인터넷을 차단해 보세요.</b>
          <br />
          인터넷이 끊겨도 축어록이 그대로 만들어져요. transbee가 녹음을 어디에도 보내지 않는다는 뜻이에요.
        </p>
      )}
      <main className="desk">
        <article className="sheet">
          <h1 className="doc-h">{job.transcript.title}</h1>
          <p className="doc-m">받아 적은 부분부터 먼저 보여드려요. 고치기는 다 끝난 뒤에 할 수 있어요.</p>
          {t.utterances.map((u, i) => (
            <div className="u" key={u.id}>
              <span className="mk p" aria-hidden="true" />
              <span className="s pen">{labels[i]}</span>
              <p className="txt pen">{u.text}</p>
            </div>
          ))}
          <div className="u">
            <span />
            <span />
            <p className="writing">받아 적는 중이에요</p>
          </div>
        </article>
      </main>
      <Cheer
        hand="차 한 잔 하고 오셔도 돼요."
        sub={p?.stage === 'transcribe' && p.totalSec ? `${stageText(p)}. ${etaText(p.etaSec)}` : '받아 적은 부분이 아래에 차례로 쌓여요.'}
      />
    </div>
  )
}
