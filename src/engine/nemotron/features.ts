// Nemotron-3-Diarization 입력 특징: 로그 멜(128) 스펙트로그램, 10ms 간격.
// transformers.js PR #1778(huggingface/transformers.js, Apache-2.0)의
// NemotronAsrStreamingFeatureExtractor + ParakeetFeatureExtractor + utils/audio.js spectrogram을 옮겨 적었다.
// (설치된 transformers.js 4.3.0은 center 끄기를 지원하지 않아 STFT만 직접 계산. 멜 필터·창은 4.3.0의 ParakeetFeatureExtractor에서 가져온다.)
// Copyright Hugging Face, Apache License 2.0.
import { ParakeetFeatureExtractor } from '@huggingface/transformers'

export const HOP = 160
const N_FFT = 512
const N_MEL = 128
const PREEMPH = 0.97
const MEL_OFFSET = 2 ** -24

export class MelExtractor {
  private window: Float64Array
  private filters: { k0: number; w: Float32Array }[]
  private fft = makeFFT(N_FFT)
  private re = new Float64Array(N_FFT)
  private im = new Float64Array(N_FFT)
  private power = new Float32Array(N_FFT / 2 + 1)

  constructor() {
    const fe = new ParakeetFeatureExtractor({ feature_size: N_MEL, n_fft: N_FFT, sampling_rate: 16000, win_length: 400, hop_length: HOP, preemphasis: PREEMPH }) as unknown as { window: Float64Array; config: { mel_filters: number[][] } }
    this.window = fe.window
    const mel = fe.config.mel_filters // [N_MEL][257]
    if (mel.length !== N_MEL || mel[0].length !== N_FFT / 2 + 1) throw new Error('unexpected mel filter shape')
    // 필터는 대부분 0: 0이 아닌 구간만 남긴다
    this.filters = mel.map((row) => {
      let a = row.findIndex((v) => v !== 0)
      if (a < 0) a = 0
      let b = row.length
      while (b > a && row[b - 1] === 0) b--
      return { k0: a, w: Float32Array.from(row.slice(a, b)) }
    })
  }

  /**
   * center=true: 앞뒤 n_fft/2 영 패딩(오프라인·첫 조각). false: 패딩 없음(뒤 조각).
   * 창이 조각 밖으로 나가는 뒤쪽 프레임은 만들지 않는다(PR의 streaming 처리와 같음).
   * @returns [frames × 128] 로그 멜
   */
  extract(audio: Float32Array, center: boolean): { data: Float32Array; frames: number } {
    const L = audio.length
    const frames = center ? Math.floor(L / HOP) : Math.floor((L - N_FFT) / HOP) + 1
    const pad = center ? N_FFT / 2 : 0
    const x = new Float64Array(L + 2 * pad)
    x.set(audio, pad)
    for (let j = pad + L - 1; j >= pad + 1; --j) x[j] -= PREEMPH * x[j - 1]
    const out = new Float32Array(Math.max(0, frames) * N_MEL)
    const { re, im, power, window } = this
    for (let i = 0; i < frames; i++) {
      const off = i * HOP
      for (let j = 0; j < N_FFT; j++) { re[j] = x[off + j] * window[j]; im[j] = 0 }
      this.fft(re, im)
      for (let k = 0; k <= N_FFT / 2; k++) power[k] = re[k] * re[k] + im[k] * im[k]
      for (let m = 0; m < N_MEL; m++) {
        const { k0, w } = this.filters[m]
        let s = 0
        for (let k = 0; k < w.length; k++) s += w[k] * power[k0 + k]
        out[i * N_MEL + m] = Math.log(Math.fround(MEL_OFFSET + Math.fround(s)))
      }
    }
    return { data: out, frames: Math.max(0, frames) }
  }
}

/** 제자리 radix-2 복소 FFT. */
function makeFFT(n: number) {
  const bits = Math.log2(n)
  const rev = new Uint32Array(n)
  for (let i = 0; i < n; i++) rev[i] = parseInt(i.toString(2).padStart(bits, '0').split('').reverse().join(''), 2)
  const cos = new Float64Array(n / 2), sin = new Float64Array(n / 2)
  for (let i = 0; i < n / 2; i++) { cos[i] = Math.cos((2 * Math.PI * i) / n); sin[i] = -Math.sin((2 * Math.PI * i) / n) }
  return (re: Float64Array, im: Float64Array) => {
    for (let i = 0; i < n; i++) {
      const j = rev[i]
      if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t }
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1, step = n / size
      for (let i = 0; i < n; i += size) {
        for (let j = 0, k = 0; j < half; j++, k += step) {
          const a = i + j, b = a + half
          const tr = re[b] * cos[k] - im[b] * sin[k]
          const ti = re[b] * sin[k] + im[b] * cos[k]
          re[b] = re[a] - tr; im[b] = im[a] - ti
          re[a] += tr; im[a] += ti
        }
      }
    }
  }
}
