// Nemotron-3-Diarization 스트리밍 상태: 등장 순서 화자 캐시(AOSC) + 최근 인코더 프레임 FIFO.
// transformers.js PR #1778 (huggingface/transformers.js, commit 26d1e15)
// src/models/nemotron3_diarization/modeling_nemotron3_diarization.js 의 Nemotron3DiarizationSpeakerCache를
// 배치 1 전용으로 줄여 TypeScript로 옮겼다. 계산 순서는 원본과 같다.
// Copyright Hugging Face, Apache License 2.0.

const LOG_HALF = Math.log(0.5)
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x))

export interface StreamingConfig {
  fifo_length: number
  speaker_cache_update_period: number
  speaker_cache_length: number
  speaker_cache_silence_frames_per_speaker: number
  prediction_score_threshold: number
  latest_frames_score_boost: number
  num_speakers: number
  subsampling_factor: number
  min_positive_scores_rate: number
  strong_boost_rate: number
  weak_boost_rate: number
}

/** values에서 -Infinity가 아닌 가장 큰 k개의 인덱스(오름차순). 같은 값이면 앞 인덱스 우선. */
function topkIndices(values: Float64Array, k: number): number[] {
  const cand: number[] = []
  for (let i = 0; i < values.length; ++i) if (values[i] !== -Infinity) cand.push(i)
  if (cand.length <= k) return cand
  const sorted = Float64Array.from(cand, (i) => values[i]).sort()
  const start = sorted.length - k
  const threshold = sorted[start]
  let ties = 0
  for (let i = start; i < sorted.length && sorted[i] === threshold; ++i) ++ties
  return cand.filter((i) => values[i] > threshold || (values[i] === threshold && ties-- > 0))
}

export class SpeakerCache {
  private fifoLength: number
  private updatePeriod: number
  private cacheLength: number
  private numSilence: number
  private threshold: number
  private latestBoost: number
  private numSpeakers: number
  private factor: number
  private minPositive: number
  private numStrong: number
  private numWeak: number

  private hidden = 0
  private capacity = 0
  /** 캐시 프레임 다음 FIFO 프레임, [capacity, hidden] */
  private frames: Float32Array | null = null
  private probs: Float32Array | null = null
  private kept: Float32Array | null = null
  numCache = 0
  numFifo = 0
  private compressed = false

  constructor(cfg: StreamingConfig, opts: { fifo_length?: number; speaker_cache_update_period?: number } = {}) {
    this.fifoLength = opts.fifo_length ?? cfg.fifo_length
    this.updatePeriod = opts.speaker_cache_update_period ?? cfg.speaker_cache_update_period
    this.cacheLength = cfg.speaker_cache_length
    this.numSilence = cfg.speaker_cache_silence_frames_per_speaker
    this.threshold = cfg.prediction_score_threshold
    this.latestBoost = cfg.latest_frames_score_boost
    this.numSpeakers = cfg.num_speakers
    this.factor = cfg.subsampling_factor
    const budget = Math.floor(this.cacheLength / this.numSpeakers) - this.numSilence
    this.minPositive = Math.floor(budget * cfg.min_positive_scores_rate)
    this.numStrong = Math.floor(budget * cfg.strong_boost_rate)
    this.numWeak = Math.floor(budget * cfg.weak_boost_rate)
  }

  private init(hidden: number) {
    this.hidden = hidden
    this.probs = new Float32Array(this.cacheLength * this.numSpeakers)
    this.kept = new Float32Array(this.cacheLength * hidden)
    this.reserve(this.cacheLength + this.fifoLength)
  }

  private reserve(capacity: number) {
    if (capacity <= this.capacity) return
    const frames = new Float32Array(capacity * this.hidden)
    if (this.frames) frames.set(this.frames.subarray(0, (this.numCache + this.numFifo) * this.hidden))
    this.frames = frames
    this.capacity = capacity
  }

  /** 다음 조각이 참조할 캐시+FIFO 프레임(복사 없는 view, 다음 update가 덮어씀). [n, hidden] */
  embeds(hidden: number): { data: Float32Array; n: number } {
    if (!this.frames) this.init(hidden)
    const n = this.numCache + this.numFifo
    return { data: this.frames!.subarray(0, n * hidden), n }
  }

