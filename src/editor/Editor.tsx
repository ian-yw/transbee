// 필사 노트: 듣고 고치기
import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { isConfirmed, type SpeakerId, type Transcript, type Utterance } from '../types'
import { clock, speakerShort, utteranceLabels } from '../labels'
import { BULK_CONFIRM, getSettings, isMac, setSettings, useSettings } from '../app/settings'
import { Cheer, Logo, ThemeButton } from '../app/ui'
import { ExportView } from '../app/ExportView'
import type { Job } from '../storage/db'
import { canPickFolder } from '../storage/folder'
import { useSave } from '../storage/useSave'
import * as ops from './ops'
import { Row, type Actions } from './Row'
import { setNow } from './highlights'
import { usePlayback, type Speed } from './usePlayback'
import { HelpDialog, IntroDialog, NamesDialog, ViewDialog } from './Dialogs'

// 문헌 사례보고서 10건의 축어록에서 많이 쓴 괄호 표기 순((네) (음) (웃음) (끄덕임) …)
const PALETTE = ['네', '음', '웃음', '끄덕임', '침묵', '한숨', '울먹이며', '작은 목소리로'] // 가장 많이 쓰는 맞장구가 앞

/**
 * 괄호 말 앞에 붙일 화자: [상, 내, 상+내, 없음]. 기본값은 골드 축어록 관례대로
 * 맞장구(네·음)는 상대, 침묵은 없음, 나머지(웃음·울먹이며…)는 그 줄을 말하는 사람.
 */
function paletteWho(t: Transcript, rowSpeaker: SpeakerId) {
  const c: SpeakerId = t.speakers.roles[1] === 'counselor' ? 1 : 0 // 상담자 먼저
  const opts = [speakerShort(t, c), speakerShort(t, (1 - c) as SpeakerId)]
  opts.push(opts.join(','), '')
  const self = rowSpeaker === c ? 0 : 1
  const pick = (item: string) => (item === '네' || item === '음' ? 1 - self : item === '침묵' ? 3 : self)
  return { opts, pick }
}

function caretOffset(el: HTMLElement): number | null {
  const sel = getSelection()
  if (!sel?.rangeCount || !sel.isCollapsed) return null
  const r = sel.getRangeAt(0)
  if (!el.contains(r.startContainer)) return null
  const pre = document.createRange()
  pre.selectNodeContents(el)
  pre.setEnd(r.startContainer, r.startOffset)
  return pre.toString().length
}

function setCaret(el: HTMLElement, offset: number | 'end') {
  const r = document.createRange()
  const node = el.firstChild
  if (node) {
    const len = node.textContent?.length ?? 0
    r.setStart(node, offset === 'end' ? len : Math.min(offset, len))
  } else r.setStart(el, 0)
  r.collapse(true)
  getSelection()?.removeAllRanges()
  getSelection()?.addRange(r)
}

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches
const rateText = (r: number) => `${Number(r.toFixed(2))}배`
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })

interface Toast {
  msg: string
  /** 되돌리기 단추: 알림을 띄운 편집 바로 뒤(실행취소 기록 수가 그대로)일 때만 보인다 */
  undo?: boolean
  past?: number
  act?: { label: string; run: () => void }
  sticky?: boolean
  n: number
}

