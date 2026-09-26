// 모델 파일 목록과 받기·보관. 브라우저 Cache Storage('transformers-cache')에
// transformers.js가 찾는 것과 같은 주소(키)로 넣어 두면, 두 번째부터는 인터넷 없이 불러온다.
import type { Progress } from './api'

const HF = 'https://huggingface.co'
export const CACHE_NAME = 'transformers-cache'

/**
 * onnx-community/whisper-large-v3-turbo_timestamped(b3f77bf) 가중치를 .onnx_data로 따로 뺀 판(값은 같다).
 * 한 파일짜리는 가중치가 WASM 힙을 거쳐 GPU로 가서 힙이 약 1.2GB로 커진 채 남는다. 따로 두면 GPU로 바로 가서 약 0.4GB(2026-09-26, M4).
 */
export const ASR_MODEL = 'Youngwon/whisper-large-v3-turbo_timestamped-external-data'
export const ASR_REVISION = '71bf86550e3656be1a30385b342a8ba3b45c910a'
export const DIAR_MODEL = 'onnx-community/Nemotron-3-Diarization-ONNX'
export const DIAR_REVISION = '353b6f8ad2cac3580e982d7fbdf0a010786b0406'
export const DIAR_DTYPE = 'q8'

/** webgpu = GPU + fp16 연산(shader-f16), webgpu-f32 = GPU지만 fp16이 없음, wasm = GPU 없이 CPU */
export type Device = 'webgpu' | 'webgpu-f32' | 'wasm'

/**
 * 장치 고르기(메인 화면·워커가 같은 답을 내도록 여기 한 곳에서). q4f16 모델은 GPU의 fp16 연산(shader-f16)이 있어야 돈다:
 * 없는 GPU(오래된 내장 그래픽 등)는 fp32 연산 모델(q4)을 GPU로. 소프트웨어 GPU(fallback adapter)는 CPU보다 느려 WASM으로.
 */
export async function pickDevice(): Promise<Device> {
  const a = typeof navigator !== 'undefined' && navigator.gpu ? await navigator.gpu.requestAdapter().catch(() => null) : null
  if (!a || (a as { info?: { isFallbackAdapter?: boolean } }).info?.isFallbackAdapter) return 'wasm'
  return a.features.has('shader-f16') ? 'webgpu' : 'webgpu-f32'
}
/** onnxruntime에 넘기는 실행 장치 */
export const ortDevice = (d: Device) => (d === 'wasm' ? 'wasm' : 'webgpu')
/** fp16 되는 GPU는 q4f16(약 564MB). 나머지는 fp32 연산 q4. */
export const asrDtype = (d: Device) => (d === 'webgpu' ? 'q4f16' : 'q4')

/** 화면의 "transbee 정보"에 보이는 모델 안내. 모델을 바꾸면(아래 이름·revision) 여기와 CHANGELOG.md도 같이 고친다. */
export const MODEL_INFO = [
  { role: '받아 적기', name: 'Whisper large-v3-turbo', by: 'OpenAI', license: 'MIT', repo: ASR_MODEL, rev: ASR_REVISION },
  { role: '화자 나누기', name: 'Nemotron-3-Diarization', by: 'NVIDIA', license: 'OpenMDW-1.1', repo: DIAR_MODEL, rev: DIAR_REVISION },
] as const

interface ModelFile { model: string; rev: string; file: string; size: number }

const ASR_COMMON: [string, number][] = [
  ['config.json', 1330], ['generation_config.json', 3797], ['preprocessor_config.json', 340],
  ['tokenizer.json', 2480645], ['tokenizer_config.json', 282843],
]
const ASR_WEIGHTS: Record<string, [string, number][]> = {
  q4f16: [
    ['onnx/encoder_model_q4f16.onnx', 546276], ['onnx/encoder_model_q4f16.onnx_data', 369541120],
    ['onnx/decoder_model_merged_q4f16.onnx', 7874045], ['onnx/decoder_model_merged_q4f16.onnx_data', 185702400],
  ],
  q4: [
    ['onnx/encoder_model_q4.onnx', 544363], ['onnx/encoder_model_q4.onnx_data', 424509440],
    ['onnx/decoder_model_merged_q4.onnx', 8688251], ['onnx/decoder_model_merged_q4.onnx_data', 325529600],
  ],
}
const DIAR_FILES: [string, number][] = [
  ['config.json', 1623], ['onnx/model_quantized.onnx', 364375], ['onnx/model_quantized.onnx_data', 120479872],
]

export function modelFiles(device: Device): ModelFile[] {
  return [
    ...DIAR_FILES.map(([file, size]) => ({ model: DIAR_MODEL, rev: DIAR_REVISION, file, size })),
    ...[...ASR_COMMON, ...ASR_WEIGHTS[asrDtype(device)]].map(([file, size]) => ({ model: ASR_MODEL, rev: ASR_REVISION, file, size })),
  ]
}

