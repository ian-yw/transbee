// 엔진 연결 지점은 여기 한 곳. 평소에는 실제 엔진(브라우저 안 Whisper·Nemotron).
// 주소에 ?mock(또는 ?mock=long|slow|network|… — src/engine/mock.ts 참고)이 있을 때만 개발용 가짜 엔진.
import { engine as real } from '../engine'
import { engine as mock } from '../engine/mock'

export const engine = new URLSearchParams(location.search).has('mock') ? mock : real
