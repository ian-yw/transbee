// 창으로 뜨는 것들: 단축키 도움말, 이름 가리기, 처음 설명 카드, 보기 설정. (<dialog>라 Esc로 닫힘)
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { SilenceFormat, Transcript } from '../types'
import { utteranceLabels } from '../labels'
import { isMac, setSettings, useSettings } from '../app/settings'
import { countNames, findName } from './ops'

export function Dialog({ open, onClose, label, children, wide, className = '' }: { open: boolean; onClose: () => void; label: string; children: ReactNode; wide?: boolean; className?: string }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current!
    if (open && !d.open) {
      d.showModal()
      // showModal은 첫 단추로 초점을 옮긴다: 기본 단추를 따로 정했으면(data-autofocus) 그리로
      d.querySelector<HTMLElement>('[data-autofocus]')?.focus()
    }
    if (!open && d.open) d.close()
  }, [open])
  return (
    <dialog ref={ref} className={`dlg${wide ? ' wide' : ''} ${className}`} aria-label={label} onClose={onClose} onClick={(e) => e.target === ref.current && onClose()}>
      {open && children}
    </dialog>
  )
}

const M = isMac ? { c: '⌃', a: '⌥', mod: '⌘' } : { c: 'Ctrl', a: 'Alt', mod: 'Ctrl' }
const K = ({ k }: { k: string }) => <kbd className="kbd">{k}</kbd>

export function HelpDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const s = useSettings()
  const combo = (k: string) => `${M.c} ${M.a} ${k}`
  // 고치는 중이 아닐 때(커서가 문장에 없을 때)는 글자 키 하나로
  const plain: [ReactNode, string][] = [
    [<><K k="Space" /> <K k="L" /></>, '재생 / 멈춤 (고치는 중이 아닐 때)'],
    [<><K k="K" /> <K k=";" /></>, '느리게 / 빠르게 (0.25배씩)'],
    [<><K k="←" /> <K k="→" /></>, '5초 뒤로 / 앞으로 (고치는 중이 아닐 때)'],
    [<K k="Enter" />, '지금 문장 고치기 시작'],
    [<K k="Esc" />, '고치기 끝내기 (커서 빼기)'],
  ]
  const rows: [ReactNode, string][] =
    s.keys === 'os'
      ? [
          [<K k={combo('Space')} />, '재생 / 멈춤'],
          // Windows는 Ctrl+Alt+화살표가 화면 돌리기(그래픽 드라이버 단축키)로 먼저 잡히는 노트북이 있어 글자 키로
          [<K k={combo(isMac ? '←' : 'B')} />, '5초 뒤로'],
          [<><K k={combo(isMac ? '↓' : ',')} /> <K k={isMac ? '↑' : '.'} /></>, '느리게 / 빠르게'],
          [<K k={combo('R')} />, '지금 줄만 다시 듣기'],
          [<K k={combo('N')} />, '확인할 다음 곳'],
        ]
      : [
          [<K k="F9" />, '재생 / 멈춤'],
          [<K k="F7" />, '5초 뒤로'],
          [<K k="F8" />, '5초 앞으로'],
          [<K k="F10" />, '지금 줄만 다시 듣기'],
          [<K k="F6" />, '확인할 다음 곳'],
        ]
  return (
    <Dialog open={open} onClose={onClose} label="키보드로 더 빠르게">
      <h2 className="h">키보드로 더 빠르게</h2>
      <div className="seg" role="radiogroup" aria-label="단축키 방식">
        <button type="button" role="radio" aria-checked={s.keys === 'os'} onClick={() => setSettings({ keys: 'os' })}>
          기본 ({isMac ? 'Mac' : 'Windows'})
        </button>
        <button type="button" role="radio" aria-checked={s.keys === 'fkey'} onClick={() => setSettings({ keys: 'fkey' })}>
          F키 방식
        </button>
      </div>
      <h3 className="gl">문장을 고치는 중이 아닐 때</h3>
      <dl className="keys">
        {plain.map(([k, d], i) => (
          <div key={i}>
            <dt>{k}</dt>
            <dd>{d}</dd>
          </div>
        ))}
      </dl>
      <h3 className="gl">언제든(고치는 중에도)</h3>
      <dl className="keys">
        {rows.map(([k, d], i) => (
          <div key={i}>
            <dt>{k}</dt>
            <dd>{d}</dd>
          </div>
        ))}
      </dl>
      <h3 className="gl">문장을 고치는 중</h3>
      <dl className="keys">
        <div><dt><K k="Enter" /></dt><dd>커서 자리에서 줄 나누기</dd></div>
        <div><dt><K k={isMac ? '⌫' : 'Backspace'} /></dt><dd>줄 맨 앞에서 윗줄과 합치기</dd></div>
        <div><dt><K k="(" /></dt><dd>자주 쓰는 말 (내: 웃음) (상: 음) … · ↑↓ 말, ←→ 누가 · 글자를 골라 두고 치면 괄호로 감싸기</dd></div>
        <div><dt><K k={`${M.mod} Z`} /></dt><dd>되돌리기 ({isMac ? '⌘ ⇧ Z' : 'Ctrl Y'} 다시 하기)</dd></div>
        <div><dt><K k={`${M.mod} S`} /></dt><dd>저장</dd></div>
        <div><dt><K k="Esc" /></dt><dd>고치기 끝내기 · 열린 창 닫기</dd></div>
      </dl>
      <p className="box">
        {s.keys === 'fkey'
          ? '풋페달은 페달 프로그램에서 F9(재생·멈춤), F7(뒤로)로 맞춰 두면 바로 쓸 수 있어요.'
          : '풋페달(발로 누르는 재생 단추)을 쓰시면 위에서 F키 방식을 고르세요.'}
      </p>
      <div className="dlg-foot">
        <button type="button" className="btn pri" onClick={onClose}>
          닫기
        </button>
      </div>
    </Dialog>
  )
}

