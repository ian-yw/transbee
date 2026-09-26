// 초벌 엔진 평가: 개발 서버의 engine-dev.html을 시스템 Chrome(WebGPU)으로 열어 파일을 처리하고 지표를 낸다.
// 결과(대사 포함)는 private-data/engine-eval/ 에만 저장한다. 화면 출력은 수치만.
//
// 사용: node scripts/eval-engine.mjs [--prepare] [--offline] [--input=window|turn] [--device=webgpu|wasm] [--headed] 파일...
//   --prepare  모델을 먼저 받는다(프로필 캐시에 보관)
//   --resume-test  끝까지 / 절반에서 멈춤 → 이어 하기 결과 비교
//   --diar     화자분리 확률만 저장(<파일>.probs.f32, 스파이크 결과 대조용)
//   --win=초    인식 구간 최대 길이(기본 28)
//   --offline  localhost 외 모든 호스트 이름 풀이를 막고 실행(두 번째 실행 오프라인 확인)
import { chromium } from 'playwright-core'
import { createServer, preview } from 'vite'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const OUT = path.join(ROOT, 'private-data/engine-eval')
const PROFILE = path.join(OUT, 'chrome-profile') // 모델 캐시가 여기 남는다(약 700MB)

const args = process.argv.slice(2)
const flag = (n) => args.includes(`--${n}`)
const opt = (n) => args.find((a) => a.startsWith(`--${n}=`))?.split('=')[1]
const files = args.filter((a) => !a.startsWith('--'))
const asrInput = opt('input') ?? 'window'
const device = opt('device')
const winSec = opt('win') ? +opt('win') : undefined
const prompt = process.env.ASR_PROMPT // 프롬프트 실험용

fs.mkdirSync(OUT, { recursive: true })
// --dist=폴더: 빌드 결과를 vite preview로 띄워 검사(ENGINE_DEV=1 npm run build 로 engine-dev.html을 넣어 빌드한 것). 아니면 개발 서버(평가 중 다른 작업자의 파일 수정으로 다시 로드되지 않게 HMR 끔)
const server = opt('dist')
  ? await preview({ root: ROOT, logLevel: 'error', build: { outDir: path.resolve(opt('dist')) }, preview: { host: '127.0.0.1', port: 5199, strictPort: true } })
  : await createServer({ root: ROOT, logLevel: 'error', server: { host: '127.0.0.1', port: 5199, strictPort: true, hmr: false, watch: null } })
if (!opt('dist')) await server.listen()

const ctx = await chromium.launchPersistentContext(PROFILE, {
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: !flag('headed'),
  args: [
    '--enable-unsafe-webgpu', '--enable-precise-memory-info',
    ...(flag('offline') ? ['--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1'] : []),
  ],
})
const page = ctx.pages()[0] ?? (await ctx.newPage())
const external = []
ctx.on('request', (r) => { if (/^https?:/.test(r.url()) && !r.url().startsWith('http://127.0.0.1')) external.push(r.url()) })
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log(`[${m.type()}]`, m.text().slice(0, 200)) })
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 300)))
page.on('console', (m) => { if (/^(prepared|download (0|50|100)%)/.test(m.text())) console.log(m.text()) })
await page.goto('http://127.0.0.1:5199/engine-dev.html')
console.log('crossOriginIsolated', await page.evaluate(() => self.crossOriginIsolated))

if (flag('prepare')) console.log('support', JSON.stringify(await page.evaluate((d) => window.__prepare(d), device)))

// 메모리: 이 Chrome 인스턴스의 모든 프로세스 footprint 합(Metal 할당 포함)
function footprintMB() {
  const ps = execFileSync('ps', ['-A', '-o', 'pid=,command=']).toString().split('\n').filter((l) => l.includes(PROFILE))
  let mb = 0
  for (const l of ps) {
    try {
      const out = execFileSync('footprint', ['-p', l.trim().split(/\s+/)[0]], { stdio: ['ignore', 'pipe', 'ignore'] }).toString()
      const m = /Footprint: ([\d.]+) (KB|MB|GB)/.exec(out)
      if (m) mb += +m[1] * { KB: 1 / 1024, MB: 1, GB: 1024 }[m[2]]
    } catch {}
  }
  return Math.round(mb)
}

