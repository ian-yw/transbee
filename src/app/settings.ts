// 이 브라우저에서만 쓰는 화면 설정(localStorage). 없거나 막혀 있어도 기본값으로 동작.
import { useSyncExternalStore } from 'react'
import { DEFAULT_SETTINGS, type SilenceFormat } from '../types'

export interface Settings {
  theme: 'auto' | 'light' | 'dark'
  cheers: boolean
  /** 단축키: 쓰는 컴퓨터에 맞춘 조합 / 풋페달용 F키 */
  keys: 'os' | 'fkey'
  autoSpeed: boolean
  speed: number
  introSeen: boolean
  /** 새 녹음을 받아 적을 때 쓰는 침묵 기준(초)·표기. 보기 설정에서 바꾸면 여는 축어록과 다음 녹음에 같이 적용 */
  silenceMin: number
  silenceFormat: SilenceFormat
}

const KEY = 'tb-settings'
const DEFAULTS: Settings = { theme: 'auto', cheers: true, keys: 'os', autoSpeed: true, speed: 1, introSeen: false, ...DEFAULT_SETTINGS }

function load(): Settings {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }
  } catch {
    return DEFAULTS
  }
}

let current = load()
const subs = new Set<() => void>()

export function setSettings(patch: Partial<Settings>) {
  current = { ...current, ...patch }
  try {
    localStorage.setItem(KEY, JSON.stringify(current))
  } catch {
    /* 저장 못 해도 이번 창에서는 적용 */
  }
  applyTheme()
  subs.forEach((f) => f())
}

export const getSettings = () => current

export const useSettings = () =>
  useSyncExternalStore(
    (f) => (subs.add(f), () => subs.delete(f)),
    () => current,
  )

export function applyTheme() {
  const el = document.documentElement
  if (current.theme === 'auto') delete el.dataset.theme
  else el.dataset.theme = current.theme
}

export const isMac = /Mac/i.test(
  (navigator as unknown as { userAgentData?: { platform: string } }).userAgentData?.platform ?? navigator.platform,
)

/** 안 듣고 한꺼번에 확인: 모델 신뢰도 보정 전까지 숨김(주소 ?bulk 로만 켬) */
export const BULK_CONFIRM = new URLSearchParams(location.search).has('bulk')
