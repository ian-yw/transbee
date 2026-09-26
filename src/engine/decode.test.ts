import { describe, expect, it } from 'vitest'
import { Resampler, SR } from './decode'

const tone = (hz: number, rate: number, sec: number) => Float32Array.from({ length: rate * sec }, (_, i) => Math.sin((2 * Math.PI * hz * i) / rate))
const rms = (x: Float32Array) => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length)

function resample(x: Float32Array, rate: number, chunk = 1000) {
  const r = new Resampler(rate, Math.ceil((x.length / rate) * SR))
  for (let i = 0; i < x.length; i += chunk) r.push(x.subarray(i, i + chunk))
  return r.finish()
}

describe('리샘플러 (조각 단위 입력)', () => {
  it('44.1kHz 1kHz 음은 크기 유지, 10kHz 음(16kHz로는 표현 불가)은 걸러짐', () => {
    const low = resample(tone(1000, 44100, 2), 44100)
    expect(Math.abs(low.length - 2 * SR)).toBeLessThanOrEqual(1)
    expect(rms(low.subarray(1000, -1000))).toBeCloseTo(Math.SQRT1_2, 2)
    const high = resample(tone(10000, 48000, 2), 48000)
    expect(rms(high.subarray(1000, -1000))).toBeLessThan(0.01)
  })
})
