// 초벌 엔진의 공개 계약. 화면(편집기)은 이 타입만 보고 개발한다.
// 실제 구현: src/engine/index.ts (Web Worker), 개발용 가짜: src/engine/mock.ts
import type { Transcript, TranscriptSettings } from '../types'

export type Stage = 'download' | 'decode' | 'diarize' | 'transcribe' | 'finish'

export interface Progress {
  stage: Stage
  /** 0..1, 이 단계 안에서의 진행 */
  ratio: number
  /** 받아 적기: 녹음에서 어디까지 처리했는지(초) */
  processedSec?: number
  totalSec?: number
  /** 모델 받기 */
  downloadedBytes?: number
  totalBytes?: number
  /** 남은 시간 추정(초). 모르면 undefined */
  etaSec?: number
}

export type EngineErrorCode =
  | 'unsupported-browser' // Chrome·Edge가 아님
  | 'no-storage' // 저장 공간 부족
  | 'network' // 모델 받는 중 인터넷 끊김
  | 'bad-file' // 열 수 없는 파일
  | 'out-of-memory'
  | 'unknown'

export interface EngineError {
  code: EngineErrorCode
  message: string
}

export interface Support {
  ok: boolean
  reason?: 'not-chromium' | 'no-webgpu-slow' | 'no-file-system-access'
  webgpu: boolean
  fp16: boolean
  /** 첫 준비에 필요한 여유 공간(바이트)과 지금 여유 */
  storageNeeded: number
  storageFree?: number
  /** 첫 준비에 내려받을 크기(바이트). 이미 받아 두었으면 0 */
  downloadBytes: number
  /** 모델이 이미 받아져 있으면 true */
  modelsReady: boolean
  /** 예전 버전 모델이 있어 새 버전으로 바꾸는 준비인지(안내 문구용) */
  updating?: boolean
}

export interface TranscribeCallbacks {
  onProgress(p: Progress): void
  /** 받아 적은 부분까지의 축어록. 처리 중 여러 번 온다(문서가 쌓이는 화면용). */
  onPartial(t: Transcript): void
  onDone(t: Transcript): void
  onError(e: EngineError): void
}

export interface Engine {
  checkSupport(): Promise<Support>
  /** 모델을 받아 브라우저 캐시에 보관. 이미 있으면 바로 끝남. */
  prepareModels(onProgress: (p: Progress) => void): Promise<void>
  /**
   * resume: 멈췄던 축어록(processing.processedUntil부터 이어서).
   * settings: 침묵 기준·표기(없으면 resume의 설정, 그것도 없으면 DEFAULT_SETTINGS).
   */
  transcribe(
    audio: Blob,
    meta: { fileName: string; mime: string },
    cb: TranscribeCallbacks,
    opts?: { resume?: Transcript; settings?: TranscriptSettings },
  ): { cancel(): void }
}
