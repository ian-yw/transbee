// Whisper large-v3-turbo(단어 시각판) 음성인식. 한국어 고정, 간투사 예시 프롬프트, 같은 6-gram 반복 금지.
// 프롬프트는 transformers.js가 prompt_ids를 지원하지 않아 decoder_input_ids를
// <|startofprev|> 프롬프트 <|startoftranscript|><|ko|><|transcribe|><|notimestamps|> 로 직접 만든다.
import { AutoProcessor, AutoTokenizer, LogitsProcessor, WhisperForConditionalGeneration, type Tensor } from '@huggingface/transformers'
import { ASR_MODEL, ASR_REVISION, asrDtype, ortDevice, type Device } from './models'
import type { Word } from '../types'
import { SR } from './decode'

/**
 * 앞 문맥(프롬프트): 간투사를 지우지 말고, 문장 끝에 부호를 붙이라는 본보기.
 * 2026-09-25 비교(평가용 녹음 2개, 문장 끝 어절 뒤 . ? ! 비율):
 *   옛 프롬프트(간투사만, 부호 없음) 26%·24% → 이 프롬프트 60%·67%(사람 축어록 66~79%). 간투사 수는 옛 것과 비슷.
 *   부호만 늘린 다른 후보는 간투사가 줄었다. 가상 예시 CER 0 그대로, 다른 평가용 녹음 2개 CER 0.325→0.302, 0.26→0.268.
 * 정답(골드)이 늘면 다시 잴 것.
 */
export const PROMPT = ' 네. 음.. 그랬군요. 어.. 그러니까, 그게 좀 힘들었어요. 아, 그래서요? 응, 맞아요.'
const EOS = 50257 // <|endoftext|>. 이 번호 이상은 특수 토큰

type Asr = Awaited<ReturnType<typeof loadAsr>>

/**
 * WebGPU 버퍼 보관 방식 lazyRelease: 기본(bucket)은 다 쓴 GPU 버퍼를 크기별로 모아 두고 다시 쓰는데, 그만큼 메모리를 계속 잡고 있다.
 * lazyRelease는 한 번 돌릴 때마다 돌려준다. 46분 녹음에서 Chrome 전체 메모리 최대 4,324 → 3,936MB, 받아 적는 동안 3,945 → 3,608MB,
 * 결과 글자는 완전히 같고 속도도 같았다(334 → 320초). simple은 오히려 늘고, disabled는 실행이 안 된다(2026-09-25, M4 Chrome).
 */
const WEBGPU_SESSION = { executionProviders: [{ name: 'webgpu', storageBufferCacheMode: 'lazyRelease' }] }

export async function loadAsr(device: Device, prompt = PROMPT) {
  const opts = { revision: ASR_REVISION }
  const [processor, tokenizer, model] = await Promise.all([
    AutoProcessor.from_pretrained(ASR_MODEL, opts),
    AutoTokenizer.from_pretrained(ASR_MODEL, opts),
    WhisperForConditionalGeneration.from_pretrained(ASR_MODEL, { ...opts, use_external_data_format: true, dtype: asrDtype(device), device: ortDevice(device), session_options: device === 'wasm' ? undefined : WEBGPU_SESSION }),
  ])
  const ids = (t: string[]) => tokenizer.convert_tokens_to_ids(t) as number[]
  const sot = ids(['<|startoftranscript|>', '<|ko|>', '<|transcribe|>', '<|notimestamps|>'])
  const prefix = [ids(['<|startofprev|>'])[0], ...(tokenizer.encode(prompt, { add_special_tokens: false }) as number[]), ...sot]
  if (prefix.some((x) => x == null)) throw new Error('whisper special token missing')
  return { processor, tokenizer, model, prefix }
}

/** 생성 단계마다 최종 로짓의 최댓값 확률(greedy라 = 고른 토큰의 확률)을 적는다. */
class ProbRecorder extends LogitsProcessor {
  probs: number[] = []
  _call(_ids: bigint[][], logits: Tensor): Tensor {
    const d = (logits as unknown as Tensor[])[0].data as Float32Array
    let max = -Infinity
    for (let i = 0; i < d.length; i++) if (d[i] > max) max = d[i]
    let sum = 0
    for (let i = 0; i < d.length; i++) sum += Math.exp(d[i] - max)
    this.probs.push(1 / sum)
    return logits
  }
}

/** 한 구간(30초 이하)을 받아 적는다. 단어 시각은 녹음 전체 기준(offset 더함). */
export async function transcribeClip(asr: Asr, audio: Float32Array, offset: number): Promise<Word[]> {
  const { input_features } = await asr.processor(audio)
  const rec = new ProbRecorder()
  const out = (await asr.model.generate({
    inputs: input_features,
    decoder_input_ids: asr.prefix,
    // Whisper 문맥은 448토큰: 프롬프트를 뺀 나머지 전부. 28초 조각에서 말이 빠르면 220으로는 뒷말이 잘렸다
    max_new_tokens: 448 - asr.prefix.length,
    no_repeat_ngram_size: 6,
    return_token_timestamps: true,
    num_frames: Math.ceil(audio.length / (SR * 0.02)), // 교차 주의 시간축(20ms)에서 실제 소리 길이만 DTW
    logits_processor: [rec],
  } as never)) as unknown as { sequences: Tensor; token_timestamps: Tensor; past_key_values?: { dispose(): Promise<void> } }
  await out.past_key_values?.dispose()
  input_features.dispose?.()

  const P = asr.prefix.length
  const gen = (out.sequences.tolist()[0] as bigint[]).slice(P).map(Number)
  const ts = (out.token_timestamps.tolist()[0] as number[]).slice(P)
  let n = gen.findIndex((t) => t >= EOS)
  if (n < 0) {
    n = gen.length
    console.warn(`transcribeClip: no end token at ${offset.toFixed(1)}s (${gen.length} tokens) — clip tail may be missing`)
  }
  const tokens = gen.slice(0, n)
  if (!tokens.length) return []

  const [texts, , indices] = (asr.tokenizer as unknown as {
    combineTokensIntoWords(t: number[], lang: string): [string[], number[][], number[][]]
  }).combineTokensIntoWords(tokens, 'korean')
  const words: Word[] = []
  texts.forEach((raw, i) => {
    // 한글 한 글자가 토큰 사이에서 잘려 깨진 조각(U+FFFD)으로 나오는 경우가 있다 — 화면에 �가 보이지 않게 뺀다
    const text = raw.replace(/\uFFFD/g, '')
    const idx = indices[i]
    if (!text.trim() || !idx.length) return
    const a = idx[0], b = idx[idx.length - 1]
    const start = offset + ts[a]
    let end = offset + (ts[b + 1] ?? ts[b])
    if (end <= start) end = start + 0.2
    const conf = idx.reduce((s, k) => s + (rec.probs[k] ?? 0), 0) / idx.length
    // "음.."의 ".."처럼 문장부호만 떨어져 나온 조각은 앞 단어에 붙인다(다음 줄 맨 앞에 ".."가 오지 않게)
    const prev = words.at(-1)
    if (prev && /^[\s.,?!…~]+$/.test(text)) return void (prev.text += text.trim())
    words.push({ text, start, end, confidence: Math.round(conf * 1000) / 1000 })
  })
  return words
}
