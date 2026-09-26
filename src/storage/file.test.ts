import { describe, expect, it } from 'vitest'
import { zipSync, strToU8 } from 'fflate'
import { DEFAULT_SETTINGS, FORMAT_VERSION, type Transcript } from '../types'
import { BadFileError, pack, readId, tempFileName, unpack } from './file'

const t: Transcript = {
  formatVersion: FORMAT_VERSION,
  id: 'a1b2',
  title: '3회기: 검사/해석',
  createdAt: '',
  updatedAt: '2026-09-24T00:00:00Z',
  audio: { fileName: 'rec.m4a', mime: 'audio/mp4', duration: 3 },
  speakers: { roles: [null, null] },
  utterances: [{ id: 'a', speaker: 0, modelSpeaker: 0, start: 0, end: 1, text: '네 (웃음)', review: 'draft' }],
  sections: [],
  model: { asr: '', diarization: '', vad: '', app: '' },
  processing: { status: 'done', processedUntil: 3 },
  settings: DEFAULT_SETTINGS,
}

describe('.transbee 작업 파일', () => {
  it('묶었다 풀면 축어록과 녹음 바이트가 그대로', async () => {
    const audio = new Uint8Array(4096).map((_, i) => i % 251)
    const back = await unpack(await pack(t, audio))
    expect(back.transcript).toEqual(t)
    expect(new Uint8Array(await back.audio.arrayBuffer())).toEqual(audio)
    expect(back.audio.type).toBe('audio/mp4')
  })

  it('id가 없던 옛 파일은 열 때 새 id를 붙인다', async () => {
    const { id: _, ...old } = t
    const back = await unpack(await pack(old as Transcript, new Uint8Array(8)))
    expect(back.legacyId).toBe(true)
    expect(back.transcript.id).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('녹음을 풀지 않고 축어록 id만 읽기(같은 이름 다른 작업 파일 구별)', async () => {
    expect(readId(await pack(t, new Uint8Array(8)))).toBe('a1b2')
    expect(readId(new Uint8Array([1, 2, 3]))).toBeUndefined()
  })

  it('다른 zip이나 깨진 파일은 BadFileError', async () => {
    await expect(unpack(zipSync({ 'x.txt': strToU8('x') }))).rejects.toBeInstanceOf(BadFileError)
    await expect(unpack(new Uint8Array([1, 2, 3]))).rejects.toBeInstanceOf(BadFileError)
  })

  it('풀면 크게 부푸는 파일(zip bomb)은 풀기 전에 거절', async () => {
    const big = new Uint8Array(80 * 1024 * 1024) // 0으로 채워져 아주 작게 압축된다
    const bomb = zipSync({ 'transcript.json': [big, { level: 9 }], 'audio/a.m4a': new Uint8Array(10) })
    expect(bomb.length).toBeLessThan(1024 * 1024)
    await expect(unpack(bomb)).rejects.toBeInstanceOf(BadFileError)
  })

  it('파일 이름에 못 쓰는 글자는 바꾼다', () => {
    expect(tempFileName(t.title)).toBe('3회기_ 검사_해석 (임시저장).transbee')
  })
})