  /**
   * 처리한 조각을 FIFO에 넣고, 넘치면 오래된 프레임을 화자 캐시로 옮긴다(캐시가 넘치면 압축).
   * chunkEmbeds [numEmbeds, hidden] 중 앞 numChunkFrames개만 들어간다(뒤는 look-ahead).
   * logits [(cached+step 프레임) × factor, numSpeakers], mask: 이 단계의 유효 인코더 프레임.
   */
  update(chunkEmbeds: Float32Array, logits: Float32Array, silence: Float32Array, numChunkFrames: number, mask: BigInt64Array | null = null) {
    const hidden = this.hidden
    const { numCache, numFifo, cacheLength } = this
    const queued = numFifo + numChunkFrames
    const popped = queued <= this.fifoLength ? 0 : Math.min(Math.max(this.updatePeriod, queued - this.fifoLength), queued)
    const numFrames = numCache + popped
    const compress = numFrames > cacheLength

    this.reserve(numCache + queued)
    const frames = this.frames!
    frames.set(chunkEmbeds.subarray(0, numChunkFrames * hidden), (numCache + numFifo) * hidden)

    if (popped > 0) {
      const cacheProbs = this.probs!
      let probs = this.poolProbs(logits, mask, this.compressed ? numCache : 0, numFrames)
      if (this.compressed) probs.set(cacheProbs.subarray(0, numCache * this.numSpeakers))
      if (compress) {
        probs = this.compress(frames, probs, numFrames, silence)
        frames.copyWithin(cacheLength * hidden, numFrames * hidden, (numCache + queued) * hidden)
      }
      cacheProbs.set(probs)
    }
    this.numCache = Math.min(numFrames, cacheLength)
    this.numFifo = queued - popped
    this.compressed ||= compress
  }

  private poolProbs(logits: Float32Array, mask: BigInt64Array | null, start: number, end: number): Float32Array {
    const { factor, numSpeakers } = this
    const probs = new Float32Array(end * numSpeakers)
    for (let t = start; t < end; ++t) {
      if (mask && !mask[t]) continue
      for (let s = 0; s < numSpeakers; ++s) {
        let sum = 0
        for (let k = 0; k < factor; ++k) sum += sigmoid(logits[(t * factor + k) * numSpeakers + s])
        probs[t * numSpeakers + s] = sum / factor
      }
    }
    return probs
  }

  private frameScores(probs: Float32Array, numFrames: number, numScored: number): Float64Array {
    const { numSpeakers, threshold } = this
    const scores = new Float64Array(numSpeakers * numScored)
    const logc = new Float64Array(numSpeakers)
    for (let t = 0; t < numFrames; ++t) {
      const fp = probs.subarray(t * numSpeakers, (t + 1) * numSpeakers)
      let sum = 0
      for (let s = 0; s < numSpeakers; ++s) { logc[s] = Math.log(Math.max(1 - fp[s], threshold)); sum += logc[s] }
      for (let s = 0; s < numSpeakers; ++s) {
        const p = fp[s]
        scores[s * numScored + t] = p > 0.5 ? Math.log(Math.max(p, threshold)) - logc[s] + sum - LOG_HALF : -Infinity
      }
    }
    for (let s = 0; s < numSpeakers; ++s) {
      const sp = scores.subarray(s * numScored, s * numScored + numFrames)
      let pos = 0
      for (const v of sp) if (v > 0) ++pos
      if (pos >= this.minPositive) for (let t = 0; t < numFrames; ++t) if (!(sp[t] > 0)) sp[t] = -Infinity
    }
    return scores
  }

  private compress(frames: Float32Array, probs: Float32Array, numFrames: number, silence: Float32Array): Float32Array {
    const { hidden, numSpeakers, cacheLength } = this
    const numScored = numFrames + this.numSilence
    const scores = this.frameScores(probs, numFrames, numScored)
    const boosts: [number, number][] = [[this.numStrong, -2 * LOG_HALF], [this.numWeak, -LOG_HALF]]
    for (let s = 0; s < numSpeakers; ++s) {
      const off = s * numScored
      const sp = scores.subarray(off, off + numFrames)
      for (let t = cacheLength; t < numFrames; ++t) sp[t] += this.latestBoost
      for (const [n, boost] of boosts) for (const t of topkIndices(sp, n)) sp[t] += boost
      scores.fill(Infinity, off + numFrames, off + numScored)
    }
    const kept = topkIndices(scores, cacheLength)
    const keptFrames = this.kept!
    const keptProbs = new Float32Array(cacheLength * numSpeakers)
    for (let i = 0; i < cacheLength; ++i) {
      const t = i < kept.length ? kept[i] % numScored : numFrames
      if (t >= numFrames) keptFrames.set(silence, i * hidden)
      else {
        keptFrames.set(frames.subarray(t * hidden, (t + 1) * hidden), i * hidden)
        keptProbs.set(probs.subarray(t * numSpeakers, (t + 1) * numSpeakers), i * numSpeakers)
      }
    }
    frames.set(keptFrames)
    return keptProbs
  }
}
