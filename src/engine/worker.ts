// 초벌 엔진 Web Worker: 디코딩 → 화자분리(Nemotron, 말소리 구간도 여기서) → 음성인식(Whisper) → 발화 조립.
// 녹음은 이 워커 밖으로 나가지 않는다. 모델 파일은 캐시에서만 읽는다(처리 중 네트워크 요청 없음).
import { env } from '@huggingface/transformers'
import ortWasm from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url'
import ortMjs from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url'
import { FORMAT_VERSION, DEFAULT_SETTINGS, type SpeakerId, type Transcript, type TranscriptSettings, type Utterance } from '../types'
import type { EngineError, Progress, Stage } from './api'
import { addSilenceMarks, asrWindows, buildUtterances, giveBackTails, joinSeam, mergeChannels, speakerMap, speakerTurns, speechRuns, wordSpeaker, type Activity, type AsrWord } from './assemble'
import { loadAsr, transcribeClip } from './asr'
import { BadFile, decodeToMono16k, SR } from './decode'
import { ASR_MODEL, ASR_REVISION, CACHE_NAME, DIAR_DTYPE, DIAR_MODEL, asrDtype, pickDevice, type Device } from './models'
import { diarize, loadDiarizer } from './nemotron/diarize'
import { version as APP_VERSION } from '../../package.json'

export type AsrInput = 'window' | 'turn'

export type ToWorker =
  | { type: 'transcribe'; audio: Blob; meta: { fileName: string; mime: string }; resume?: Transcript; settings?: TranscriptSettings; dev?: { device?: Device; asrInput?: AsrInput; diarOnly?: boolean; winSec?: number; prompt?: string } }
export type FromWorker =
  | { type: 'progress'; p: Progress }
  | { type: 'partial'; t: Transcript }
  | { type: 'done'; t: Transcript }
  | { type: 'error'; e: EngineError }
  | { type: 'log'; msg: string }
  | { type: 'debug'; probs: Float32Array }

const post = (m: FromWorker) => (self as unknown as Worker).postMessage(m)
const log = (msg: string) => post({ type: 'log', msg })

env.allowLocalModels = false
// CPU 일꾼 수: 기본(코어 절반, 최대 4)보다 늘리되 화면·다른 프로그램 몫으로 2개 남김. M4(10코어)에서 4 → 8개로 CPU 받아 적기 약 12% 빨라짐
env.backends.onnx.wasm!.numThreads = Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 2) - 2))
env.backends.onnx.wasm!.wasmPaths = { wasm: new URL(ortWasm, self.location.href).href, mjs: new URL(ortMjs, self.location.href).href }
// 모델은 캐시에만 있다. 캐시에 없는 파일을 찾으면 인터넷에 가지 않고 "없음"으로 답한다(선택 파일은 없어도 됨).
env.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, self.location.href)
  if (url.origin === self.location.origin) return fetch(input, init)
  // transformers.js 4.3.0의 토크나이저 파일 확인(get_file_metadata)은 revision을 무시하고 main을 묻는다 → 고정 revision 캐시로 답한다
  const pinned = url.href.replace(`${ASR_MODEL}/resolve/main/`, `${ASR_MODEL}/resolve/${ASR_REVISION}/`)
  const hit = pinned !== url.href && (await (await caches.open(CACHE_NAME)).match(pinned))
  if (hit) return hit
  log(`cache miss (not fetched): ${url.pathname}`)
  return new Response(null, { status: 404, statusText: 'not in cache' })
}

self.onmessage = async (ev: MessageEvent<ToWorker>) => {
  const m = ev.data
  if (m.type !== 'transcribe') return
  try {
    await run(m)
  } catch (e) {
    post({ type: 'error', e: toEngineError(e) })
  }
}