export function Editor({ job, audio, onHome }: { job: Job; audio: Blob; onHome: () => void }) {
  const settings = useSettings()
  const hRef = useRef(ops.createHistory(job.transcript))
  const [, force] = useReducer((x: number) => x + 1, 0)
  const h = hRef.current
  const t = h.t
  const update = useCallback((next: ops.History) => {
    if (next === hRef.current) return
    hRef.current = next
    force()
  }, [])
  const apply = useCallback((fn: (t: Transcript) => Transcript, tag?: string) => update(ops.commit(hRef.current, fn(hRef.current.t), tag)), [update])

  const [cur, setCur] = useState(-1)
  const curRef = useRef(cur)
  curRef.current = cur
  const [mode, setMode] = useState<'edit' | 'export'>('edit')
  const [dlg, setDlg] = useState<'' | 'help' | 'names' | 'intro' | 'view'>(settings.introSeen ? '' : 'intro')
  const [tools, setTools] = useState<{ uid: string; btn: HTMLElement } | null>(null)
  // who: 사용자가 ←/→로 고른 화자(paletteWho의 opts 번호). 없으면 고른 말의 기본값
  const [palette, setPalette] = useState<{ uid: string; x: number; y: number; i: number; who?: number } | null>(null)
  const [toast, setToast] = useState<Toast | null>(null)
  const [cheer, setCheer] = useState<'' | 'half' | 'hour' | 'done'>('')
  const [restUntil, setRestUntil] = useState(0)
  const pending = useRef<{ sel: string; offset: number | 'end'; seek?: number } | null>(null)
  const userScrollAt = useRef(0)
  const lastSpot = useRef<{ uid: string; from: number } | null>(null)

  const saver = useSave(job, t, audio)
  const getUtts = useCallback(() => hRef.current.t.utterances, [])
  // 재생이 끝을 지나간 문장(고치던 글씨를 인쇄 글씨로 바꾸는 때: 마지막 줄은 다음 문장이 없어서 이것으로)
  const [passed, setPassed] = useState('')
  const [touched, setTouched] = useState('') // 마지막으로 고치러 들어간 문장
  const player = usePlayback(audio, getUtts, {
    index: setCur,
    heard: (ids) => {
      setPassed(ids[ids.length - 1])
      update(ops.silently(hRef.current, ops.markHeard(hRef.current.t, ids)))
    },
    paused: () => void saver.temp(),
  })

  const say = (msg: string, o: Partial<Toast> = {}) => setToast({ msg, n: Date.now(), ...o, past: hRef.current.past.length })
  useEffect(() => {
    if (!toast || toast.sticky) return
    const id = setTimeout(() => setToast(null), 7000)
    return () => clearTimeout(id)
  }, [toast])

  const roleName = (s: SpeakerId, x: Transcript = hRef.current.t) => {
    const r = x.speakers.roles[s]
    return r === 'counselor' ? '상담자' : r === 'client' ? '내담자' : `화자${s + 1}`
  }
  const who = (s: SpeakerId) => {
    const r = t.speakers.roles[s]
    return r === 'counselor' ? 'c' : r === 'client' ? 'k' : 'q'
  }

  // ---------- 편집 조작 ----------
  const L = useRef({ t, player, saver, palette, tools, dlg })
  L.current = { t, player, saver, palette, tools, dlg }

  const focusText = (uid: string, offset: number | 'end' = 0) => (pending.current = { sel: `[data-uid="${uid}"]`, offset })

  const paletteState = (pal: { uid: string; i: number; who?: number }) => {
    const x = L.current.t
    const u = x.utterances.find((y) => y.id === pal.uid)
    const { opts, pick } = paletteWho(x, u?.speaker ?? 0)
    const who = pal.who ?? pick(PALETTE[pal.i])
    return { opts, who, text: opts[who] ? `${opts[who]}: ${PALETTE[pal.i]}` : PALETTE[pal.i] }
  }

  const insertPalette = (i: number, who?: number) => {
    const pal = L.current.palette
    const label = pal ? paletteState({ ...pal, i, who: who ?? pal.who }).text : PALETTE[i]
    setPalette(null)
    // 낱말 바로 앞에 넣으면 "(한숨)많으셨군요"처럼 붙지 않게 뒤에 빈칸
    const el = document.activeElement as HTMLElement | null
    const off = el ? caretOffset(el) : null
    const next = off !== null ? (el!.textContent ?? '')[off] : undefined
    document.execCommand('insertText', false, next && !/\s/.test(next) ? `${label}) ` : `${label})`)
  }

  const act: Actions = useMemo(
    () => ({
      input(uid, text, e) {
        apply((x) => ops.setText(x, uid, text), `type:${uid}`)
        if (e.inputType === 'insertText' && e.data === '(') {
          const r = getSelection()?.getRangeAt(0).getBoundingClientRect()
          if (r) setPalette({ uid, x: r.left, y: r.bottom + 6, i: 0 })
        } else if (L.current.palette) setPalette(null)
      },
      key(uid, e: KeyboardEvent<HTMLElement>) {
        if (e.nativeEvent.isComposing || e.keyCode === 229) return
        const el = e.currentTarget
        const pal = L.current.palette
        if (pal && pal.uid === uid) {
          // ↑/↓ 말 고르기, ←/→ 화자 고르기
          const move = { ArrowDown: 1, ArrowUp: -1 }[e.key]
          if (move) {
            e.preventDefault()
            setPalette({ ...pal, i: (pal.i + move + PALETTE.length) % PALETTE.length })
            return
          }
          const side = { ArrowRight: 1, ArrowLeft: -1 }[e.key]
          if (side) {
            e.preventDefault()
            const { opts, who } = paletteState(pal)
            setPalette({ ...pal, who: (who + side + opts.length) % opts.length })
            return
          }
          if (e.key === 'Enter' || e.key === 'Tab') {
            e.preventDefault()
            insertPalette(pal.i)
            return
          }
          if (e.key === 'Escape') {
            e.preventDefault()
            setPalette(null)
            return
          }
        }
        if (e.altKey || e.metaKey || e.ctrlKey) return
        const x = L.current.t
        const i = x.utterances.findIndex((u) => u.id === uid)
        const off = caretOffset(el)
        const len = el.textContent?.length ?? 0
        if (e.key === 'Enter') {
          e.preventDefault()
          if (off === null) return
          if (off >= len) {
            const next = x.utterances[i + 1]
            if (next) focusText(next.id, 0)
            force()
            return
          }
          const r = ops.splitUtterance(x, uid, off)
          if (!r) return
          update(ops.commit(hRef.current, r.t))
          focusText(r.newId, 0)
          say(`줄을 나눴어요. 새 줄도 ${roleName(x.utterances[i].speaker)} 말로 두었어요.`, { undo: true })
        } else if (e.key === 'Backspace' && off === 0 && i > 0) {
          e.preventDefault()
          const r = ops.mergeWithPrevious(x, uid)
          if (!r) return
          update(ops.commit(hRef.current, r.t))
          focusText(r.prevId, r.caret)
          const pu = x.utterances[i - 1]
          say(pu.speaker === x.utterances[i].speaker ? '윗줄과 합쳤어요.' : `윗줄과 합쳤어요. ${roleName(x.utterances[i].speaker)} 말이 윗줄 ${roleName(pu.speaker)} 말에 들어갔어요.`, { undo: true })
        } else if (e.key === 'ArrowUp' && off === 0 && i > 0) {
          e.preventDefault()
          focusText(x.utterances[i - 1].id, 'end')
          force()
        } else if (e.key === 'ArrowDown' && off === len && i < x.utterances.length - 1) {
          e.preventDefault()
          focusText(x.utterances[i + 1].id, 0)
          force()
        }
      },
      focus(uid) {
        setPassed('')
        setTouched(uid)
        const x = L.current.t
        const i = x.utterances.findIndex((u) => u.id === uid)
        const p = L.current.player
        // 재생 중이면 형광펜은 소리를 따라간다. 멈춰 있으면 누른 문장으로 옮기되, 이미 그 문장 안에 멈춰 있으면
        // 그 자리를 지킨다(긴 문장 중간에서 멈추고 틀린 낱말을 고친 뒤 이어 들을 수 있게)
        if (p.playing || i < 0) return
        setCur(i)
        const u = x.utterances[i]
        const now = p.el.currentTime
        if (now < u.start || now >= u.end) p.seek(u.start)
      },
      mark: (uid) => apply((x) => ops.setReview(x, [uid], 'marked')),
      tools: (uid, btn) => setTools((o) => (o?.uid === uid ? null : { uid, btn })),
      suggestion: (uid, sid, ok) => apply((x) => (ok ? ops.acceptSuggestion(x, uid, sid) : ops.rejectSuggestion(x, uid, sid))),
      sectionInput: (sid, title) => apply((x) => ops.setSectionTitle(x, sid, title, true), `sec:${sid}`),
      sectionBlur: (sid, title) => update(ops.silently(hRef.current, ops.setSectionTitle(hRef.current.t, sid, title))),
      press() {
        // 고치려고 문장을 누르면 멈춘다(다시 재생하면 2초 앞부터). 재생 중 커서가 튀지 않게
        if (L.current.player.playing) L.current.player.pause()
      },
      play(uid) {
        const p = L.current.player
        if (p.playing) return p.pause()
        const u = L.current.t.utterances.find((x) => x.id === uid)
        const now = p.el.currentTime
        // 이 문장 안에 멈춰 있으면 그 자리부터(멈췄다 다시 재생하면 2초 앞부터), 아니면 문장 처음부터
        if (u && (now < u.start || now >= u.end)) p.seek(u.start)
        p.play()
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  const undo = () => update(ops.undo(hRef.current))
  const redo = () => update(ops.redo(hRef.current))

  const save = async (overwrite = false) => {
    const first = !L.current.saver.savedAt
    const r = await L.current.saver.save(overwrite)
    if (r === 'folder')
      say(first ? '저장했어요. 작업 파일에는 녹음이 들어 있어요. 다른 컴퓨터로 옮길 때는 USB나 AirDrop이 가장 안전해요.' : '저장했어요.')
    else if (r === 'download') say('작업 파일을 다운로드 폴더에 받았어요.')
    else if (r === 'newer')
      say('폴더의 작업 파일이 이 창보다 나중에 저장된 거예요. 다른 컴퓨터에서 고쳤다면, 그 파일을 첫 화면에 놓아 여세요.', {
        sticky: true,
        act: { label: '이 창 내용으로 덮어쓰기', run: () => void save(true) },
      })
    else if (r === 'gone')
      say('저장하던 폴더를 찾지 못했어요. 폴더를 옮기거나 지웠다면 다시 골라 주세요. 고친 내용은 브라우저 안에 그대로 있어요.', {
        sticky: true,
        act: { label: '폴더 고르기', run: () => void L.current.saver.changeFolder().then((ok) => void (ok && save())) },
      })
    else if (r === 'error') say('저장하지 못했어요. 브라우저 안에는 그대로 남아 있어요.')
  }

  // 브라우저 자동 저장이 실패하면(저장 공간 부족) 한 번 알린다
  useEffect(() => {
    if (saver.lost) say('컴퓨터 저장 공간이 부족해 자동 저장을 못 하고 있어요. [저장]을 눌러 파일로 남겨 주세요.', { sticky: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saver.lost])

  /** 확인할 다음 곳: 커서(없으면 지금 재생 문장) 뒤의 잘 안 들린 단어·같이 말한 단어로 커서를 옮기고 1초 앞부터 듣게 둔다 */
  const nextCheck = () => {
    const us = hRef.current.t.utterances
    const el = document.activeElement as HTMLElement | null
    const focused = el?.dataset.uid ? us.findIndex((u) => u.id === el.dataset.uid) : -1
    // 커서가 문장에 없으면(단추로 옮겨 감) 지난번에 옮겨 간 곳 다음부터, 그것도 없으면 지금 재생 문장부터
    const last = lastSpot.current && us.findIndex((u) => u.id === lastSpot.current!.uid)
    const r =
      focused >= 0 ? ops.nextSpot(us, focused, caretOffset(el!) ?? -1)
      : last != null && last >= 0 ? ops.nextSpot(us, last, lastSpot.current!.from)
      : ops.nextSpot(us, cur, -1)
    if (!r) return say('확인할 곳이 더 없어요.')
    const u = us[r.index]
    lastSpot.current = { uid: u.id, from: r.spot.from }
    pending.current = { sel: `[data-uid="${u.id}"]`, offset: r.spot.from, seek: Math.max(u.start, r.spot.start - 1) }
    force()
  }

  const replayLine = () => {
    const u = hRef.current.t.utterances[Math.max(cur, 0)]
    if (u) player.playRange(u.start, u.end)
  }

  const changeSpeed = (d: number) => {
    const s = getSettings()
    // 알아서 빨라지기로 듣던 중이면 지금 들리는 속도에서 한 칸
    const base = s.autoSpeed ? player.el.playbackRate : s.speed
    setSettings({ autoSpeed: false, speed: Math.min(2.5, Math.max(0.5, base + d)) })
    player.applyRate()
  }

  // 전역 단축키
  const K = useRef({ undo, redo, save, nextCheck, replayLine, changeSpeed })
  K.current = { undo, redo, save, nextCheck, replayLine, changeSpeed }
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.isComposing) return
      const k = K.current
      const p = L.current.player
      if (document.querySelector('dialog.rest[open]')) return
      const inDialog = !!document.querySelector('dialog[open]')
      const mod = isMac ? e.metaKey : e.ctrlKey
      if (mod && !e.altKey && !inDialog && (e.code === 'KeyZ' || (!isMac && e.code === 'KeyY'))) {
        e.preventDefault()
        if (e.code === 'KeyY' || e.shiftKey) k.redo()
        else k.undo()
        return
      }
      if (mod && !e.altKey && e.code === 'KeyS') {
        e.preventDefault()
        k.save()
        return
      }
      const s = getSettings()
      const cmd =
        s.keys === 'os'
          ? e.ctrlKey && e.altKey && !e.metaKey
            ? ({ Space: 'toggle', ArrowLeft: 'back', KeyB: 'back', ArrowDown: 'slower', Comma: 'slower', ArrowUp: 'faster', Period: 'faster', KeyR: 'replay', KeyN: 'next' } as Record<string, string>)[e.code]
            : undefined
          : ({ F9: 'toggle', F7: 'back', F8: 'fwd', F10: 'replay', F6: 'next' } as Record<string, string>)[e.key]
      if (cmd) {
        e.preventDefault()
        if (cmd === 'toggle') p.toggle()
        else if (cmd === 'back') p.skip(-5)
        else if (cmd === 'fwd') p.skip(5)
        else if (cmd === 'slower') k.changeSpeed(-0.25)
        else if (cmd === 'faster') k.changeSpeed(0.25)
        else if (cmd === 'replay') k.replayLine()
        else k.nextCheck()
        return
      }
      const typing = (e.target as HTMLElement).closest?.('[contenteditable], input, textarea')
      if (e.key === '?' && !typing && !inDialog) {
        e.preventDefault()
        setDlg('help')
      }
      if (e.key === 'Escape') {
        if (L.current.palette) setPalette(null)
        else if (L.current.tools) {
          L.current.tools.btn.focus()
          setTools(null)
        } else if (typing && (e.target as HTMLElement).dataset.uid) {
          // 문장 고치기에서 나오기: 커서를 빼면 스페이스·화살표가 재생 조작이 된다
          ;(e.target as HTMLElement).blur()
          return
        }
      }
      // 고치는 중(커서 깜빡임)이 아닐 때: 스페이스 재생/멈춤, ←/→ 5초, Enter 지금 문장 고치기
      // 키보드로 옮겨 간 단추(초점 테두리가 보이는 단추) 위에서는 원래대로 그 단추를 누른다
      const onButton = (e.target as HTMLElement).closest?.('button, a, [role="switch"], [role="radio"], input[type="range"]') as HTMLElement | null
      if (!typing && !inDialog && !e.altKey && !e.ctrlKey && !e.metaKey && !(onButton && onButton.matches(':focus-visible'))) {
        // 글자 키는 e.code로(한글 입력 상태여도 같은 자리의 키): L 재생/멈춤, K 느리게, ; 빠르게(영상 편집기처럼 한 손으로)
        const k2 =
          e.code === 'Space' || e.code === 'KeyL' ? 'toggle'
          : e.code === 'KeyK' ? 'slower'
          : e.code === 'Semicolon' ? 'faster'
          : e.key === 'ArrowLeft' ? 'back'
          : e.key === 'ArrowRight' ? 'fwd'
          : e.key === 'Enter' && !onButton ? 'edit'
          : ''
        if (k2) {
          e.preventDefault()
          if (k2 === 'toggle') p.toggle()
          else if (k2 === 'slower') k.changeSpeed(-0.25)
          else if (k2 === 'faster') k.changeSpeed(0.25)
          else if (k2 === 'back') p.skip(-5)
          else if (k2 === 'fwd') p.skip(5)
          else {
            const u = L.current.t.utterances[Math.max(0, curRef.current)]
            if (u) {
              focusText(u.id, 0)
              force()
            }
          }
          return
        }
      }
    }
    // 브라우저 메뉴의 실행취소도 우리 기록으로
    const onBefore = (e: InputEvent) => {
      if (e.inputType === 'historyUndo' || e.inputType === 'historyRedo') {
        e.preventDefault()
        if (e.inputType === 'historyUndo') K.current.undo()
        else K.current.redo()
      }
    }
    const onScroll = (e: Event) => {
      if (e.type !== 'keydown' || ['PageUp', 'PageDown', 'Home', 'End'].includes((e as globalThis.KeyboardEvent).key)) userScrollAt.current = Date.now()
    }
    addEventListener('keydown', onKey)
    addEventListener('beforeinput', onBefore)
    addEventListener('wheel', onScroll, { passive: true })
    addEventListener('touchmove', onScroll, { passive: true })
    addEventListener('keydown', onScroll)
    return () => {
      removeEventListener('keydown', onKey)
      removeEventListener('beforeinput', onBefore)
      removeEventListener('wheel', onScroll)
      removeEventListener('touchmove', onScroll)
      removeEventListener('keydown', onScroll)
    }
  }, [])

  // 편집 뒤 커서 옮기기
  useLayoutEffect(() => {
    const p = pending.current
    if (!p) return
    pending.current = null
    const el = document.querySelector<HTMLElement>(p.sel)
    if (!el) return
    el.focus({ preventScroll: true })
    setCaret(el, p.offset)
    if (p.seek !== undefined) L.current.player.seek(p.seek)
    el.scrollIntoView({ block: 'nearest' })
  })

  // 지금 문장 형광펜 + 재생 따라 화면 이동
  const curId = t.utterances[cur]?.id
  useEffect(() => {
    setNow(curId ? document.querySelector(`[data-uid="${curId}"]`) : null)
  }, [curId, t, mode])
  useEffect(() => () => setNow(null), [])
  useEffect(() => {
    if (!player.playing || !curId) return
    if (document.activeElement?.classList.contains('txt')) return
    if (Date.now() - userScrollAt.current < 2500) return
    const el = document.querySelector(`[data-row="${curId}"]`)
    if (!el) return
    const r = el.getBoundingClientRect()
    const top = document.querySelector('.head')?.getBoundingClientRect().bottom ?? 140 // 위쪽 단계·재생 막대 밑
    if (r.top < top + 10 || r.bottom > innerHeight - 90) el.scrollIntoView({ block: 'center', behavior: reduced() ? 'auto' : 'smooth' })
  }, [curId, player.playing])

  // 위쪽 머리(단계·재생 막대) 높이만큼 비워 두고 문장으로 옮긴다(scroll-padding-top). 창 폭에 따라 줄바꿈되어 높이가 바뀐다.
  useLayoutEffect(() => {
    const el = document.querySelector<HTMLElement>('.head')
    if (!el) return
    const root = document.documentElement
    const ro = new ResizeObserver(() => root.style.setProperty('--head-h', `${el.offsetHeight + 12}px`))
    ro.observe(el)
    return () => {
      ro.disconnect()
      root.style.removeProperty('--head-h')
    }
  }, [mode])

  // 바깥을 누르면 줄 도구·팔레트 닫기
  useEffect(() => {
    if (!tools && !palette) return
    const close = (e: MouseEvent) => {
      const el = e.target as HTMLElement
      if (el.closest('.pop, .palette')) return
      setTools(null)
      setPalette(null)
    }
    addEventListener('mousedown', close)
    return () => removeEventListener('mousedown', close)
  }, [tools, palette])

  // ---------- 확인 정도와 쪽지 ----------
  const total = t.utterances.length
  const confirmed = useMemo(() => t.utterances.filter((u) => isConfirmed(u.review)).length, [t.utterances])
  const toCheck = useMemo(() => t.utterances.filter(ops.needsCheck).length, [t.utterances])
  const prevConfirmed = useRef(confirmed)
  // 다 확인한 쪽지는 듣거나 고치는 중에는 미뤄 두었다가, 재생이 멈추고 고치던 문장을 마치면(인쇄 글씨로 바뀌면) 띄운다
  const doneWaiting = useRef(false)
  const [editing, setEditing] = useState(false)
  useEffect(() => {
    const f = () => setEditing(!!(document.activeElement as HTMLElement | null)?.dataset?.uid)
    document.addEventListener('focusin', f)
    document.addEventListener('focusout', f)
    return () => {
      document.removeEventListener('focusin', f)
      document.removeEventListener('focusout', f)
    }
  }, [])
  useEffect(() => {
    const prev = prevConfirmed.current
    prevConfirmed.current = confirmed
    if (total && prev < total && confirmed === total) doneWaiting.current = true
    else if (!saver.meta.current.cheeredHalf && prev * 2 < total && confirmed * 2 >= total && confirmed < total) {
      setCheer('half')
      saver.setMeta({ cheeredHalf: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirmed, total])
  useEffect(() => {
    const holding = !!touched && touched === t.utterances[cur]?.id && passed !== touched
    if (!doneWaiting.current || player.playing || editing || holding) return
    doneWaiting.current = false
    if (confirmed === total) setCheer('done')
  }, [confirmed, total, player.playing, editing, touched, passed, cur, t.utterances])

  // 한 시간 넘게 이어서 작업하면 쉬어 가자는 쪽지(10분 넘게 창을 떠나 있으면 새로 셈)
  const since = useRef(Date.now())
  useEffect(() => {
    let hiddenAt = 0
    const vis = () => {
      if (document.hidden) hiddenAt = Date.now()
      else if (hiddenAt && Date.now() - hiddenAt > 10 * 60_000) since.current = Date.now()
    }
    const id = setInterval(() => {
      if (Date.now() - since.current >= 60 * 60_000) {
        since.current = Date.now()
        // 응원 쪽지를 꺼 두었으면 말없이 멈추지 않는다
        if (!getSettings().cheers) return
        L.current.player.pause()
        setCheer('hour')
      }
    }, 30_000)
    document.addEventListener('visibilitychange', vis)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', vis)
    }
  }, [])
  const [, tick] = useReducer((x: number) => x + 1, 0)
  useEffect(() => {
    if (!restUntil) return
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [restUntil])

  // ---------- 상담자 확인 ----------
  const rolesUnset = !t.speakers.roles[0] && !t.speakers.roles[1]
  const sample = (s: SpeakerId) => {
    const us = t.utterances.filter((u) => u.speaker === s)
    const u = us.reduce<Utterance | undefined>((a, b) => (!a || b.end - b.start > a.end - a.start ? b : a), undefined)
    if (u) player.playRange(u.start, Math.min(u.end, u.start + 8), true)
  }
  const chooseRole = (s: SpeakerId) => {
    apply((x) => ops.setRoles(x, s))
    // 목소리 듣기로 옮겨 간 재생 위치를 처음으로(재생을 누르면 첫 문장부터)
    player.pause()
    player.seek(t.utterances[0]?.start ?? 0)
    say(`화자${s + 1}을 상담자로 정했어요.`, { undo: true, sticky: true })
  }

  const labels = useMemo(() => utteranceLabels(t), [t])
  const secByUtt = useMemo(() => new Map(t.sections.map((s) => [s.beforeUtteranceId, s])), [t.sections])

  if (mode === 'export')
    return (
      <div className="page">
        <header className="topbar">
          <Logo onClick={onHome} />
          <span className="vsep" aria-hidden="true" />
          <button type="button" className="btn quiet sm" onClick={() => setMode('edit')}>
            ← 고치던 곳으로
          </button>
          <span className="title">{t.title}</span>
        </header>
        <ExportView
          t={t}
          folder={saver.folder}
          fileBase={saver.meta.current.fileBase}
          saved={!saver.dirty && !!saver.savedAt}
          onBack={() => setMode('edit')}
          onHome={onHome}
          onSave={() => save()}
          onExported={() => saver.setMeta({ exportedAt: new Date().toISOString() })}
        />
      </div>
    )

  const toolU = tools && t.utterances.find((u) => u.id === tools.uid)
  const toolI = toolU ? t.utterances.indexOf(toolU) : -1
  const bulkIds = BULK_CONFIRM ? t.utterances.filter((u) => u.review === 'draft' && (u.confidence ?? 0) >= 0.9 && !u.overlap && !ops.spots(u).length).map((u) => u.id) : []
  const firstDraft = t.utterances.find((u) => u.review === 'draft') ?? t.utterances[0]

  return (
    <div className="page editor">
      <a
        className="skip"
        href="#sheet"
        onClick={(e) => {
          e.preventDefault()
          if (firstDraft) focusText(firstDraft.id, 0)
          force()
        }}
      >
        확인할 문장으로 건너뛰기
      </a>
      <div className="head">
        <header className="topbar ed">
          <Logo onClick={onHome} />
          <span className="vsep" aria-hidden="true" />
          <button type="button" className="btn quiet sm" onClick={onHome} title="만든 축어록 목록(첫 화면)으로. 고친 내용은 저절로 남고, 목록에서 다시 이어 할 수 있어요.">
            ← 목록
          </button>
          <TitleField value={t.title} onChange={(v) => apply((x) => ops.setTitle(x, v))} />
          <SaveStatus saver={saver} onSave={() => void save()} />
          <span className="gap" />
          <span className="hgroup" role="group" aria-label="되돌리기·다시 하기">
          <button type="button" className="btn sm" onClick={undo} disabled={!h.past.length} aria-label="되돌리기" title={`방금 고친 것을 되돌려요 (${isMac ? '⌘Z' : 'Ctrl+Z'})`}>
            <Arrow back /> <span className="lbl">되돌리기</span>
          </button>
          <button type="button" className="btn sm" onClick={redo} disabled={!h.future.length} aria-label="다시 하기" title={`되돌린 것을 다시 해요 (${isMac ? '⌘⇧Z' : 'Ctrl+Y'})`}>
            <span className="lbl">다시 하기</span> <Arrow />
          </button>
          </span>
          <ThemeButton />
          <button type="button" className="btn sm" onClick={() => setDlg('view')} title="밤 필사(어두운 화면), 침묵 표기, 응원 쪽지">
            보기 설정
          </button>
          <button type="button" className="btn sm" onClick={() => setDlg('help')} title="키보드 단축키">
            단축키
          </button>
        </header>
        <Steps
          steps={[
            { key: 'upload', label: '녹음 올리기', done: true },
            { key: 'draft', label: '받아 적기', done: true },
            { key: 'role', label: '상담자 정하기', done: !rolesUnset, run: () => document.querySelector<HTMLElement>('.ask button')?.focus() },
            { key: 'fix', label: '듣고 고치기', done: total > 0 && confirmed === total, note: `${confirmed}/${total}`, run: () => (toCheck ? nextCheck() : firstDraft && (focusText(firstDraft.id, 0), force())) },
            { key: 'names', label: '이름 가리기', done: !!saver.meta.current.maskedAt, optional: true, run: () => setDlg('names') },
            { key: 'save', label: '저장', done: !saver.dirty && !!saver.savedAt, note: saver.dirty && saver.savedAt ? '고친 것 있음' : undefined, run: () => void save() },
            {
              key: 'export',
              label: '한글/워드로 내보내기',
              done: !!saver.meta.current.exportedAt,
              run: () => {
                player.pause()
                setMode('export')
              },
            },
          ]}
        />
        <div className="prog">
          <span>
            확인한 문장 {confirmed} / {total}
          </span>
          <span className="line" role="progressbar" aria-label="확인한 문장" aria-valuemin={0} aria-valuemax={total} aria-valuenow={confirmed}>
            <i style={{ width: `${total ? (confirmed / total) * 100 : 0}%` }} />
          </span>
        </div>
        <div className="playrow">
          <Dock player={player} auto={settings.autoSpeed} userSpeed={settings.speed} onSpeed={changeSpeed} />
          {toCheck > 0 && (
            <button type="button" className="nextcheck" onMouseDown={(e) => e.preventDefault()} onClick={nextCheck}>
              확인할 곳 {toCheck}개 · <b>다음</b>
            </button>
          )}
        </div>
      {bulkIds.length > 0 && (
        <div className="bulkbar">
          <span>
            또렷하게 들린 문장 <b>{bulkIds.length}개</b>가 아직 연필이에요.
          </span>
          <span className="gap" />
          <button
            type="button"
            className="btn sm"
            onClick={() => {
              apply((x) => ops.setReview(x, bulkIds, 'bulk'))
              say(`${bulkIds.length}개를 안 듣고 확인했어요.`, { undo: true })
            }}
          >
            안 듣고 한꺼번에 확인
          </button>
        </div>
      )}

      </div>

      <main className="desk">
        <article className="sheet" id="sheet" aria-label={`${t.title} 축어록`}>
          {rolesUnset && (
            <section className="ask" aria-labelledby="ask-q">
              <p id="ask-q" className="q">
                두 목소리 중 누가 상담자인가요?
              </p>
              <div className="row2">
                <button type="button" className="pill" onClick={() => sample(0)}>
                  <span aria-hidden="true">▶</span> 화자1 듣기
                </button>
                <button type="button" className="pill" onClick={() => sample(1)}>
                  <span aria-hidden="true">▶</span> 화자2 듣기
                </button>
              </div>
              <div className="row2">
                <button type="button" className="btn pri sm" onClick={() => chooseRole(0)}>
                  화자1이 상담자예요
                </button>
                <button type="button" className="btn sm" onClick={() => chooseRole(1)}>
                  화자2가 상담자예요
                </button>
              </div>
            </section>
          )}
          {t.utterances.map((u, i) => (
            <Row key={u.id} u={u} label={labels[i]} who={who(u.speaker)} now={i === cur} passed={u.id === passed} playing={i === cur && player.playing} section={secByUtt.get(u.id)} act={act} />
          ))}
        </article>
      </main>

      {toolU && tools && (
        <LineTools
          u={toolU}
          anchor={tools.btn}
          first={toolI === 0}
          hasSection={secByUtt.has(toolU.id)}
          other={roleName((1 - toolU.speaker) as SpeakerId)}
          label={labels[toolI]}
          onClose={(refocus) => {
            if (refocus) tools.btn.focus()
            setTools(null)
          }}
          onListen={() => player.playRange(toolU.start, toolU.end)}
          onNudge={(d) => {
            apply((x) => ops.nudgeStart(x, toolU.id, d))
            const u = hRef.current.t.utterances.find((x) => x.id === toolU.id)!
            player.playRange(u.start, u.end)
          }}
          onSpeaker={() => apply((x) => ops.setSpeaker(x, toolU.id, (1 - toolU.speaker) as SpeakerId))}
          onMerge={() => {
            const r = ops.mergeWithPrevious(hRef.current.t, toolU.id)
            if (r) {
              update(ops.commit(hRef.current, r.t))
              focusText(r.prevId, r.caret)
            }
          }}
          onSection={() => {
            const r = ops.insertSection(hRef.current.t, toolU.id)
            update(ops.commit(hRef.current, r.t))
            pending.current = { sel: `[data-sid="${r.id}"]`, offset: 0 }
          }}
          onReview={(r) => apply((x) => ops.setReview(x, [toolU.id], r))}
          onSwapAll={() => {
            apply(ops.swapSpeakers)
            say('두 사람을 맞바꿨어요.', { undo: true })
          }}
        />
      )}

      {palette &&
        (() => {
          const ps = paletteState(palette)
          return (
            <div className="palette" style={{ left: palette.x, top: palette.y }}>
              <div className="pal-who" role="radiogroup" aria-label="누가 (←/→)">
                {ps.opts.map((o, k) => (
                  <span
                    key={k}
                    role="radio"
                    aria-checked={k === ps.who}
                    className={k === ps.who ? 'on' : ''}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      setPalette({ ...palette, who: k })
                    }}
                  >
                    {o || '없음'}
                  </span>
                ))}
              </div>
              <div className="pal-list" role="listbox" aria-label="자주 쓰는 말 (↑/↓)">
                {PALETTE.map((p, i) => (
                  <span
                    key={p}
                    role="option"
                    aria-selected={i === palette.i}
                    className={i === palette.i ? 'on' : ''}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      insertPalette(i)
                    }}
                  >
                    {p}
                  </span>
                ))}
              </div>
              <div className="pal-hint">
                ({ps.text}) · ↑↓ 말 · ←→ 누가 · Enter
              </div>
            </div>
          )
        })()}

      <div className="bottom">
        {toast && (
          <div className="toast" role="status" key={toast.n}>
            <span>{toast.msg}</span>
            {toast.undo && toast.past === h.past.length && (
              <button
                type="button"
                className="btn sm"
                onClick={() => {
                  undo()
                  setToast(null)
                }}
              >
                되돌리기
              </button>
            )}
            {toast.act && (
              <button
                type="button"
                className="btn sm"
                onClick={() => {
                  setToast(null)
                  toast.act!.run()
                }}
              >
                {toast.act.label}
              </button>
            )}
            <button type="button" className="x" aria-label="알림 닫기" onClick={() => setToast(null)}>
              ×
            </button>
          </div>
        )}
        <p className="legend">
          <span className="pn">연필 글씨 = 초벌</span>
          <span className="pr">인쇄 글씨 = 확인함</span>
          <span>✓ 듣고 확인 · 속 빈 ✓ 안 듣고 확인</span>
          <span>
            <span className="dt">점선 밑줄</span> 잘 안 들린 말
          </span>
          <span>
            <span className="ov">보라 밑줄</span> 같이 말한 곳
          </span>
          <span>멈췄다 다시 재생하면 2초 앞부터</span>
          <button type="button" className="link" onClick={() => setDlg('intro')}>
            표시 설명
          </button>
        </p>
      </div>

      {cheer === 'half' && <Cheer key="half" hand="절반 넘었어요. 여기까지 온 것도 큰 일이에요." sub={`남은 문장 ${total - confirmed}개`} />}
      {cheer === 'hour' && (
        <Cheer
          key="hour"
          hand="한 시간 넘게 듣고 계세요. 눈 한번 감았다 가요."
          sub="재생은 멈춰 둘게요. 돌아오면 멈춘 곳부터 이어져요."
          action="5분 쉬기"
          onAction={() => {
            setCheer('')
            setRestUntil(Date.now() + 5 * 60_000)
          }}
        />
      )}
      {cheer === 'done' && (
        <Cheer
          key="done"
          hand="한 회기를 끝까지 들으셨어요."
          sub="한 줄 한 줄 옮긴 이 시간이, 다음 상담에서 더 잘 듣는 귀가 될 거예요."
          action="한글/워드로 내보내기"
          onAction={() => setMode('export')}
        />
      )}
      {restUntil > 0 && <Rest until={restUntil} onBack={() => setRestUntil(0)} />}

      <HelpDialog open={dlg === 'help'} onClose={() => setDlg('')} />
      <IntroDialog
        open={dlg === 'intro'}
        onClose={() => {
          setSettings({ introSeen: true })
          setDlg('')
        }}
      />
      <ViewDialog
        open={dlg === 'view'}
        onClose={() => setDlg('')}
        silence={t.settings.silenceFormat}
        silenceMin={t.settings.silenceMin}
        onSilence={(f) => {
          apply((x) => ops.reformatSilence(x, f))
          setSettings({ silenceFormat: f })
        }}
        onSilenceMin={(n) => {
          apply((x) => ops.resilence(x, n))
          setSettings({ silenceMin: n })
        }}
      />
      <NamesDialog
        open={dlg === 'names'}
        onClose={() => setDlg('')}
        t={t}
        onApply={(pairs, n) => {
          apply((x) => ops.maskNames(x, pairs))
          saver.setMeta({ maskedAt: new Date().toISOString() })
          setDlg('')
          say(`${n}곳을 바꿨어요.`, { undo: true })
        }}
      />
    </div>
  )
}

/**
 * 저장 상태 한 줄 + 누르면 세 단계 설명. 사용자가 "지금 어디까지 남아 있나"를 알 수 있게.
 * (1) 자동 저장: 고칠 때마다 이 브라우저 (2) 임시저장: 1분마다·멈출 때 폴더 (3) 저장: [저장]·⌘S로 본 파일
 */
function SaveStatus({ saver, onSave }: { saver: ReturnType<typeof useSave>; onSave: () => void }) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: Event) => !box.current?.contains(e.target as Node) && setOpen(false)
    addEventListener('pointerdown', close)
    return () => removeEventListener('pointerdown', close)
  }, [open])
  // 머리 줄에 들어가므로 짧게. 창에서는 길게 풀어 쓴다(fileLong)
  const file = saver.savedAt ? (saver.dirty ? '파일 저장 필요' : '파일 저장됨') : '파일 저장 필요'
  const fileLong = saver.savedAt ? (saver.dirty ? '저장한 뒤 고친 것이 있어요' : '파일로 저장돼 있어요') : '아직 파일로 저장하지 않았어요'
  const short = saver.lost ? '⚠ 자동 저장이 안 되고 있어요' : `✓ 자동 저장${saver.tempAt ? ` · 임시저장 ${hhmm(saver.tempAt)}` : ''} · ${file}`
  const mod = isMac ? '⌘S' : 'Ctrl+S'
  return (
    <span className="pop-wrap" ref={box}>
      <button type="button" className={`savest${saver.lost || saver.needsAllow ? ' warn' : ''}`} aria-expanded={open} onClick={() => setOpen((o) => !o)} title="저장 상태 자세히 보기">
        <span className="full">{short}</span>
        <span className="short">{saver.lost ? '⚠ 저장 확인' : '✓ 저장 상태'}</span>
      </button>
      {open && (
        <span className="hint savepop" role="dialog" aria-label="저장 상태">
          <b>고친 내용은 세 곳에 남아요</b>
          <span className={`lv${saver.lost ? ' bad' : ' ok'}`}>
            <b>1. 자동 저장 (이 브라우저)</b> 고칠 때마다 저절로.{' '}
            {saver.lost ? '지금 저장 공간이 부족해 안 되고 있어요. 아래 [지금 저장]으로 파일에 남겨 주세요.' : saver.autoAt ? `마지막 ${new Date(saver.autoAt).toLocaleTimeString('ko-KR', { hour12: false })}` : '고치면 바로 저장돼요.'}
            <i>브라우저 기록을 정리하면 지워질 수 있어요.</i>
          </span>
          <span className={`lv${saver.tempAt ? ' ok' : ''}`}>
            <b>2. 임시저장 (폴더{saver.folder ? ` ‘${saver.folder}’` : ''})</b> 1분마다, 그리고 재생을 멈출 때 저절로.{' '}
            {saver.needsAllow
              ? '폴더 저장 허락이 필요해요.'
              : saver.folder
                ? saver.tempAt
                  ? `마지막 ${hhmm(saver.tempAt)}`
                  : '아직 없어요.'
                : '저장할 폴더를 고르면 시작돼요.'}
            <i>"제목 (임시저장).transbee" 파일이에요.</i>
          </span>
          <span className={`lv${saver.savedAt && !saver.dirty ? ' ok' : ''}`}>
            <b>3. 저장 (파일)</b> [저장]이나 {mod}를 누를 때. 지금: {fileLong}.
            <i>"제목.transbee" 파일이에요. 보관하거나 다른 컴퓨터로 옮길 때 이 파일을 쓰세요.</i>
          </span>
          <span className="row2">
            <button type="button" className="btn sm pri" onClick={() => (setOpen(false), onSave())}>
              지금 저장 ({mod})
            </button>
            {saver.needsAllow ? (
              <button type="button" className="btn sm" onClick={() => (setOpen(false), saver.allow())}>
                폴더 저장 다시 허용하기
              </button>
            ) : (
              canPickFolder() && (
                <button type="button" className="btn sm" onClick={() => (setOpen(false), saver.changeFolder())}>
                  {saver.folder ? '폴더 바꾸기' : '저장할 폴더 고르기'}
                </button>
              )
            )}
          </span>
        </span>
      )}
    </span>
  )
}

