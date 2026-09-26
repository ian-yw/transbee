// 처음 한 번 준비(모델 받기) + 그동안 저장할 폴더 고르기
import { useEffect, useRef, useState } from 'react'
import type { EngineError, Progress } from '../engine/api'
import { canPickFolder, getFolder, pickFolder } from '../storage/folder'
import { engine } from './engine'
import { Logo, etaText, mbText } from './ui'

export function FolderPick({ compact }: { compact?: boolean }) {
  const [name, setName] = useState<string>()
  useEffect(() => void getFolder().then((d) => setName(d?.name)), [])
  if (!canPickFolder()) return null
  const pick = async () => {
    const d = await pickFolder()
    if (d) setName(d.name)
  }
  return (
    <section className={compact ? 'folder compact' : 'card folder'} aria-labelledby="folder-h">
      <h2 id="folder-h" className="h">
        {name ? '작업은 이 폴더에 저장해요' : '받는 동안, 저장할 폴더를 골라 주세요'}
      </h2>
      <p className="sub-h">고치는 동안 1분마다 이 폴더에 작업 파일을 저장해 둬요. 브라우저를 정리해도 작업이 남아요.</p>
      {name ? (
        <div className="job row-c">
          <span aria-hidden="true">📁</span>
          <div className="n">‘{name}’ 폴더</div>
        </div>
      ) : (
        // 문서·다운로드·바탕화면 폴더 자체는 Chrome이 고르지 못하게 막아 둔다(시스템 폴더 보호). 그 안에 새 폴더를 만들어야 한다.
        <ol className="how">
          <li>아래 [폴더 고르기]를 누르면 폴더 창이 열려요.</li>
          <li>
            <b>문서</b> 폴더 안에서 <b>새 폴더</b>를 만들어(예: 상담 축어록) 그 폴더를 고르세요. 문서·다운로드·바탕화면 폴더 자체는 브라우저가 막아 두어 고를 수 없어요.
          </li>
          <li>Chrome이 파일을 보고 고쳐도 되는지 물으면 <b>허용</b>을 누르세요.</li>
        </ol>
      )}
      <button type="button" className={`btn ${name ? '' : 'pri'} wide`} onClick={pick}>
        {name ? '폴더 바꾸기' : '폴더 고르기'}
      </button>
      <p className="box">
        다음에 transbee를 열 때 Chrome이 다시 허용을 물을 수 있어요. <b>매번 허용</b>을 고르면 그다음부터는 묻지 않아요. 고치는 중에도 위쪽의 <b>저장 폴더 … 바꾸기</b>로 폴더를 바꿀 수 있어요.
      </p>
      <p className="box">
        <b>작업 파일에는 녹음이 들어 있어요.</b> 메신저나 클라우드로 옮기면 그곳에도 저장돼요. 다른 컴퓨터로 옮길 때는 USB나 AirDrop이 가장 안전해요.
      </p>
    </section>
  )
}

export function Prepare({ title, bytes, updating, onDone, onError, onHome }: { title: string; bytes?: number; updating?: boolean; onDone: () => void; onError: (e: EngineError) => void; onHome: () => void }) {
  const [p, setP] = useState<Progress>()
  const started = useRef(false)
  useEffect(() => {
    if (started.current) return
    started.current = true
    engine
      .prepareModels(setP)
      .then(onDone)
      .catch((e: EngineError) => onError(e?.code ? e : { code: 'unknown', message: String(e) }))
  }, [onDone, onError])
  const ratio = p?.ratio ?? 0
  return (
    <div className="page">
      <header className="topbar">
        <Logo onClick={onHome} />
        <span className="title">{title}</span>
      </header>
      <main className="prep">
        <section className="card" aria-labelledby="prep-h">
          <h1 id="prep-h" className="h">
            {updating ? 'AI 모델을 새 버전으로 바꿀게요' : 'AI 모델을 이 컴퓨터에 받아 둘게요'}
          </h1>
          <p className="sub-h">
            {updating
              ? 'transbee가 더 잘 받아 적는 새 버전으로 바뀌었어요. 새 AI 모델을 한 번 받고, 예전 모델은 지워서 공간을 비워요.'
              : 'AI 받아 적기를 위한 AI 모델을 받고 있어요. 받아 둔 모델은 이 컴퓨터에 남아서, 다음부터는 받지 않고 바로 시작해요. 새 버전이 나오면 그때 한 번 더 받아요.'}
          </p>
          <div className="bar big" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(ratio * 100)} aria-label="AI 모델 받기">
            <i style={{ width: `${ratio * 100}%` }} />
          </div>
          <div className="small muted row-sb">
            <span>{p?.totalBytes ? `${mbText(p.totalBytes)} 중 ${mbText(p.downloadedBytes ?? 0)}` : bytes ? `약 ${mbText(bytes)}를 받을 준비를 하고 있어요` : '받을 준비를 하고 있어요'}</span>
            <span>{etaText(p?.etaSec)}</span>
          </div>
          <p className="box">다 받으면 바로 받아 적기를 시작해요. 이 창은 열어 두세요.</p>
        </section>
        <FolderPick />
      </main>
    </div>
  )
}
