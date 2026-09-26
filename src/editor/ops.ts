// 편집 조작. 모두 순수 함수: 축어록을 받아 새 축어록을 돌려준다(원본은 건드리지 않음).
import type { ReviewState, Section, SilenceFormat, SpeakerId, Transcript, Utterance, Word } from '../types'
import { relabelMarks, silenceText, speakerShort } from '../labels'

let seq = 0
export const newId = (p = 'u') => `${p}${Date.now().toString(36)}${(seq++).toString(36)}`

const touch = (t: Transcript, patch: Partial<Transcript>): Transcript => ({
  ...t,
  ...patch,
  updatedAt: new Date().toISOString(),
})

const mapUtt = (t: Transcript, id: string, fn: (u: Utterance) => Utterance): Transcript =>
  touch(t, { utterances: t.utterances.map((u) => (u.id === id ? fn(u) : u)) })

const bare = (s: string) => s.replace(/\s/g, '').length

/** 본문 글자 위치(offset)에 해당하는 녹음 시각. 단어 시각이 있으면 그걸로, 없으면 글자 비율로. */
export function timeAtOffset(u: Utterance, offset: number): number {
  const total = bare(u.text)
  const before = bare(u.text.slice(0, offset))
  const words = u.words ?? []
  let t: number
  if (words.length) {
    // 편집으로 글자 수가 달라졌을 수 있어 단어 쪽 글자 수에 맞춰 늘이거나 줄인다
    const wTotal = words.reduce((n, w) => n + bare(w.text), 0)
    const target = total ? (before / total) * wTotal : 0
    t = words[words.length - 1].end
    let acc = 0
    for (const w of words) {
      const len = bare(w.text)
      if (target <= acc) {
        t = w.start
        break
      }
      if (target < acc + len) {
        t = w.start + (w.end - w.start) * ((target - acc) / len)
        break
      }
      acc += len
    }
  } else {
    t = u.start + (u.end - u.start) * (total ? before / total : 0.5)
  }
  return Math.min(Math.max(t, u.start + 0.01), u.end - 0.01)
}

/** 시각 → 본문 글자 위치(낱말 경계로 맞춤). 제안 넣기용. */
export function offsetAtTime(u: Utterance, time: number): number {
  const words = u.words ?? []
  const total = bare(u.text)
  let ratio: number
  if (words.length) {
    const wTotal = words.reduce((n, w) => n + bare(w.text), 0)
    // 소리가 낱말 도중에 났으면 그 낱말 뒤에 넣는다
    const done = words.filter((w) => w.start < time).reduce((n, w) => n + bare(w.text), 0)
    ratio = wTotal ? done / wTotal : 1
  } else {
    ratio = u.end > u.start ? (time - u.start) / (u.end - u.start) : 1
  }
  const want = Math.round(Math.min(Math.max(ratio, 0), 1) * total)
  let seen = 0
  for (let i = 0; i < u.text.length; i++) {
    if (seen >= want && /\s/.test(u.text[i])) return i
    if (!/\s/.test(u.text[i])) seen++
  }
  return u.text.length
}

export function setText(t: Transcript, id: string, text: string): Transcript {
  return mapUtt(t, id, (u) => (u.text === text ? u : { ...u, text, review: 'edited' }))
}

/** 나눈 줄의 '같이 말한 곳' 표시: 단어 시각이 있으면 그 줄 단어로 다시 정한다(없으면 원래 줄 것을 물려받음) */
const overlapOf = (u: Utterance) => (u.words?.length ? u.words.some((w) => w.overlap) || undefined : u.overlap)

/** 커서 위치에서 줄 나누기. 한쪽이 비면 null. */
export function splitUtterance(t: Transcript, id: string, offset: number): { t: Transcript; newId: string } | null {
  const i = t.utterances.findIndex((u) => u.id === id)
  if (i < 0) return null
  const u = t.utterances[i]
  const left = u.text.slice(0, offset).trimEnd()
  const right = u.text.slice(offset).trimStart()
  if (!left || !right) return null
  const at = timeAtOffset(u, offset)
  const words = u.words
  const a: Utterance = {
    ...u,
    text: left,
    end: at,
    words: words?.filter((w) => w.end <= at + 1e-6),
    suggestions: u.suggestions?.filter((s) => s.at < at),
  }
  a.overlap = overlapOf(a)
  const b: Utterance = {
    ...u,
    id: newId(),
    text: right,
    start: at,
    words: words?.filter((w) => w.end > at + 1e-6),
    suggestions: u.suggestions?.filter((s) => s.at >= at),
  }
  b.overlap = overlapOf(b)
  const utterances = [...t.utterances]
  utterances.splice(i, 1, a, b)
  return { t: touch(t, { utterances }), newId: b.id }
}

