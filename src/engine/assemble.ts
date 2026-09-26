// 순수 로직: 화자 채널 합치기, 음성 구간·인식 구간 나누기, 단어 → 발화 조립, 침묵 표기.
// 모델·브라우저 API를 쓰지 않는다(vitest로 검증).
import type { SpeakerId, TranscriptSettings, Utterance, Word } from '../types'
import { silenceText } from '../labels'

export const FPS = 100 // 화자분리 프레임: 10ms
const ACTIVE = 0.5

/** 두 화자로 합친 프레임별 말함 확률. p[0], p[1] 길이 = 프레임 수. */
export interface Activity {
  p: [Float32Array, Float32Array]
}

export interface AsrWord extends Word {
  speaker: SpeakerId
}

/**
 * 모델 채널(최대 8개)을 두 화자로 합치는 표. map[채널] = 0 | 1.
 * 말한 시간이 가장 긴 두 채널이 두 화자다(먼저 등장한 채널이 0).
 * 나머지 채널은 인코더 평균 임베딩이 더 가까운 쪽에 붙인다
 * — 근거: 한 사람이 두 채널로 쪼개진 경우가 가장 흔하고, 같은 사람의 프레임은 인코더 공간에서 가깝다.
 * 임베딩이 없으면(말한 프레임 없음) 더 오래 말한 쪽에 붙인다.
 */
export function speakerMap(activeSec: number[], meanEmb: (Float32Array | null)[]): SpeakerId[] {
  const order = activeSec.map((s, c) => [s, c]).sort((a, b) => b[0] - a[0] || a[1] - b[1]).map((x) => x[1])
  const [a, b] = [order[0], order[1]].sort((x, y) => x - y)
  const map: SpeakerId[] = activeSec.map(() => 0)
  map[a] = 0
  map[b] = 1
  for (let c = 0; c < activeSec.length; c++) {
    if (c === a || c === b) continue
    const e = meanEmb[c]
    if (e && meanEmb[a] && meanEmb[b]) map[c] = cosine(e, meanEmb[a]!) >= cosine(e, meanEmb[b]!) ? 0 : 1
    else map[c] = activeSec[a] >= activeSec[b] ? 0 : 1
  }
  return map
}

function cosine(x: Float32Array, y: Float32Array): number {
  let d = 0, nx = 0, ny = 0
  for (let i = 0; i < x.length; i++) { d += x[i] * y[i]; nx += x[i] * x[i]; ny += y[i] * y[i] }
  return d / (Math.sqrt(nx * ny) || 1)
}

/** 채널 확률(frames × channels)을 두 화자 확률로. 같은 화자로 합친 채널은 최댓값. */
export function mergeChannels(probs: Float32Array, channels: number, map: SpeakerId[]): Activity {
  const n = probs.length / channels
  const p: [Float32Array, Float32Array] = [new Float32Array(n), new Float32Array(n)]
  for (let t = 0; t < n; t++) {
    for (let c = 0; c < channels; c++) {
      const v = probs[t * channels + c]
      const s = map[c]
      if (v > p[s][t]) p[s][t] = v
    }
  }
  return { p }
}

const speechAt = (a: Activity, t: number) => a.p[0][t] > ACTIVE || a.p[1][t] > ACTIVE

/** 말소리 구간 [시작초, 끝초]. minGap초보다 짧은 쉼은 이어 붙인다. */
export function speechRuns(a: Activity, minGap = 0.3): [number, number][] {
  const n = a.p[0].length
  const runs: [number, number][] = []
  let s = -1
  for (let t = 0; t <= n; t++) {
    const on = t < n && speechAt(a, t)
    if (on && s < 0) s = t
    else if (!on && s >= 0) {
      const last = runs.at(-1)
      if (last && s / FPS - last[1] < minGap) last[1] = t / FPS
      else runs.push([s / FPS, t / FPS])
      s = -1
    }
  }
  return runs
}

/**
 * 음성인식에 넣을 구간(Whisper는 30초까지). 말소리 구간을 이어 붙이되 maxLen을 넘거나 쉼이 breakGap 이상이면 끊는다.
 * 쉼 없이 maxLen을 넘는 말은 말함 확률이 가장 낮은 프레임에서 자른다.
 */
