// engine-dev.html: 파일을 넣어 엔진을 돌리고 JSON·단계별 시간을 보여준다. scripts/eval-engine.mjs가 window.__run을 부른다.
import type { Transcript } from '../types'
import type { Progress } from './api'
import { createEngine } from './index'
import type { Device } from './models'
import type { AsrInput } from './worker'

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const logEl = $('log'), outEl = $('out')
const log = (s: string) => { logEl.textContent += `${s}\n`; console.log(s) }

interface RunResult { transcript?: Transcript; error?: unknown; stageSec: Record<string, number>; totalSec: number; partials: number; logs: string[]; support?: unknown }
declare global { interface Window { __run: typeof run; __prepare: typeof prepare; __diar: typeof diar; __result?: RunResult } }

let cancel: (() => void) | null = null

async function prepare(device?: Device) {
  const engine = createEngine({ device })
  let last = 0
  const t = performance.now()
  await engine.prepareModels((p: Progress) => {
    if (p.ratio - last > 0.05 || p.ratio === 1) { last = p.ratio; log(`download ${(p.ratio * 100).toFixed(0)}% ${((p.downloadedBytes ?? 0) / 2 ** 20).toFixed(0)}MB`) }
  })
  const support = await engine.checkSupport()
  log(`prepared in ${((performance.now() - t) / 1000).toFixed(1)}s; support ${JSON.stringify(support)}`)
  return support
}

function run(file: File, opts: { asrInput?: AsrInput; device?: Device; winSec?: number; prompt?: string; resume?: Transcript; stopAfterPartials?: number } = {}): Promise<RunResult> {
  const logs: string[] = []
  const engine = createEngine({ ...opts, onLog: (m) => { logs.push(m); log(m) } })
  const res: RunResult = { stageSec: {}, totalSec: 0, partials: 0, logs }
  const t0 = performance.now()
  let stage = '', stageStart = t0, lastLog = 0
  const mark = (next: string) => {
    const now = performance.now()
    if (stage) res.stageSec[stage] = (res.stageSec[stage] ?? 0) + (now - stageStart) / 1000
    stage = next; stageStart = now
  }
  return new Promise((resolve) => {
    const finish = () => { mark(''); res.totalSec = (performance.now() - t0) / 1000; window.__result = res; cancel = null; resolve(res) }
    cancel = engine.transcribe(file, { fileName: file.name, mime: file.type }, {
      onProgress(p) {
        if (p.stage !== stage) mark(p.stage)
        if (performance.now() - lastLog > 5000) { lastLog = performance.now(); log(`${p.stage} ${(p.ratio * 100).toFixed(0)}% ${p.processedSec?.toFixed(0) ?? ''}/${p.totalSec?.toFixed(0) ?? ''}s eta ${p.etaSec ?? '-'}s`) }
      },
      onPartial(t) { res.partials++; res.transcript = t; if (res.partials === opts.stopAfterPartials) { cancel?.(); finish() } },
      onDone(t) { res.transcript = t; outEl.textContent = JSON.stringify(t, null, 1); finish() },
      onError(e) { res.error = e; log(`ERROR ${e.code}: ${e.message}`); finish() },
    }, { resume: opts.resume }).cancel
  })
}

/** 화자분리 확률만(프레임 × 8) — 스파이크 결과와 비교용 */
function diar(file: File, device?: Device): Promise<number[]> {
  return new Promise((resolve, reject) => {
    createEngine({ device, onLog: log, onDebug: (p) => resolve(Array.from(p)) })
      .transcribe(file, { fileName: file.name, mime: file.type }, { onProgress() {}, onPartial() {}, onDone() {}, onError: reject })
  })
}

window.__run = run
window.__diar = diar
window.__prepare = prepare
$('prepare').onclick = () => prepare(($('device') as HTMLSelectElement).value as Device || undefined).catch((e) => log(`ERROR ${JSON.stringify(e)}`))
$('run').onclick = () => {
  const f = ($('file') as HTMLInputElement).files?.[0]
  if (!f) return log('파일을 고르세요')
  run(f, { asrInput: ($('asrInput') as HTMLSelectElement).value as AsrInput, device: (($('device') as HTMLSelectElement).value as Device) || undefined })
    .then((r) => log(`done: ${r.totalSec.toFixed(1)}s ${JSON.stringify(r.stageSec)}`))
}
$('cancel').onclick = () => cancel?.()