export const fileUrl = (f: ModelFile) => `${HF}/${f.model}/resolve/${f.rev}/${f.file}`

/** 예전 버전 모델 파일이 캐시에 있는지(모델을 새 버전으로 바꾼 뒤 처음 준비할 때 안내 문구를 달리한다) */
export async function hasOldModels(): Promise<boolean> {
  if (typeof caches === 'undefined') return false
  const current = new Set([...modelFiles('webgpu'), ...modelFiles('wasm')].map(fileUrl))
  const keys = await (await caches.open(CACHE_NAME)).keys()
  return keys.some((r) => isOurs(r.url) && !current.has(r.url))
}

const isOurs = (url: string) => url.startsWith(`${HF}/${ASR_MODEL}/`) || url.startsWith(`${HF}/${DIAR_MODEL}/`)

/**
 * 새 버전을 다 받은 뒤, 지금 목록에 없는 우리 모델 파일(예전 revision)을 지운다 — 모델을 바꿀 때마다 수백 MB가 쌓이지 않게.
 * 다른 장치(webgpu/wasm)용 현재 파일은 남긴다.
 */
async function pruneOldModels() {
  const cache = await caches.open(CACHE_NAME)
  const current = new Set([...modelFiles('webgpu'), ...modelFiles('wasm')].map(fileUrl))
  for (const r of await cache.keys()) if (isOurs(r.url) && !current.has(r.url)) await cache.delete(r)
}

/** 아직 캐시에 없는 파일 */
export async function missingFiles(device: Device): Promise<ModelFile[]> {
  if (typeof caches === 'undefined') return modelFiles(device)
  const cache = await caches.open(CACHE_NAME)
  const out: ModelFile[] = []
  for (const f of modelFiles(device)) if (!(await cache.match(fileUrl(f)))) out.push(f)
  return out
}

export class EngineFailure extends Error {
  code: 'no-storage' | 'network' | 'unknown'
  constructor(code: EngineFailure['code'], message: string) { super(message); this.code = code }
}

/**
 * 없는 파일만 받아 캐시에 넣는다. 파일 단위로 이어 받는다(끊기면 받은 파일은 남고, 받던 파일은 처음부터).
 * ponytail: 파일 안에서 이어 받기(Range)는 안 함 — 가장 큰 파일이 370MB라 끊기면 그 파일은 다시 받는다.
 */
export async function downloadModels(device: Device, onProgress: (p: Progress) => void): Promise<void> {
  const all = modelFiles(device)
  const missing = await missingFiles(device)
  const totalBytes = all.reduce((s, f) => s + f.size, 0)
  let done = totalBytes - missing.reduce((s, f) => s + f.size, 0)
  const from = done
  const t0 = performance.now()
  const report = (extra: number) => {
    const got = done + extra - from
    const sec = (performance.now() - t0) / 1000
    // 남은 시간: 3초 넘게 받은 뒤의 평균 속도로
    const etaSec = sec > 3 && got > 0 ? Math.round(((totalBytes - done - extra) * sec) / got) : undefined
    onProgress({ stage: 'download', ratio: (done + extra) / totalBytes, downloadedBytes: done + extra, totalBytes, etaSec })
  }
  report(0)
  if (!missing.length) return

  const need = missing.reduce((s, f) => s + f.size, 0)
  const est = await navigator.storage?.estimate?.()
  if (est?.quota != null && est.usage != null && est.quota - est.usage < need * 1.05) {
    throw new EngineFailure('no-storage', `need ${need} bytes, free ${est.quota - est.usage}`)
  }

  const cache = await caches.open(CACHE_NAME)
  for (const f of missing) {
    let res: Response
    try {
      res = await fetch(fileUrl(f))
    } catch (e) {
      throw new EngineFailure('network', String(e))
    }
    if (!res.ok || !res.body) throw new EngineFailure('network', `${f.file}: HTTP ${res.status}`)
    let got = 0
    const counted = res.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, c) { got += chunk.byteLength; report(got); c.enqueue(chunk) },
    }))
    const headers = new Headers({ 'content-type': res.headers.get('content-type') ?? 'application/octet-stream', 'content-length': String(f.size) })
    try {
      await cache.put(fileUrl(f), new Response(counted, { headers }))
    } catch (e) {
      await cache.delete(fileUrl(f))
      const name = (e as Error)?.name
      if (name === 'QuotaExceededError') throw new EngineFailure('no-storage', String(e))
      throw new EngineFailure('network', String(e))
    }
    if (got !== f.size) {
      await cache.delete(fileUrl(f))
      throw new EngineFailure('network', `${f.file}: got ${got} of ${f.size} bytes`)
    }
    done += f.size
    report(0)
  }
  await pruneOldModels().catch(() => {})
}