/** 되돌리기(굽은 화살표 왼쪽)·다시 하기(오른쪽). 글꼴에 ↶ ↷ 글자가 없는 경우가 있어 그림으로 */
const Arrow = ({ back }: { back?: boolean }) => (
  <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" style={{ transform: back ? undefined : 'scaleX(-1)', verticalAlign: '-2px' }}>
    <path d="M6 3 2.5 6.5 6 10M3 6.5h6.5a4 4 0 0 1 0 8H7" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

/** 축어록 이름: 처음엔 녹음 파일 이름. 눌러서 고치고 Enter(또는 밖을 누르면) 반영, Esc는 취소 */
function TitleField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [v, setV] = useState(value)
  useEffect(() => setV(value), [value])
  const commit = () => (v.trim() ? onChange(v) : setV(value))
  return (
    <input
      id="doc-title"
      className="titlein"
      value={v}
      size={Math.max(8, Math.min(40, v.length + 2))}
      aria-label="축어록 이름(눌러서 고치기)"
      title="눌러서 이름을 고칠 수 있어요"
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing) return
        if (e.key === 'Enter') e.currentTarget.blur()
        else if (e.key === 'Escape') {
          setV(value)
          requestAnimationFrame(() => (e.target as HTMLInputElement).blur())
        }
      }}
    />
  )
}

