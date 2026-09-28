// 앱 셸 서비스 워커: 빌드 결과(HTML·JS·CSS·wasm·글꼴·아이콘)를 통째로 보관해 두었다가 인터넷 없이도 연다.
// 빌드할 때 vite.config.ts의 appShell()이 버전과 파일 목록을 채워 dist/sw.js로 내보낸다(개발 서버에서는 쓰지 않음).
// 모델 파일은 엔진이 'transformers-cache'에 따로 보관한다 — 여기서는 건드리지 않는다(지우기도 transbee-app-만).
// 새 버전은 뒤에서 받아 두고 기다린다. 화면의 [지금 업데이트](src/app/ui.tsx UpdateBar)가 'skip-waiting'을 보내면 바뀐다.
// 바로 전 판 파일은 남겨 둔다: 아직 새로고침하지 않은 다른 창(받아 적는 중일 수 있다)이 옛 파일을 찾아도 깨지지 않게.
const CACHE = 'transbee-app-__VERSION__'
const FILES = __FILES__

// 이 표시가 있으면 지금 켜진 판은 [지금 업데이트]를 아는 판(0.3.16부터)
const PROMPT = 'transbee-flow-prompt'

self.addEventListener('install', (e) => {
  e.waitUntil(
    (async () => {
      // 브라우저 HTTP 캐시를 거치지 않고 서버에서 새로 받는다(옛 index.html이 새 판 보관함에 섞이지 않게)
      await (await caches.open(CACHE)).addAll(FILES.map((f) => new Request(f, { cache: 'reload' })))
      // 지금 켜진 판이 옛 방식(창을 모두 닫아야 바뀜, 0.3.15까지)이면 기다리지 않고 켠다: 새로고침 한 번이면 새 판.
      // 열려 있던 옛 화면이 찾는 옛 파일은 activate가 남겨 둔 바로 전 판에서 나온다.
      if (!(await caches.has(PROMPT))) self.skipWaiting()
    })(),
  )
})

self.addEventListener('message', (e) => {
  if (e.data === 'skip-waiting') self.skipWaiting()
})

self.addEventListener('activate', (e) => {
  // 캐시 목록은 만든 순서: 마지막 옛 판(바로 전 판) 하나만 남기고 지운다
  e.waitUntil(
    Promise.all([
      caches.open(PROMPT),
      caches.keys().then((keys) => {
        const old = keys.filter((k) => k.startsWith('transbee-app-') && k !== CACHE)
        return Promise.all(old.slice(0, -1).map((k) => caches.delete(k)))
      }),
    ]),
  )
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  const url = new URL(req.url)
  if (req.method !== 'GET' || url.origin !== location.origin) return
  // 주소 뒤 ?mock 같은 것이 붙어도 같은 화면
  const key = req.mode === 'navigate' && url.pathname === '/' ? '/index.html' : url.pathname
  if (!FILES.includes(key)) {
    // 옛 판 화면이 찾는 옛 파일은 남겨 둔 바로 전 판에서
    if (url.pathname.startsWith('/assets/')) e.respondWith(caches.match(url.pathname).then((hit) => hit ?? fetch(req)))
    return
  }
  // Cloudflare Pages는 /index.html을 /로 넘긴다: 넘겨받은 응답을 그대로 화면 이동에 주면 Chrome이 막으므로 새로 만든다
  e.respondWith(caches.open(CACHE).then((c) => c.match(key)).then((hit) => (hit?.redirected ? new Response(hit.body, hit) : hit) ?? fetch(req)))
})