/** 윗줄과 합치기. caret = 합친 문장에서 원래 줄이 시작하는 위치. */
export function mergeWithPrevious(t: Transcript, id: string): { t: Transcript; prevId: string; caret: number } | null {
  const i = t.utterances.findIndex((u) => u.id === id)
  if (i <= 0) return null
  const p = t.utterances[i - 1]
  const u = t.utterances[i]
  const head = p.text.trimEnd()
  const tail = u.text.trimStart()
  const text = head && tail ? `${head} ${tail}` : head + tail
  // 한쪽이라도 안 듣고 확인(bulk)이면 합친 줄도 안 듣고 확인 — 듣지 않은 말이 들은 것처럼 보이지 않게
  const review: ReviewState = p.review === 'draft' || u.review === 'draft' ? 'draft' : p.review === 'bulk' || u.review === 'bulk' ? 'bulk' : 'edited'
  const merged: Utterance = {
    ...p,
    text,
    end: Math.max(p.end, u.end),
    words: p.words || u.words ? [...(p.words ?? []), ...(u.words ?? [])] : undefined,
    suggestions: p.suggestions || u.suggestions ? [...(p.suggestions ?? []), ...(u.suggestions ?? [])] : undefined,
    overlap: p.overlap || u.overlap || undefined,
    confidence: p.confidence !== undefined && u.confidence !== undefined ? Math.min(p.confidence, u.confidence) : (p.confidence ?? u.confidence),
    review,
  }
  const utterances = [...t.utterances]
  utterances.splice(i - 1, 2, merged)
  // 합쳐져 사라지는 줄 위의 소제목은 합친 줄 위로 올린다(이미 있으면 뺀다)
  const hasPrev = t.sections.some((s) => s.beforeUtteranceId === p.id)
  const sections = t.sections.flatMap((s) =>
    s.beforeUtteranceId !== u.id ? [s] : hasPrev ? [] : [{ ...s, beforeUtteranceId: p.id }],
  )
  return { t: touch(t, { utterances, sections }), prevId: p.id, caret: head && tail ? head.length + 1 : head.length }
}

/** 축어록 이름(처음엔 녹음 파일 이름). 비우면 그대로 둔다. */
export const setTitle = (t: Transcript, title: string) => (title.trim() && title !== t.title ? touch(t, { title: title.trim() }) : t)

export const setSpeaker = (t: Transcript, id: string, speaker: SpeakerId) => mapUtt(t, id, (u) => ({ ...u, speaker }))

/** 두 화자 전체 맞바꾸기. 상담자가 정해져 있으면 역할만, 아니면 발화의 화자를 뒤집는다. */
export function swapSpeakers(t: Transcript): Transcript {
  const [a, b] = t.speakers.roles
  if (a || b) return relabel(t, touch(t, { speakers: { roles: [b, a] } }))
  return relabel(t, touch(t, { utterances: t.utterances.map((u) => ({ ...u, speaker: (1 - u.speaker) as SpeakerId })) }), true)
}

export function setRoles(t: Transcript, counselor: SpeakerId | null): Transcript {
  const roles: Transcript['speakers']['roles'] =
    counselor === null ? [null, null] : counselor === 0 ? ['counselor', 'client'] : ['client', 'counselor']
  return relabel(t, touch(t, { speakers: { roles } }))
}

/** 화자 이름이 바뀌면 글 속 괄호 표기((상: 음))도 같은 사람을 가리키게. flip: 발화의 화자 번호를 뒤집은 경우 */
function relabel(t: Transcript, next: Transcript, flip = false): Transcript {
  const map = new Map<string, string>()
  for (const s of [0, 1] as SpeakerId[]) map.set(speakerShort(t, s), speakerShort(next, (flip ? 1 - s : s) as SpeakerId))
  if ([...map].every(([k, v]) => k === v)) return next
  return { ...next, utterances: next.utterances.map((u) => { const text = relabelMarks(u.text, map); return text === u.text ? u : { ...u, text } }) }
}

export function setReview(t: Transcript, ids: Iterable<string>, review: ReviewState): Transcript {
  const set = new Set(ids)
  return touch(t, { utterances: t.utterances.map((u) => (set.has(u.id) && u.review !== review ? { ...u, review } : u)) })
}

/**
 * 재생이 지나간 초벌 문장만 '들음'으로. 바뀐 게 없으면 같은 객체.
 * 확인 상태도 파일에 남는 내용이라 updatedAt을 올린다(저장 안 한 고침으로 잡힘).
 */
