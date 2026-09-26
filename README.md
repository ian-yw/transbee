# transbee

**상담 녹음을 사례보고서용 축어록으로 옮겨 적는, 내 컴퓨터 안에서만 도는 AI 프로그램**

[transbee.beevelop.ai](https://transbee.beevelop.ai) · 평생 무료 · 회원가입 없음 · 녹음을 어디에도 보내지 않음 · [AGPL-3.0](LICENSE) · [바뀐 점](CHANGELOG.md)

상담 녹음을 사례보고서용 축어록으로 푸는 웹앱입니다. 녹음 파일을 놓으면 먼저 초벌(자동 받아 적기)을 만들고, 그다음 녹음을 들으며 고치기 쉬운 편집 화면을 줍니다. 상담 수련생을 위해 Beevelop상담교육센터가 만들었습니다.

- 두 사람(상담자·내담자)이 말하는 개인상담 녹음을 위한 도구입니다.
- 들린 그대로 받아 적습니다. "음", "어", 반복, 말 끊김을 지우지 않고, 3초 이상 말이 없으면 "(침묵 N초)"로 적습니다.
- 맞장구·웃음 같은 괄호 말은 누가 했는지와 함께 넣습니다: (상: 음) (내: 웃음) (상,내: 웃음).
- 확인한 문장과 아직 확인하지 않은 문장을 글씨체로 구분합니다(연필 손글씨 / 인쇄 글씨). 잘 안 들린 말과 두 사람이 같이 말한 곳을 따로 표시합니다.
- 한글에 붙여 넣기, 한글 파일(.hwpx), 엑셀(.xlsx), 워드(.docx), 글자만(.txt)으로 내보냅니다.

## 녹음이 밖으로 나가지 않는 구조

transbee는 서버에서 돌아가는 서비스가 아닙니다. 사이트는 정적 파일(HTML·JS·CSS·WASM·글꼴)만 내려주고, 받아 적기와 화자 구분은 모두 사용자 브라우저 안에서 돌아갑니다.

- 처음 한 번 Hugging Face에서 모델 파일을 받아 브라우저 저장소(Cache Storage)에 보관합니다. 외부로 나가는 요청은 이 모델 파일 다운로드뿐입니다(사용자가 첫 화면의 사용법 영상을 누를 때만 YouTube 재생 창이 쿠키 없이 열립니다).
- 녹음은 브라우저 안의 Web Worker가 읽고 처리합니다. 녹음이나 축어록을 네트워크로 보내는 코드가 없습니다. 분석·추적 스크립트도 넣지 않았습니다.
- 작업은 브라우저 안(IndexedDB)에 자동 저장되고, 사용자가 고른 폴더에 작업 파일(`.transbee`, 축어록 + 원본 녹음을 묶은 zip)로 저장됩니다.
- 앱 파일은 서비스 워커가 보관해 두므로, 모델을 한 번 받은 뒤에는 인터넷이 끊겨도 앱을 열고 새 녹음을 받아 적을 수 있습니다. 브라우저 메뉴의 "앱 설치"로 바탕화면에 추가할 수 있습니다.

## 지원 브라우저

컴퓨터(Windows·Mac)의 Chrome과 Edge만 지원합니다. Safari, Firefox, 휴대폰 브라우저는 지원하지 않습니다.

- 그래픽 기능(WebGPU)이 있는 컴퓨터에서 빠르게 돌아갑니다. 그래픽 카드에 16비트 연산(shader-f16)이 없으면 32비트 연산 모델로 그래픽 카드에서 조금 느리게 돌고, WebGPU가 없으면 CPU(WASM)로 돌아가며 훨씬 오래 걸립니다.
- 처음 한 번 받는 모델 파일은 WebGPU 기준 약 655MB, 16비트 연산이 없거나 WebGPU가 없는 컴퓨터는 약 840MB입니다(1MB = 1,048,576바이트, 앱 화면 표시와 같은 기준).
- 폴더 저장에는 Chrome·Edge의 파일 접근 기능(File System Access)을 씁니다.

## 쓰는 모델과 라이선스

| 쓰임 | 이름 | 라이선스 |
|---|---|---|
| 받아 적기 | [Youngwon/whisper-large-v3-turbo_timestamped-external-data](https://huggingface.co/Youngwon/whisper-large-v3-turbo_timestamped-external-data) — [onnx-community/whisper-large-v3-turbo_timestamped](https://huggingface.co/onnx-community/whisper-large-v3-turbo_timestamped)(OpenAI [Whisper large-v3-turbo](https://huggingface.co/openai/whisper-large-v3-turbo)의 ONNX 변환본)의 가중치를 별도 파일(.onnx_data)로 옮긴 판(값은 같고, 브라우저 메모리를 덜 씁니다) | MIT |
| 화자 구분·말소리 구간 | [onnx-community/Nemotron-3-Diarization-ONNX](https://huggingface.co/onnx-community/Nemotron-3-Diarization-ONNX) — NVIDIA Nemotron-3-Diarization의 ONNX 변환본 | OpenMDW-1.1 |

모델 파일은 저장소에 들어 있지 않고, 앱이 처음 실행될 때 위 저장소의 고정된 버전(revision)에서 받습니다.

코드와 글꼴:

| 이름 | 쓰임 | 라이선스 |
|---|---|---|
| [transformers.js](https://github.com/huggingface/transformers.js) (`@huggingface/transformers`) | 모델 실행 | Apache-2.0 |
| transformers.js PR #1778 이식 코드 (`src/engine/nemotron/`) | Nemotron 화자분리 전처리·화자 캐시 | Apache-2.0 (Copyright Hugging Face, 전문 `src/engine/nemotron/LICENSE`) |
| [ONNX Runtime Web](https://github.com/microsoft/onnxruntime) (`onnxruntime-web`) | 모델 실행(WebGPU·WASM) | MIT |
| [Mediabunny](https://github.com/Vanilagy/mediabunny) | 녹음 파일 풀기 | MPL-2.0 |
| [fflate](https://github.com/101arrowz/fflate) | 작업 파일·hwpx·xlsx·docx 묶기 | MIT |
| [React](https://react.dev) | 화면 | MIT |
| IBM Plex Sans KR, Gowun Batang, Gaegu, Nanum Pen Script, Noto Sans KR (Google Fonts, `public/fonts/`) | 글꼴 | SIL Open Font License 1.1 (저작권 고지·전문 `public/fonts/LICENSE.txt`) |

## 라이선스

- 코드: [GNU AGPL-3.0](LICENSE). 누구나 쓰고 고치고 나눌 수 있습니다. 고친 것을 배포하거나 네트워크 서비스로 제공하면, 고친 소스코드도 같은 라이선스로 공개해야 합니다.
- 이름과 로고: "transbee", "Beevelop", "Beevelop상담교육센터"의 이름과 로고(`public/brand/`)는 비벨롭(Beevelop)의 것이며 위 라이선스로 허락되지 않습니다. 고친 판을 내놓을 때는 다른 이름과 로고를 써 주세요. 자세한 조건은 이용약관(`src/legal/이용약관.md`) 제7조에 있습니다.
- 글꼴·모델·라이브러리는 위 표의 각 라이선스를 따릅니다.

## 개발

Node.js 20.19 이상 또는 22.12 이상이 필요합니다(Vite 8 요구 사항).

```sh
npm install
npm run dev          # 개발 서버 (http://localhost:5173)
npx vitest run       # 로직 검사
npm run build        # dist/ 에 빌드 (타입 검사 포함)
npx vite preview     # 빌드 결과 확인 (서비스 워커·헤더 포함)
```

- 화면만 볼 때는 주소 뒤에 `?mock`을 붙이면 모델 없이 가짜 엔진으로 돌아갑니다. `?mock=long|slow|network|nospace|stall|badfile|fresh|unsupported`로 예외 화면을 재현합니다(`src/engine/mock.ts`).
- 엔진 평가: `node scripts/eval-engine.mjs [--prepare] 파일...` — 시스템 Chrome으로 파일을 처리해 속도·메모리·글자 오류율을 냅니다. 결과는 `private-data/engine-eval/`에만 남습니다.
- 평가에 쓰는 녹음과 축어록은 저장소에 넣지 않고 `private-data/`(git 제외)에 둡니다.

### 배포

정적 호스팅이면 어디든 올릴 수 있습니다. 다만 WASM 다중 스레드를 쓰려면 모든 응답에 아래 두 헤더가 필요합니다.

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: credentialless
```

Vercel은 `vercel.json`, Cloudflare Pages는 `public/_headers`(빌드하면 `dist/_headers`)에 이 헤더와 캐시 설정을 적어 두었습니다. `sw.js`는 캐시하지 않고(`no-cache`), 이름에 해시가 붙은 `assets/`는 오래 캐시합니다.


## 문의

- 이메일: beevelop@gmail.com · 전화: 070-4591-1369 · [카카오톡 상담](http://pf.kakao.com/_xcYpcn/chat)
- 버그·제안: GitHub Issues
- 후원(커피 한 잔): [크티](https://ctee.kr/place/beevelop)

## 브랜치와 버전

- `develop`: 기본 브랜치(개발). `main`: 배포 브랜치(Vercel이 이 브랜치를 배포).
- 버전은 `package.json`의 `version`이 기준이고, 배포할 때 `vX.Y.Z` 태그를 붙입니다. 바뀐 점은 [CHANGELOG.md](CHANGELOG.md).

---

© 비벨롭(Beevelop) · [Beevelop상담교육센터](https://beevelop.ai/ko)