interface Step {
  key: string
  label: string
  done: boolean
  /** 안 해도 되는 단계(이름 가리기): 지금 할 일로 잡지 않는다 */
  optional?: boolean
  note?: string
  run?: () => void
}

/** 축어록 완성까지의 단계: 한 일은 ✓, 지금 할 일은 형광펜, 남은 일은 빈 동그라미. 누르면 그 일을 한다. */
function Steps({ steps }: { steps: Step[] }) {
  const now = steps.find((s) => !s.done && !s.optional)?.key
  // 좁은 창에서 단계 줄이 옆으로 넘치면 지금 단계가 보이게 옮겨 둔다
  const ol = useRef<HTMLOListElement>(null)
  useEffect(() => {
    const el = ol.current
    const cur = el?.querySelector<HTMLElement>('.step.now')
    if (el && cur && el.scrollWidth > el.clientWidth) el.scrollTo({ left: cur.offsetLeft - el.clientWidth / 2 + cur.clientWidth / 2 })
  }, [now])
  return (
    <ol className="steps" aria-label="축어록 완성까지" ref={ol}>
      {steps.map((s, i) => {
        const st = s.done ? 'done' : s.key === now ? 'now' : 'todo'
        const inner = (
          <>
            <span className="dot" aria-hidden="true">
              {s.done ? '✓' : i + 1}
            </span>
            <span className="tx">
              <span className="lb">{s.label}</span>
              {(s.note || s.optional) && <span className="nt">{s.note ?? '필요할 때'}</span>}
            </span>
          </>
        )
        const why = st === 'done' ? '했어요' : st === 'now' ? '지금 할 일' : s.optional ? '필요할 때만' : '남은 일'
        return (
          <li key={s.key} className={`step ${st}${s.optional ? ' optional' : ''}`} aria-current={st === 'now' ? 'step' : undefined}>
            {s.run ? (
              <button type="button" onClick={s.run} aria-label={`${s.label} · ${why}${s.note ? ` · ${s.note}` : ''}`}>
                {inner}
              </button>
            ) : (
              <span className="sb" aria-label={`${s.label} · ${why}`}>
                {inner}
              </span>
            )}
          </li>
        )
      })}
    </ol>
  )
}

