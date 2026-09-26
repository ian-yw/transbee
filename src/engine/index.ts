// 초벌 엔진 클라이언트(메인 스레드). 무거운 처리는 전부 worker.ts에서 한다.
import type { Engine, EngineError, Progress, Support, TranscribeCallbacks } from './api'
import { downloadModels, EngineFailure, hasOldModels, missingFiles, pickDevice, type Device } from './models'
import type { AsrInput, FromWorker, ToWorker } from './worker'

export type { Engine } from './api'


/** 컴퓨터의 Chrome·Edge만. 안드로이드 Chrome은 메모리(3~4GB)·폴더 저장·키보드 편집이 안 돼 막는다 */
function isChromeOrEdge(): boolean {
  const ua = (navigator as Navigator & { userAgentData?: { brands: { brand: string }[]; mobile: boolean } }).userAgentData
  return !ua?.mobile && (ua?.brands ?? []).some((b) => /^(Google Chrome|Microsoft Edge|HeadlessChrome)$/.test(b.brand))
}

const asEngineError = (e: unknown): EngineError =>
  e instanceof EngineFailure ? { code: e.code, message: e.message } : { code: 'unknown', message: String((e as Error)?.message ?? e) }

/** dev: 개발 검증용(engine-dev.html). 제품 화면은 기본값만 쓴다. */
export function createEngine(dev: { device?: Device; asrInput?: AsrInput; winSec?: number; prompt?: string; onLog?: (msg: string) => void; onDebug?: (probs: Float32Array) => void } = {}): Engine {
  const device = async (): Promise<Device> => dev.device ?? (await pickDevice())
  // 준비 화면을 나갔다 다시 와도 받기는 하나만: 진행 중이면 그 받기에 붙고, 진행 표시는 마지막으로 부른 화면으로
  let preparing: Promise<void> | undefined
  let onPrep: (p: Progress) => void = () => {}
  return {
    async checkSupport(): Promise<Support> {
      const dv = await device()
      const missing = await missingFiles(dv)
      const est = await navigator.storage?.estimate?.().catch(() => undefined)
      const chromium = isChromeOrEdge()
      const storageNeeded = missing.reduce((s, f) => s + f.size, 0)
      const storageFree = est?.quota != null && est.usage != null ? est.quota - est.usage : undefined
      return {
        ok: chromium && (storageFree == null || storageFree >= storageNeeded),
        reason: !chromium ? 'not-chromium' : dv === 'wasm' ? 'no-webgpu-slow' : !('showDirectoryPicker' in window) ? 'no-file-system-access' : undefined,
        webgpu: dv !== 'wasm',
        fp16: dv === 'webgpu',
        storageNeeded,
        storageFree,
        downloadBytes: storageNeeded,
        modelsReady: missing.length === 0,
        updating: missing.length > 0 && (await hasOldModels().catch(() => false)),
      }
    },

    prepareModels(onProgress) {
      onPrep = onProgress
      preparing ??= (async () => {
        // 브라우저가 공간이 부족할 때 모델 캐시를 지우지 않도록 요청(거절돼도 진행)
        await navigator.storage?.persist?.().catch(() => false)
        try {
          await downloadModels(await device(), (p) => onPrep(p))
        } catch (e) {
          throw asEngineError(e)
        }
      })().finally(() => (preparing = undefined))
      return preparing
    },

    transcribe(audio, meta, cb: TranscribeCallbacks, opts) {
      const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
      let finished = false
      const end = () => { finished = true; worker.terminate() }
      worker.onmessage = (ev: MessageEvent<FromWorker>) => {
        const m = ev.data
        if (finished) return
        if (m.type === 'progress') cb.onProgress(m.p)
        else if (m.type === 'partial') cb.onPartial(m.t)
        else if (m.type === 'done') { end(); cb.onDone(m.t) }
        else if (m.type === 'error') { end(); cb.onError(m.e) }
        else if (m.type === 'log') dev.onLog?.(m.msg)
        else if (m.type === 'debug') { end(); dev.onDebug?.(m.probs) }
      }
      worker.onerror = (ev) => { if (!finished) { end(); cb.onError({ code: 'unknown', message: ev.message || 'worker crashed' }) } }
      const msg: ToWorker = { type: 'transcribe', audio, meta, resume: opts?.resume, settings: opts?.settings, dev: { device: dev.device, asrInput: dev.asrInput, diarOnly: !!dev.onDebug, winSec: dev.winSec, prompt: dev.prompt } }
      worker.postMessage(msg)
      // 멈추기 = 워커 종료(GPU 메모리도 바로 돌려준다). 마지막 onPartial의 processing.processedUntil부터 이어 하면 된다.
      return { cancel: end }
    },
  }
}

export const engine: Engine = createEngine()
