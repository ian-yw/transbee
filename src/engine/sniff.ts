// 파일 앞부분만 보고 형식을 알아낸다. 소리를 풀지 않고, 녹음 내용도 읽지 않는다.

// mp3 프레임 머리(4바이트) → 프레임 길이. [버전][레이어] 비트레이트(kbps)와 샘플레이트
const V1 = [
  [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448], // Layer I
  [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384], // Layer II
  [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320], // Layer III
]
const V2 = [
  [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
  [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
  [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
]
const RATES: Record<number, number[]> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] }

function frameLen(b: Uint8Array, i: number): number {
  if (b[i] !== 0xff || (b[i + 1] & 0xe0) !== 0xe0) return 0
  const ver = (b[i + 1] >> 3) & 3, layer = (b[i + 1] >> 1) & 3 // ver 1·layer 0은 없는 값
  const bri = b[i + 2] >> 4, sri = (b[i + 2] >> 2) & 3, pad = (b[i + 2] >> 1) & 1
  if (ver === 1 || layer === 0 || bri === 0 || bri === 15 || sri === 3) return 0
  const li = 3 - layer // 0 = Layer I
  const br = (ver === 3 ? V1 : V2)[li][bri] * 1000, sr = RATES[ver][sri]
  if (li === 0) return (Math.floor((12 * br) / sr) + pad) * 4
  return Math.floor(((li === 2 && ver !== 3 ? 72 : 144) * br) / sr) + pad
}

/** mp3 프레임이 `need`개 이어지는(버전·레이어·샘플레이트가 같은) 첫 자리. 없으면 -1 */
export function mp3Start(b: Uint8Array, need = 4): number {
  for (let i = 0; i + 4 <= b.length; i++) {
    const key = (b[i + 1] & 0xfe) | ((b[i + 2] & 0x0c) << 8)
    let at = i, n = 0
    while (n < need && at + 4 <= b.length) {
      const len = frameLen(b, at)
      if (!len || ((b[at + 1] & 0xfe) | ((b[at + 2] & 0x0c) << 8)) !== key) break
      at += len
      n++
    }
    if (n === need) return i
  }
  return -1
}

/** 맨 앞 ID3v2 태그 길이(없으면 0) */
export function id3Size(b: Uint8Array): number {
  if (b.length < 10 || b[0] !== 0x49 || b[1] !== 0x44 || b[2] !== 0x33) return 0
  const size = ((b[6] & 0x7f) << 21) | ((b[7] & 0x7f) << 14) | ((b[8] & 0x7f) << 7) | (b[9] & 0x7f)
  return 10 + size + (b[5] & 0x10 ? 10 : 0)
}

const ASF = [0x30, 0x26, 0xb2, 0x75, 0x8e, 0x66, 0xcf, 0x11]

/** 브라우저가 풀지 못하는 녹음기 형식: WMA, ADPCM WAV. 그 밖은 undefined */
export function fileKind(b: Uint8Array): 'wma' | 'adpcm' | undefined {
  if (ASF.every((v, i) => b[i] === v)) return 'wma'
  const tag = (s: string, i: number) => [...s].every((c, k) => b[i + k] === c.charCodeAt(0))
  if (!tag('RIFF', 0) || !tag('WAVE', 8)) return
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength)
  for (let i = 12; i + 10 <= b.length; i += 8 + v.getUint32(i + 4, true) + (v.getUint32(i + 4, true) & 1)) {
    if (!tag('fmt ', i)) continue
    const fmt = v.getUint16(i + 8, true)
    if (fmt === 0x0002 || fmt === 0x0011) return 'adpcm'
    if (fmt >= 0x0160 && fmt <= 0x0163) return 'wma'
    return
  }
}
