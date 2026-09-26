// 엑셀(.xlsx)·워드(.docx) 최소 OOXML. 새 의존성 없이 fflate로 직접 묶는다.
import { buildRows, cellText, esc, GAP, proseLine, tableCols, XML_HEAD, zip } from './common'
import type { Transcript } from '../types'
import type { ExportOptions } from './index'

const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships'
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types'
const rels = (items: [id: string, type: string, target: string][]) =>
  `${XML_HEAD}<Relationships xmlns="${PKG_REL}">${items.map(([id, type, target]) => `<Relationship Id="${id}" Type="${REL}/${type}" Target="${target}"/>`).join('')}</Relationships>`
const types = (overrides: [part: string, type: string][]) =>
  `${XML_HEAD}<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${overrides.map(([p, t]) => `<Override PartName="${p}" ContentType="application/vnd.openxmlformats-officedocument.${t}"/>`).join('')}</Types>`

// ── 엑셀: 레이아웃과 관계없이 늘 표. 1행 머리(굵게·회색·틀 고정), 소제목 행은 칸 합치기.
export function toXlsxBlob(t: Transcript, o: ExportOptions): Blob {
  const cols = tableCols(o)
  const rows = buildRows(t, o)
  const S = { head: 1, body: 2, section: 3 } // styles.xml cellXfs 순서
  const ref = (c: number, r: number) => `${String.fromCharCode(65 + c)}${r}`
  const str = (c: number, r: number, v: string, s: number) =>
    // 엑셀 한 칸은 32,767자까지(넘으면 파일을 복구하겠다고 나온다)
    v ? `<c r="${ref(c, r)}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${esc(v.slice(0, 32767))}</t></is></c>` : `<c r="${ref(c, r)}" s="${s}"/>`
  const merges: string[] = []
  const sheetRows = [
    `<row r="1">${cols.map((c, i) => str(i, 1, c.title, S.head)).join('')}</row>`,
    ...rows.map((row, k) => {
      const r = k + 2
      if (row.kind !== 'utt') {
        if (cols.length > 1) merges.push(`<mergeCell ref="A${r}:${ref(cols.length - 1, r)}"/>`)
        const v = row.kind === 'gap' ? GAP : row.title
        return `<row r="${r}">${cols.map((_, i) => str(i, r, i ? '' : v, row.kind === 'gap' ? S.body : S.section)).join('')}</row>`
      }
      const cells = cols.map((c, i) =>
        c.key === 'number' ? `<c r="${ref(i, r)}" s="${S.body}"><v>${row.n}</v></c>` : str(i, r, cellText(row, c.key), S.body),
      )
      return `<row r="${r}">${cells.join('')}</row>`
    }),
  ]
  const sheet =
    `${XML_HEAD}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${REL}">` +
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
    `<cols>${cols.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.xl}" customWidth="1"/>`).join('')}</cols>` +
    `<sheetData>${sheetRows.join('')}</sheetData>` +
    (merges.length ? `<mergeCells count="${merges.length}">${merges.join('')}</mergeCells>` : '') +
    '</worksheet>'
  const border = '<border><left style="thin"><color auto="1"/></left><right style="thin"><color auto="1"/></right><top style="thin"><color auto="1"/></top><bottom style="thin"><color auto="1"/></bottom><diagonal/></border>'
  const styles =
    `${XML_HEAD}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    '<fonts count="2"><font><sz val="11"/><name val="맑은 고딕"/><family val="2"/></font><font><b/><sz val="11"/><name val="맑은 고딕"/><family val="2"/></font></fonts>' +
    '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE6E6E6"/><bgColor indexed="64"/></patternFill></fill></fills>' +
    `<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>${border}</borders>` +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' +
    '<xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>'
  return zip(
    [
      ['[Content_Types].xml', types([['/xl/workbook.xml', 'spreadsheetml.sheet.main+xml'], ['/xl/worksheets/sheet1.xml', 'spreadsheetml.worksheet+xml'], ['/xl/styles.xml', 'spreadsheetml.styles+xml']])],
      ['_rels/.rels', rels([['rId1', 'officeDocument', 'xl/workbook.xml']])],
      ['xl/workbook.xml', `${XML_HEAD}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${REL}"><sheets><sheet name="축어록" sheetId="1" r:id="rId1"/></sheets></workbook>`],
      ['xl/_rels/workbook.xml.rels', rels([['rId1', 'worksheet', 'worksheets/sheet1.xml'], ['rId2', 'styles', 'styles.xml']])],
      ['xl/worksheets/sheet1.xml', sheet],
      ['xl/styles.xml', styles],
    ],
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  )
}