const summary = []
for (const file of files) {
  const name = path.basename(file)
  const series = []
  const timer = setInterval(() => series.push(footprintMB()), 3000)
  await page.setInputFiles('#file', file)
  if (flag('resume-test')) {
    // 절반쯤에서 멈춘 뒤 이어 하기 → 한 번에 끝까지 한 결과와 같은지
    const full = await page.evaluate(({ asrInput }) => window.__run(document.getElementById('file').files[0], { asrInput }), { asrInput })
    const half = Math.max(1, Math.floor(full.partials / 2))
    const cut = await page.evaluate(({ asrInput, half }) => window.__run(document.getElementById('file').files[0], { asrInput, stopAfterPartials: half }), { asrInput, half })
    const resumed = await page.evaluate(({ asrInput, t }) => window.__run(document.getElementById('file').files[0], { asrInput, resume: t }), { asrInput, t: cut.transcript })
    const a = full.transcript.utterances, b = resumed.transcript.utterances
    const same = a.length === b.length && a.every((u, i) => u.text === b[i].text && u.speaker === b[i].speaker && u.id === b[i].id)
    // 어디가 다른지(수치만): 다른 발화 수와 그 시각
    const diff = a.map((u, i) => (b[i] && u.text === b[i].text && u.speaker === b[i].speaker ? null : +u.start.toFixed(1))).filter((x) => x != null)
    console.log(JSON.stringify({ file: name, resumeTest: { stoppedAt: cut.transcript.processing.processedUntil, keptUtterances: cut.transcript.utterances.length, full: a.length, resumed: b.length, identical: same, differentAt: diff, status: resumed.transcript.processing.status } }))
    clearInterval(timer)
    continue
  }
  if (flag('diar')) {
    const probs = await page.evaluate((device) => window.__diar(document.getElementById('file').files[0], device), device)
    fs.writeFileSync(path.join(OUT, `${name}.${device ?? 'auto'}.probs.f32`), Buffer.from(Float32Array.from(probs).buffer))
    console.log(name, 'probs frames', probs.length / 8)
    clearInterval(timer)
    continue
  }
  const res = await page.evaluate(({ asrInput, device, winSec, asrPrompt }) => window.__run(document.getElementById('file').files[0], { asrInput, device, winSec, prompt: asrPrompt ?? undefined }), { asrInput, device, winSec, asrPrompt: prompt ?? null })
  clearInterval(timer)
  const tag = `${name}.${asrInput}${winSec ? winSec : ''}${prompt ? '.p' + prompt.length : ''}${device ? '.' + device : ''}${flag('offline') ? '.offline' : ''}`
  fs.writeFileSync(path.join(OUT, `${tag}.json`), JSON.stringify({ ...res, memMB: series }, null, 1))
  const m = res.transcript ? metrics(name, file, res.transcript) : {}
  const row = {
    file: name, input: asrInput + (winSec ?? ''), error: res.error?.code, audioSec: +(res.transcript?.audio.duration ?? 0).toFixed(1),
    totalSec: +res.totalSec.toFixed(1), rtf: res.transcript ? +(res.totalSec / res.transcript.audio.duration).toFixed(3) : null,
    stageSec: Object.fromEntries(Object.entries(res.stageSec).map(([k, v]) => [k, +v.toFixed(1)])),
    memPeakMB: Math.max(0, ...series), partials: res.partials, ...m,
  }
  summary.push(row)
  console.log(JSON.stringify(row))
  if (res.error) console.log('error message (first line):', String(res.error.message).split('\n')[0].slice(0, 300))
}
const hfRequests = external.filter((u) => u.includes('huggingface') || u.includes('hf.co'))
console.log('external requests seen by browser:', external.length, 'huggingface:', hfRequests.length, [...new Set(external.map((u) => new URL(u).host))].join(' '))
fs.writeFileSync(path.join(OUT, `summary.${asrInput}${flag('offline') ? '.offline' : ''}.${Date.now()}.json`), JSON.stringify({ summary, external: external.length }, null, 1))
await ctx.close()
await (server.close ? server.close() : server.httpServer.close())