export function IntroDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} label="표시 설명" wide>
      <h2 className="h">초벌은 연필, 확인하면 인쇄 글씨</h2>
      <div className="states">
        <div className="st">
          <div className="lab">
            <span className="mk p" aria-hidden="true" />
            연필 · 초벌
          </div>
          <p className="txt pen q">네, 그리고 그.. 제가 좀 무서웠던 것 같아요.</p>
          <p className="why">컴퓨터가 받아 적은 그대로예요. 아직 확인하지 않았어요.</p>
        </div>
        <div className="st">
          <div className="lab">
            <span className="mk now" aria-hidden="true" />
            형광펜 · 지금
          </div>
          <p className="txt pen k">
            <mark>어.. 솔직히 좀 긴장됐어요.</mark>
          </p>
          <p className="why">지금 듣거나 고치는 문장이에요. 끝까지 듣거나, 고치고 다른 문장으로 나가면 인쇄 글씨로 바뀌어요. 고치는 동안에는 글씨체가 바뀌지 않아요.</p>
        </div>
        <div className="st">
          <div className="lab">
            <span className="mk i" aria-hidden="true">✓</span>
            인쇄 · 확인함
          </div>
          <p className="txt print c">먼저 해 보시니까 어떠셨어요?</p>
          <p className="why">끝까지 들었거나 고친 문장이에요. 보고서에 들어갈 모양 그대로예요.</p>
        </div>
      </div>
      <ul className="rules">
        <li>재생이 문장 끝까지 지나가면 저절로 확인돼요. 여백의 ○를 눌러도 돼요.</li>
        <li>문장을 누르면 바로 고칠 수 있어요. Enter는 줄 나누기, 줄 맨 앞에서 지우기 키는 윗줄과 합치기예요.</li>
        <li>상1·내1 같은 이름을 누르면 이 줄만 듣기, 화자 바꾸기, 소제목 넣기가 있어요.</li>
      </ul>
      <div className="dlg-foot">
        <button type="button" className="btn pri" onClick={onClose}>
          알겠어요
        </button>
      </div>
    </Dialog>
  )
}

