import react from '@vitejs/plugin-react'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { defineConfig, type Plugin } from 'vite'

// WASM 다중 스레드(SharedArrayBuffer)에는 교차 출처 격리가 필요하다.
// COEP는 credentialless: Hugging Face 모델(CORS)과 글꼴 같은 교차 출처 자원을 CORP 헤더 없이도 받을 수 있다(Chrome·Edge 지원).
// 배포 서버에도 같은 두 헤더를 붙인다: vercel.json(Vercel), public/_headers(Cloudflare Pages).
const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'credentialless',
}

/**
 * 빌드 결과 전체를 앱 셸로: src/sw.js에 파일 목록과 버전(내용 해시)을 넣어 dist/sw.js로 쓴다.
 * 빼는 것: 개발 확인용 engine-dev.html, 호스팅 설정 _headers.
 */
function appShell(): Plugin {
  const SKIP = new Set(['sw.js', 'engine-dev.html', '_headers'])
  return {
    name: 'transbee-app-shell',
    apply: 'build',
    writeBundle({ dir }) {
      const out = dir!
      const files = (fs.readdirSync(out, { recursive: true }) as string[])
        .filter((f) => fs.statSync(path.join(out, f)).isFile() && !SKIP.has(f.split(path.sep).join('/')))
        .map((f) => '/' + f.split(path.sep).join('/'))
        .sort()
      const hash = createHash('sha256')
      for (const f of files) hash.update(f).update(fs.readFileSync(path.join(out, f)))
      const sw = fs.readFileSync(path.resolve(import.meta.dirname, 'src/sw.js'), 'utf8')
        .replace('__VERSION__', hash.digest('hex').slice(0, 12))
        .replace('__FILES__', JSON.stringify(files))
      fs.writeFileSync(path.join(out, 'sw.js'), sw)
    },
  }
}

export default defineConfig({
  plugins: [react(), appShell()],
  // .ts.net: 다른 컴퓨터(같은 Tailscale 망)에서 `tailscale serve`의 HTTPS 주소로 열어 볼 때. HTTPS여야 WebGPU·폴더 저장이 된다.
  server: { headers: isolation, allowedHosts: ['.ts.net'] },
  preview: { headers: isolation, allowedHosts: ['.ts.net'] },
  worker: { format: 'es' },
  // 사전 번들링하면 onnxruntime-web의 wasm 상대 경로가 깨진다
  optimizeDeps: { exclude: ['@huggingface/transformers', 'onnxruntime-web'], include: ['mediabunny'] },
  build: {
    // 개발 확인용 engine-dev.html은 운영 빌드에 넣지 않는다(개발 서버에서는 그대로 열림). 빌드 결과로 평가할 때만 ENGINE_DEV=1.
    rollupOptions: { input: { main: 'index.html', ...(process.env.ENGINE_DEV ? { engineDev: 'engine-dev.html' } : {}) } },
  },
})
