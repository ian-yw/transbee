// 앱 셸 서비스 워커: 빌드 결과(HTML·JS·CSS·wasm·글꼴·아이콘)를 통째로 보관해 두었다가 인터넷 없이도 연다.
// 빌드할 때 vite.config.ts의 appShell()이 버전과 파일 목록을 채워 dist/sw.js로 내보낸다(개발 서버에서는 쓰지 않음).
// 모델 파일은 엔진이 'transformers-cache'에 따로 보관한다 — 여기서는 건드리지 않는다(지우기도 transbee-app-만).
// 새 버전은 뒤에서 받아 두고 기다린다(skipWaiting 안 함): 열려 있는 화면이 옛 파일을 계속 찾을 수 있게, 창을 다 닫고 다시 열 때 바뀐다.
const CACHE = 'transbee-app-__VERSION__'
const FILES = __FILES__

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)))
})

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('transbee-app-') && k !== CACHE).map((k) => caches.delete(k)))))
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  const url = new URL(req.url)
  if (req.method !== 'GET' || url.origin !== location.origin) return
  // 주소 뒤 ?mock 같은 것이 붙어도 같은 화면
  const key = req.mode === 'navigate' && url.pathname === '/' ? '/index.html' : url.pathname
  if (!FILES.includes(key)) return
  // Cloudflare Pages는 /index.html을 /로 넘긴다: 넘겨받은 응답을 그대로 화면 이동에 주면 Chrome이 막으므로 새로 만든다
  e.respondWith(caches.open(CACHE).then((c) => c.match(key)).then((hit) => (hit?.redirected ? new Response(hit.body, hit) : hit) ?? fetch(req)))
})