export function asrWindows(a: Activity, runs: [number, number][], maxLen = 28, breakGap = 2, pad = 0.2): [number, number][] {
  const out: [number, number][] = []
  const dur = a.p[0].length / FPS
  // 여유(pad)는 조용한 경계에만: 말 도중 강제로 자른 자리에 붙이면 두 구간이 겹쳐 같은 낱말을 두 번 받아 적는다
  let cur: Seg | null = null
  const flush = () => { if (cur) out.push([Math.max(0, cur[0] - (cur[2] ? 0 : pad)), Math.min(dur, cur[1] + (cur[3] ? 0 : pad))]); cur = null }
  for (const [s, e, cs, ce] of splitLong(a, runs, maxLen)) {
    if (cur && (s - cur[1] >= breakGap || e - cur[0] > maxLen)) flush()
    if (!cur) cur = [s, e, cs, ce]
    else { cur[1] = e; cur[3] = ce }
  }
  flush()
  return out
}

/** [시작, 끝, 시작이 강제로 자른 자리인가, 끝이 강제로 자른 자리인가] */
type Seg = [number, number, boolean, boolean]

/** 말소리 구간을 turn(같은 화자 연속)으로. 화자가 바뀌면 끊고, 같은 화자의 gap초 미만 쉼은 잇는다. */
export function speakerTurns(a: Activity, gap = 1, minLen = 0.2): { start: number; end: number; speaker: SpeakerId }[] {
  const n = a.p[0].length
  const turns: { start: number; end: number; speaker: SpeakerId }[] = []
  let s = -1
  let spk: SpeakerId = 0
  const close = (t: number) => {
    const last = turns.at(-1)
    if (last && last.speaker === spk && s / FPS - last.end < gap) last.end = t / FPS
    else if ((t - s) / FPS >= minLen) turns.push({ start: s / FPS, end: t / FPS, speaker: spk })
    s = -1
  }
  for (let t = 0; t <= n; t++) {
    const on = t < n && speechAt(a, t)
    const who: SpeakerId = t < n && a.p[1][t] > a.p[0][t] ? 1 : 0
    if (s >= 0 && (!on || who !== spk)) close(t)
    if (on && s < 0) { s = t; spk = who }
  }
  return turns
}

export function splitLong(a: Activity, runs: [number, number][], maxLen: number): Seg[] {
  const out: Seg[] = []
  for (let [s, e] of runs) {
    let cut = false
    while (e - s > maxLen) {
      // maxLen의 70~100% 사이에서 말함 확률이 가장 낮은 프레임
      let best = Math.floor((s + maxLen) * FPS), bestV = Infinity
      for (let t = Math.floor((s + maxLen * 0.7) * FPS); t < Math.floor((s + maxLen) * FPS); t++) {
        const v = Math.max(a.p[0][t] ?? 0, a.p[1][t] ?? 0)
        if (v < bestV) { bestV = v; best = t }
      }
      out.push([s, best / FPS, cut, true])
      s = best / FPS
      cut = true
    }
    out.push([s, e, cut, false])
  }
  return out
}

/**
 * 단어 화자: 단어 앞 0.3초에서 두 화자 확률 합이 큰 쪽. 둘 다 조용하면 ±0.5초, ±2초로 넓혀 본다.
 * 앞부분만 보는 까닭: Whisper 단어 끝 = 다음 단어 시작이라 말차례 마지막 단어("것 같아요")가 쉼을 건너
 * 상대 말까지 늘어나고, 단어 전체로 보면 상대 쪽으로 넘어간다(가상 상담 154단어: 전체 150개 맞음 → 앞 0.3초 154개).
 */
export function wordSpeaker(a: Activity, start: number, end: number): SpeakerId {
  const n = a.p[0].length
  end = Math.min(end, start + 0.3)
  for (const widen of [0, 0.5, 2]) {
    let s0 = 0, s1 = 0
    const t0 = Math.max(0, Math.floor((start - widen) * FPS)), t1 = Math.min(n, Math.ceil((end + widen) * FPS))
    for (let t = t0; t < t1; t++) { s0 += a.p[0][t]; s1 += a.p[1][t] }
    if (s0 + s1 > 0.1) return s1 > s0 ? 1 : 0
  }
  return 0
}

/**
 * 단어 끝 다듬기: 그 화자가 0.3초 넘게 쉬기 시작한 곳까지(+0.1초)로 줄인다. 늘어난 끝이 침묵을 가리거나
 * "이 줄만 듣기"에 상대 말이 섞이지 않게. 그 화자 말소리가 전혀 없으면 그대로.
 */
export function trimEnd(a: Activity, s: SpeakerId, start: number, end: number): number {
  const n = a.p[s].length
  let last = -1
  for (let t = Math.max(0, Math.floor(start * FPS)); t < Math.min(n, Math.ceil(end * FPS)); t++) {
    if (a.p[s][t] > ACTIVE) last = t
    else if (last >= 0 && t - last > 0.3 * FPS) break
  }
  return last < 0 ? end : Math.min(end, Math.max(start + 0.1, (last + 1) / FPS + 0.1))
}

