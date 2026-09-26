// 한글 파일(.hwpx, OWPML/KS X 6101).
// 기준 템플릿: python-hwpx 6.5.0의 Skeleton.hwpx(한컴 오피스가 만든 빈 문서 구조).
// hwpx-header.xml = 그 header.xml에 표 테두리(borderFill 3: 실선, 4: 실선+회색 바탕), 굵은 글자(charPr 7),
// 문단 모양 20(내어쓰기 40pt: 한글은 들여쓰기 값이 음수면 내어쓰기 — 템플릿의 문단 모양 10과 같은 방식)·21(가운데)만 더한 것.
// 글자 모양 0 = 함초롬바탕 10pt. 줄 배치 캐시(linesegarray)는 넣지 않는다 — 한글이 열 때 다시 계산한다.
import headerXml from './hwpx-header.xml?raw'
import { buildRows, esc, GAP, proseLine, tableCols, cellText, TABLE_MM, XML_HEAD, zip, type Row } from './common'
import type { Transcript } from '../types'
import type { ExportOptions } from './index'

const NS =
  'xmlns:ha="http://www.hancom.co.kr/hwpml/2011/app" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph" xmlns:hp10="http://www.hancom.co.kr/hwpml/2016/paragraph" xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hc="http://www.hancom.co.kr/hwpml/2011/core" xmlns:hh="http://www.hancom.co.kr/hwpml/2011/head" xmlns:hhs="http://www.hancom.co.kr/hwpml/2011/history" xmlns:hm="http://www.hancom.co.kr/hwpml/2011/master-page" xmlns:hpf="http://www.hancom.co.kr/schema/2011/hpf" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf/" xmlns:ooxmlchart="http://www.hancom.co.kr/hwpml/2016/ooxmlchart" xmlns:hwpunitchar="http://www.hancom.co.kr/hwpml/2016/HwpUnitChar" xmlns:epub="http://www.idpf.org/2007/ops" xmlns:config="urn:oasis:names:tc:opendocument:xmlns:config:1.0"'

/** A4, 좌우 여백 30mm(8504), 본문 너비 42520 = 150mm */
const SEC_PR =
  '<hp:secPr id="" textDirection="HORIZONTAL" spaceColumns="1134" tabStop="8000" tabStopVal="4000" tabStopUnit="HWPUNIT" outlineShapeIDRef="1" memoShapeIDRef="0" textVerticalWidthHead="0" masterPageCnt="0"><hp:grid lineGrid="0" charGrid="0" wonggojiFormat="0"/><hp:startNum pageStartsOn="BOTH" page="0" pic="0" tbl="0" equation="0"/><hp:visibility hideFirstHeader="0" hideFirstFooter="0" hideFirstMasterPage="0" border="SHOW_ALL" fill="SHOW_ALL" hideFirstPageNum="0" hideFirstEmptyLine="0" showLineNumber="0"/><hp:lineNumberShape restartType="0" countBy="0" distance="0" startNumber="0"/><hp:pagePr landscape="WIDELY" width="59528" height="84186" gutterType="LEFT_ONLY"><hp:margin header="4252" footer="4252" gutter="0" left="8504" right="8504" top="5668" bottom="4252"/></hp:pagePr><hp:footNotePr><hp:autoNumFormat type="DIGIT" userChar="" prefixChar="" suffixChar=")" supscript="0"/><hp:noteLine length="-1" type="SOLID" width="0.12 mm" color="#000000"/><hp:noteSpacing betweenNotes="283" belowLine="567" aboveLine="850"/><hp:numbering type="CONTINUOUS" newNum="1"/><hp:placement place="EACH_COLUMN" beneathText="0"/></hp:footNotePr><hp:endNotePr><hp:autoNumFormat type="DIGIT" userChar="" prefixChar="" suffixChar=")" supscript="0"/><hp:noteLine length="14692344" type="SOLID" width="0.12 mm" color="#000000"/><hp:noteSpacing betweenNotes="0" belowLine="567" aboveLine="850"/><hp:numbering type="CONTINUOUS" newNum="1"/><hp:placement place="END_OF_DOCUMENT" beneathText="0"/></hp:endNotePr><hp:pageBorderFill type="BOTH" borderFillIDRef="1" textBorder="PAPER" headerInside="0" footerInside="0" fillArea="PAPER"><hp:offset left="1417" right="1417" top="1417" bottom="1417"/></hp:pageBorderFill><hp:pageBorderFill type="EVEN" borderFillIDRef="1" textBorder="PAPER" headerInside="0" footerInside="0" fillArea="PAPER"><hp:offset left="1417" right="1417" top="1417" bottom="1417"/></hp:pageBorderFill><hp:pageBorderFill type="ODD" borderFillIDRef="1" textBorder="PAPER" headerInside="0" footerInside="0" fillArea="PAPER"><hp:offset left="1417" right="1417" top="1417" bottom="1417"/></hp:pageBorderFill></hp:secPr><hp:ctrl><hp:colPr id="" type="NEWSPAPER" layout="LEFT" colCount="1" sameSz="1" sameGap="0"/></hp:ctrl>'