// ---------- 지표 ----------
function metrics(name, file, t) {
  const hypWords = t.utterances.flatMap((u) => (u.words ?? []).map((w) => ({ ...w, speaker: u.speaker })))
  const hypText = t.utterances.map((u) => u.text).join(' ')
  const spkSec = [0, 1].map((s) => t.utterances.filter((u) => u.speaker === s).reduce((a, u) => a + u.end - u.start, 0))
  const base = {
    utterances: t.utterances.length,
    speakerShare: +(Math.min(...spkSec) / (spkSec[0] + spkSec[1] || 1)).toFixed(2),
    fillersHyp: countFillers(hypText),
    silenceMarks: t.utterances.filter((u) => u.text.startsWith('(침묵')).length,
    overlaps: t.utterances.filter((u) => u.overlap).length,
    meanConf: +(t.utterances.reduce((a, u) => a + (u.confidence ?? 0), 0) / (t.utterances.length || 1)).toFixed(3),
  }
  let gold = null
  // 정답: <파일>-gold.json 또는 private-data/golds/<이름>/transcript.json(편집기로 고친 작업 파일)
  const goldDir = path.join(ROOT, 'private-data/golds', name.replace(/\.[^.]+$/, ''), 'transcript.json')
  const sideGold = [file.replace(/\.[^.]+$/, '-gold.json'), goldDir].find((f) => fs.existsSync(f)) ?? ''
  if (sideGold) {
    const g = JSON.parse(fs.readFileSync(sideGold, 'utf8'))
    gold = g.utterances.map((u) => ({ start: u.start, end: u.end, spk: u.speaker, text: refText(u.text) })).filter((g) => norm(g.text))
  }
  if (gold) {
    const ref = norm(gold.map((g) => g.text).join(' '))
    const hyp = norm(stripMarks(hypText))
    const gf = countFillers(gold.map((g) => g.text).join(' '))
    const hf = base.fillersHyp
    const hit = Object.keys(gf).reduce((a, k) => a + Math.min(gf[k], hf[k] ?? 0), 0)
    const gTotal = Object.values(gf).reduce((a, b) => a + b, 0)
    // 발화별 화자: 정답 발화 구간 안 단어들의 다수 화자. 화자 번호 대응은 둘 중 나은 쪽.
    const votes = gold.map((g) => {
      const ws = hypWords.filter((w) => (w.start + w.end) / 2 >= g.start && (w.start + w.end) / 2 < g.end)
      if (!ws.length) return null
      const ones = ws.filter((w) => w.speaker === 1).length
      return ones * 2 > ws.length ? 1 : 0
    })
    const labels = [...new Set(gold.map((g) => g.spk))]
    let best = 0
    for (const first of [0, 1]) {
      const c = gold.filter((g, i) => votes[i] != null && (votes[i] === first) === (g.spk === labels[0])).length
      best = Math.max(best, c)
    }
    const judged = votes.filter((v) => v != null).length
    Object.assign(base, {
      cer: +(lev(ref, hyp) / ref.length).toFixed(3), refChars: ref.length, hypChars: hyp.length,
      fillerRecall: +(hit / (gTotal || 1)).toFixed(3), fillerHypOverGold: +(Object.values(hf).reduce((a, b) => a + b, 0) / (gTotal || 1)).toFixed(2),
      fillersGold: gf, speakerAcc: +(best / (judged || 1)).toFixed(3), speakerJudged: `${judged}/${gold.length}`,
      ...turnBounds(gold, t.utterances.filter((u) => norm(stripMarks(u.text)))),
    })
  }
  return base
}

// 화자가 바뀌는 곳(다음 줄 시작 시각)을 1초 안에서 짝지어: 정답 경계 중 맞힌 수, 정답에 없는 경계 수
function turnBounds(gold, hyp) {
  const cuts = (xs, spk) => xs.slice(1).filter((x, i) => spk(x) !== spk(xs[i])).map((x) => x.start)
  const g = cuts(gold, (x) => x.spk), h = cuts(hyp, (x) => x.speaker)
  const used = new Set()
  let kept = 0
  for (const t of g) {
    const j = h.findIndex((x, k) => !used.has(k) && Math.abs(x - t) <= 1)
    if (j >= 0) { used.add(j); kept++ }
  }
  return { turnsGold: g.length, turnsKept: kept, turnsExtra: h.length - used.size }
}

// 정답 비교 규칙: 침묵 표기와 상황 설명 괄호는 지우고, 맞장구·겹친 말 괄호는 화자 표시만 떼고 포함, OO 삭제, 한글·영숫자만.
function refText(s) {
  return stripMarks(s).replace(/\(([^)]*)\)/g, (_, inner) => (/웃|속삭|소리|웅얼|며$|끄덕|한숨/.test(inner) ? ' ' : ` ${inner.replace(/^[^():]*:/, '')} `)).replace(/O{2,}|o{2,}|x{2,}|X{2,}|#{2,}/g, '')
}
function stripMarks(s) { return s.replace(/\((침묵 )?\d+초\)|\(…\)/g, ' ') }
function norm(s) { return s.replace(/[^0-9A-Za-z가-힣]+/g, '') }
function countFillers(s) {
  const FILLER = { 음: '음', 으음: '음', 음음: '음', 흠: '음', 어: '어', 에: '어', 어어: '어', 응: '응', 으응: '응', 응응: '응', 웅: '응', 아: '아', 아아: '아', 네: '네', 예: '네', 넵: '네' }
  const c = { 음: 0, 어: 0, 응: 0, 아: 0, 네: 0 }
  for (const tok of stripMarks(s).split(/[^0-9A-Za-z가-힣]+/)) if (FILLER[tok]) c[FILLER[tok]]++
  return c
}
function lev(a, b) {
  let prev = new Int32Array(b.length + 1).map((_, i) => i), cur = new Int32Array(b.length + 1)
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    ;[prev, cur] = [cur, prev]
  }
  return prev[b.length]
}