/** [from, to] 사이에서 가장 긴 연속 무음(초). */
export function longestSilence(a: Activity, from: number, to: number): number {
  const n = a.p[0].length
  let best = 0, run = 0
  for (let t = Math.max(0, Math.round(from * FPS)); t < Math.min(n, Math.round(to * FPS)); t++) {
    run = speechAt(a, t) ? 0 : run + 1
    if (run > best) best = run
  }
  return best / FPS
}

/**
 * 같이 말한 구간: 두 화자가 모두 말함(>0.5)인 프레임이 minLen초 이상 이어진 곳.
 * 기준 0.3초 — 평가용 46분 녹음의 겹침 조각 285개 중 절반이 0.19초 이하였고, 이런 조각은 말이 바뀌는 순간 두 확률이
 * 잠깐 같이 높은 번짐이다. 맞장구 한 음절("네")이 0.3~0.5초라 그보다 짧은 겹침은 사람이 다시 들을 까닭이 없다.
 * (이전 기준 "발화 안 겹침 합 0.2초 이상"은 긴 발화일수록 번짐이 쌓여 발화 약 30%가 겹침으로 잡혔다.)
 */
export const OVERLAP_MIN = 0.3

export function overlapRuns(a: Activity, minLen = OVERLAP_MIN): [number, number][] {
  const n = a.p[0].length
  const runs: [number, number][] = []
  let s = -1
  for (let t = 0; t <= n; t++) {
    const on = t < n && a.p[0][t] > ACTIVE && a.p[1][t] > ACTIVE
    if (on && s < 0) s = t
    else if (!on && s >= 0) {
      if ((t - s) / FPS >= minLen) runs.push([s / FPS, t / FPS])
      s = -1
    }
  }
  return runs
}

/** [from, to]와 걸치는 겹침 구간이 있는지(runs는 시각순). */
function hitsRun(runs: [number, number][], from: number, to: number): boolean {
  let lo = 0, hi = runs.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (runs[mid][1] <= from) lo = mid + 1
    else hi = mid
  }
  return lo < runs.length && runs[lo][0] < to
}

/**
 * 단어(화자 배정됨) → 발화. 화자가 바뀌거나 무음이 silenceMin 이상이면 새 발화.
 * swap: 사용자가 맞바꾼 상태(이어 하기)면 speaker = 1 - modelSpeaker.
 */
export function buildUtterances(words: AsrWord[], a: Activity, settings: TranscriptSettings, swap = false): Utterance[] {
  const sorted = [...words].sort((x, y) => x.start - y.start).map((w) => ({ ...w, end: trimEnd(a, w.speaker, w.start, w.end) }))
  const runs = overlapRuns(a)
  const groups: AsrWord[][] = []
  for (const w of sorted) {
    const g = groups.at(-1)
    const prev = g?.at(-1)
    if (g && prev && prev.speaker === w.speaker && longestSilence(a, prev.end, w.start) < settings.silenceMin) g.push(w)
    else groups.push([w])
  }
  return groups.map((g) => {
    const m = g[0].speaker
    const start = g[0].start
    const end = Math.max(...g.map((w) => w.end))
    const confs = g.map((w) => w.confidence).filter((c): c is number => c != null)
    const u: Utterance = {
      id: `u${Math.round(start * 1000)}s${m}`,
      speaker: (swap ? 1 - m : m) as SpeakerId,
      modelSpeaker: m,
      start: round2(start),
      end: round2(end),
      text: g.map((w) => w.text).join('').replace(/\s+/g, ' ').trim(),
      words: g.map(({ text, start, end, confidence }) => {
        const w: Word = { text: text.trim(), start: round2(start), end: round2(end), confidence }
        if (hitsRun(runs, start - 0.1, end + 0.1)) w.overlap = true
        return w
      }),
      review: 'draft',
    }
    if (confs.length) u.confidence = round2(confs.reduce((x, y) => x + y, 0) / confs.length)
    if (hitsRun(runs, start, end)) {
      u.overlap = true
      // 겹침이 단어 사이 쉼에 걸렸으면 가장 가까운 단어에 표시(화면은 단어에 밑줄을 긋는다)
      const ws = u.words!
      if (!ws.some((w) => w.overlap)) {
        const r = runs.find(([x, y]) => x < end && y > start)!
        const mid = (r[0] + r[1]) / 2
        ws.reduce((best, w) => (Math.abs((w.start + w.end) / 2 - mid) < Math.abs((best.start + best.end) / 2 - mid) ? w : best)).overlap = true
      }
    }
    return u
  })
}

