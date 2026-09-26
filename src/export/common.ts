// 내보내기 형식들이 같이 쓰는 것: 범위 고르기, 괄호 표기 거르기, 줄(행) 만들기, 표 칸, zip.
import { strToU8, zipSync, type Zippable } from 'fflate'
import { stamp, utteranceLabels } from '../labels'
import type { Transcript } from '../types'
import type { ExportOptions } from './index'

export type Row =
  | { kind: 'section'; title: string }
  | { kind: 'gap' }
  | { kind: 'utt'; n: number; label: string; time: string; text: string }

/** 고르지 않은 부분을 건너뛴 자리 표시(사례보고서 관례) */
export const GAP = '〈중략〉'
export type UttRow = Extract<Row, { kind: 'utt' }>

/**
 * 짧은 맞장구 괄호 판정 — 이 규칙 하나만 쓴다.
 * (네) (예) (음) (응) (아) (어) (오) (으음)과 그 반복((네네) (음음))만 맞장구. 화자가 붙어도((상: 음)) 같다.
 * (네, 맞아요)처럼 말이 붙으면 아님.
 */
export const isBackchannel = (paren: string) => /^\((?:[^():]+:\s*)?(?:네|예|음|응|아|어|으|오)+\.?\)$/.test(paren)

/** 괄호 표기를 옵션대로 남기거나 뺀다. 맞장구는 include.backchannel, 나머지는 include.nonverbal이 정한다. */
export function cleanText(text: string, inc: ExportOptions['include']): string {
  let removed = false
  const out = text.replace(/\([^()]*\)/g, (p) => {
    if (isBackchannel(p) ? inc.backchannel : inc.nonverbal) return p
    removed = true
    return ''
  })
  // 뺀 자리의 빈칸만 정리한다. 아무것도 안 뺐으면 사용자가 쓴 그대로.
  return removed ? out.replace(/[ \t]{2,}/g, ' ').replace(/ +([.,?!])/g, '$1').trim() : text.trim()
}

/** 소제목을 발화 순서대로. 가리키는 발화가 없는 소제목은 뺀다. */
function orderedSections(t: Transcript) {
  const idx = new Map(t.utterances.map((u, i) => [u.id, i]))
  return t.sections
    .filter((s) => idx.has(s.beforeUtteranceId))
    .map((s) => ({ ...s, at: idx.get(s.beforeUtteranceId)! }))
    .sort((a, b) => a.at - b.at)
}

/** 발화별로 범위 안인지. 소제목 범위 = 그 소제목부터 다음 소제목 전까지. */
export function rangeMask(t: Transcript, o: ExportOptions): boolean[] {
  if (o.range.kind === 'all') return t.utterances.map(() => true)
  const mask = t.utterances.map(() => false)
  const secs = orderedSections(t)
  const chosen = new Set(o.range.sectionIds)
  secs.forEach((s, k) => {
    if (!chosen.has(s.id)) return
    const end = k + 1 < secs.length ? secs[k + 1].at : t.utterances.length
    for (let i = s.at; i < end; i++) mask[i] = true
  })
  return mask
}

export function buildRows(t: Transcript, o: ExportOptions): Row[] {
  const labels = utteranceLabels(t, o.label === 'full')
  const mask = rangeMask(t, o)
  const titlesAt = new Map<number, string[]>()
  for (const s of orderedSections(t)) titlesAt.set(s.at, [...(titlesAt.get(s.at) ?? []), s.title])
  const rows: Row[] = []
  if (o.title.trim()) rows.push({ kind: 'section', title: o.title.trim() })
  let seen = false
  t.utterances.forEach((u, i) => {
    if (!mask[i]) return
    // 앞서 고른 부분과 떨어져 있으면 〈중략〉. 번호는 녹음 전체 기준 그대로(사례보고서도 발췌한 번호를 이어 쓴다)
    if (o.gapMark && seen && !mask[i - 1]) rows.push({ kind: 'gap' })
    seen = true
    if (o.include.sections) for (const title of titlesAt.get(i) ?? []) rows.push({ kind: 'section', title })
    const text = cleanText(u.text, o.include)
    // 괄호 표기만 있던 문장((침묵 4초) 등)은 거르면 비므로 뺀다. 번호는 전체 순번이라 빈 번호가 생긴다.
    if (text) rows.push({ kind: 'utt', n: i + 1, label: labels[i], time: stamp(u.start), text })
  })
  return rows
}

/** 줄글 한 줄: "상담자 7: 본문", 시각을 넣으면 "[12:04] 상담자 7: 본문" */
export const proseLine = (r: UttRow, o: ExportOptions) =>
  `${o.include.time ? `[${r.time}] ` : ''}${r.label}: ${r.text}`

export type ColKey = 'number' | 'speaker' | 'time' | 'content' | 'memo'
export interface Col {
  key: ColKey
  title: string
  /** 한글·워드 칸 너비(mm). 모든 칸 합 = TABLE_MM */
  mm: number
  /** 엑셀 열 너비(글자 수) */
  xl: number
}
/** A4에 좌우 여백 30mm → 본문 너비 150mm */
export const TABLE_MM = 150

export function tableCols(o: ExportOptions): Col[] {
  const c = o.columns
  const cols: Col[] = []
  if (c.number) cols.push({ key: 'number', title: '번호', mm: 12, xl: 6 })
  if (c.speaker) cols.push({ key: 'speaker', title: '화자', mm: 15, xl: 8 })
  if (c.time) cols.push({ key: 'time', title: '시각', mm: 18, xl: 9 })
  const content: Col = { key: 'content', title: '내용', mm: 0, xl: 70 }
  cols.push(content)
  if (c.memo) cols.push({ key: 'memo', title: '메모', mm: 40, xl: 30 })
  content.mm = TABLE_MM - cols.reduce((s, x) => s + x.mm, 0)
  return cols
}

export function cellText(r: UttRow, key: ColKey): string {
  switch (key) {
    case 'number':
      return String(r.n)
    case 'speaker':
      return r.label
    case 'time':
      return r.time
    case 'content':
      return r.text
    case 'memo':
      return ''
  }
}

/** XML·HTML 이스케이프. XML에 못 들어가는 제어 문자도 뺀다. */
export const esc = (s: string) =>
  s
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

export const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'

/** 순서대로 zip. store=true인 항목은 무압축(hwpx mimetype). */
export function zip(files: [name: string, data: string, store?: boolean][], type: string): Blob {
  const z: Zippable = {}
  for (const [name, data, store] of files) z[name] = [strToU8(data), { level: store ? 0 : 6 }]
  return new Blob([zipSync(z) as Uint8Array<ArrayBuffer>], { type })
}
