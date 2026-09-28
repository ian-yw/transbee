import { describe, expect, it } from 'vitest'
import { fileKind, id3Size, mp3Start } from './sniff'

// MPEG-1 Layer III 128kbps 44.1kHz 프레임 = 417바이트
const frames = (n: number) => {
  const f = new Uint8Array(417 * n)
  for (let i = 0; i < n; i++) f.set([0xff, 0xfb, 0x90, 0x00], i * 417)
  return f
}
const cat = (...xs: Uint8Array[]) => {
  const out = new Uint8Array(xs.reduce((s, x) => s + x.length, 0))
  let o = 0
  for (const x of xs) {
    out.set(x, o)
    o += x.length
  }
  return out
}

describe('파일 앞부분으로 형식 알기', () => {
  it('mp3 앞에 붙은 소리 아닌 데이터(가짜 프레임 머리 포함)를 건너뛴 첫 프레임 자리', () => {
    const junk = new Uint8Array(20000).fill(0x55)
    junk.set([0xff, 0xfb, 0x90, 0x00], 1000) // 프레임 머리처럼 보이지만 이어지지 않음
    expect(mp3Start(cat(junk, frames(6)))).toBe(20000)
    expect(mp3Start(new Uint8Array(5000))).toBe(-1)
    const id3 = cat(new Uint8Array([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 1, 0]), new Uint8Array(128))
    expect(id3Size(id3)).toBe(10 + 128)
  })

  it('WMA·ADPCM WAV는 알아보고, 보통 WAV는 아님', () => {
    const wav = (fmt: number) => {
      const b = new Uint8Array(44)
      const v = new DataView(b.buffer)
      b.set([...'RIFF'].map((c) => c.charCodeAt(0)), 0)
      b.set([...'WAVEfmt '].map((c) => c.charCodeAt(0)), 8)
      v.setUint32(16, 16, true)
      v.setUint16(20, fmt, true)
      return b
    }
    expect(fileKind(wav(0x0011))).toBe('adpcm')
    expect(fileKind(wav(0x0002))).toBe('adpcm')
    expect(fileKind(wav(0x0001))).toBeUndefined()
    expect(fileKind(new Uint8Array([0x30, 0x26, 0xb2, 0x75, 0x8e, 0x66, 0xcf, 0x11, 0xa6]))).toBe('wma')
    expect(fileKind(frames(2))).toBeUndefined()
  })
})