// ── 워드: 줄글 = 문단들, 표 = 테두리 표(머리 행 반복·회색). 글꼴 바탕 10pt, A4 좌우 여백 30mm.
const TWIP_PER_MM = 1440 / 25.4

export function toDocxBlob(t: Transcript, o: ExportOptions): Blob {
  const rows = buildRows(t, o)
  const r = (text: string, bold = false) => `<w:r>${bold ? '<w:rPr><w:b/></w:rPr>' : ''}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>`
  const p = (text: string, bold = false, pPr = '') => `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}${text ? r(text, bold) : ''}</w:p>`
  let body: string
  if (o.layout === 'table') {
    const cols = tableCols(o)
    const w = cols.map((c) => Math.round(c.mm * TWIP_PER_MM))
    const total = w.reduce((a, b) => a + b, 0)
    const tc = (width: number, inner: string, extra = '') => `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${extra}</w:tcPr>${inner}</w:tc>`
    const line = '<w:TAG w:val="single" w:sz="4" w:space="0" w:color="000000"/>'
    const borders = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map((b) => line.replace('TAG', b)).join('')
    const head = `<w:tr><w:trPr><w:tblHeader/></w:trPr>${cols.map((c, i) => tc(w[i], p(c.title, true, '<w:jc w:val="center"/>'), '<w:shd w:val="clear" w:color="auto" w:fill="E6E6E6"/><w:vAlign w:val="center"/>')).join('')}</w:tr>`
    const trs = rows.map((row) =>
      row.kind === 'gap'
        ? `<w:tr>${tc(total, p(GAP, false, '<w:jc w:val="center"/>'), `<w:gridSpan w:val="${cols.length}"/>`)}</w:tr>`
        : row.kind === 'section'
        ? `<w:tr>${tc(total, p(row.title, true), `<w:gridSpan w:val="${cols.length}"/>`)}</w:tr>`
        : `<w:tr>${cols.map((c, i) => tc(w[i], p(cellText(row, c.key)))).join('')}</w:tr>`,
    )
    body =
      `<w:tbl><w:tblPr><w:tblW w:w="${total}" w:type="dxa"/><w:tblBorders>${borders}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="85" w:type="dxa"/><w:right w:w="85" w:type="dxa"/></w:tblCellMar></w:tblPr>` +
      `<w:tblGrid>${w.map((x) => `<w:gridCol w:w="${x}"/>`).join('')}</w:tblGrid>${head}${trs.join('')}</w:tbl><w:p/>` // 표 뒤 빈 문단은 워드 필수
  } else {
    // 내어쓰기 4글자(10pt × 4 = 800twip): 둘째 줄부터 화자 이름 아래로 흐르지 않게
    body = rows
      .map((row) =>
        row.kind === 'section' ? p(row.title, true, '<w:spacing w:before="240"/>')
        : row.kind === 'gap' ? p(GAP, false, '<w:jc w:val="center"/>')
        : p(proseLine(row, o), false, '<w:ind w:left="800" w:hanging="800"/>'),
      )
      .join('')
  }
  const margin = Math.round(30 * TWIP_PER_MM)
  const doc =
    `${XML_HEAD}<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}` +
    `<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="${margin}" w:bottom="1440" w:left="${margin}" w:header="851" w:footer="992" w:gutter="0"/></w:sectPr></w:body></w:document>`
  const styles =
    `${XML_HEAD}<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults>` +
    '<w:rPrDefault><w:rPr><w:rFonts w:ascii="바탕" w:hAnsi="바탕" w:eastAsia="바탕" w:cs="바탕"/><w:sz w:val="20"/><w:szCs w:val="20"/><w:lang w:val="ko-KR" w:eastAsia="ko-KR"/></w:rPr></w:rPrDefault>' +
    '<w:pPrDefault><w:pPr><w:spacing w:after="80" w:line="300" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults></w:styles>'
  return zip(
    [
      ['[Content_Types].xml', types([['/word/document.xml', 'wordprocessingml.document.main+xml'], ['/word/styles.xml', 'wordprocessingml.styles+xml']])],
      ['_rels/.rels', rels([['rId1', 'officeDocument', 'word/document.xml']])],
      ['word/document.xml', doc],
      ['word/_rels/document.xml.rels', rels([['rId1', 'styles', 'styles.xml']])],
      ['word/styles.xml', styles],
    ],
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  )
}
