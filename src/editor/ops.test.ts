import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, FORMAT_VERSION, type Transcript, type Utterance } from '../types'
import {
  acceptSuggestion,
  commit,
  createHistory,
  findName,
  markHeard,
  maskNames,
  countNames,
  mergeWithPrevious,
  nextSpot,
  redo,
  resilence,
  setSpeaker,
  setText,
  splitUtterance,
  setRoles,
  swapSpeakers,
  timeAtOffset,
  undo,
} from './ops'
import { changedEnd } from './Row'

const u = (id: string, speaker: 0 | 1, start: number, end: number, text: string, extra: Partial<Utterance> = {}): Utterance => ({
  id,
  speaker,
  modelSpeaker: speaker,
  start,
  end,
  text,
  review: 'draft',
  ...extra,
})

const tr = (utterances: Utterance[]): Transcript => ({
  formatVersion: FORMAT_VERSION,
  id: 't1',
  title: 't',
  createdAt: '',
  updatedAt: '',
  audio: { fileName: 'a.m4a', mime: 'audio/mp4', duration: 60 },
  speakers: { roles: ['counselor', 'client'] },
  utterances,
  sections: [{ id: 's1', title: '시작', beforeUtteranceId: 'b' }],
  model: { asr: '', diarization: '', vad: '', app: '' },
  processing: { status: 'done', processedUntil: 60 },
  settings: DEFAULT_SETTINGS,
})

const words = [
  { text: '솔직히', start: 10, end: 11 },
  { text: '좀', start: 11.5, end: 12 },
  { text: '긴장됐어요.', start: 13, end: 15 },
]

describe('나누기·합치기 시각', () => {
  it('단어 시각이 있으면 나눈 자리 다음 단어의 시작 시각', () => {
    const x = u('a', 1, 10, 15, '솔직히 좀 긴장됐어요.', { words })
    expect(timeAtOffset(x, '솔직히 좀 '.length)).toBe(13)
    const r = splitUtterance(tr([x]), 'a', '솔직히 좀 '.length)!
    const [a, b] = r.t.utterances
    expect([a.text, a.start, a.end]).toEqual(['솔직히 좀', 10, 13])
    expect([b.text, b.start, b.end, b.speaker]).toEqual(['긴장됐어요.', 13, 15, 1])
    expect(a.words).toHaveLength(2)
    expect(b.words).toHaveLength(1)
  })

  it('소리 제안은 그 시각의 낱말 뒤에 넣는다', () => {
    const x = u('a', 1, 10, 15, '솔직히 좀 긴장됐어요.', { words, suggestions: [{ id: 'n', label: '웃음', at: 11.7, confidence: 0.7 }] })
    expect(acceptSuggestion(tr([x]), 'a', 'n').utterances[0]).toMatchObject({ text: '솔직히 좀 (웃음) 긴장됐어요.', suggestions: [] })
  })

  it('단어 시각이 없으면 글자 비율', () => {
    const x = u('a', 0, 0, 10, '가나 다라마바사아자차') // 공백 뺀 10글자, 앞 2글자
    expect(timeAtOffset(x, 2)).toBeCloseTo(2)
  })

  it('합치면 시각·단어·소제목이 이어지고, 다시 나누면 원래 시각', () => {
    const t = tr([u('a', 0, 0, 5, '앞 문장', { words: [{ text: '앞', start: 0, end: 1 }, { text: '문장', start: 1, end: 5 }] }), u('b', 0, 6, 9, '뒷 문장', { words: [{ text: '뒷', start: 6, end: 7 }, { text: '문장', start: 7, end: 9 }] })])
    const m = mergeWithPrevious(t, 'b')!
    const x = m.t.utterances[0]
    expect([x.text, x.start, x.end, m.caret]).toEqual(['앞 문장 뒷 문장', 0, 9, 5])
    expect(m.t.sections[0].beforeUtteranceId).toBe('a')
    const s = splitUtterance(m.t, 'a', m.caret)!
    expect(s.t.utterances[1].start).toBe(6)
    expect(mergeWithPrevious(t, 'a')).toBeNull()
  })
})

describe('실행취소', () => {
  it('되돌리고 다시 하기, 같은 문장 타이핑은 한 번으로 묶음, 들음 표시는 남김', () => {
    let h = createHistory(tr([u('a', 0, 0, 1, '가'), u('b', 1, 1, 2, '나')]))
    h = commit(h, setText(h.t, 'a', '가나'), 'type:a', 1000)
    h = commit(h, setText(h.t, 'a', '가나다'), 'type:a', 1500)
    h = { ...h, t: markHeard(h.t, ['b']) }
    expect(h.past).toHaveLength(1)
    h = undo(h)
    expect(h.t.utterances[0].text).toBe('가')
    expect(h.t.utterances[1].review).toBe('heard')
    h = redo(h)
    expect(h.t.utterances[0]).toMatchObject({ text: '가나다', review: 'edited' })
  })
})