const BODY_W = 42520
const HU_PER_MM = BODY_W / TABLE_MM
const ROW_H = 1500 // 최소 행 높이. 글이 길면 한글이 늘린다.
const CHAR = { normal: 0, bold: 7 }
const FILL = { line: 3, lineGray: 4 }
const PARA = { normal: 0, hang: 20, center: 21 }

export function hwpxFiles(t: Transcript, o: ExportOptions): [string, string, boolean?][] {
  const rows = buildRows(t, o)
  let pid = 1
  const run = (text: string, c = CHAR.normal) =>
    `<hp:run charPrIDRef="${c}">${text ? `<hp:t>${esc(text)}</hp:t>` : '<hp:t/>'}</hp:run>`
  const para = (runs: string, pr = PARA.normal, id = pid++) =>
    `<hp:p id="${id}" paraPrIDRef="${pr}" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">${runs}</hp:p>`

  // 본문 문단들 [run, 문단 모양]. 첫 문단에는 쪽 설정(secPr)이 같이 들어간다.
  const body: [string, number][] =
    o.layout === 'table'
      ? [[`<hp:run charPrIDRef="0">${table(rows, o, para, run)}</hp:run>`, PARA.normal]]
      : rows.map((r) =>
          r.kind === 'section' ? [run(r.title, CHAR.bold), PARA.normal] : r.kind === 'gap' ? [run(GAP), PARA.center] : [run(proseLine(r, o)), PARA.hang],
        )
  const [[first, firstPr] = [run(''), PARA.normal], ...rest] = body
  const section =
    `${XML_HEAD}<hs:sec ${NS}>` +
    para(`<hp:run charPrIDRef="0">${SEC_PR}</hp:run>${first}`, firstPr, 0) +
    rest.map(([r, pr]) => para(r, pr)).join('') +
    '</hs:sec>'

  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z')
  const preview = rows
    .map((r) => (r.kind === 'section' ? r.title : r.kind === 'gap' ? GAP : proseLine(r, o)))
    .join('\r\n')
    .slice(0, 1000)
  return [
    ['mimetype', 'application/hwp+zip', true],
    [
      'version.xml',
      `${XML_HEAD}<hv:HCFVersion xmlns:hv="http://www.hancom.co.kr/hwpml/2011/version" tagetApplication="WORDPROCESSOR" major="5" minor="1" micro="1" buildNumber="0" os="1" xmlVersion="1.5" application="Hancom Office Hangul" appVersion="13, 0, 0, 1408 WIN32LEWindows_10"/>`,
    ],
    ['Contents/header.xml', headerXml],
    ['Contents/section0.xml', section],
    ['Preview/PrvText.txt', preview],
    [
      'settings.xml',
      `${XML_HEAD}<ha:HWPApplicationSetting xmlns:ha="http://www.hancom.co.kr/hwpml/2011/app" xmlns:config="urn:oasis:names:tc:opendocument:xmlns:config:1.0"><ha:CaretPosition listIDRef="0" paraIDRef="0" pos="0"/></ha:HWPApplicationSetting>`,
    ],
    [
      'META-INF/container.rdf',
      `${XML_HEAD}<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about=""><ns0:hasPart xmlns:ns0="http://www.hancom.co.kr/hwpml/2016/meta/pkg#" rdf:resource="Contents/header.xml"/></rdf:Description><rdf:Description rdf:about="Contents/header.xml"><rdf:type rdf:resource="http://www.hancom.co.kr/hwpml/2016/meta/pkg#HeaderFile"/></rdf:Description><rdf:Description rdf:about=""><ns0:hasPart xmlns:ns0="http://www.hancom.co.kr/hwpml/2016/meta/pkg#" rdf:resource="Contents/section0.xml"/></rdf:Description><rdf:Description rdf:about="Contents/section0.xml"><rdf:type rdf:resource="http://www.hancom.co.kr/hwpml/2016/meta/pkg#SectionFile"/></rdf:Description><rdf:Description rdf:about=""><rdf:type rdf:resource="http://www.hancom.co.kr/hwpml/2016/meta/pkg#Document"/></rdf:Description></rdf:RDF>`,
    ],
    [
      'Contents/content.hpf',
      `${XML_HEAD}<opf:package ${NS} version="" unique-identifier="" id=""><opf:metadata><opf:title>${esc(t.title)}</opf:title><opf:language>ko</opf:language><opf:meta name="creator" content="text">transbee</opf:meta><opf:meta name="subject" content="text"/><opf:meta name="description" content="text"/><opf:meta name="lastsaveby" content="text">transbee</opf:meta><opf:meta name="CreatedDate" content="text">${now}</opf:meta><opf:meta name="ModifiedDate" content="text">${now}</opf:meta><opf:meta name="keyword" content="text"/></opf:metadata><opf:manifest><opf:item id="header" href="Contents/header.xml" media-type="application/xml"/><opf:item id="section0" href="Contents/section0.xml" media-type="application/xml"/><opf:item id="settings" href="settings.xml" media-type="application/xml"/></opf:manifest><opf:spine><opf:itemref idref="header" linear="yes"/><opf:itemref idref="section0" linear="yes"/></opf:spine></opf:package>`,
    ],
    [
      'META-INF/container.xml',
      `${XML_HEAD}<ocf:container xmlns:ocf="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:hpf="http://www.hancom.co.kr/schema/2011/hpf"><ocf:rootfiles><ocf:rootfile full-path="Contents/content.hpf" media-type="application/hwpml-package+xml"/><ocf:rootfile full-path="Preview/PrvText.txt" media-type="text/plain"/><ocf:rootfile full-path="META-INF/container.rdf" media-type="application/rdf+xml"/></ocf:rootfiles></ocf:container>`,
    ],
    ['META-INF/manifest.xml', `${XML_HEAD}<odf:manifest xmlns:odf="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"/>`],
  ]
}