/** 5분 쉬기: 창(dialog)이라 뒤 화면으로 초점이 빠지지 않고, 단축키도 쉬는 동안은 듣지 않는다 */
function Rest({ until, onBack }: { until: number; onBack: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => ref.current?.showModal(), [])
  const resting = until > Date.now()
  return (
    <dialog
      ref={ref}
      className="dlg rest"
      aria-labelledby="rest-h"
      onCancel={(e) => {
        e.preventDefault()
        onBack()
      }}
    >
      <h2 id="rest-h" className="h">
        {resting ? '잠깐 쉬는 중이에요' : '5분이 지났어요'}
      </h2>
      <p>{resting ? `${clock((until - Date.now()) / 1000)} 남았어요. 창밖을 한번 보고 오세요.` : '이어서 해 볼까요?'}</p>
      <div className="dlg-foot">
        <button type="button" className="btn pri" autoFocus onClick={onBack}>
          돌아왔어요
        </button>
      </div>
    </dialog>
  )
}

function Dock({ player, auto, userSpeed, onSpeed }: { player: ReturnType<typeof usePlayback>; auto: boolean; userSpeed: number; onSpeed: (d: number) => void }) {
  const el = player.el
  const [time, setTime] = useState(el.currentTime)
  const [dur, setDur] = useState(el.duration || 0)
  useEffect(() => {
    let raf = 0
    let last = -1
    const upd = () => {
      cancelAnimationFrame(raf) // play·seeked·timeupdate마다 불리므로 도는 루프는 늘 하나만
      if (Math.abs(el.currentTime - last) >= 0.1) setTime((last = el.currentTime))
      if (!el.paused) raf = requestAnimationFrame(upd)
    }
    const meta = () => setDur(el.duration || 0)
    const evs = ['play', 'seeked', 'timeupdate'] as const
    evs.forEach((ev) => el.addEventListener(ev, upd))
    el.addEventListener('durationchange', meta)
    meta()
    return () => {
      cancelAnimationFrame(raf)
      evs.forEach((ev) => el.removeEventListener(ev, upd))
      el.removeEventListener('durationchange', meta)
    }
  }, [el])
  const sp: Speed = player.speed
  const pct = dur ? (time / dur) * 100 : 0
  return (
    <div className="dock" role="group" aria-label="재생">
      <button type="button" className="pp" onClick={player.toggle} aria-label={player.playing ? '멈추기' : '재생'}>
        {player.playing ? '❚❚' : '▶'}
      </button>
      <button type="button" className="btn quiet sm" onClick={() => player.skip(-5)} aria-label="5초 뒤로">
        ↺ 5초
      </button>
      <span className="ts">{clock(time)}</span>
      <input
        type="range"
        className="scrub"
        min={0}
        max={dur || 1}
        step={0.1}
        value={time}
        style={{ ['--p' as string]: `${pct}%` }}
        onChange={(e) => player.seek(Number(e.target.value))}
        aria-label="재생 위치"
        aria-valuetext={`${clock(time)} / ${clock(dur)}`}
      />
      <span className="ts">{clock(dur)}</span>
      <button
        type="button"
        role="switch"
        aria-checked={auto}
        className="auto"
        onClick={() => {
          setSettings({ autoSpeed: !auto })
          player.applyRate()
        }}
      >
        <span className="sw" aria-hidden="true" />
        알아서 빨라지기
      </button>
      {/* 속도 −/+는 늘 보인다. 알아서 빨라지기 중에 누르면 그 기능을 끄고 지금 들리는 속도에서 한 칸 */}
      <span className="spd-set">
        <button type="button" className="btn quiet sm" onClick={() => onSpeed(-0.25)} aria-label="느리게" title="느리게 (0.25배씩)" disabled={!auto && userSpeed <= 0.5}>
          −
        </button>
        <span className="spd">
          {auto ? `지금 ${rateText(sp.rate)}` : rateText(userSpeed)}
          {auto && sp.why ? ` · ${sp.why}` : ''}
        </span>
        <button type="button" className="btn quiet sm" onClick={() => onSpeed(0.25)} aria-label="빠르게" title="빠르게 (0.25배씩)" disabled={!auto && userSpeed >= 2.5}>
          +
        </button>
      </span>
    </div>
  )
}

