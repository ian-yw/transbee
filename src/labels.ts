import type { SpeakerId, SpeakerRole, Transcript, SilenceFormat } from './types'

const SHORT: Record<SpeakerRole, string> = { counselor: '상', client: '내' }
const FULL: Record<SpeakerRole, string> = { counselor: '상담자', client: '내담자' }

/** 화면·내보내기용 화자 이름. 상담자 확인 전에는 '화자1'/'화자2'. */
export function speakerShort(t: Transcript, s: SpeakerId): string {
  const role = t.speakers.roles[s]
  return role ? SHORT[role] : `화자${s + 1}`
}

/**
 * 발화마다 화자별 순번을 붙인 라벨. 저장하지 않고 매번 계산한다.
 * 화면은 짧게(상1, 내1), 내보내기 기본은 사례보고서 관례대로 길게(상담자 1, 내담자 1).
 */
export function utteranceLabels(t: Transcript, full = false): string[] {
  const count: [number, number] = [0, 0]
  return t.utterances.map((u) => {
    count[u.speaker] += 1
    const role = t.speakers.roles[u.speaker]
    if (!role) return speakerShort(t, u.speaker)
    return full ? `${FULL[role]} ${count[u.speaker]}` : `${SHORT[role]}${count[u.speaker]}`
  })
}

/** 괄호 표기 앞에 붙이는 화자 순서: 상담자가 먼저 */
const MARK_ORDER = ['상', '내', '화자1', '화자2']

/**
 * 괄호 표기 안의 화자 이름 바꾸기: (상: 음) (화자1: 네) (상,내: 웃음).
 * map의 이름만 바꾸고, 모르는 이름이 섞인 괄호는 그대로 둔다(사용자가 쓴 다른 괄호 말).
 */
export function relabelMarks(text: string, map: Map<string, string>): string {
  return text.replace(/\(([^():]+?):/g, (m, inner: string) => {
    const parts = inner.split(',').map((x) => x.trim())
    if (!parts.every((x) => map.has(x))) return m
    const next = parts.map((x) => map.get(x)!).sort((a, b) => MARK_ORDER.indexOf(a) - MARK_ORDER.indexOf(b))
    return `(${next.join(',')}:`
  })
}

export function silenceText(seconds: number, format: SilenceFormat): string {
  const n = Math.round(seconds)
  if (format === 'short') return `(${n}초)`
  if (format === 'dots') return '(…)'
  return `(침묵 ${n}초)`
}

/** 12:04 또는 1:02:03 */
export function clock(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

/** 내보내기용 시각: 00:05, 12:04, 1:02:03 (사용자 정답 전사 형식 [00:04]에 맞춤) */
export function stamp(sec: number): string {
  const c = clock(sec)
  return c.length === 4 ? `0${c}` : c
}