export function markHeard(t: Transcript, ids: string[]): Transcript {
  const set = new Set(ids)
  if (!t.utterances.some((u) => set.has(u.id) && u.review === 'draft')) return t
  return touch(t, { utterances: t.utterances.map((u) => (set.has(u.id) && u.review === 'draft' ? { ...u, review: 'heard' } : u)) })
}

/** "이 줄만 듣기" 시작점을 앞뒤로 옮기기. 윗줄 시작과 이 줄 끝 사이로 제한. */
export function nudgeStart(t: Transcript, id: string, delta: number): Transcript {
  const i = t.utterances.findIndex((u) => u.id === id)
  const lo = i > 0 ? t.utterances[i - 1].start + 0.05 : 0
  return mapUtt(t, id, (u) => ({ ...u, start: Math.min(Math.max(u.start + delta, lo), u.end - 0.1) }))
}

export function insertSection(t: Transcript, beforeUtteranceId: string, title = ''): { t: Transcript; id: string } {
  const s: Section = { id: newId('s'), title, beforeUtteranceId }
  return { t: touch(t, { sections: [...t.sections.filter((x) => x.beforeUtteranceId !== beforeUtteranceId), s] }), id: s.id }
}

/** 비우면 소제목을 뺀다. 타이핑 중(keepEmpty)에는 빈 채로 둔다. */
export function setSectionTitle(t: Transcript, id: string, title: string, keepEmpty = false): Transcript {
  const cur = t.sections.find((s) => s.id === id)
  if (!cur || (cur.title === title && (keepEmpty || title.trim()))) return t
  const sections = keepEmpty || title.trim()
    ? t.sections.map((s) => (s.id === id ? { ...s, title } : s))
    : t.sections.filter((s) => s.id !== id)
  return touch(t, { sections })
}

export interface NameHit {
  index: number // 발화 번호(0부터), 소제목이면 -1
  id: string
  before: string
  hit: string
  after: string
}

/** 이름이 나오는 곳을 앞뒤 문맥과 함께 */
export function findName(t: Transcript, name: string, ctx = 18): NameHit[] {
  const hits: NameHit[] = []
  if (!name.trim()) return hits
  t.utterances.forEach((u, index) => {
    let at = u.text.indexOf(name)
    while (at >= 0) {
      hits.push({
        index,
        id: u.id,
        before: (at > ctx ? '…' : '') + u.text.slice(Math.max(0, at - ctx), at),
        hit: name,
        after: u.text.slice(at + name.length, at + name.length + ctx) + (at + name.length + ctx < u.text.length ? '…' : ''),
      })
      at = u.text.indexOf(name, at + name.length)
    }
  })
  // 소제목도 바꾸므로 같이 보여 준다(index -1)
  for (const sec of t.sections) {
    let at = sec.title.indexOf(name)
    while (at >= 0) {
      hits.push({ index: -1, id: sec.id, before: sec.title.slice(0, at), hit: name, after: sec.title.slice(at + name.length) })
      at = sec.title.indexOf(name, at + name.length)
    }
  }
  return hits
}

/** 이름 가리기: 여러 이름을 한 번에 바꾼다. 확인 상태는 그대로 둔다. */
// 여러 이름을 한 번에(단일 패스) 바꾼다. 차례로 바꾸면 앞 이름의 결과가 뒤 이름을 가려
// "민준" → OO 뒤에 "민준이"를 못 찾는 식으로 조각이 남는다. 긴 이름을 먼저 맞춘다.
function namePattern(pairs: { from: string; to: string }[]) {
  const map = new Map<string, string>()
  // 앞뒤 빈칸은 떼고 찾는다(미리보기 findName과 같게) — "지수 "를 적어도 "지수가"가 남지 않게
  for (const p of pairs) {
    const k = p.from.trim()
    if (k && !map.has(k)) map.set(k, p.to)
  }
  if (!map.size) return undefined
  const alts = [...map.keys()].sort((a, b) => b.length - a.length).map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  return { re: new RegExp(alts.join('|'), 'g'), map }
}

/** 이름 가리기로 실제로 바뀔 곳의 수(단일 패스 기준, 미리보기·완료 알림용) */
export function countNames(t: Transcript, pairs: { from: string; to: string }[]): number {
  const np = namePattern(pairs)
  if (!np) return 0
  const n = (s: string) => s.match(np.re)?.length ?? 0
  return t.utterances.reduce((a, u) => a + n(u.text), 0) + t.sections.reduce((a, s) => a + n(s.title), 0)
}