function toEngineError(e: unknown): EngineError {
  const msg = String((e as Error)?.stack ?? e)
  if (e instanceof BadFile) return { code: 'bad-file', message: msg }
  // RangeError라도 배열 범위 초과 같은 버그는 메모리 부족이 아니다: 메모리 쪽 문구가 있을 때만
  if (/out of memory|alloc|\bOOM\b|Invalid typed array length|Array buffer/i.test(msg)) return { code: 'out-of-memory', message: msg }
  if (/not in cache|could not locate file|file was not found/i.test(msg)) return { code: 'network', message: `model files missing: ${msg}` }
  return { code: 'unknown', message: msg }
}

async function run({ audio, meta, resume, settings: wanted, dev }: Extract<ToWorker, { type: 'transcribe' }>) {
  let device = dev?.device ?? (await pickDevice())
  // fp16 없는 GPU에서 모델을 못 올리면(드라이버·메모리) 같은 q4 파일로 CPU에서: 느려도 끝까지 간다
  const load = async <T>(f: (d: Device) => Promise<T>): Promise<T> => {
    try { return await f(device) } catch (e) {
      if (device !== 'webgpu-f32') throw e
      log(`webgpu-f32 load failed, falling back to wasm: ${String(e).slice(0, 200)}`)
      device = 'wasm'
      return f(device)
    }
  }
  const asrInput = dev?.asrInput ?? 'window'
  const t0 = performance.now()
  const progress = (stage: Stage, ratio: number, extra: Partial<Progress> = {}) => post({ type: 'progress', p: { stage, ratio: Math.min(1, ratio), ...extra } })

  // 1. 디코딩
  progress('decode', 0)
  const pcm = await decodeToMono16k(audio, (s, d) => progress('decode', s / d))
  const duration = pcm.length / SR
  log(`decoded ${duration.toFixed(1)}s in ${((performance.now() - t0) / 1000).toFixed(1)}s, device=${device}`)

  // 2. 화자분리 (전체를 다시 돌린다: 30초당 수십 ms라 이어 하기에서도 싸고, 화자 번호가 처음 실행과 같아진다)
  progress('diarize', 0, { totalSec: duration })
  const diarModel = await load(loadDiarizer)
  const d = await diarize(diarModel, pcm, (s) => progress('diarize', s / duration, { processedSec: s, totalSec: duration }))
  await diarModel.dispose()
  const activeSec = Array.from({ length: d.channels }, (_, c) => {
    let k = 0
    for (let t = c; t < d.probs.length; t += d.channels) if (d.probs[t] > 0.5) k++
    return k / 100
  })
  if (dev?.diarOnly) return post({ type: 'debug', probs: d.probs })
  const map = speakerMap(activeSec, d.meanEmb)
  const act: Activity = mergeChannels(d.probs, d.channels, map)
  log(`diarized in ${((performance.now() - t0) / 1000).toFixed(1)}s; channel sec ${activeSec.map((s) => s.toFixed(0)).join(',')} -> map ${map.join('')}`)

  // 3. 음성인식 구간
  const settings = wanted ?? resume?.settings ?? DEFAULT_SETTINGS
  const from = resume?.processing.processedUntil ?? 0
  const kept: Utterance[] = resume ? resume.utterances.filter((u) => u.start < from) : []
  const swap = resume ? isSwapped(resume.utterances) : false
  type Clip = { start: number; end: number; speaker?: SpeakerId }
  const clips: Clip[] = (asrInput === 'window'
    ? asrWindows(act, speechRuns(act), dev?.winSec).map(([start, end]) => ({ start, end }))
    : speakerTurns(act).flatMap((t) => splitClip({ ...t, start: Math.max(0, t.start - 0.15), end: Math.min(duration, t.end + 0.15) }, 28))
  // 이어 하기: 멈춘 곳(소수 둘째 자리로 저장) 뒤만. 반올림 오차로 남는 수 ms 조각은 버린다 — Whisper가 빈 소리에서 "음.."을 지어낸다
  ).filter((c) => c.end - Math.max(c.start, from) >= 0.3).map((c) => ({ ...c, start: Math.max(c.start, from) }))

  const base: Transcript = resume
    ? structuredClone(resume)
    : {
        formatVersion: FORMAT_VERSION,
        id: crypto.randomUUID(),
        title: meta.fileName.replace(/\.[^.]+$/, ''),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        audio: { fileName: meta.fileName, mime: meta.mime, duration },
        speakers: { roles: [null, null] },
        utterances: [],
        sections: [],
        model: { asr: '', diarization: '', vad: '', app: '' },
        processing: { status: 'running', processedUntil: 0 },
        settings,
      }
  base.audio.duration = duration
  base.settings = settings
  base.model = {
    asr: `${ASR_MODEL} ${asrDtype(device)} ${device} (${asrInput})`,
    diarization: `${DIAR_MODEL} ${DIAR_DTYPE} ${device}`,
    vad: 'nemotron speaker activity',
    app: `transbee ${APP_VERSION}`,
  }

  const snapshot = (words: AsrWord[], until: number, status: Transcript['processing']['status']): Transcript => {
    const fresh = addSilenceMarks(giveBackTails(buildUtterances(words, act, settings, swap)), act, settings, kept.at(-1))
    return { ...base, updatedAt: new Date().toISOString(), utterances: joinSeam(kept, fresh, act, settings), processing: { status, processedUntil: round2(until) } }
  }

  // 4. 받아 적기
  progress('transcribe', 0, { processedSec: from, totalSec: duration })
  const asr = await load((d) => loadAsr(d, dev?.prompt))
  base.model.asr = `${ASR_MODEL} ${asrDtype(device)} ${device} (${asrInput})` // 위에서 CPU로 바꿨을 수 있다
  log(`asr loaded at ${((performance.now() - t0) / 1000).toFixed(1)}s`)
  const words: AsrWord[] = []
  const tAsr = performance.now()
  // 진행 막대는 녹음 전체 기준(이어 하기면 이미 받아 적은 말소리부터): 화면의 "40분 중 20분까지"와 맞게
  const speechBefore = kept.reduce((s, u) => s + u.end - u.start, 0)
  const speechTotal = clips.reduce((s, c) => s + c.end - c.start, 0)
  let speechDone = 0
  for (const c of clips) {
    const ws = await transcribeClip(asr, pcm.subarray(Math.floor(c.start * SR), Math.ceil(c.end * SR)), c.start)
    for (const w of ws) words.push({ ...w, speaker: c.speaker ?? wordSpeaker(act, w.start, w.end) })
    speechDone += c.end - c.start
    const rate = (performance.now() - tAsr) / 1000 / speechDone
    progress('transcribe', (speechBefore + speechDone) / (speechBefore + speechTotal), { processedSec: c.end, totalSec: duration, etaSec: Math.round(rate * (speechTotal - speechDone)) })
    post({ type: 'partial', t: snapshot(words, c.end, 'running') })
  }
  await asr.model.dispose()

  progress('finish', 1, { processedSec: duration, totalSec: duration })
  post({ type: 'done', t: snapshot(words, duration, 'done') })
  log(`done in ${((performance.now() - t0) / 1000).toFixed(1)}s, clips=${clips.length}, words=${words.length}`)
}

/** 이어 하기: 사용자가 화자를 맞바꿨는지(발화 다수가 speaker ≠ modelSpeaker) */
function isSwapped(utts: Utterance[]): boolean {
  const known = utts.filter((u) => u.modelSpeaker === 0 || u.modelSpeaker === 1)
  return known.filter((u) => u.speaker !== u.modelSpeaker).length > known.length / 2
}

function splitClip<T extends { start: number; end: number }>(c: T, max: number): T[] {
  const n = Math.ceil((c.end - c.start) / max)
  const len = (c.end - c.start) / n
  return Array.from({ length: n }, (_, i) => ({ ...c, start: c.start + i * len, end: c.start + (i + 1) * len }))
}

const round2 = (x: number) => Math.round(x * 100) / 100
