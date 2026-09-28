// Chrome의 mp3 디코더가 거부하는 정상 mp3를 mpg123(wasm)으로 푼다.
// Chrome 153의 mp3 디코더(Symphonia)는 ZOOM H1n 같은 녹음기 mp3를 "stereo channel pair block_type mismatch"로 거부한다.
// 받아 적기(decode.ts)와 듣기(usePlayback.ts) 모두 Chrome이 실패했을 때만 이 길로 온다.
import { MPEGDecoder } from 'mpg123-decoder'
import { Resampler, SR } from './resample'
import { id3Size, mp3Start } from './sniff'

const CHUNK = 1024 * 1024

/** 앞 4MB 안에(ID3 태그 건너뛰고) mp3 프레임이 이어지는 자리가 있나 */
export async function looksMp3(blob: Blob): Promise<boolean> {
  const skip = id3Size(new Uint8Array(await blob.slice(0, 10).arrayBuffer()))
  return mp3Start(new Uint8Array(await blob.slice(skip, skip + 4 * 1024 * 1024).arrayBuffer())) >= 0
}

/** mp3 → 16kHz 모노. 샘플레이트가 중간에 바뀌면 구간마다 따로 바꿔 잇는다 */
export async function decodeMp3(blob: Blob, onProgress?: (sec: number, duration: number) => void): Promise<Float32Array> {
  const dec = new MPEGDecoder()
  await dec.ready
  const segs: Float32Array[] = []
  let rs: Resampler | undefined
  let rate = 0, inSec = 0, doneSec = 0, est = 0
  try {
    for (let at = 0; at < blob.size; at += CHUNK) {
      const { channelData: ch, samplesDecoded: n, sampleRate } = dec.decode(new Uint8Array(await blob.slice(at, at + CHUNK).arrayBuffer()))
      if (!n) continue
      inSec += n / sampleRate
      est = (inSec * blob.size) / Math.min(blob.size, at + CHUNK) // 지금까지의 바이트당 길이로 전체 길이 어림
      if (sampleRate !== rate) {
        if (rs) {
          segs.push(rs.finish())
          doneSec = segs.reduce((s, x) => s + x.length, 0) / SR
        }
        rate = sampleRate
        rs = new Resampler(rate, Math.ceil((est - doneSec) * SR * 1.02))
      }
      const mono = new Float32Array(n)
      for (const c of ch) for (let i = 0; i < n; i++) mono[i] += c[i] / ch.length
      rs!.push(mono)
      onProgress?.(inSec, est)
      await new Promise((r) => setTimeout(r)) // 화면에서 쓸 때 멈춰 보이지 않게
    }
  } finally {
    dec.free()
  }
  if (rs) segs.push(rs.finish())
  if (segs.length === 1) return segs[0]
  const out = new Float32Array(segs.reduce((s, x) => s + x.length, 0))
  let o = 0
  for (const x of segs) {
    out.set(x, o)
    o += x.length
  }
  return out
}

/** 16kHz 모노 → 16비트 WAV(재생용) */
export function wav16(pcm: Float32Array): Blob {
  const b = new ArrayBuffer(44 + pcm.length * 2)
  const v = new DataView(b)
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)))
  str(0, 'RIFF')
  v.setUint32(4, 36 + pcm.length * 2, true)
  str(8, 'WAVEfmt ')
  v.setUint32(16, 16, true) // fmt 길이
  v.setUint16(20, 1, true) // PCM
  v.setUint16(22, 1, true) // 모노
  v.setUint32(24, SR, true)
  v.setUint32(28, SR * 2, true)
  v.setUint16(32, 2, true)
  v.setUint16(34, 16, true)
  str(36, 'data')
  v.setUint32(40, pcm.length * 2, true)
  for (let i = 0; i < pcm.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, pcm[i])) * 0x7fff, true)
  return new Blob([b], { type: 'audio/wav' })
}
