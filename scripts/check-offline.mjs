// 앱 설치·오프라인 확인: 빌드 결과(dist)를 vite preview로 띄우고, 모델을 받아 둔 평가용 Chrome 프로필로 한 번 연 뒤
// 네트워크를 완전히 끊고(서버도 닫음) 새로 고침·새 탭·앱 창에서 앱이 열리고 새 녹음을 받아 적는지 본다.
// 사용: npm run build && node scripts/check-offline.mjs <녹음 파일>   (먼저 node scripts/eval-engine.mjs --prepare 로 모델을 받아 둘 것)
import { chromium } from 'playwright-core'
import { preview } from 'vite'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const PROFILE = path.join(ROOT, 'private-data/engine-eval/chrome-profile') // 모델 캐시(127.0.0.1:5199)
const URL0 = 'http://127.0.0.1:5199/'
const AUDIO = process.argv.slice(2).find((a) => !a.startsWith('--'))
if (!AUDIO) throw new Error('받아 적을 녹음 파일을 주세요: node scripts/check-offline.mjs <녹음 파일>')
const ok = (name, v) => console.log(`${v ? '✓' : '✗'} ${name}`)

const server = await preview({ root: ROOT, logLevel: 'error', preview: { host: '127.0.0.1', port: 5199, strictPort: true } })
const ctx = await chromium.launchPersistentContext(PROFILE, {
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: !process.argv.includes('--headed'),
  args: ['--enable-unsafe-webgpu'],
})
const page = ctx.pages()[0] ?? (await ctx.newPage())
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 200)))

// 1. 온라인으로 한 번 열기: 헤더, 서비스 워커 설치, 설치 가능 여부
const res = await page.goto(URL0)
const h = res.headers()
ok(`헤더 COOP=${h['cross-origin-opener-policy']} COEP=${h['cross-origin-embedder-policy']}`, h['cross-origin-opener-policy'] === 'same-origin' && h['cross-origin-embedder-policy'] === 'credentialless')
await page.evaluate(() => navigator.serviceWorker.ready)
await page.reload()
ok('서비스 워커가 화면을 맡음', await page.evaluate(() => !!navigator.serviceWorker.controller))
const caches0 = await page.evaluate(async () => Promise.all((await caches.keys()).map(async (k) => [k, (await (await caches.open(k)).keys()).length])))
console.log('  보관함:', JSON.stringify(caches0))
const cdp = await ctx.newCDPSession(page)
const inst = await cdp.send('Page.getInstallabilityErrors')
ok(`설치 가능(오류 ${inst.installabilityErrors.length}개${inst.installabilityErrors.map((e) => ' ' + e.errorId).join('')})`, inst.installabilityErrors.length === 0)
const manifestId = (await cdp.send('Page.getAppManifest')).manifest?.id ?? URL0

// 2. 끊기: 서버 닫고 브라우저도 오프라인
await new Promise((r) => server.httpServer.close(r))
await ctx.setOffline(true)
const offlineRun = async (p, label) => {
  const iso = await p.evaluate(() => self.crossOriginIsolated)
  const home = await p.getByRole('heading', { name: '녹음 파일을 여기에 놓으세요' }).isVisible()
  ok(`${label}: 첫 화면 열림, 교차 출처 격리 ${iso}`, home && iso)
}
await page.reload()
await offlineRun(page, '오프라인 새로 고침')
const tab = await ctx.newPage()
await tab.goto(URL0 + '?from=newtab')
await offlineRun(tab, '오프라인 새 탭')
await tab.close()

// 앱 창(바탕화면 앱): CDP PWA.install → PWA.launch. 지원 안 되는 Chrome이면 --app 창과 같은 새 창으로 대신 본다.
try {
  const s = cdp
  await s.send('PWA.install', { manifestId })
  await s.send('PWA.changeAppUserSettings', { manifestId, displayMode: 'standalone' }).catch((e) => console.log('  ', String(e).slice(0, 120)))
  const [appPage] = await Promise.all([ctx.waitForEvent('page', { timeout: 15000 }), s.send('PWA.launch', { manifestId })])
  await appPage.waitForLoadState()
  ok(`오프라인 앱 창 standalone=${await appPage.evaluate(() => matchMedia('(display-mode: standalone)').matches)}`, true)
  await offlineRun(appPage, '오프라인 앱 창')
  await s.send('PWA.uninstall', { manifestId }).catch(() => {})
  await appPage.close()
} catch (e) {
  console.log('  (앱 창 설치 확인 못 함:', String(e).split('\n')[0].slice(0, 160), ')')
}

// 3. 오프라인으로 새 녹음 받아 적기: 받은 녹음 파일을 파일 고르기로
const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: '파일 고르기' }).click()])
await chooser.setFiles(path.resolve(AUDIO))
const t0 = Date.now()
await page.locator('.page.editor').waitFor({ timeout: 240000 })
const n = await page.locator('.desk [data-id], .desk .row').count()
ok(`오프라인에서 새 녹음 받아 적고 편집 화면까지 ${((Date.now() - t0) / 1000).toFixed(0)}초 (줄 ${n})`, true)

// 뒷정리: 이 프로필은 평가(개발 서버, 같은 주소)에도 쓰므로 서비스 워커와 앱 보관함을 지운다(모델 보관함은 그대로)
await ctx.setOffline(false)
await page.evaluate(async () => {
  for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister()
  for (const k of await caches.keys()) if (k.startsWith('transbee-app-')) await caches.delete(k)
})
await ctx.close()
