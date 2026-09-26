import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import gold from '../../fixtures/demo-gold.json'
import type { ExportOptions } from './index'
import type { Transcript } from '../types'
import { countDrafts, DEFAULT_EXPORT, toClipboard, toDocx, toHwpx, toTxt, toXlsx } from './index'
import { cleanText, isBackchannel } from './common'

const demo = () => structuredClone(gold) as Transcript
const opt = (patch: Partial<ExportOptions> = {}, include: Partial<ExportOptions['include']> = {}): ExportOptions => ({
  ...DEFAULT_EXPORT,
  ...patch,
  include: { ...DEFAULT_EXPORT.include, ...include },
})
const TABLE = opt({ layout: 'table' })
const unzip = async (b: Blob) => unzipSync(new Uint8Array(await b.arrayBuffer()))

describe('범위·초벌 수', () => {
  it('소제목 범위 = 그 소제목부터 다음 소제목 전까지', () => {
    const t = demo()
    t.utterances[9].review = 'heard'
    expect(countDrafts(t, DEFAULT_EXPORT)).toBe(23)
    const s2 = opt({ range: { kind: 'sections', sectionIds: ['s2'] } })
    expect(countDrafts(t, s2)).toBe(7) // u009~u016 8개 중 u010 확인
    const lines = toTxt(t, s2).trim().split('\n')
    expect(lines[0]).toBe('[검사 결과 보기 전]')
    expect(lines[1]).toMatch(/^상담자 5: 그럼 검사 결과를/)
    expect(lines).toHaveLength(9)
  })
})

