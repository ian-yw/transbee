// 첫 화면: 파일 놓기 하나 + 약속 문구 + 하던 작업 + 설치(바탕화면에 추가)
import { useEffect, useRef, useState } from 'react'
import { isConfirmed } from '../types'
import { deleteJob, getJobs, type Job } from '../storage/db'
import { Dialog } from '../editor/Dialogs'
import { ByBeevelop, Cheer, Logo, ThemeButton, durText, mbText } from './ui'
import { FolderMenu } from './FolderMenu'
import { LegalDialog, SiteInfo, type LegalDoc } from './Legal'
import { AboutPanel, APP_VERSION, CONTACT, GitHubMark, GUIDE_ID, PrivacyDialog, REPO_URL } from './About'

interface InstallEvent extends Event {
  prompt(): Promise<void>
}
let installEvent: InstallEvent | undefined
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault()
  installEvent = e as InstallEvent
})
const standalone = () => matchMedia('(display-mode: standalone)').matches

export const ACCEPT = 'audio/*,.m4a,.mp3,.wav,.aac,.ogg,.flac,.webm,.transbee'

function jobStatus(j: Job): { text: string; ratio: number } {
  const t = j.transcript
  if (t.processing.status !== 'done')
    return {
      text: t.processing.processedUntil ? `${durText(t.processing.processedUntil)}까지 받아 적음` : '받아 적기 전',
      ratio: t.audio.duration ? Math.min(1, t.processing.processedUntil / t.audio.duration) : 0,
    }
  const n = t.utterances.length
  const ok = t.utterances.filter((u) => isConfirmed(u.review)).length
  if (n && ok === n) return { text: '다 고침', ratio: 1 }
  return { text: `${Math.floor((ok / (n || 1)) * 100)}% 확인함`, ratio: ok / (n || 1) }
}

function when(iso: string) {
  const d = new Date(iso)
  return d.toDateString() === new Date().toDateString() ? '오늘' : d.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' })
}