describe('화자·이름', () => {
  it('두 화자 전체 맞바꾸기', () => {
    expect(swapSpeakers(tr([u('a', 0, 0, 1, '')])).speakers.roles).toEqual(['client', 'counselor'])
    const t = tr([u('a', 0, 0, 1, ''), u('b', 1, 1, 2, '')])
    const none = swapSpeakers({ ...t, speakers: { roles: [null, null] } })
    expect(none.utterances.map((x) => x.speaker)).toEqual([1, 0])
  })

  it('화자가 바뀌면 괄호 속 화자 이름도 같은 사람으로', () => {
    const t = tr([u('a', 0, 0, 1, '했 (내: 음) 습니다 (상,내: 웃음) (오늘: 네)')])
    expect(swapSpeakers(t).utterances[0].text).toBe('했 (상: 음) 습니다 (상,내: 웃음) (오늘: 네)')
    const none = { ...t, speakers: { roles: [null, null] as Transcript['speakers']['roles'] }, utterances: [{ ...t.utterances[0], text: '(화자2: 네)' }] }
    expect(swapSpeakers(none).utterances[0].text).toBe('(화자1: 네)')
    expect(setRoles(none, 1).utterances[0].text).toBe('(상: 네)')
  })

  it('이름 가리기: 여러 이름, 문맥, 확인 상태 유지', () => {
    const t = tr([u('a', 0, 0, 1, '지수 씨가 한빛고에서 지수를', { review: 'heard' })])
    expect(findName(t, '지수')).toHaveLength(2)
    expect(findName(t, '한빛고')[0]).toMatchObject({ before: '지수 씨가 ', after: '에서 지수를' })
    const m = maskNames(t, [{ from: '지수', to: 'OO' }, { from: '한빛고', to: '△△고' }])
    expect(m.utterances[0]).toMatchObject({ text: 'OO 씨가 △△고에서 OO를', review: 'heard' })
  })

  it('이름 가리기: 적은 순서와 상관없이 긴 이름부터, 개수는 실제로 바뀌는 곳', () => {
    const t = tr([u('a', 0, 0, 1, '민준이가 민준 씨에게')])
    const pairs = [{ from: '민준', to: 'OO' }, { from: '민준이', to: 'OO이' }]
    expect(maskNames(t, pairs).utterances[0].text).toBe('OO이가 OO 씨에게')
    expect(countNames(t, pairs)).toBe(2)
  })
})

describe('확인 상태·확인할 곳', () => {
  it('재생으로 붙은 들음도 저장할 고침(updatedAt이 바뀜)', () => {
    const t = tr([u('a', 0, 0, 1, '가')])
    expect(markHeard(t, ['a']).updatedAt).not.toBe(t.updatedAt)
    expect(markHeard(t, ['x'])).toBe(t)
  })

  it('확인할 곳 = 신뢰도 0.6 미만 단어·겹친 단어, 커서 뒤 다음 곳으로(고친 문장·확인한 문장은 건너뜀)', () => {
    const ws = (c: number[], ov = -1) => ['가나', '다라', '마바'].map((text, i) => ({ text, start: i, end: i + 0.5, confidence: c[i], overlap: i === ov || undefined }))
    const us = [
      u('a', 0, 0, 3, '가나 다라 마바', { words: ws([0.65, 0.5, 0.95]) }),
      u('b', 1, 3, 6, '가나 다라 마바', { words: ws([0.9, 0.9, 0.9], 2), overlap: true }),
      u('c', 0, 6, 9, '가나 다라 마바', { words: ws([0.1, 0.1, 0.1]), review: 'heard' }),
    ]
    expect(nextSpot(us, 0, -1)).toMatchObject({ index: 0, spot: { from: 3, to: 5, kind: 'doubt' } })
    expect(nextSpot(us, 0, 3)).toMatchObject({ index: 1, spot: { from: 6, kind: 'overlap' } })
    expect(nextSpot(us, 1, 6)).toMatchObject({ index: 0, spot: { from: 3 } }) // 끝나면 처음부터
    expect(nextSpot([{ ...us[0], review: 'edited' }], 0, -1)).toBeNull()
  })

  it('침묵 기준 바꾸기: 맨 앞 자동 표기만 다시 정함(있던 표기는 엔진이 잰 초 기준)', () => {
    const t = tr([u('a', 0, 0, 1, '가'), u('b', 1, 5, 6, '(침묵 4초) 나'), u('c', 0, 8.5, 9, '다 (침묵 9초)')])
    expect(resilence(t, 5).utterances.map((x) => x.text)).toEqual(['가', '나', '다 (침묵 9초)'])
    expect(resilence(t, 2).utterances.map((x) => x.text)).toEqual(['가', '(침묵 4초) 나', '(침묵 3초) 다 (침묵 9초)'])
  })

  it('화자 바꾸기·나누기에도 modelSpeaker(엔진 배정)는 그대로', () => {
    const t = setSpeaker(tr([u('a', 0, 10, 15, '솔직히 좀 긴장됐어요.', { words })]), 'a', 1)
    const r = splitUtterance(t, 'a', 4)!
    expect(r.t.utterances.map((x) => [x.speaker, x.modelSpeaker])).toEqual([[1, 0], [1, 0]])
  })

  it('되돌리기 뒤 커서 자리 = 바뀐 부분의 끝', () => {
    expect(changedEnd('가나다라', '가라')).toBe(1) // 타이핑 되돌림: 지운 자리
    expect(changedEnd('가라', '가나다라')).toBe(3) // 다시 하기: 넣은 글자 뒤
    expect(changedEnd('가나', '가나')).toBe(2)
  })
})