export function ViewDialog(p: {
  open: boolean
  onClose: () => void
  silence: SilenceFormat
  silenceMin: number
  onSilence: (f: SilenceFormat) => void
  onSilenceMin: (sec: number) => void
}) {
  const { open, onClose, silence, onSilence } = p
  const s = useSettings()
  const radio = <T extends string>(name: string, value: T, cur: T, set: (v: T) => void, label: string) => (
    <label className="opt">
      <input type="radio" name={name} checked={cur === value} onChange={() => set(value)} />
      {label}
    </label>
  )
  return (
    <Dialog open={open} onClose={onClose} label="보기 설정">
      <h2 className="h">보기 설정</h2>
      <fieldset>
        <legend className="gl">화면</legend>
        {radio('theme', 'auto', s.theme, (v) => setSettings({ theme: v }), '컴퓨터 설정 따라')}
        {radio('theme', 'light', s.theme, (v) => setSettings({ theme: v }), '밝은 화면 (필사 노트)')}
        {radio('theme', 'dark', s.theme, (v) => setSettings({ theme: v }), '어두운 화면 (밤 필사)')}
      </fieldset>
      <fieldset>
        <legend className="gl">침묵 표기 모양</legend>
        {radio('sil', 'full', silence, onSilence, '(침묵 4초)')}
        {radio('sil', 'short', silence, onSilence, '(4초)')}
        {radio('sil', 'dots', silence, onSilence, '(…)  — 초가 빠져 되돌릴 수 없어요')}
        <label className="opt">
          말 사이가
          <select value={p.silenceMin} onChange={(e) => p.onSilenceMin(Number(e.target.value))} aria-label="침묵으로 적는 기준(초)">
            {[2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
              <option key={n} value={n}>
                {n}초
              </option>
            ))}
          </select>
          이상 비면 침묵으로 적어요
        </label>
        <p className="small muted">다음에 받아 적는 녹음에도 같은 기준과 모양을 써요.</p>
      </fieldset>
      <label className="opt">
        <input type="checkbox" checked={s.cheers} onChange={(e) => setSettings({ cheers: e.target.checked })} />
        응원 쪽지 보기
      </label>
      <div className="dlg-foot">
        <button type="button" className="btn pri" onClick={onClose}>
          닫기
        </button>
      </div>
    </Dialog>
  )
}

export function NamesDialog({ open, onClose, t, onApply }: { open: boolean; onClose: () => void; t: Transcript; onApply: (pairs: { from: string; to: string }[], count: number) => void }) {
  const [rows, setRows] = useState([{ from: '', to: 'OO' }])
  const [all, setAll] = useState(false)
  useEffect(() => {
    if (open) {
      setRows([{ from: '', to: 'OO' }])
      setAll(false)
    }
  }, [open])
  const labels = utteranceLabels(t)
  const found = rows.map((r) => findName(t, r.from.trim()))
  const hits = found.flat()
  const total = countNames(t, rows)
  const shown = all ? hits : hits.slice(0, 4)
  const set = (i: number, patch: Partial<(typeof rows)[0]>) => setRows(rows.map((r, k) => (k === i ? { ...r, ...patch } : r)))
  return (
    <Dialog open={open} onClose={onClose} label="이름 가리기" wide>
      <h2 className="h">이름 가리기</h2>
      <p className="sub-h">보고서에 나오면 안 되는 이름을 적어 주세요. 여러 개를 한 번에 바꿀 수 있어요.</p>
      <div className="names">
        {rows.map((r, i) => (
          <div className="name-row" key={i}>
            <input aria-label={`가릴 이름 ${i + 1}`} value={r.from} placeholder="예: 지수" onChange={(e) => set(i, { from: e.target.value })} autoFocus={i === rows.length - 1} />
            <span aria-hidden="true">→</span>
            <input aria-label={`바꿀 말 ${i + 1}`} value={r.to} onChange={(e) => set(i, { to: e.target.value })} />
            <span className="small muted" aria-live="polite">
              {r.from.trim() ? `${found[i].length}곳` : ''}
            </span>
          </div>
        ))}
        <button type="button" className="btn quiet sm" onClick={() => setRows([...rows, { from: '', to: 'OO' }])}>
          + 이름 더 넣기
        </button>
      </div>
      {hits.length > 0 && (
        <ul className="ctx">
          {shown.map((h, i) => (
            <li key={i}>
              <b>{h.index < 0 ? '소제목' : labels[h.index]}:</b> {h.before}
              <mark>{h.hit}</mark>
              {h.after}
            </li>
          ))}
          <li className="small muted">
            찾은 {hits.length}곳 중 {shown.length}곳
            {!all && hits.length > shown.length && (
              <button type="button" className="link" onClick={() => setAll(true)}>
                모두 보기
              </button>
            )}
          </li>
        </ul>
      )}
      <div className="dlg-foot">
        <button type="button" className="btn" onClick={onClose}>
          닫기
        </button>
        <button type="button" className="btn pri" disabled={!total} onClick={() => onApply(rows, total)}>
          {total}곳 모두 바꾸기
        </button>
      </div>
      <p className="small muted right">바꾼 뒤에도 되돌리기로 돌아갈 수 있어요.</p>
    </Dialog>
  )
}
