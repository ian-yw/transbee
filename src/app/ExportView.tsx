// 한글/워드로 내보내기: 범위·모양·칸·넣을 것 → 복사해서 붙이기 / 파일로 받기, 오른쪽에 붙였을 때 모양
import { useEffect, useMemo, useRef, useState } from 'react'
import { isConfirmed, type Transcript } from '../types'
import { DEFAULT_EXPORT, countDrafts, toClipboard, toDocx, toHwpx, toTxt, toXlsx, type ExportOptions } from '../export'
import { safeName } from '../storage/file'
import { isMac } from './settings'
import { durText, download } from './ui'

type Kind = 'hwpx' | 'xlsx' | 'docx' | 'txt'
const MAKE: Record<Kind, (t: Transcript, o: ExportOptions) => Promise<Blob>> = {
  hwpx: toHwpx,
  xlsx: toXlsx,
  docx: toDocx,
  txt: async (t, o) => new Blob([toTxt(t, o)], { type: 'text/plain;charset=utf-8' }),
}

const PREVIEW_CSS = `<style>body{margin:0;padding:18px 20px;background:#fff;color:#000;font-family:'함초롬바탕',Batang,'AppleMyungjo',serif}</style>`

export function ExportView(p: { t: Transcript; folder?: string; fileBase?: string; saved: boolean; onBack: () => void; onHome: () => void; onSave: () => void; onExported: () => void }) {
  const { t } = p
  const [o, setO] = useState<ExportOptions>(DEFAULT_EXPORT)
  const [state, setState] = useState<'idle' | 'copied' | 'copyFail' | 'fileFail'>('idle')
  const h = useRef<HTMLHeadingElement>(null)
  useEffect(() => h.current?.focus(), [state])

  const preview = useMemo(() => {
    try {
      return toClipboard(t, o)
    } catch {
      return null
    }
  }, [t, o])
  const drafts = useMemo(() => {
    try {
      return countDrafts(t, o)
    } catch {
      return null
    }
  }, [t, o])

  const set = (patch: Partial<ExportOptions>) => setO((x) => ({ ...x, ...patch }))
  const inc = (k: keyof ExportOptions['include']) => setO((x) => ({ ...x, include: { ...x.include, [k]: !x.include[k] } }))
  const col = (k: keyof ExportOptions['columns']) => setO((x) => ({ ...x, columns: { ...x.columns, [k]: !x.columns[k] } }))
  const picked = o.range.kind === 'sections' ? o.range.sectionIds : []
  const none = o.range.kind === 'sections' && !picked.length
  const toggleSection = (id: string) =>
    set({ range: { kind: 'sections', sectionIds: picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id] } })

  const copy = async () => {
    try {
      const { html, text } = toClipboard(t, o)
      await navigator.clipboard.write([
        new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([text], { type: 'text/plain' }) }),
      ])
      setState('copied')
      p.onExported()
    } catch {
      setState('copyFail')
    }
  }
  const file = async (k: Kind) => {
    try {
      download(await MAKE[k](t, o), `${safeName(t.title)}.${k}`)
      p.onExported()
    } catch {
      setState('fileFail')
    }
  }

  // 표에서는 넣을 것 중 시각 대신 표 칸의 시각을 쓴다(두 설정이 헷갈리지 않게)
  const table = o.layout === 'table'
  const sections = [...t.sections].sort(
    (a, b) => t.utterances.findIndex((u) => u.id === a.beforeUtteranceId) - t.utterances.findIndex((u) => u.id === b.beforeUtteranceId),
  )

  if (state === 'copyFail' || state === 'fileFail')
    return (
      <main className="center">
        <section className="card state">
          <h1 className="h" tabIndex={-1} ref={h}>
            {state === 'copyFail' ? '복사하지 못했어요' : '파일을 만들지 못했어요'}
          </h1>
          <p>
            {state === 'copyFail'
              ? '이 브라우저가 서식 있는 복사를 막았어요. 한글 파일로 받아서 열면 같은 모양이에요.'
              : '글자만 받기로 받으면 메모장이나 한글에서 열 수 있어요.'}
          </p>
          <button type="button" className="btn pri" onClick={() => (setState('idle'), file(state === 'copyFail' ? 'hwpx' : 'txt'))}>
            {state === 'copyFail' ? '한글 파일로 받기' : '글자만 받기'}
          </button>
          <button type="button" className="btn quiet" onClick={() => setState('idle')}>
            내보내기로 돌아가기
          </button>
        </section>
      </main>
    )

  if (state === 'copied') {
    const all = t.utterances.length > 0 && t.utterances.every((u) => isConfirmed(u.review))
    const edited = t.utterances.filter((u) => u.review === 'edited').length
    return (
      <main className="center">
        <section className="card state done">
          <div className="check" aria-hidden="true">
            ✓
          </div>
          <h1 className="h" tabIndex={-1} ref={h}>
            {all ? '한 회기 축어록을 다 만들었어요' : '복사해 두었어요'}
          </h1>
          <p>한글이나 워드를 열고 붙여넣기({isMac ? '⌘V' : 'Ctrl+V'}) 하세요.</p>
          <p className="small muted">
            {durText(t.audio.duration)} 녹음, 발화 {t.utterances.length}개, 직접 고친 문장 {edited}개
          </p>
          {p.saved && p.folder ? (
            <p className="box safe">
              작업은 ‘{p.folder}’ 폴더에 "{safeName(p.fileBase ?? t.title)}.transbee"로 저장돼 있어요.
            </p>
          ) : (
            <p className="box">
              작업을 파일로 남기려면 저장해 주세요.{' '}
              <button type="button" className="link" onClick={p.onSave}>
                저장하기
              </button>
            </p>
          )}
          <button type="button" className="btn pri" onClick={p.onHome}>
            다른 녹음 넣기
          </button>
          <button type="button" className="btn quiet" onClick={() => setState('idle')}>
            내보내기로 돌아가기
          </button>
        </section>
      </main>
    )
  }

  return (
    <main className="export">
      <section className="opts" aria-labelledby="exp-h">
        <h1 id="exp-h" className="h" tabIndex={-1} ref={h}>
          한글/워드로 내보내기
        </h1>

        <fieldset>
          <legend className="gl">모양</legend>
          <div className="seg">
            <label>
              <input type="radio" name="layout" checked={!table} onChange={() => set({ layout: 'prose' })} />
              줄글
            </label>
            <label>
              <input type="radio" name="layout" checked={table} onChange={() => set({ layout: 'table' })} />표
            </label>
          </div>
        </fieldset>

        <fieldset>
          <legend className="gl">맨 위 제목</legend>
          <input
            id="exp-title"
            className="txtin"
            type="text"
            value={o.title}
            placeholder="예: 11회기 축어록"
            aria-label="맨 위 제목(비우면 넣지 않아요)"
            onChange={(e) => set({ title: e.target.value })}
          />
        </fieldset>

        <fieldset>
          <legend className="gl">화자 이름</legend>
          <div className="seg">
            <label>
              <input type="radio" name="label" checked={o.label === 'full'} onChange={() => set({ label: 'full' })} />
              상담자 1 · 내담자 1
            </label>
            <label>
              <input type="radio" name="label" checked={o.label === 'short'} onChange={() => set({ label: 'short' })} />
              상1 · 내1
            </label>
          </div>
        </fieldset>

        {table && (
          <fieldset>
            <legend className="gl">표 칸</legend>
            <Check on={o.columns.number} onChange={() => col('number')} label="번호" />
            <Check on={o.columns.speaker} onChange={() => col('speaker')} label="화자" />
            <Check on={o.columns.time} onChange={() => col('time')} label="시각" />
            <Check on disabled label="내용" />
            <Check on={o.columns.memo} onChange={() => col('memo')} label="메모 칸" note="비워 둠" />
          </fieldset>
        )}

        <fieldset>
          <legend className="gl">넣을 것</legend>
          {!table && <Check on={o.include.time} onChange={() => inc('time')} label="시각" note="[12:04]" />}
          <Check on={o.include.nonverbal} onChange={() => inc('nonverbal')} label="비언어" note="(웃음) (침묵 4초)" />
          <Check on={o.include.backchannel} onChange={() => inc('backchannel')} label="맞장구" note="(네) (음)" />
          <Check on={o.include.sections} onChange={() => inc('sections')} label="소제목" />
        </fieldset>

        <fieldset>
          <legend className="gl">범위</legend>
          <label className={`opt${o.range.kind === 'all' ? ' on' : ''}`}>
            <input type="radio" name="range" checked={o.range.kind === 'all'} onChange={() => set({ range: { kind: 'all' } })} />
            전체<span className="x">{durText(t.audio.duration)}</span>
          </label>
          <label className={`opt${o.range.kind === 'sections' ? ' on' : ''}`}>
            <input
              type="radio"
              name="range"
              disabled={!sections.length}
              checked={o.range.kind === 'sections'}
              onChange={() => set({ range: { kind: 'sections', sectionIds: sections.slice(0, 1).map((s) => s.id) } })}
            />
            소제목으로 고르기
            <span className="x">{sections.length ? `${picked.length}개 고름` : '소제목이 없어요'}</span>
          </label>
          {o.range.kind === 'sections' && (
            <>
              <div className="chips">
                {sections.map((s) => (
                  <button type="button" key={s.id} aria-pressed={picked.includes(s.id)} onClick={() => toggleSection(s.id)}>
                    {s.title}
                  </button>
                ))}
              </div>
              <Check on={o.gapMark} onChange={() => set({ gapMark: !o.gapMark })} label="건너뛴 곳 표시" note="〈중략〉" />
            </>
          )}
        </fieldset>

        {!t.speakers.roles[0] && !t.speakers.roles[1] && (
          <p className="box warn" role="status">
            상담자를 아직 정하지 않아 "화자1 · 화자2"로 나가요.{' '}
            <button type="button" className="link" onClick={p.onBack}>
              상담자 정하러 가기
            </button>
          </p>
        )}
        {none && (
          <p className="box" role="status">
            내보낼 소제목을 하나 이상 골라 주세요.
          </p>
        )}
        {!!drafts && (
          <p className="box" role="status">
            아직 확인하지 않은 초벌 문장이 {drafts}개 있어요. 그대로 내보낼 수도 있어요.
          </p>
        )}
        <button type="button" className="btn pri full" onClick={copy} disabled={none}>
          복사해서 한글에 붙이기
        </button>
        <button type="button" className="btn full" onClick={() => file('hwpx')} disabled={none}>
          한글 파일로 받기
        </button>
        <p className="more">
          <button type="button" className="link" onClick={() => file('xlsx')} disabled={none}>
            엑셀 파일로 받기
          </button>
          <button type="button" className="link" onClick={() => file('docx')} disabled={none}>
            워드
          </button>
          <button type="button" className="link" onClick={() => file('txt')} disabled={none}>
            글자만
          </button>
        </p>
        {table || <p className="small muted">엑셀 파일은 늘 표 모양으로 받아요.</p>}
      </section>
      <section className="pv" aria-label="한글·워드에 붙였을 때 모양">
        <p className="cap2">한글·워드에 붙였을 때 모양</p>
        {preview ? (
          <iframe className="hwp" title="한글·워드에 붙였을 때 모양" sandbox="" srcDoc={PREVIEW_CSS + preview.html} />
        ) : (
          <div className="hwp empty">미리보기를 준비하고 있어요.</div>
        )}
      </section>
    </main>
  )
}

function Check({ on, onChange, label, note, disabled }: { on: boolean; onChange?: () => void; label: string; note?: string; disabled?: boolean }) {
  return (
    <label className={`opt${on ? ' on' : ''}`}>
      <input type="checkbox" checked={on} disabled={disabled} onChange={onChange ?? (() => {})} />
      {label}
      {note && <span className="x">{note}</span>}
    </label>
  )
}
