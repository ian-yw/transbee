import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../types'
import { addSilenceMarks, asrWindows, buildUtterances, FPS, giveBackTails, joinSeam, mergeChannels, speakerMap, speakerTurns, speechRuns, trimEnd, wordSpeaker, type Activity, type AsrWord } from './assemble'

// 초 단위 구간으로 두 화자 활동 만들기
function activity(sec: number, spans: [0 | 1, number, number][]): Activity {
  const p: [Float32Array, Float32Array] = [new Float32Array(sec * FPS), new Float32Array(sec * FPS)]
  for (const [s, a, b] of spans) p[s].fill(0.9, a * FPS, b * FPS)
  return { p }
}
const w = (text: string, start: number, end: number, speaker: 0 | 1): AsrWord => ({ text, start, end, speaker, confidence: 0.8 })

describe('2화자 합치기', () => {
  it('가장 오래 말한 두 채널이 화자, 나머지는 임베딩이 가까운 쪽', () => {
    const e = (x: number, y: number) => Float32Array.of(x, y)
    // 채널 0(10초), 1(2초, 채널 2와 같은 사람), 2(8초)
    const map = speakerMap([10, 2, 8], [e(1, 0), e(0.1, 1), e(0, 1)])
    expect(map).toEqual([0, 1, 1])
    // 채널 3개 확률을 합치면 합친 쪽은 최댓값
    const probs = Float32Array.of(0.9, 0.2, 0.7, /* t1 */ 0.1, 0.6, 0.3)
    const a = mergeChannels(probs, 3, map)
    expect([...a.p[0]].map((x) => +x.toFixed(2))).toEqual([0.9, 0.1])
    expect([...a.p[1]].map((x) => +x.toFixed(2))).toEqual([0.7, 0.6])
  })
})

describe('단어 → 발화', () => {
  const a = activity(20, [[0, 0, 3], [1, 3.2, 5], [1, 9, 11], [0, 10.5, 11]])
  const words = [w(' 네,', 0.1, 0.5, 0), w(' 오늘은', 0.6, 2.9, 0), w(' 음..', 3.3, 4.9, 1), w(' 그게', 9.1, 10, 1), w(' 요', 10.1, 10.9, 1)]
  const utts = buildUtterances(words, a, DEFAULT_SETTINGS)

  it('화자가 바뀌거나 긴 무음이면 새 발화, 겹침·단어 보존', () => {
    expect(utts.map((u) => [u.speaker, u.text])).toEqual([[0, '네, 오늘은'], [1, '음..'], [1, '그게 요']])
    expect(utts[2].overlap).toBe(true)
    expect(utts[0].overlap).toBeUndefined()
    expect(utts[0].words?.map((x) => x.text)).toEqual(['네,', '오늘은'])
    // 겹침(10.5~11초)에 걸친 단어만 표시
    expect(utts[2].words?.map((x) => !!x.overlap)).toEqual([false, true])
    expect(utts.every((u) => u.review === 'draft' && u.modelSpeaker === u.speaker)).toBe(true)
  })

  it('말차례 끝 단어가 쉼을 건너 상대 말까지 늘어나도 앞부분 화자, 끝은 그 화자가 멈춘 곳 근처로', () => {
    const b = activity(10, [[0, 1, 5.6], [1, 6.3, 9]])
    expect(wordSpeaker(b, 5.3, 6.8)).toBe(0)
    expect(trimEnd(b, 0, 5.3, 6.8)).toBeCloseTo(5.7)
    expect(trimEnd(b, 1, 6.5, 7)).toBe(7)
  })

  it('0.3초보다 짧은 겹침(말 바뀔 때 번짐)은 겹침이 아님', () => {
    const b = activity(6, [[0, 0, 3.15], [1, 3, 5]])
    const us = buildUtterances([w(' 네', 0.2, 3.1, 0), w(' 음', 3.2, 4.8, 1)], b, DEFAULT_SETTINGS)
    expect(us.map((u) => !!u.overlap)).toEqual([false, false])
  })

  it('침묵 표기: silenceMin(3초) 이상 무음 뒤 발화 앞에 (침묵 N초)', () => {
    const marked = addSilenceMarks(utts, a, DEFAULT_SETTINGS)
    expect(marked.map((u) => u.text)).toEqual(['네, 오늘은', '음..', '(침묵 4초) 그게 요'])
    const short = addSilenceMarks(utts, a, { silenceMin: 3, silenceFormat: 'short' })
    expect(short[2].text).toBe('(4초) 그게 요')
  })

  it('이어 하기 이음매: 같은 사람 말이 이어지면 한 문장, 무음이 길거나 화자가 다르면 따로', () => {
    const [x, , y] = utts // 화자0 0~2.9, 화자1 9.1~10.9
    const cut = buildUtterances([w(' 오늘은', 3.3, 4.0, 0)], activity(20, [[0, 0, 4]]), DEFAULT_SETTINGS)
    const b = activity(20, [[0, 0, 4]])
    expect(joinSeam([x], cut, b, DEFAULT_SETTINGS).map((u) => u.text)).toEqual(['네, 오늘은 오늘은'])
    expect(joinSeam([x], [y], a, DEFAULT_SETTINGS)).toHaveLength(2)
  })

  it('맞바꾼 상태로 이어 하면 speaker만 뒤집고 modelSpeaker는 그대로', () => {
    const swapped = buildUtterances(words, a, DEFAULT_SETTINGS, true)
    expect(swapped.map((u) => [u.speaker, u.modelSpeaker])).toEqual([[1, 0], [0, 1], [0, 1]])
  })
})

