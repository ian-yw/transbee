// 녹음 파일(m4a·mp3·wav·webm 등) → 16kHz 모노 Float32. Web Worker 안에서 조각 단위로 푼다.
// 컨테이너 풀기는 mediabunny, 소리 풀기는 WebCodecs AudioDecoder(mediabunny가 호출).
// decodeAudioData처럼 원본 샘플레이트 전체를 한 번에 풀지 않아서, 메모리는 결과(50분 = 약 192MB)와 조각 몇 개뿐이다.
import { ALL_FORMATS, AudioSampleSink, BlobSource, Input } from 'mediabunny'
import { Resampler, SR } from './resample'
import { decodeMp3, looksMp3 } from './mp3'

export { Resampler, SR } from './resample'

export class BadFile extends Error {}

export async function decodeToMono16k(blob: Blob, onProgress: (sec: number, duration: number) => void): Promise<Float32Array> {
  try {
    return await decodeBlob(blob, onProgress)
  } catch (e) {
    // Chrome이 못 푸는 mp3(녹음기 mp3, 앞에 소리 아닌 데이터가 붙은 mp3, WAV 안의 mp3)는 mpg123으로 처음부터 다시
    if (!(e instanceof BadFile) || !(await looksMp3(blob))) throw e
    try {
      const pcm = await decodeMp3(blob, onProgress)
      if (pcm.length) return pcm
    } catch {
      // mpg123도 못 풀면 처음 오류로
    }
    throw e
  }
}

async function decodeBlob(blob: Blob, onProgress: (sec: number, duration: number) => void): Promise<Float32Array> {
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