/** 맞장구 한 마디(음, 네, 응…)만으로 된 글 */
const BACKCHANNEL = /^(?:(?:음+|으음|네+|응+|예|아+|어+|오+|흠)[.,?!]*\s*)+$/

/**
 * 말하던 사람의 말이 상대 줄로 떨어진 것 되돌리기.
 * 상대가 "음" 하며 겹치면 화자 나누기가 말하던 사람의 낱말 몇 개(…했 / 습니다)를 상대에게 준다.
 * A · 상대의 짧은 줄 · A 이고, 짧은 줄이 앞 A에 바로 붙어 있고(사이 0.05초 미만) 앞 A가 문장부호(. ? !) 없이 끊겼으면
 * 그 낱말을 앞 A 끝에 돌려준다. 두 A는 그대로 두 줄 — 골드도 그 자리에서 줄을 나눈다.
 * 맞장구 한 마디뿐인 줄, 앞 A가 끝난 문장인 줄, 뒤 A에만 붙은 줄은 진짜 상대의 짧은 대답이라 그대로 둔다.
 * ponytail: 골드 3개(짧은 줄 20곳)에서 조건을 좁히기 전 맞게 12 / 잘못 8 → 좁힌 뒤 맞게 9 / 잘못 2(2026-09-26). 골드가 늘면 다시 잰다.
 */
export function giveBackTails(utts: Utterance[]): Utterance[] {
  const out = [...utts]
  for (let i = 1; i < out.length - 1; i++) {
    const [a, b, c] = [out[i - 1], out[i], out[i + 1]]
    if (a.speaker !== c.speaker || b.speaker === a.speaker) continue
    if (b.text.split(/\s+/).length > 3 || b.end - b.start > 2 || BACKCHANNEL.test(b.text.trim())) continue
    if (b.start - a.end >= 0.05 || /[.?!]$/.test(a.text.trim())) continue
    const words = [...(a.words ?? []), ...(b.words ?? [])]
    const confs = words.map((w) => w.confidence).filter((v): v is number => v != null)
    const joined: Utterance = {
      ...a,
      end: Math.max(a.end, b.end),
      text: `${a.text} ${b.text}`.replace(/\s+/g, ' ').trim(),
      words,
      overlap: a.overlap || b.overlap || undefined,
    }
    if (confs.length) joined.confidence = round2(confs.reduce((v, w) => v + w, 0) / confs.length)
    out.splice(i - 1, 3, joined, c)
  }
  return out
}

/**
 * 이어 하기 이음매: 멈춘 자리에서 한 사람의 말이 이어졌으면(같은 화자, 사이 무음 < silenceMin)
 * 이미 있던 마지막 문장과 새 첫 문장을 한 문장으로 — 한 번에 끝까지 했을 때와 같게.
 */
export function joinSeam(kept: Utterance[], fresh: Utterance[], a: Activity, settings: TranscriptSettings): Utterance[] {
  const last = kept.at(-1), first = fresh[0]
  if (!last || !first || last.modelSpeaker !== first.modelSpeaker || longestSilence(a, last.end, first.start) >= settings.silenceMin) return [...kept, ...fresh]
  const words = [...(last.words ?? []), ...(first.words ?? [])]
  const confs = words.map((w) => w.confidence).filter((c): c is number => c != null)
  const joined: Utterance = {
    ...last,
    end: Math.max(last.end, first.end),
    text: `${last.text} ${first.text}`.trim(),
    words,
    overlap: last.overlap || first.overlap || undefined,
  }
  if (confs.length) joined.confidence = round2(confs.reduce((x, y) => x + y, 0) / confs.length)
  return [...kept.slice(0, -1), joined, ...fresh.slice(1)]
}

/** 앞 발화와의 사이 무음이 silenceMin 이상이면 본문 앞에 (침묵 N초). prev = 이미 있는 앞 발화(이어 하기). */
export function addSilenceMarks(utts: Utterance[], a: Activity, settings: TranscriptSettings, prev?: Utterance): Utterance[] {
  let last = prev
  return utts.map((u) => {
    const gap = last ? longestSilence(a, last.end, u.start) : 0
    last = u
    return gap >= settings.silenceMin ? { ...u, text: `${silenceText(gap, settings.silenceFormat)} ${u.text}` } : u
  })
}

const round2 = (x: number) => Math.round(x * 100) / 100
