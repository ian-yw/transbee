// 내보내기 공개 계약. 화면은 이 함수들만 부른다.
import type { Transcript } from '../types'
import { buildRows, cellText, esc, GAP, proseLine, rangeMask, tableCols, TABLE_MM } from './common'
import { toHwpxBlob } from './hwpx'
import { toDocxBlob, toXlsxBlob } from './ooxml'

export interface ExportOptions {
  range: { kind: 'all' } | { kind: 'sections'; sectionIds: string[] }
  layout: 'prose' | 'table'
  /** 화자 이름: 'full' = 상담자 1 / 내담자 1(사례보고서 관례), 'short' = 상1 / 내1 */
  label: 'full' | 'short'
  /** 맨 위 제목 줄(예: 11회기 축어록). 비우면 넣지 않는다 */
  title: string
  /** 소제목으로 고른 부분 사이를 〈중략〉으로 잇는다 */
  gapMark: boolean
  /** 표 모양일 때 칸 */
  columns: { number: boolean; speaker: boolean; time: boolean; memo: boolean }
  include: {
    time: boolean // 줄글에서 [12:04]
    nonverbal: boolean // (웃음) (침묵 4초) 등
    sections: boolean // 소제목
    backchannel: boolean // 맞장구 (네) (음) — nonverbal을 꺼도 따로 남길 수 있음
  }
}

/**
 * 기본값 = 문헌 사례보고서 10건(2026-09-25 확인)의 축어록 모양: "N회기 축어록" 제목 아래 줄글,
 * "상담자 1: …" / "내담자 1: …" 내어쓰기, 시각 없음, 맞장구·비언어는 괄호로 본문 안에, 건너뛴 부분은 〈중략〉.
 */
export const DEFAULT_EXPORT: ExportOptions = {
  range: { kind: 'all' },
  layout: 'prose',
  label: 'full',
  title: '',
  gapMark: true,
  columns: { number: true, speaker: true, time: false, memo: true },
  include: { time: false, nonverbal: true, sections: true, backchannel: true },
}

/** 내보내기 범위 안에서 아직 초벌(draft)인 문장 수 */
export function countDrafts(t: Transcript, o: ExportOptions): number {
  const mask = rangeMask(t, o)
  return t.utterances.filter((u, i) => mask[i] && u.review === 'draft').length
}

// 한글·워드 붙여넣기용 HTML. 모양은 모두 태그 속성(border·width·bgcolor)과 인라인 style에 같이 적는다.
// <style> 블록은 Chrome 비동기 클립보드 정리 과정에서 빠지고, 붙여 넣는 쪽도 인라인 모양만 확실히 읽는다.
const FONT = "font-family:'함초롬바탕','HCR Batang','바탕',Batang,serif;font-size:10pt"
const px = (mm: number) => Math.round((mm * 96) / 25.4)
/** 내어쓰기(둘째 줄부터 안으로): 화자 이름 아래로 본문이 흐르지 않게 */
const HANG = 'padding-left:4em;text-indent:-4em'

/** 한글·워드에 붙여 넣을 HTML과 대체 글자 */
export function toClipboard(t: Transcript, o: ExportOptions): { html: string; text: string } {
  const rows = buildRows(t, o)
  let html: string
  if (o.layout === 'table') {
    const cols = tableCols(o)
    const cell = (text: string, w: number | null, extra: string, attrs = '') =>
      `<td${w ? ` width="${px(w)}"` : ''}${attrs} style="border:1px solid #000000;padding:2pt 4pt;${w ? `width:${px(w)}px;` : ''}${FONT};${extra}">${text}</td>`
    const head = `<tr>${cols.map((c) => cell(`<b>${c.title}</b>`, c.mm, 'background:#E6E6E6;font-weight:bold;text-align:center;vertical-align:middle', ' bgcolor="#E6E6E6" align="center"')).join('')}</tr>`
    const body = rows.map((r) =>
      r.kind === 'section'
        ? `<tr>${cell(`<b>${esc(r.title)}</b>`, null, 'font-weight:bold', ` colspan="${cols.length}"`)}</tr>`
        : r.kind === 'gap'
          ? `<tr>${cell(GAP, null, 'text-align:center', ` colspan="${cols.length}" align="center"`)}</tr>`
          : `<tr>${cols.map((c) => cell(esc(cellText(r, c.key)), c.mm, 'vertical-align:top', ' valign="top"')).join('')}</tr>`,
    )
    html = `<table border="1" cellspacing="0" cellpadding="4" width="${px(TABLE_MM)}" style="border-collapse:collapse;width:${px(TABLE_MM)}px;${FONT}">${head}${body.join('')}</table>`
  } else {
    html = rows
      .map((r) =>
        r.kind === 'section'
          ? `<p style="margin:12pt 0 4pt 0;${FONT};font-weight:bold"><b>${esc(r.title)}</b></p>`
          : r.kind === 'gap'
            ? `<p align="center" style="margin:6pt 0;text-align:center;${FONT}">${GAP}</p>`
            : `<p style="margin:0 0 4pt 0;line-height:160%;${HANG};${FONT}">${esc(proseLine(r, o))}</p>`,
      )
      .join('')
  }
  return { html, text: toTxt(t, o) }
}

export async function toHwpx(t: Transcript, o: ExportOptions): Promise<Blob> {
  return toHwpxBlob(t, o)
}
/** 엑셀은 layout과 관계없이 늘 표 모양(칸 구성은 columns). */
export async function toXlsx(t: Transcript, o: ExportOptions): Promise<Blob> {
  return toXlsxBlob(t, o)
}
export async function toDocx(t: Transcript, o: ExportOptions): Promise<Blob> {
  return toDocxBlob(t, o)
}

/** 줄글: "[12:04] 상7: 본문", 소제목 "[소제목]" 줄. 표: 탭으로 나눈 칸(엑셀에 붙이면 칸이 나뉜다). */
export function toTxt(t: Transcript, o: ExportOptions): string {
  const rows = buildRows(t, o)
  if (o.layout === 'table') {
    const cols = tableCols(o)
    const lines = [cols.map((c) => c.title).join('\t')]
    for (const r of rows) {
      lines.push(r.kind === 'section' ? r.title : r.kind === 'gap' ? GAP : cols.map((c) => cellText(r, c.key).replace(/\t/g, ' ')).join('\t'))
    }
    return lines.join('\n') + '\n'
  }
  const lines: string[] = []
  for (const r of rows) {
    if (r.kind === 'section') {
      if (lines.length) lines.push('')
      lines.push(`[${r.title}]`)
    } else lines.push(r.kind === 'gap' ? GAP : proseLine(r, o))
  }
  return lines.join('\n') + '\n'
}