function LineTools(p: {
  u: Utterance
  anchor: HTMLElement
  first: boolean
  hasSection: boolean
  other: string
  label: string
  onClose: (refocus: boolean) => void
  onListen: () => void
  onNudge: (d: number) => void
  onSpeaker: () => void
  onMerge: () => void
  onSection: () => void
  onReview: (r: 'marked' | 'draft') => void
  onSwapAll: () => void
}) {
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => box.current?.querySelector<HTMLButtonElement>('button')?.focus(), [p.u.id])
  const r = p.anchor.getBoundingClientRect()
  const top = r.bottom + scrollY + 6
  const left = Math.min(r.left + scrollX, scrollX + innerWidth - 290)
  const done = (fn: () => void, refocus = false) => () => {
    fn()
    p.onClose(refocus)
  }
  const draft = p.u.review === 'draft'
  const [tip, setTip] = useState('')
  const K = isMac ? { r: '⌃⌥R', bs: '⌫' } : { r: 'Ctrl+Alt+R', bs: 'Backspace' }
  /** 줄 도구 한 줄. tip이 있으면 옆 ⓘ를 눌러 키보드로 하는 법을 펼친다 */
  const item = (key: string, label: ReactNode, onClick: () => void, tipText?: string) => (
    <div className="pi-row" key={key}>
      <button type="button" className="pi" onClick={onClick}>
        {label}
      </button>
      {tipText && (
        <button type="button" className="pi-tip" aria-expanded={tip === key} aria-label={`${typeof label === 'string' ? label : ''} 키보드로 하는 법`} onClick={() => setTip((t) => (t === key ? '' : key))}>
          i
        </button>
      )}
      {tipText && tip === key && <p className="tip">{tipText}</p>}
    </div>
  )
  return (
    <div className="pop" ref={box} role="dialog" aria-label={`${p.label} 줄 도구`} style={{ top, left }}>
      <p className="pop-h">
        {p.label} · {clock(p.u.start)}
      </p>
      {item(
        'listen',
        <>
          <span className="icon" aria-hidden="true">
            ▶
          </span>
          이 줄만 듣기
        </>,
        p.onListen,
        `지금 문장은 ${K.r}로 다시 들을 수 있어요. 문장 오른쪽의 재생 단추를 눌러도 돼요.`,
      )}
      <div className="nudge">
        <p className="lbl">듣기 시작이 어긋나면</p>
        <div className="btns">
          <button type="button" className="btn sm" onClick={() => p.onNudge(-1)}>
            1초 앞에서
          </button>
          <button type="button" className="btn sm" onClick={p.onListen} aria-label="다시 듣기">
            ▶
          </button>
          <button type="button" className="btn sm" onClick={() => p.onNudge(1)}>
            1초 뒤에서
          </button>
        </div>
      </div>
      <hr />
      {item('speaker', `${p.other} 말로 바꾸기`, done(p.onSpeaker, true))}
      {!p.first && item('merge', '윗줄과 합치기', done(p.onMerge), `문장 맨 앞에 커서를 두고 ${K.bs}를 누르면 윗줄과 합쳐져요.`)}
      {!p.hasSection && item('section', '위에 소제목 넣기', done(p.onSection))}
      {draft
        ? item('mark', '확인한 문장으로 두기', done(() => p.onReview('marked'), true), '문장 왼쪽 여백의 ○를 눌러도 돼요. 재생이 문장 끝까지 지나가면 저절로 확인돼요.')
        : item('unmark', '다시 확인할래요', done(() => p.onReview('draft'), true))}
      <hr />
      {item('swap', '두 사람 전체 맞바꾸기', done(p.onSwapAll, true))}
      <p className="pop-foot">줄 나누기: 나눌 자리에 커서를 두고 Enter</p>
    </div>
  )
}
