// 개발용 가짜 엔진. fixtures/demo-gold.json(가상 상담 정답)을 "초벌"처럼 흐트러뜨려
// 진행률·onPartial을 흉내 낸다. 실제 엔진(src/engine/index.ts)과 같은 Engine 계약.
//
// 주소 뒤 ?mock=… 로 상황을 만들 수 있다(화면 확인용):
//   long      발화 612개(성능 확인)       unsupported  안 되는 브라우저
//   slow      느린 컴퓨터                  nospace      저장 공간 부족
//   network   모델 받다가 끊김             stall        받아 적다가 멈춤
//   badfile   열 수 없는 파일              fresh        모델을 처음 받는 것처럼
import goldRaw from '../../fixtures/demo-gold.json?raw'
import type { NonverbalSuggestion, Transcript, TranscriptSettings, Utterance, Word } from '../types'
import type { Engine, Progress, Support } from './api'
import { silenceText } from '../labels'

const MODE = new URLSearchParams(location.search).get('mock') ?? ''
const READY_KEY = 'tb-mock-models'
const MB = 1024 * 1024

// 결정적인 난수(매번 같은 초벌)
function rng(seed: number) {
  return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32)
}

const TYPOS: [string, string][] = [
  ['했어요', '햇어요'],
  ['검사', '겁사'],
  ['솔직히', '솔찍히'],
  ['많으셨죠', '만으셨죠'],
  ['그러셨구나', '그러셨군아'],
]

function roughen(gold: Transcript, settings: TranscriptSettings): Transcript {
  const r = rng(7)
  const utterances = gold.utterances.map((g, i): Utterance => {
    let text = g.text
    const suggestions: NonverbalSuggestion[] = []
    // 간투사 일부 빠뜨리기
    if (r() < 0.35) text = text.replace(/(^|\s)(음|어|그)\.\.\s?/, '$1').trim()
    // 오타 몇 개
    const typo = TYPOS[i % TYPOS.length]
    if (i % 3 === 1 && text.includes(typo[0])) text = text.replace(typo[0], typo[1])
    // (웃음)은 본문에서 빼고 제안으로. 정답에 없어도 화면 확인용으로 몇 곳에 제안을 붙인다.
    if (text.includes('(웃음)') || i % 8 === 7) {
      text = text.replace(/\s?\(웃음\)/, '').trim()
      suggestions.push({ id: `n${i}`, label: i % 16 === 15 ? '한숨' : '웃음', at: g.end - 0.3, confidence: 0.72 })
    }
    // 앞 발화와 3초 넘게 비면 침묵 표기(실제 간격 그대로)
    const gap = i ? g.start - gold.utterances[i - 1].end : 0
    if (gap >= settings.silenceMin) text = `${silenceText(gap, settings.silenceFormat)} ${text}`
    const low = r() < 0.18
    const confidence = low ? 0.45 + r() * 0.2 : 0.86 + r() * 0.12
    const overlap = /\((네|음|응)\)/.test(text) || r() < 0.06
    // 단어 시각: 글자 수 비율로 나눠 흉내
    const toks = text.split(/\s+/).filter(Boolean)
    const total = toks.reduce((n, w) => n + w.length, 0) || 1
    let at = g.start
    const words: Word[] = toks.map((w) => {
      const d = ((g.end - g.start) * w.length) / total
      const word: Word = { text: w, start: at, end: at + d, confidence: low && r() < 0.4 ? 0.3 + r() * 0.2 : 0.8 + r() * 0.19 }
      if (overlap && /^\((네|음|응)\)/.test(w)) word.overlap = true
      at += d
      return word
    })
    return {
      id: g.id,
      speaker: g.speaker,
      modelSpeaker: g.speaker,
      start: g.start,
      end: g.end,
      text,
      words,
      confidence,
      overlap: overlap || undefined,
      review: 'draft',
      suggestions: suggestions.length ? suggestions : undefined,
    }
  })
  // 겹침 표시가 있는데 맞장구 괄호가 없는 문장은 마지막 단어에 겹침 표시(실제 엔진처럼 단어 단위)
  for (const u of utterances) if (u.overlap && u.words?.length && !u.words.some((w) => w.overlap)) u.words[u.words.length - 1].overlap = true
  return { ...gold, speakers: { roles: [null, null] }, sections: [], utterances, settings }
}

