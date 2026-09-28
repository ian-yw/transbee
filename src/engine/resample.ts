// 16kHz로 바꾸기. 소리 풀기(decode.ts)와 mp3 대체 디코더(mp3.ts)가 같이 쓴다.
export const SR = 16000

/**
 * 스트리밍 창 사인크(windowed-sinc) 리샘플러. 저역 통과 차단 = 출력 나이퀴스트의 90%(7.2kHz), 한쪽 8 영점, Hann 창.
 * (mediabunny 내장 리샘플러는 저역 통과 없는 선형 보간이라 48k→16k에서 앨리어싱이 생긴다.)
 */
export class Resampler {
  private step: number
  private half: number
  private phases = 256
  private kernel: Float32Array // [phases+1][2*half]
  private buf = new Float32Array(0)
  private base = 0 // buf[0]의 전역 입력 인덱스
  private inTotal = 0
  private out: Float32Array
  private n = 0

  private inRate: number

  constructor(inRate: number, expectedOut: number) {
    this.inRate = inRate
    this.step = inRate / SR
    this.out = new Float32Array(expectedOut + SR)
    const fc = Math.min(0.5, 0.5 / this.step) * 0.9 // 입력 샘플당 주기
    this.half = Math.ceil(8 / (2 * fc))
    const taps = 2 * this.half
    this.kernel = new Float32Array((this.phases + 1) * taps)
    for (let p = 0; p <= this.phases; p++) {
      const frac = p / this.phases
      let sum = 0
      for (let j = 0; j < taps; j++) {
        const d = j - this.half + 1 - frac
        const x = 2 * fc * d
        const sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x)
        const win = 0.5 + 0.5 * Math.cos((Math.PI * d) / this.half)
        const v = Math.abs(d) >= this.half ? 0 : sinc * win
        this.kernel[p * taps + j] = v
        sum += v
      }
      for (let j = 0; j < taps; j++) this.kernel[p * taps + j] /= sum
    }
  }

  push(x: Float32Array) {
    if (this.inRate === SR) { this.write(x); this.inTotal += x.length; return }
    const b = new Float32Array(this.buf.length + x.length)
    b.set(this.buf)
    b.set(x, this.buf.length)
    this.buf = b
    this.inTotal += x.length
    this.drain(false)
  }

  finish(): Float32Array {
    if (this.inRate !== SR) this.drain(true)
    return this.out.subarray(0, this.n)
  }

  private drain(final: boolean) {
    const { step, half, kernel, phases } = this
    const taps = 2 * half
    const end = this.base + this.buf.length
    const outLimit = Math.floor(this.inTotal / step)
    for (;;) {
      if (final ? this.n >= outLimit : false) break
      const pos = this.n * step
      let i0 = Math.floor(pos)
      let p = Math.round((pos - i0) * phases)
      if (p === phases) { i0 += 1; p = 0 }
      if (!final && i0 + half >= end) break
      let acc = 0
      const k = p * taps
      for (let j = 0; j < taps; j++) {
        const idx = i0 - half + 1 + j - this.base
        if (idx >= 0 && idx < this.buf.length) acc += this.buf[idx] * kernel[k + j]
      }
      this.write1(acc)
    }
    // 다음 출력에 필요한 입력만 남긴다
    const keepFrom = Math.floor(this.n * step) - half
    if (keepFrom > this.base) {
      this.buf = this.buf.slice(keepFrom - this.base)
      this.base = keepFrom
    }
  }

  private write1(v: number) {
    if (this.n >= this.out.length) this.grow(1)
    this.out[this.n++] = v
  }

  private write(x: Float32Array) {
    if (this.n + x.length > this.out.length) this.grow(x.length)
    this.out.set(x, this.n)
    this.n += x.length
  }

  private grow(need: number) {
    const o = new Float32Array(Math.max(this.out.length * 1.1, this.n + need) | 0)
    o.set(this.out.subarray(0, this.n))
    this.out = o
  }
}
