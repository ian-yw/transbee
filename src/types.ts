// 축어록 데이터 형식. 엔진·편집기·내보내기가 모두 이 형식만 주고받는다.
// 시각은 모두 초(second) 단위 실수.

export const FORMAT_VERSION = 1

/** 화자는 항상 두 명. 0/1은 화자분리 결과 순서이고, 누가 상담자인지는 speakers.roles가 정한다. */
export type SpeakerId = 0 | 1
export type SpeakerRole = 'counselor' | 'client'

/**
 * 확인 상태.
 * draft  = 연필(초벌, 아직 확인 안 함)
 * heard  = 재생이 문장 끝까지 지나감 (✓)
 * edited = 사용자가 고침 (✓)
 * marked = 여백 ○를 눌러 직접 확인 (✓)
 * bulk   = 안 듣고 한꺼번에 확인 (속 빈 ✓)
 */
export type ReviewState = 'draft' | 'heard' | 'edited' | 'marked' | 'bulk'

export interface Word {
  text: string
  start: number
  end: number
  /** 0..1 */
  confidence?: number
  /** 상대 화자와 같이 말한 구간(0.3초 이상 겹침)에 걸친 단어 */
  overlap?: boolean
}

/** 웃음·울음·한숨·기침 같은 소리 감지 제안. 사람이 넣기/빼기를 정한다. */
export interface NonverbalSuggestion {
  id: string
  label: string // 예: '웃음'
  at: number // 초
  confidence: number // 0..1
}

export interface Utterance {
  id: string
  /** 지금 배정된 화자 */
  speaker: SpeakerId
  /** 엔진이 배정한 화자(0/1, 맞바꾸기 전). 되돌리기 기준. */
  modelSpeaker: number
  start: number
  end: number
  /** 화면에 보이는 본문. 괄호 표기 (웃음) (네) (침묵 4초) 포함. */
  text: string
  /** 음성인식 단어 시각. 나누기 시각 계산용. 편집 후에는 어긋날 수 있다. */
  words?: Word[]
  /** 문장 평균 신뢰도 0..1 */
  confidence?: number
  /** 상대 화자와 같이 말한 구간(0.3초 이상 겹침)이 있음. 어느 단어인지는 words[].overlap */
  overlap?: boolean
  review: ReviewState
  suggestions?: NonverbalSuggestion[]
}

/** 소제목 줄. beforeUtteranceId 발화 바로 위에 보인다. */
export interface Section {
  id: string
  title: string
  beforeUtteranceId: string
}

export type SilenceFormat = 'full' | 'short' | 'dots' // (침묵 4초) | (4초) | (…)

export interface TranscriptSettings {
  /** 이 초 이상 비면 침묵 표기 */
  silenceMin: number
  silenceFormat: SilenceFormat
}

export interface Transcript {
  formatVersion: typeof FORMAT_VERSION
  /** 만들 때 crypto.randomUUID(). 작업 목록과 작업 파일(.transbee)을 짝짓는 기준(제목은 바뀔 수 있음). */
  id: string
  title: string
  createdAt: string
  updatedAt: string
  audio: {
    fileName: string
    mime: string
    duration: number
  }
  /** roles[speakerId]. 상담자 확인 전에는 null */
  speakers: { roles: [SpeakerRole | null, SpeakerRole | null] }
  utterances: Utterance[]
  sections: Section[]
  model: { asr: string; diarization: string; vad: string; app: string }
  /** 초벌 처리 상태. 멈췄다가 이어 하기 위해 쓴다. */
  processing: { status: 'running' | 'paused' | 'done'; processedUntil: number }
  settings: TranscriptSettings
}

export const DEFAULT_SETTINGS: TranscriptSettings = { silenceMin: 3, silenceFormat: 'full' }

export const isConfirmed = (r: ReviewState) => r !== 'draft'
