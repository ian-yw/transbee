// 발화 한 줄: 여백 표시 · 화자 이름(줄 도구) · 바로 고치는 본문 · 소리 제안
import { memo, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { Section, Utterance } from '../types'
import { clock } from '../labels'
import { decorate, undecorate } from './highlights'

export interface Actions {
  input(uid: string, text: string, e: InputEvent): void
  key(uid: string, e: KeyboardEvent<HTMLElement>): void
  focus(uid: string): void
  mark(uid: string): void
  tools(uid: string, btn: HTMLElement): void
  suggestion(uid: string, sid: string, accept: boolean): void
  sectionInput(sid: string, title: string): void
  sectionBlur(sid: string, title: string): void
  /** 이 줄 재생/멈춤(지금 문장 옆 단추) */
  play(uid: string): void
  /** 문장을 마우스로 눌렀을 때(고치기 시작) */
  press(): void
}

/** old → next로 바뀐 부분이 next에서 끝나는 위치(앞뒤 같은 글자를 빼고 남은 가운데의 끝) */
export function changedEnd(old: string, next: string): number {
  let a = 0
  while (a < old.length && a < next.length && old[a] === next[a]) a++
  let b = 0
  while (b < old.length - a && b < next.length - a && old[old.length - 1 - b] === next[next.length - 1 - b]) b++
  return next.length - b
}

/** textContent를 React 밖에서 관리하는 편집 칸(타이핑 중 커서가 튀지 않게) */
function useText(text: string, after?: (el: HTMLElement) => void) {
  const ref = useRef<HTMLParagraphElement>(null)
  // 한 줄 칸: 줄바꿈은 어떤 길로도 들어오지 않게(Windows 한글 입력기의 조합 중 Enter, 끌어다 놓기).
  // 본문이 글자 노드 하나라는 가정(커서 위치·밑줄 계산)이 여기에 기댄다.
  useLayoutEffect(() => {
    const el = ref.current!
    const block = (e: InputEvent) => {
      if (e.inputType === 'insertParagraph' || e.inputType === 'insertLineBreak') e.preventDefault()
      // 글자를 골라 두고 ( 를 치면 괄호로 감싼다: "음" → "(음)"
      else if (e.inputType === 'insertText' && e.data === '(') {
        const sel = getSelection()
        const picked = sel && !sel.isCollapsed && el.contains(sel.anchorNode) ? sel.toString() : ''
        if (picked && !/[()\n]/.test(picked)) {
          e.preventDefault()
          document.execCommand('insertText', false, `(${picked.trim()})`)
        }
      }
      else if (e.inputType === 'insertFromDrop') {
        e.preventDefault()
        const s = e.dataTransfer?.getData('text/plain')
        if (s) document.execCommand('insertText', false, s.replace(/\s*\n\s*/g, ' '))
      }
    }
    el.addEventListener('beforeinput', block)
    return () => el.removeEventListener('beforeinput', block)
  }, [])
  useLayoutEffect(() => {
    const el = ref.current!
    const old = el.textContent ?? ''
    if (old !== text) {
      const focused = document.activeElement === el
      el.textContent = text
      if (focused && el.firstChild) {
        // 되돌리기·다시 하기처럼 밖에서 글자가 바뀌면 바뀐 자리 끝에 커서(문장 끝으로 튀지 않게)
        const r = document.createRange()
        r.setStart(el.firstChild, changedEnd(old, text))
        r.collapse(true)
        getSelection()?.removeAllRanges()
        getSelection()?.addRange(r)
      }
    }
    after?.(el)
  })
  return ref
}

function onPaste(e: React.ClipboardEvent) {
  e.preventDefault()
  const s = e.clipboardData.getData('text/plain').replace(/\s*\n\s*/g, ' ')
  document.execCommand('insertText', false, s)
}

function SectionLine({ s, act }: { s: Section; act: Actions }) {
  const ref = useText(s.title)
  return (
    <p
      ref={ref}
      className="sec"
      contentEditable="plaintext-only"
      suppressContentEditableWarning
      spellCheck={false}
      data-sid={s.id}
      aria-label="소제목"
      data-ph="소제목을 적어 주세요"
      onInput={(e) => act.sectionInput(s.id, e.currentTarget.textContent ?? '')}
      onBlur={(e) => act.sectionBlur(s.id, e.currentTarget.textContent ?? '')}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
          e.preventDefault()
          e.currentTarget.blur()
        }
      }}
      onPaste={onPaste}
    />
  )
}