describe('사례보고서 모양', () => {
  it('제목 줄, 고른 소제목 사이 〈중략〉, 번호는 녹음 전체 기준 그대로', () => {
    const o = opt({ title: '3회기 축어록', range: { kind: 'sections', sectionIds: ['s1', 's3'] } })
    const lines = toTxt(demo(), o).trim().split('\n')
    expect(lines[0]).toBe('[3회기 축어록]')
    expect(lines).toContain('〈중략〉')
    const after = lines.slice(lines.indexOf('〈중략〉')).find((l) => l.startsWith('상담자'))
    expect(after).toMatch(/^상담자 9: /)
    expect(toTxt(demo(), { ...o, gapMark: false })).not.toContain('〈중략〉')
  })
  it('한글 파일: 내어쓰기 문단(20), 〈중략〉 가운데(21)', async () => {
    const o = opt({ range: { kind: 'sections', sectionIds: ['s1', 's3'] } })
    const sec = strFromU8((await unzip(await toHwpx(demo(), o)))['Contents/section0.xml'])
    expect(sec).toMatch(/paraPrIDRef="20"[^>]*><hp:run charPrIDRef="0"><hp:t>상담자 1: /)
    expect(sec).toMatch(/paraPrIDRef="21"[^>]*><hp:run charPrIDRef="0"><hp:t>〈중략〉/)
    const ids = [...sec.matchAll(/<hp:p id="(\d+)"/g)].map((m) => m[1])
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('괄호 표기 거르기', () => {
  const s = '좋아요 (웃음) (네) 그래서 (음음)(침묵 4초).'
  it('맞장구 판정', () => {
    for (const p of ['(네)', '(예)', '(음)', '(응)', '(아)', '(어)', '(네네)', '(상: 음)', '(내: 네.)', '(상,내: 으음)']) expect(isBackchannel(p)).toBe(true)
    for (const p of ['(웃음)', '(침묵 4초)', '(네, 맞아요)', '(네?)', '()', '(내: 웃음)']) expect(isBackchannel(p)).toBe(false)
  })
  it('비언어 끄고 맞장구 유지', () => {
    expect(cleanText(s, { ...DEFAULT_EXPORT.include, nonverbal: false })).toBe('좋아요 (네) 그래서 (음음).')
  })
  it('둘 다 끔 / 맞장구만 끔', () => {
    expect(cleanText(s, { ...DEFAULT_EXPORT.include, nonverbal: false, backchannel: false })).toBe('좋아요 그래서.')
    expect(cleanText(s, { ...DEFAULT_EXPORT.include, backchannel: false })).toBe('좋아요 (웃음) 그래서 (침묵 4초).')
  })
  it('아무것도 안 빼면 원문 그대로', () => {
    expect(cleanText('음 ... 네', DEFAULT_EXPORT.include)).toBe('음 ... 네')
  })
  it('괄호만 있던 문장은 빠진다', () => {
    const t = demo()
    t.utterances[1].text = '(침묵 4초)'
    expect(toTxt(t, opt({}, { nonverbal: false }))).not.toContain('내담자 1:')
    expect(toTxt(t, DEFAULT_EXPORT)).toContain('내담자 1: (침묵 4초)')
  })
})

describe('글자만(.txt)', () => {
  it('줄글: 시각·라벨·소제목, 한 시간 넘으면 H:MM:SS', () => {
    const t = demo()
    t.utterances[23].start = 3725
    const txt = toTxt(t, opt({ label: 'short' }, { time: true }))
    expect(txt.startsWith('[상담 시작]\n[00:00] 상1: 네, 오늘은')).toBe(true)
    expect(txt).toContain('\n\n[검사 결과 보기]\n')
    expect(txt).toContain('[1:02:05] 내12: 음.. 그냥..')
    expect(toTxt(t, opt({}, { sections: false })).split('\n')[0]).toBe('상담자 1: 네, 오늘은 지난주에 하신 검사 결과를 같이 보려고 해요.')
  })
  it('표: 탭 칸, 칸 구성 옵션', () => {
    const lines = toTxt(demo(), TABLE).split('\n')
    expect(lines[0]).toBe('번호\t화자\t내용\t메모')
    expect(lines[1]).toBe('상담 시작')
    expect(lines[2]).toBe('1\t상담자 1\t네, 오늘은 지난주에 하신 검사 결과를 같이 보려고 해요.\t')
    const withTime = toTxt(demo(), opt({ layout: 'table', columns: { number: false, speaker: true, time: true, memo: false } }))
    expect(withTime.split('\n')[2]).toBe('상담자 1\t00:00\t네, 오늘은 지난주에 하신 검사 결과를 같이 보려고 해요.')
  })
})

describe('복사해서 붙이기(HTML)', () => {
  it('표: 테두리·머리 음영·소제목 구분 행이 속성과 인라인 style 둘 다에', () => {
    const { html, text } = toClipboard(demo(), TABLE)
    expect(html).toMatch(/^<table border="1" cellspacing="0"[^>]*style="border-collapse:collapse/)
    expect(html).toContain('bgcolor="#E6E6E6"')
    expect(html.match(/colspan="4"/g)).toHaveLength(3)
    expect(html).toContain('함초롬바탕')
    expect(text).toBe(toTxt(demo(), TABLE))
  })
  it('줄글: 문단, 특수문자 이스케이프', () => {
    const t = demo()
    t.utterances[0].text = 'a<b & "c"'
    const { html } = toClipboard(t, DEFAULT_EXPORT)
    expect(html).toContain('<p style="margin:0 0 4pt 0;')
    expect(html).toContain('상담자 1: a&lt;b &amp; &quot;c&quot;')
    expect(html).toContain('padding-left:4em;text-indent:-4em') // 내어쓰기
  })
})

describe('파일 형식', () => {
  it('hwpx: mimetype가 첫 항목·무압축, 필수 파일, 표 행 수', async () => {
    const blob = await toHwpx(demo(), TABLE)
    const raw = new Uint8Array(await blob.arrayBuffer())
    expect(strFromU8(raw.slice(30, 38))).toBe('mimetype') // 첫 로컬 헤더의 파일 이름
    expect(raw[8] | (raw[9] << 8)).toBe(0) // 압축 방식 0 = 무압축
    const z = unzipSync(raw)
    expect(Object.keys(z)[0]).toBe('mimetype')
    expect(strFromU8(z.mimetype)).toBe('application/hwp+zip')
    for (const f of ['version.xml', 'META-INF/container.xml', 'Contents/content.hpf', 'Contents/header.xml', 'Contents/section0.xml', 'settings.xml'])
      expect(z[f], f).toBeDefined()
    const sec = strFromU8(z['Contents/section0.xml'])
    expect(sec.match(/<hp:tr>/g)).toHaveLength(1 + 3 + 24)
    expect(sec).toContain('rowCnt="28" colCnt="4"')
    expect(sec).toContain('<hp:t>번호</hp:t>')
    expect(strFromU8(z['Contents/header.xml'])).toContain('<hh:borderFill id="4"')
  })
  it('hwpx 줄글: 소제목·문장이 문단으로', async () => {
    const z = await unzip(await toHwpx(demo(), DEFAULT_EXPORT))
    const sec = strFromU8(z['Contents/section0.xml'])
    expect(sec.match(/<hp:p /g)).toHaveLength(3 + 24)
    expect(sec).toContain('<hp:run charPrIDRef="7"><hp:t>상담 시작</hp:t></hp:run>')
  })
  it('xlsx: 머리 + 행, 소제목 칸 합치기', async () => {
    const z = await unzip(await toXlsx(demo(), TABLE))
    const sheet = strFromU8(z['xl/worksheets/sheet1.xml'])
    expect(sheet.match(/<row /g)).toHaveLength(1 + 3 + 24)
    expect(sheet).toContain('<mergeCells count="3"><mergeCell ref="A2:D2"/>')
    expect(sheet).toContain('<t xml:space="preserve">내용</t>')
  })
  it('docx: 표는 머리 반복·소제목 gridSpan, 줄글은 문단', async () => {
    const table = strFromU8((await unzip(await toDocx(demo(), TABLE)))['word/document.xml'])
    expect(table).toContain('<w:tblHeader/>')
    expect(table.match(/<w:gridSpan w:val="4"\/>/g)).toHaveLength(3)
    const prose = strFromU8((await unzip(await toDocx(demo(), DEFAULT_EXPORT)))['word/document.xml'])
    expect(prose).not.toContain('<w:tbl>')
    expect(prose).toContain('<w:ind w:left="800" w:hanging="800"/></w:pPr><w:r><w:t xml:space="preserve">상담자 1: 네, 오늘은')
  })
})