export function maskNames(t: Transcript, pairs: { from: string; to: string }[]): Transcript {
  const np = namePattern(pairs)
  if (!np) return t
  const rep = (s: string) => s.replace(np.re, (m) => np.map.get(m) ?? m)
  const repWords = (ws?: Word[]) => ws?.map((w) => ({ ...w, text: rep(w.text) }))
  return touch(t, {
    utterances: t.utterances.map((u) => {
      const text = rep(u.text)
      return text === u.text ? u : { ...u, text, words: repWords(u.words) }
    }),
    sections: t.sections.map((s) => ({ ...s, title: rep(s.title) })),
  })
}

/** 소리 제안 "(웃음?)" 넣기 */
export function acceptSuggestion(t: Transcript, uid: string, sid: string): Transcript {
  return mapUtt(t, uid, (u) => {
    const s = u.suggestions?.find((x) => x.id === sid)
    if (!s) return u
    const at = offsetAtTime(u, s.at)
    const head = u.text.slice(0, at).trimEnd()
    const tail = u.text.slice(at).trimStart()
    const text = [head, `(${s.label})`, tail].filter(Boolean).join(' ')
    return { ...u, text, suggestions: u.suggestions!.filter((x) => x.id !== sid) }
  })
}

export const rejectSuggestion = (t: Transcript, uid: string, sid: string) =>
  mapUtt(t, uid, (u) => ({ ...u, suggestions: u.suggestions?.filter((x) => x.id !== sid) }))

const LEADING_SILENCE = /^(?:\((?:침묵 )?(\d+)초\)|\(…\))\s*/

/**
 * 침묵 기준(초) 바꾸기: 문장 맨 앞의 자동 침묵 표기만 다시 정한다(문장 중간에 직접 쓴 표기는 그대로).
 * 이미 있는 표기는 엔진이 잰 초를 믿고, 없던 자리는 앞 문장 끝~이 문장 시작 간격으로 잰다.
 */
export function resilence(t: Transcript, min: number): Transcript {
  const us = t.utterances
  return touch(t, {
    settings: { ...t.settings, silenceMin: min },
    utterances: us.map((u, i) => {
      const gap = i ? u.start - us[i - 1].end : 0
      const m = LEADING_SILENCE.exec(u.text)
      const sec = m?.[1] ? Number(m[1]) : gap
      const body = m ? u.text.slice(m[0].length) : u.text
      const text = i && sec >= min ? (m ? u.text : `${silenceText(gap, t.settings.silenceFormat)} ${body}`) : body
      return text === u.text ? u : { ...u, text }
    }),
  })
}

// ---------- 확인할 곳 ----------

/**
 * 잘 안 들린 말 기준: 단어 신뢰도(Whisper가 고른 토큰의 확률 평균) 0.6 미만. 점선 밑줄·확인할 곳·알아서 빨라지기가 모두 이 값을 쓴다.
 * 근거(2026-09-25 엔진, 정답 전사가 있는 평가용 녹음 2개, 단어 559개 — scripts/eval-engine.mjs 결과로 잼):
 *   신뢰도 구간별 틀린 비율 0~0.4: 56%, 0.4~0.5: 48%, 0.5~0.6: 52%, 0.6~0.7: 37%, 0.7~0.9: 24%, 0.9~: 4%.
 *   0.6 아래는 어디를 잘라도 표시한 단어의 절반쯤이 틀렸고(0.5 미만 54%, 0.6 미만 53%), 0.6에서 한 단계 떨어진다.
 *   0.5로 자르면 0.5~0.6 구간(0.5 미만만큼 자주 틀림)을 놓쳐 틀린 단어를 40%만 잡고, 0.6은 54%, 옛 기준 0.7은 67%.
 * 평가용 46분 녹음(정답 없음)에서 0.7 → 0.6 → 0.5:
 *   점선 단어 15.1% → 9.6% → 5.9%, 알아서 빨라지기 1배 비율(말소리 기준) 42% → 30% → 22%,
 *   확인할 곳이 있는 문장 80% → 73% → 65%. 문장 비율이 덜 줄어드는 건 같이 말한 문장(33%)과 긴 문장(단어 50개 넘는 문장이 10%) 때문.
 * 표본이 작다(0.5~0.6 구간 42단어). 정답이 늘면 다시 잴 것.
 */
export const DOUBT = 0.6

export interface Spot {
  /** 본문 글자 범위 */
  from: number
  to: number
  /** 녹음 시각 */
  start: number
  end: number
  kind: 'doubt' | 'overlap'
}

