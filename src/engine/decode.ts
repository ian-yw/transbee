// 녹음 파일(m4a·mp3·wav·webm 등) → 16kHz 모노 Float32. Web Worker 안에서 조각 단위로 푼다.
// 컨테이너 풀기는 mediabunny, 소리 풀기는 WebCodecs AudioDecoder(mediabunny가 호출).
// decodeAudioData처럼 원본 샘플레이트 전체를 한 번에 풀지 않아서, 메모리는 결과(50분 = 약 192MB)와 조각 몇 개뿐이다.
import { ALL_FORMATS, AudioSampleSink, BlobSource, Input } from 'mediabunny'

export const SR = 16000

export class BadFile extends Error {}

export async function decodeToMono16k(blob: Blob, onProgress: (sec: number, duration: number) => void): Promise<Float32Array> {
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS })
  try {
    return await decode(input, onProgress)
  } catch (e) {
    // 중간이 깨진 파일·안 맞는 코덱은 어디서 터지든 "열 수 없는 파일"로(다시 해도 같은 오류라 '이어서 받아 적기'로 보내면 안 된다).
    // 메모리 부족만 그대로 올린다.
    if (e instanceof BadFile || (e instanceof RangeError && /alloc|memory|Array buffer|Invalid typed array length/i.test(e.message))) throw e
    throw new BadFile(`decode failed: ${e}`)
  } finally {
    input.dispose()
  }
}

async function decode(input: Input, onProgress: (sec: number, duration: number) => void): Promise<Float32Array> {
  const track = await input.getPrimaryAudioTrack()
  if (!track) throw new BadFile('no audio track')
  if (!(await track.canDecode())) throw new BadFile(`codec not decodable: ${track.codec}`)
  const duration = await track.computeDuration()
  // 리샘플러는 디코더가 실제로 내놓는 샘플레이트로 만든다: HE-AAC(SBR)는 파일에 적힌 값의 두 배로 나온다
  let rs: Resampler | undefined
  let rate = 0
  let inSec = 0 // 지금까지 넣은 소리 길이
  let lastReport = 0
  for await (const s of new AudioSampleSink(track).samples()) {
    try {
      if (!rs) {
        rate = s.sampleRate
        rs = new Resampler(rate, Math.ceil(duration * SR))
        inSec = s.timestamp
      } else if (s.sampleRate !== rate) throw new BadFile(`sample rate changed ${rate} -> ${s.sampleRate}`)
      // 조각 사이가 비어 있으면(녹음이 잠깐 끊긴 파일) 빈 소리로 채워 재생 시각과 맞춘다
      const gap = s.timestamp - inSec
      if (gap > 0.05) {
        rs.push(new Float32Array(Math.round(gap * rate)))
        inSec += gap
      }
      const n = s.numberOfFrames, ch = s.numberOfChannels
      const mono = new Float32Array(n)
      const plane = new Float32Array(n)
      for (let c = 0; c < ch; c++) {
        s.copyTo(plane, { planeIndex: c, format: 'f32-planar' })
        for (let i = 0; i < n; i++) mono[i] += plane[i] / ch
      }
      rs.push(mono)
      inSec += n / rate
      const t = s.timestamp + s.duration
      if (t - lastReport > 30) { lastReport = t; onProgress(t, duration) }
    } finally {
      s.close()
    }
  }
  const pcm = rs?.finish()
  if (!pcm?.length) throw new BadFile('empty audio')
  onProgress(duration, duration)
  return pcm
}

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