/** 표 하나(<hp:tbl>). 머리 행은 쪽이 넘어가면 반복, 소제목은 모든 칸을 합친 한 칸. */
function table(
  rows: Row[],
  o: ExportOptions,
  para: (runs: string) => string,
  run: (text: string, c?: number) => string,
): string {
  const cols = tableCols(o)
  const widths = cols.map((c) => Math.round(c.mm * HU_PER_MM))
  widths[cols.findIndex((c) => c.key === 'content')] += BODY_W - widths.reduce((a, b) => a + b, 0)
  const tc = (text: string, col: number, row: number, span: number, w: number, fill: number, c: number, head = false) =>
    `<hp:tc name="" header="${head ? 1 : 0}" hasMargin="0" protect="0" editable="0" dirty="0" borderFillIDRef="${fill}">` +
    `<hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="${head ? 'CENTER' : 'TOP'}" linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0" hasTextRef="0" hasNumRef="0">${para(run(text, c))}</hp:subList>` +
    `<hp:cellAddr colAddr="${col}" rowAddr="${row}"/><hp:cellSpan colSpan="${span}" rowSpan="1"/><hp:cellSz width="${w}" height="${ROW_H}"/><hp:cellMargin left="510" right="510" top="141" bottom="141"/></hp:tc>`

  const trs = [
    `<hp:tr>${cols.map((c, i) => tc(c.title, i, 0, 1, widths[i], FILL.lineGray, CHAR.bold, true)).join('')}</hp:tr>`,
    ...rows.map((r, k) =>
      r.kind !== 'utt'
        ? `<hp:tr>${tc(r.kind === 'gap' ? GAP : r.title, 0, k + 1, cols.length, BODY_W, FILL.line, r.kind === 'gap' ? CHAR.normal : CHAR.bold)}</hp:tr>`
        : `<hp:tr>${cols.map((c, i) => tc(cellText(r, c.key), i, k + 1, 1, widths[i], FILL.line, CHAR.normal)).join('')}</hp:tr>`,
    ),
  ]
  return (
    `<hp:tbl id="1" zOrder="0" numberingType="TABLE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" pageBreak="CELL" repeatHeader="1" rowCnt="${trs.length}" colCnt="${cols.length}" cellSpacing="0" borderFillIDRef="${FILL.line}" noAdjust="0">` +
    `<hp:sz width="${BODY_W}" widthRelTo="ABSOLUTE" height="${ROW_H * trs.length}" heightRelTo="ABSOLUTE" protect="0"/>` +
    '<hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="COLUMN" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/>' +
    '<hp:outMargin left="0" right="0" top="0" bottom="0"/><hp:inMargin left="510" right="510" top="141" bottom="141"/>' +
    trs.join('') +
    '</hp:tbl>'
  )
}

export const toHwpxBlob = (t: Transcript, o: ExportOptions) => zip(hwpxFiles(t, o), 'application/hwp+zip')