/**
 * 한 문장 안의 확인할 곳(잘 안 들린 단어, 같이 말한 단어). 본문에서 단어 글자를 차례로 찾아 범위를 잡는다.
 * 고친 문장은 단어 위치가 어긋날 수 있어 빈 목록. 단어 시각이 없는 문장은 평균 신뢰도로 문장 전체.
 */
export function spots(u: Utterance): Spot[] {
  if (u.review === 'edited') return []
  if (!u.words?.length) return (u.confidence ?? 1) < DOUBT ? [{ from: 0, to: u.text.length, start: u.start, end: u.end, kind: 'doubt' }] : []
  const out: Spot[] = []
  let from = 0
  for (const w of u.words) {
    const at = u.text.indexOf(w.text, from)
    if (at < 0 || !w.text) continue
    from = at + w.text.length
    if (w.overlap) out.push({ from: at, to: from, start: w.start, end: w.end, kind: 'overlap' })
    else if ((w.confidence ?? 1) < DOUBT) out.push({ from: at, to: from, start: w.start, end: w.end, kind: 'doubt' })
  }
  // 맞장구 괄호 (네)(음)는 같이 말한 곳이 흔하다: 겹침 문장인데 단어 표시가 없으면 괄호 자리
  if (u.overlap && !out.some((x) => x.kind === 'overlap')) {
    const re = /\((?:네|음|응|예)\)/g
    let m: RegExpExecArray | null
    while ((m = re.exec(u.text))) out.push({ from: m.index, to: m.index + m[0].length, start: u.start, end: u.end, kind: 'overlap' })
    out.sort((a, b) => a.from - b.from)
  }
  return out
}

/** 확인할 곳이 남은 초벌 문장 */
export const needsCheck = (u: Utterance) => u.review === 'draft' && spots(u).length > 0

/** (at번째 문장, 글자 위치 offset) 다음의 확인할 곳. 끝까지 없으면 처음부터 다시 찾는다. */
export function nextSpot(us: Utterance[], at: number, offset: number): { index: number; spot: Spot } | null {
  const n = us.length
  if (!n) return null
  for (let k = 0; k <= n; k++) {
    const i = (Math.max(at, 0) + k) % n
    if (us[i].review !== 'draft') continue
    const s = spots(us[i]).find((x) => k > 0 || x.from > offset)
    if (s) return { index: i, spot: s }
  }
  return null
}

/** 이미 들어간 침묵 표기의 모양 바꾸기. (…)는 초가 없어 되돌릴 수 없으므로 그대로 둔다. */
export function reformatSilence(t: Transcript, format: SilenceFormat): Transcript {
  const re = /\((?:침묵 )?(\d+)초\)/g
  return touch(t, {
    settings: { ...t.settings, silenceFormat: format },
    utterances: t.utterances.map((u) => {
      const text = u.text.replace(re, (_, n) => silenceText(Number(n), format))
      return text === u.text ? u : { ...u, text }
    }),
  })
}

// ---------- 실행취소 ----------

export interface History {
  t: Transcript
  past: Transcript[]
  future: Transcript[]
  tag?: string
  at: number
}

const LIMIT = 300
const MERGE_MS = 1500

export const createHistory = (t: Transcript): History => ({ t, past: [], future: [], at: 0 })

/** 같은 tag(예: 한 문장 타이핑)가 1.5초 안에 이어지면 실행취소 한 번으로 묶는다. */
export function commit(h: History, next: Transcript, tag?: string, now = Date.now()): History {
  if (next === h.t) return h
  if (tag && tag === h.tag && now - h.at < MERGE_MS) return { ...h, t: next, future: [], at: now }
  return { t: next, past: [...h.past.slice(-LIMIT + 1), h.t], future: [], tag, at: now }
}

/** 재생으로 붙은 '들음' 표시는 실행취소로 지우지 않는다(편집이 아니므로). */
function keepHeard(restored: Transcript, current: Transcript): Transcript {
  const heard = new Set(current.utterances.filter((u) => u.review === 'heard').map((u) => u.id))
  return markHeard(restored, [...heard])
}

export function undo(h: History): History {
  const prev = h.past[h.past.length - 1]
  if (!prev) return h
  return { t: keepHeard(prev, h.t), past: h.past.slice(0, -1), future: [h.t, ...h.future], at: 0 }
}

export function redo(h: History): History {
  const [next, ...rest] = h.future
  if (!next) return h
  return { t: keepHeard(next, h.t), past: [...h.past, h.t], future: rest, at: 0 }
}

/** 재생 중 '들음' 표시: 실행취소 기록 없이 지금 상태에만 반영 */
export const silently = (h: History, next: Transcript): History => (next === h.t ? h : { ...h, t: next })