describe('구간 나누기', () => {
  it('말소리 구간 → 인식 구간(28초 이하, 2초 이상 쉼에서 끊음), turn', () => {
    const a = activity(80, [[0, 1, 10], [1, 10.1, 20], [0, 23, 70]])
    const runs = speechRuns(a)
    expect(runs).toEqual([[1, 20], [23, 70]])
    const wins = asrWindows(a, runs)
    expect(wins.every(([s, e]) => e - s <= 28.4)).toBe(true)
    expect(wins[0]).toEqual([0.8, 20.2])
    expect(wins.at(-1)![1]).toBeCloseTo(70.2)
    // 쉼 없이 긴 말을 자른 자리는 여유를 붙이지 않아 구간이 겹치지 않는다
    expect(wins.every((w, i) => !i || w[0] >= wins[i - 1][1])).toBe(true)
    expect(speakerTurns(a).map((t) => t.speaker)).toEqual([0, 1, 0])
  })
})

describe('상대 줄로 떨어진 문장 끝 돌려주기', () => {
  const u = (speaker: 0 | 1, start: number, end: number, text: string) => ({ id: `u${start}`, speaker, modelSpeaker: speaker, start, end, text, review: 'draft' as const })
  it('붙어 있는 짧은 상대 줄은 붙은 쪽 줄로 돌려주고, 맞장구 한 마디나 떨어진 줄은 둔다', () => {
    const us = giveBackTails([u(0, 0, 3, '그렇게 했'), u(1, 3, 3.4, '습니다.'), u(0, 3.5, 6, '그래서요'), u(1, 7, 7.3, '음.'), u(0, 7.5, 9, '네.'), u(1, 10, 10.5, '그런'), u(0, 11, 12, '끝')])
    expect(us.map((x) => x.text)).toEqual(['그렇게 했 습니다.', '그래서요', '음.', '네.', '그런', '끝'])
    expect(us.map((x) => x.speaker)).toEqual([0, 0, 1, 0, 1, 0])
    // 앞 줄이 끝난 문장이면(진짜 짧은 대답), 뒤 줄에만 붙어 있으면 그대로
    expect(giveBackTails([u(0, 0, 3, '그랬어요.'), u(1, 3, 3.5, '맞아요'), u(0, 3.5, 6, '나')]).map((x) => x.speaker)).toEqual([0, 1, 0])
    expect(giveBackTails([u(0, 0, 3, '가'), u(1, 3.5, 4, '그러니까'), u(0, 4, 6, '나')]).map((x) => x.text)).toEqual(['가', '그러니까', '나'])
  })
})