/** 성능 확인용: 612개가 될 때까지 되풀이 */
function lengthen(t: Transcript, n = 612): Transcript {
  const out: Utterance[] = []
  const d = t.audio.duration
  for (let k = 0; out.length < n; k++)
    for (const u of t.utterances) {
      if (out.length >= n) break
      const shift = <T extends { start: number; end: number }>(w: T): T => ({ ...w, start: w.start + k * d, end: w.end + k * d })
      out.push({ ...shift(u), id: `${u.id}-${k}`, words: u.words?.map(shift), suggestions: u.suggestions?.map((s) => ({ ...s, id: `${s.id}-${k}`, at: s.at + k * d })) })
    }
  const duration = out[out.length - 1].end + 1
  return { ...t, utterances: out, audio: { ...t.audio, duration } }
}

function draft(meta: { fileName: string; mime: string }, settings?: TranscriptSettings): Transcript {
  const gold = JSON.parse(goldRaw) as Transcript
  let t = roughen(gold, settings ?? gold.settings)
  if (MODE === 'long') t = lengthen(t)
  const now = new Date().toISOString()
  return {
    ...t,
    id: crypto.randomUUID(),
    title: meta.fileName.replace(/\.[^.]+$/, ''),
    createdAt: now,
    updatedAt: now,
    audio: { ...t.audio, fileName: meta.fileName, mime: meta.mime },
    model: { asr: 'mock', diarization: 'mock', vad: 'mock', app: 'dev' },
    processing: { status: 'running', processedUntil: 0 },
  }
}

const isChromium = () => {
  const brands = (navigator as unknown as { userAgentData?: { brands: { brand: string }[] } }).userAgentData?.brands ?? []
  return brands.some((b) => /Chromium|Google Chrome|Microsoft Edge/.test(b.brand))
}

const ready = () => MODE !== 'fresh' && localStorage.getItem(READY_KEY) === '1'
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

export const engine: Engine = {
  async checkSupport(): Promise<Support> {
    const est = await navigator.storage?.estimate?.().catch(() => undefined)
    const free = est?.quota !== undefined ? est.quota - (est.usage ?? 0) : undefined
    const chromium = MODE !== 'unsupported' && isChromium()
    const slow = MODE === 'slow'
    return {
      ok: chromium,
      reason: !chromium ? 'not-chromium' : slow ? 'no-webgpu-slow' : undefined,
      webgpu: !slow && 'gpu' in navigator,
      fp16: false,
      storageNeeded: 1.5 * 1024 * MB,
      storageFree: MODE === 'nospace' ? 600 * MB : free,
      downloadBytes: ready() ? 0 : 700 * MB,
      modelsReady: ready(),
    }
  },

  async prepareModels(onProgress) {
    if (ready()) return
    const total = 700 * MB
    for (let i = 1; i <= 40; i++) {
      await wait(120)
      if (MODE === 'network' && i === 16) throw { code: 'network', message: 'mock network' }
      const p: Progress = { stage: 'download', ratio: i / 40, downloadedBytes: (total * i) / 40, totalBytes: total, etaSec: (40 - i) * 0.12 }
      onProgress(p)
    }
    try {
      localStorage.setItem(READY_KEY, '1')
    } catch {
      /* 개발용 */
    }
  },

  transcribe(_audio, meta, cb, opts) {
    let stopped = false
    const full = draft(meta, opts?.settings ?? opts?.resume?.settings)
    const totalSec = full.audio.duration
    const from = opts?.resume?.processing.processedUntil ?? 0
    const kept = opts?.resume?.utterances.filter((u) => u.end <= from) ?? []
    const rest = full.utterances.filter((u) => u.end > from)
    const step = MODE === 'long' ? 8 : 1

    ;(async () => {
      if (MODE === 'badfile') return cb.onError({ code: 'bad-file', message: 'mock bad file' })
      for (const stage of ['decode', 'diarize'] as const) {
        for (let i = 1; i <= 5; i++) {
          await wait(90)
          if (stopped) return
          cb.onProgress({ stage, ratio: i / 5, totalSec })
        }
      }
      const done = [...kept]
      for (let i = 0; i < rest.length; i += step) {
        await wait(160)
        if (stopped) return
        done.push(...rest.slice(i, i + step))
        const until = done[done.length - 1].end
        if (MODE === 'stall' && i >= rest.length / 2) return cb.onError({ code: 'unknown', message: 'mock stall' })
        cb.onProgress({ stage: 'transcribe', ratio: until / totalSec, processedSec: until, totalSec, etaSec: ((rest.length - i) / step) * 0.16 })
        cb.onPartial({ ...full, utterances: [...done], processing: { status: 'running', processedUntil: until } })
      }
      cb.onProgress({ stage: 'finish', ratio: 1, processedSec: totalSec, totalSec })
      cb.onDone({ ...full, utterances: done, processing: { status: 'done', processedUntil: totalSec } })
    })()

    return { cancel: () => void (stopped = true) }
  },
}