const MARK: Record<Utterance['review'], [string, string, string]> = {
  draft: ['p', '', '초벌이에요. 누르면 확인한 문장이 돼요'],
  heard: ['i', '✓', '듣고 확인했어요'],
  edited: ['i', '✓', '고쳐서 확인했어요'],
  marked: ['i', '✓', '직접 확인했어요'],
  bulk: ['h', '✓', '안 듣고 확인했어요'],
}

export const Row = memo(function Row(p: { u: Utterance; label: string; who: 'c' | 'k' | 'q'; now: boolean; passed?: boolean; playing?: boolean; section?: Section; act: Actions }) {
  const { u, act } = p
  const draft = u.review === 'draft'
  // 고치는 동안에는 글씨체를 바꾸지 않는다: 들어올 때의 모양(연필/인쇄)을 붙잡아 두었다가 다음 문장으로 넘어가거나
  // 재생이 이 문장 끝을 지나가면 바꾼다(마지막 줄). 글씨체가 바뀌면 글자 크기·줄바꿈이 달라져 고치던 자리가 튄다.
  // Esc로 커서만 빼고 다시 들을 때도 그대로 둔다.
  const [held, setHeld] = useState<boolean | null>(null)
  const [focused, setFocused] = useState(false)
  useEffect(() => {
    if (!focused && (!p.now || p.passed)) setHeld(null)
  }, [p.now, p.passed, focused])
  const pen = held ?? draft
  const ref = useText(u.text, (el) => decorate(el, u))
  useLayoutEffect(() => {
    const el = ref.current!
    return () => undecorate(el)
  }, [ref])
  // 지금 문장 표시는 형광펜 점(재생 단추 ▶와 헷갈리지 않게 삼각형을 쓰지 않는다)
  const [mk, sym, why] = p.now ? (['now', '', `지금 문장 · ${MARK[u.review][2]}`] as const) : MARK[u.review]
  return (
    <div className="row" data-row={u.id}>
      {p.section && <SectionLine s={p.section} act={act} />}
      <div className="u">
        {draft ? (
          <button type="button" tabIndex={-1} className={`mk ${mk}`} title={why} aria-label={why} onClick={() => act.mark(u.id)}>
            {sym}
          </button>
        ) : (
          <span className={`mk ${mk}`} title={why} role="img" aria-label={why}>
            {sym}
          </span>
        )}
        <button
          type="button"
          className={`s ${draft ? 'pen' : p.who}`}
          aria-haspopup="dialog"
          title={`${clock(u.start)} · 누르면 이 줄에 쓰는 도구가 열려요`}
          onClick={(e) => act.tools(u.id, e.currentTarget)}
        >
          {p.label}
        </button>
        <div className="cell">
          {/* 글보다 먼저 두어 첫 줄 오른쪽에 뜨게(float) */}
          {p.now && (
            <button
              type="button"
              className="rowplay"
              onMouseDown={(e) => e.preventDefault()} // 고치던 커서를 뺏지 않게
              onClick={() => act.play(u.id)}
              aria-label={p.playing ? '멈추기' : '이 문장부터 재생'}
              title={p.playing ? '멈추기 (스페이스)' : '재생 (스페이스)'}
            >
              {p.playing ? '❚❚' : '▶'}
            </button>
          )}
          <p
            ref={ref}
            // 초벌은 지금 듣는 문장이어도 연필 + 형광펜. 확인하면(들음·고침·표시) 인쇄 글씨
            className={`txt ${pen ? 'pen' : 'print'} ${p.who}`}
            contentEditable="plaintext-only"
            suppressContentEditableWarning
            spellCheck={false}
            data-uid={u.id}
            aria-label={`${p.label} ${clock(u.start)}`}
            onInput={(e) => act.input(u.id, e.currentTarget.textContent ?? '', e.nativeEvent as InputEvent)}
            onKeyDown={(e) => act.key(u.id, e)}
            onMouseDown={act.press}
            onFocus={() => {
              setHeld((h) => h ?? draft)
              setFocused(true)
              act.focus(u.id)
            }}
            onBlur={() => setFocused(false)}
            onPaste={onPaste}
          />
          {u.suggestions?.map((s) => (
            <span className="sugg" key={s.id}>
              ({s.label}?)
              <button type="button" className="ok" onClick={() => act.suggestion(u.id, s.id, true)} aria-label={`(${s.label}) 넣기`}>
                넣기
              </button>
              <button type="button" className="no" onClick={() => act.suggestion(u.id, s.id, false)} aria-label={`(${s.label}) 빼기`}>
                빼기
              </button>
            </span>
          ))}
        </div>
      </div>
    </div>
  )
})
