// Nemotron-3-Diarization 오프라인형 설정(모델 카드: 청크 340 + 오른쪽 문맥 40 인코더 프레임, FIFO 40, 캐시 갱신 300)으로
// 긴 녹음을 약 30초씩 잘라 넣는다. 조각 사이에 남는 상태는 화자 캐시뿐이라 메모리가 늘지 않는다.
// 조각 나누기 규칙은 transformers.js PR #1778(Apache-2.0)의 Nemotron3DiarizationProcessor·forward와 같다.
import { AutoModel, Tensor, type PreTrainedModel } from '@huggingface/transformers'
import { HOP, MelExtractor } from './features'
import { SpeakerCache, type StreamingConfig } from './speaker-cache'
import { DIAR_DTYPE, DIAR_MODEL, DIAR_REVISION, ortDevice, type Device } from '../models'

const N_MEL = 128
const N_SPK = 8

interface DiarConfig {
  chunk_length: number
  chunk_right_context: number
  fifo_length: number
  speaker_cache_update_period: number
  streaming_config: StreamingConfig
  audio_config: { subsampling_factor: number; hidden_size: number }
}

export interface Diarization {
  /** [frames × 8] 채널별 말함 확률(시그모이드), 10ms 간격 */
  probs: Float32Array
  channels: number
  /** 채널별 "혼자 말한" 인코더 프레임 임베딩 평균(없으면 null) — 2화자 합치기용 */
  meanEmb: (Float32Array | null)[]
}

export async function loadDiarizer(device: Device) {
  return AutoModel.from_pretrained(DIAR_MODEL, { revision: DIAR_REVISION, dtype: DIAR_DTYPE, device: ortDevice(device) })
}

export async function diarize(model: PreTrainedModel, pcm: Float32Array, onChunk: (doneSec: number) => void): Promise<Diarization> {
  const cfg = model.config as unknown as DiarConfig
  const factor = cfg.audio_config.subsampling_factor
  const hidden = cfg.audio_config.hidden_size
  const [chunkLen, right] = [cfg.chunk_length, cfg.chunk_right_context]
  const melPerChunk = (chunkLen + right) * factor
  const melStep = chunkLen * factor
  const samplesFirst = (melPerChunk - 1) * HOP + 200 // + win_length/2
  const samplesLater = melPerChunk * HOP + 400 // + win_length
  const chunkStart = (mel: number) => mel * HOP - 256 // - n_fft/2

  const mel = new MelExtractor()
  const cache = new SpeakerCache(cfg.streaming_config, { fifo_length: cfg.fifo_length, speaker_cache_update_period: cfg.speaker_cache_update_period })
  const totalFrames = Math.floor(pcm.length / HOP)
  const probs = new Float32Array(totalFrames * N_SPK)
  const embSum = Array.from({ length: N_SPK }, () => new Float64Array(hidden))
  const embN = Array.from({ length: N_SPK }, () => 0)
  let written = 0

  const run = async (a: number, b: number, first: boolean, last: boolean) => {
    const f = mel.extract(pcm.subarray(a, b), first)
    const numEmbeds = Math.ceil(f.frames / factor)
    const lookahead = last ? 0 : right
    const numChunk = numEmbeds - lookahead
    if (numChunk < 1) return
    const cached = cache.embeds(hidden)
    const stepLen = cached.n + numEmbeds
    const mask = new BigInt64Array(stepLen).fill(1n)
    const out = await model({
      input_features: new Tensor('float32', f.data, [1, f.frames, N_MEL]),
      cached_embeds: new Tensor('float32', cached.data, [1, cached.n, hidden]),
      attention_mask: new Tensor('int64', mask, [1, stepLen]),
    })
    const logits = out.logits.data as Float32Array
    const embeds = out.chunk_embeds.data as Float32Array
    cache.update(embeds, logits, out.silence_embeds.data as Float32Array, numChunk, mask)

    // 이 조각 몫의 로짓(캐시 프레임 뒤, look-ahead 앞)
    const n = Math.min(numChunk * factor, f.frames, totalFrames - written)
    const off = cached.n * factor
    for (let i = 0; i < n * N_SPK; i++) probs[written * N_SPK + i] = 1 / (1 + Math.exp(-logits[off * N_SPK + i]))
    // 혼자 말한 인코더 프레임의 임베딩을 채널별로 모은다
    for (let e = 0; e < Math.floor(n / factor); e++) {
      let who = -1, count = 0
      for (let s = 0; s < N_SPK; s++) {
        let p = 0
        for (let k = 0; k < factor; k++) p += probs[(written + e * factor + k) * N_SPK + s]
        if (p / factor > 0.5) { who = s; count++ }
      }
      if (count !== 1) continue
      const row = embeds.subarray(e * hidden, (e + 1) * hidden)
      for (let h = 0; h < hidden; h++) embSum[who][h] += row[h]
      embN[who]++
    }
    written += n
    for (const t of Object.values(out)) (t as { dispose?: () => void }).dispose?.()
  }

  if (pcm.length <= samplesFirst) {
    await run(0, pcm.length, true, true)
  } else {
    await run(0, samplesFirst, true, false)
    let m = melStep
    let start = chunkStart(m)
    while (start + samplesLater <= pcm.length) {
      await run(start, start + samplesLater, false, false)
      onChunk(written / 100)
      m += melStep
      start = chunkStart(m)
    }
    // 마지막 조각: n_fft보다 짧으면 특징을 못 만든다(나머지는 무음으로 둔다)
    if (pcm.length - start >= 512 + factor * HOP) await run(start, pcm.length, false, true)
  }
  onChunk(pcm.length / 16000)
  return {
    probs,
    channels: N_SPK,
    meanEmb: embSum.map((s, c) => (embN[c] ? Float32Array.from(s, (v) => v / embN[c]) : null)),
  }
}
