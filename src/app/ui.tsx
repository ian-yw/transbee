// 여러 화면에서 쓰는 작은 부품: 로고, 응원 쪽지, "이럴 때는" 틀, 시간 표기
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { setSettings, useSettings, type Settings } from './settings'

export function Logo({ onClick }: { onClick?: () => void }) {
  const inner = (
    <>
      <svg className="mark" viewBox="0 0 86 179" aria-hidden="true">
        <path d="M21.8 6.4h42.4L85.4 44 64.2 81.6H21.8L.6 44z" fill="#FFC943" />
        <path d="M21.8 97.4h42.4L85.4 135l-21.2 37.6H21.8L.6 135z" fill="currentColor" />
      </svg>
      <span className="word">
        trans<em>bee</em>
      </span>
    </>
  )
  return onClick ? (
    <button type="button" className="logo" onClick={onClick} aria-label="transbee 첫 화면으로">
      {inner}
    </button>
  ) : (
    <span className="logo">{inner}</span>
  )
}

/** 화면 밝기 단추: 컴퓨터 설정 따라 → 밝게 → 어둡게 → … (보기 설정의 '화면'과 같은 값) */
const THEMES: { v: Settings['theme']; name: string; icon: ReactNode }[] = [
  { v: 'auto', name: '컴퓨터 설정 따라', icon: <path d="M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2zm0 1.5v9a4.5 4.5 0 0 1 0-9z" fill="currentColor" /> },
  { v: 'light', name: '밝은 화면', icon: <g stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" fill="none"><circle cx="8" cy="8" r="3" /><path d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1" /></g> },
  { v: 'dark', name: '어두운 화면', icon: <path d="M13.5 10.2A5.8 5.8 0 0 1 5.8 2.5a5.8 5.8 0 1 0 7.7 7.7z" fill="currentColor" /> },
]
export function ThemeButton() {
  const { theme } = useSettings()
  const i = Math.max(0, THEMES.findIndex((t) => t.v === theme))
  const next = THEMES[(i + 1) % THEMES.length]
  return (
    <button type="button" className="btn sm theme-btn" onClick={() => setSettings({ theme: next.v })} aria-label={`화면: ${THEMES[i].name} (누르면 ${next.name})`} title={`화면: ${THEMES[i].name} · 누르면 ${next.name}`}>
      <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
        {THEMES[i].icon}
      </svg>
    </button>
  )
}

export const ByBeevelop = () => (
  <a className="by" href="https://beevelop.ai/ko" target="_blank" rel="noopener noreferrer">
    by Beevelop상담교육센터
  </a>
)

/** 손글씨 쪽지. 사용자가 다른 일을 시작하면 접히고(누르면 다시 펼침), ×로 닫는다. 설정에서 끄면 안 보인다. */
export function Cheer({ hand, sub, action, onAction, inline }: { hand: ReactNode; sub?: ReactNode; action?: string; onAction?: () => void; inline?: boolean }) {
  const { cheers } = useSettings()
  const [open, setOpen] = useState(true)
  const [gone, setGone] = useState(false)
  const [hold, setHold] = useState(false)
  const box = useRef<HTMLElement>(null)
  // 시간이 지나면 접는 대신, 보인 지 3초가 지난 뒤 처음 누르거나 입력할 때 접는다(다른 데를 보다가 놓치지 않게)
  useEffect(() => {
    if (!open || hold) return
    const since = Date.now()
    const fold = (e: Event) => {
      if (Date.now() - since < 3000 || box.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    addEventListener('pointerdown', fold, true)
    addEventListener('keydown', fold, true)
    return () => {
      removeEventListener('pointerdown', fold, true)
      removeEventListener('keydown', fold, true)
    }
  }, [open, hold])
  if (!cheers || gone) return null
  if (!open)
    return (
      <button type="button" className={`cheer-tab${inline ? ' inline' : ''}`} onClick={() => setOpen(true)}>
        쪽지
      </button>
    )
  return (
    <aside
      ref={box}
      className={`cheer${inline ? ' inline' : ''}`}
      role="status"
      onMouseEnter={() => setHold(true)}
      onMouseLeave={() => setHold(false)}
      onFocus={() => setHold(true)}
      onBlur={(e) => !box.current?.contains(e.relatedTarget) && setHold(false)}
    >
      <p className="hand">{hand}</p>
      {sub && <p className="sub">{sub}</p>}
      {action && (
        <button type="button" className="btn sm act" onClick={onAction}>
          {action}
        </button>
      )}
      <button type="button" className="x" aria-label="쪽지 닫기" onClick={() => setGone(true)}>
        ×
      </button>
    </aside>
  )
}

/** 새 버전을 뒤에서 받아 두었으면 한 줄 알림. 창을 모두 닫고 다시 열 때 바뀐다(src/sw.js). */
export function UpdateNote() {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    navigator.serviceWorker?.getRegistration().then((r) => {
      if (!r) return
      const check = () => setReady(!!r.waiting && !!navigator.serviceWorker.controller)
      const watch = () => r.installing?.addEventListener('statechange', check)
      check()
      watch()
      r.addEventListener('updatefound', watch)
    })
  }, [])
  return ready ? (
    <p className="update-note" role="status">
      새 버전이 있어요. 창을 닫고 다시 열면 적용돼요.
      <button type="button" className="x" aria-label="알림 닫기" onClick={() => setReady(false)}>
        ×
      </button>
    </p>
  ) : null
}

/** "이럴 때는" 화면: 제목 한 줄 + 설명 한 줄 + 버튼 하나 */
export function Problem(p: { title: string; desc: ReactNode; action: string; onAction: () => void; onHome?: () => void }) {
  const h = useRef<HTMLHeadingElement>(null)
  useEffect(() => h.current?.focus(), [])
  return (
    <main className="center">
      <section className="card state">
        <h1 className="h" tabIndex={-1} ref={h}>
          {p.title}
        </h1>
        <p>{p.desc}</p>
        <button type="button" className="btn pri" onClick={p.onAction}>
          {p.action}
        </button>
        {p.onHome && (
          <button type="button" className="btn quiet" onClick={p.onHome}>
            첫 화면으로
          </button>
        )}
      </section>
    </main>
  )
}

/** 52분 / 1분 21초 / 40초. coarse면 분까지만(긴 녹음의 진행 표시용) */
export function durText(sec: number, coarse = false): string {
  const s = Math.max(0, Math.round(sec))
  if (s < 60 && !coarse) return `${s}초`
  const m = Math.floor(s / 60)
  const r = s % 60
  if (s < 600 && r && !coarse) return `${m}분 ${r}초`
  const h = Math.floor(m / 60)
  return h ? `${h}시간 ${m % 60}분` : `${m}분`
}

export const etaText = (sec?: number) =>
  sec === undefined ? '' : sec < 60 ? '1분 안에 끝나요' : `약 ${Math.round(sec / 60)}분 남음`

export const mbText = (bytes: number) => (bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)}GB` : `${Math.round(bytes / 1024 ** 2)}MB`)

export function download(blob: Blob, name: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
}