export function Home({ onFile, onOpen, downloadBytes }: { onFile: (f: File) => void; onOpen: (j: Job) => void; downloadBytes?: number }) {
  const [jobs, setJobs] = useState<Job[] | null>(null)
  const [drag, setDrag] = useState(false)
  const [privacy, setPrivacy] = useState(false)
  const [doc, setDoc] = useState<LegalDoc | null>(null)
  const showAbout = () => document.getElementById('about')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  const [installHint, setInstallHint] = useState(false)
  const [guide, setGuide] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  const load = () =>
    getJobs()
      .then((js) => setJobs(js.sort((a, b) => b.transcript.updatedAt.localeCompare(a.transcript.updatedAt))))
      .catch(() => setJobs([]))
  useEffect(() => void load(), [])

  const install = async () => {
    if (installEvent) {
      await installEvent.prompt()
      installEvent = undefined
    } else setInstallHint((v) => !v)
  }

  const [asking, setAsking] = useState<Job>()
  const sideH = useRef<HTMLHeadingElement>(null)
  const remove = async (j: Job) => {
    setAsking(undefined)
    await deleteJob(j.id)
    await load()
    sideH.current?.focus() // 지운 줄에 있던 초점이 사라지지 않게
  }

  return (
    <div
      className="home-page"
      onDragOver={(e) => {
        e.preventDefault()
        setDrag(true)
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDrag(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDrag(false)
        const f = e.dataTransfer.files[0]
        if (f) onFile(f)
      }}
    >
      <header className="topbar">
        <Logo onClick={() => scrollTo({ top: 0, behavior: 'smooth' })} />
        <ByBeevelop />
        <span className="gap" />
        <FolderMenu onFile={onFile} />
        {!standalone() && (
          <span className="pop-wrap">
            <button type="button" className="btn sm" onClick={install} aria-expanded={installHint}>
              설치
            </button>
            {installHint && (
              <span className="hint" role="note">
                설치는 선택이에요. 안 해도 똑같이 쓸 수 있어요.
                <br />
                주소창 오른쪽 끝의 설치 단추를 누르거나, 브라우저 메뉴(⋮)에서 "앱 설치" 또는 "바탕화면에 추가"를 눌러 주세요.
              </span>
            )}
          </span>
        )}
        <ThemeButton />
      </header>

      <main className="home">
        <div>
          <section className={`drop${drag ? ' over' : ''}`} aria-labelledby="drop-h">
            <div className="up" aria-hidden="true">
              ↥
            </div>
            <h1 id="drop-h" className="big">
              녹음 파일을 여기에 놓으세요
            </h1>
            <p className="muted">
              폰이나 녹음기에서 옮긴 m4a, mp3, wav 파일
              <br />
              저장해 둔 작업 파일(.transbee)도 여기에 놓으면 열려요
            </p>
            <div className="drop-btns">
              <button type="button" className="btn pri" onClick={() => input.current?.click()}>
                파일 고르기
              </button>
              {GUIDE_ID && (
                <button type="button" className="btn guide" onClick={() => setGuide(true)}>
                  <span className="play" aria-hidden="true">
                    ▶
                  </span>
                  1분 사용법 영상
                </button>
              )}
            </div>
            {!!downloadBytes && <p className="muted small first-dl">받아 적기를 하려면 AI 모델(약 {mbText(downloadBytes)})을 이 컴퓨터로 받아요. 한 번 받아 두면 새 버전이 나오기 전까지 다시 받지 않아요.</p>}
            <p className="muted small first-dl speed">
              받아 적는 속도는 컴퓨터 성능에 따라 달라요. 빠른 컴퓨터는 50분 녹음을 10분 안쪽에 끝내고, 그래픽 기능을 쓸 수 없는 컴퓨터는 훨씬 오래 걸릴 수 있어요.
            </p>
            <input
              ref={input}
              type="file"
              accept={ACCEPT}
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0]
                e.target.value = ''
                if (f) onFile(f)
              }}
            />
            <div className="promise">
              <span className="lock" aria-hidden="true">
                <svg viewBox="0 0 16 16" width="14" height="14">
                  <rect x="3" y="7" width="10" height="7" rx="1.5" fill="currentColor" />
                  <path d="M5 7V5a3 3 0 0 1 6 0v2" stroke="currentColor" strokeWidth="1.6" fill="none" />
                </svg>
              </span>
              <div>
                <p>
                  <b>transbee는 녹음을 어디에도 보내지 않아요.</b>
                </p>
                <ul>
                  <li>설치하지 않고 이 창에서 바로 써도 돼요. 설치해도, 안 해도 녹음과 축어록은 이 컴퓨터 밖으로 나가지 않아요.</li>
                  <li>처음 한 번 AI 모델을 받은 뒤에는, 받아 적기와 고치기를 모두 이 컴퓨터 안에서 해요.</li>
                  <li>[설치]하면 바탕화면 아이콘으로 열리고, 인터넷이 없을 때도 열 수 있어요.</li>
                </ul>
              </div>
            </div>
            <ul className="trust" aria-label="transbee 약속">
              <li>
                <b>평생 무료</b> 결제 없음
              </li>
              <li>
                <b>회원가입 없음</b> 바로 시작
              </li>
              <li>
                <a href={REPO_URL} target="_blank" rel="noopener noreferrer">
                  <b>오픈소스</b> 만든 방법 공개
                </a>
              </li>
            </ul>
          </section>
        </div>

        <aside className="side">
          <h2 className="side-h" tabIndex={-1} ref={sideH}>
            하던 작업
          </h2>
          {jobs && jobs.length === 0 && <p className="job empty">아직 없어요. 만든 축어록이 여기에 쌓여요.</p>}
          {jobs?.map((j) => {
            const s = jobStatus(j)
            return (
              <div className="job" key={j.id}>
                <button type="button" className="job-open" onClick={() => onOpen(j)}>
                  <span className="n">{j.transcript.title}</span>
                  <span className="bar" aria-hidden="true">
                    <i style={{ width: `${s.ratio * 100}%` }} className={s.ratio === 1 ? 'done' : ''} />
                  </span>
                  <span className="m">
                    <span>{s.text}</span>
                    <span>{when(j.transcript.updatedAt)}</span>
                    {j.savedAt && j.transcript.updatedAt <= j.savedAt && <span className="tag">폴더에 저장됨</span>}
                  </span>
                </button>
                <button type="button" className="btn quiet sm del" onClick={() => setAsking(j)} aria-label={`${j.transcript.title} 지우기`}>
                  지우기
                </button>
              </div>
            )
          })}
          <Cheer inline hand="오늘도 준비하느라 애쓰셨어요." sub="받아 적기는 transbee가 먼저 해 둘게요. 다듬기만 하시면 돼요." />
        </aside>
      </main>

      {/* 부가 정보: 작업 영역과 띠(배경·선)로 나누고 글씨를 한 단계 작게 */}
      <section className="infozone" aria-label="transbee 정보와 안내">
        <div className="infozone-in">
          <AboutPanel />
          <SiteInfo onDoc={setDoc} />
        </div>
      </section>

      <footer className="foot">
        <p>상담 녹음을 사례보고서용 축어록으로 옮겨 적는 AI 기반 프로그램이에요. 이 컴퓨터 안에서만 돌고 녹음과 축어록은 어디에도 보내지 않아요.</p>
        <p className="foot-links">
          <span>
            © {new Date().getFullYear()}{' '}
            <a href="https://beevelop.ai/ko" target="_blank" rel="noopener noreferrer">
              Beevelop
            </a>
          </span>
          {CONTACT ? (
            <a href={CONTACT} target="_blank" rel="noopener noreferrer">
              문의하기
            </a>
          ) : (
            <span>문의 · 준비 중</span>
          )}
          <button type="button" className="link" onClick={showAbout}>
            버전 {APP_VERSION}
          </button>
          <a href={REPO_URL} target="_blank" rel="noopener noreferrer" className="ghlink">
            <GitHubMark /> 소스코드
          </a>
          <button type="button" className="link" onClick={() => setPrivacy(true)}>
            개인정보 안내
          </button>
        </p>
      </footer>
      <PrivacyDialog open={privacy} onClose={() => setPrivacy(false)} />
      <LegalDialog doc={doc} onClose={() => setDoc(null)} />
      <Dialog open={guide} onClose={() => setGuide(false)} label="transbee 1분 사용법 영상" className="video">
        <div className="gd-head">
          <b>1분 사용법</b>
          <button type="button" className="gd-x" onClick={() => setGuide(false)} aria-label="닫기" data-autofocus>
            ×
          </button>
        </div>
        {/* 누를 때만 YouTube에 연결. COEP credentialless 페이지라 iframe도 credentialless(쿠키 없이 열림) */}
        <iframe
          className="gd-video"
          src={`https://www.youtube-nocookie.com/embed/${GUIDE_ID}?autoplay=1&rel=0&playsinline=1`}
          title="transbee 1분 사용법"
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
          {...{ credentialless: true }}
        />
        <a className="gd-yt" href={`https://www.youtube.com/shorts/${GUIDE_ID}`} target="_blank" rel="noopener noreferrer">
          YouTube에서 보기 ↗
        </a>
      </Dialog>
      <Dialog open={!!asking} onClose={() => setAsking(undefined)} label="작업 지우기">
        <h2 className="h">"{asking?.transcript.title}" 작업을 지울까요?</h2>
        <p>이 브라우저에서만 지워져요. 폴더에 저장한 파일은 그대로 남아요.</p>
        <div className="dlg-foot">
          <button type="button" className="btn" onClick={() => setAsking(undefined)}>
            그대로 두기
          </button>
          <button type="button" className="btn pri" onClick={() => asking && remove(asking)}>
            지우기
          </button>
        </div>
      </Dialog>

    </div>
  )
}
