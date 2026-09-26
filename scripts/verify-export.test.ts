// 내보내기 결과 파일을 실제 프로그램으로 열어 보기 위한 파일 쓰기. 평소 테스트에서는 건너뛴다.
// EXPORT_OUT=/private/tmp/transbee-export-verify/out npx vitest run scripts/verify-export.test.ts
// 그다음: soffice --headless --convert-to pdf|csv, python-hwpx(conda env transbee-spike)로 .hwpx 열기.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { it } from 'vitest'
import gold from '../fixtures/demo-gold.json'
import type { Transcript } from '../src/types'
import { DEFAULT_EXPORT, toClipboard, toDocx, toHwpx, toTxt, toXlsx } from '../src/export'

const out = process.env.EXPORT_OUT

it.skipIf(!out)('내보내기 파일 쓰기', async () => {
  mkdirSync(out!, { recursive: true })
  const t = structuredClone(gold) as Transcript
  t.utterances[3].text += ' (웃음) (네)' // 괄호 표기 확인용
  for (const layout of ['prose', 'table'] as const) {
    const o = { ...DEFAULT_EXPORT, layout, columns: { ...DEFAULT_EXPORT.columns, time: layout === 'table' } }
    const save = async (ext: string, b: Blob) => writeFileSync(join(out!, `${layout}.${ext}`), new Uint8Array(await b.arrayBuffer()))
    await save('hwpx', await toHwpx(t, o))
    await save('docx', await toDocx(t, o))
    await save('xlsx', await toXlsx(t, o))
    writeFileSync(join(out!, `${layout}.txt`), toTxt(t, o))
    writeFileSync(join(out!, `${layout}.clip.html`), `<meta charset="utf-8">${toClipboard(t, o).html}`)
  }
})
