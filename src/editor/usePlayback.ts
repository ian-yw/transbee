// 재생: 지금 문장 추적, 문장 끝을 지나면 '들음', 알아서 빨라지기, 멈췄다 재생하면 2초 앞부터.
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Utterance } from '../types'
import { getSettings } from '../app/settings'
import { spots, type Spot } from './ops'

/**
 * t 시각에 해당하는 발화 번호(시작이 t 이하인 마지막 발화).
 * 0.05초 여유: 문장 시작으로 옮기면 오디오가 그 직전(16.649…)에 멈춰 윗줄이 형광펜이 되는 것을 막는다.
 */
export function locate(us: Utterance[], t: number): number {
  t += 0.05
  let lo = 0
  let hi = us.length - 1
  let ans = 0
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (us[mid].start <= t) {
      ans = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  return ans
}

export interface Speed {
  rate: number
  why?: '자신 없는 곳' | '같이 말한 곳'
}

/**
 * 알아서 빨라지기: 확인할 곳(잘 안 들린 단어·같이 말한 단어) 앞 0.8초~뒤 0.4초만 1배, 나머지는 2배.
 * 문장 단위로 늦추면 평가용 녹음에서 재생 시간의 90% 넘게가 1배였다(긴 문장엔 거의 늘 자신 없는 단어가 하나는 있다).
 * 1배 구간 사이가 2초(녹음 기준)보다 짧으면 이어서 1배 — 평가용 46분 녹음에서 속도가 바뀌는 횟수가
 * 분당 24번 → 16번으로 줄고, 1배 비율은 37% → 42%(말소리 42.5분을 듣는 시간 29분 → 30분). 여기까지 기준 0.7일 때.
 * 기준을 0.6으로 낮춘 뒤(ops.DOUBT) 같은 대화의 1배 비율은 30%.
 */
const SLOW_LEAD = 0.8, SLOW_TAIL = 0.4, SLOW_JOIN = 2
const windows = new WeakMap<Utterance, { start: number; end: number; kind: Spot['kind'] }[]>()
function slowWindows(u: Utterance) {
  let w = windows.get(u)
  if (!w) {
    w = []
    for (const x of spots(u)) {
      // 앞쪽은 문장 시작에서 자르지 않는다: 첫 단어가 잘 안 들린 말이면 윗줄 끝에서부터 늦춘다(autoSpeedAt이 다음 문장도 본다)
      const cur = { start: x.start - SLOW_LEAD, end: Math.min(u.end, x.end + SLOW_TAIL), kind: x.kind }
      const last = w.at(-1)
      if (last && cur.start - last.end < SLOW_JOIN) {
        last.end = Math.max(last.end, cur.end)
        if (cur.kind === 'overlap') last.kind = 'overlap'
      } else w.push(cur)
    }
    windows.set(u, w)
  }
  return w
}

export function autoSpeed(u: Utterance | undefined, t = u?.start ?? 0): Speed {
  if (!u) return { rate: 1 }
  const s = slowWindows(u).find((x) => t >= x.start && t <= x.end)
  if (s) return { rate: 1, why: s.kind === 'overlap' ? '같이 말한 곳' : '자신 없는 곳' }
  return { rate: 2 }
}

/** 재생 위치 t의 속도: 지금 문장(i)과, 늦출 구간이 이 문장 끝으로 당겨져 들어오는 다음 문장까지 본다 */
export function autoSpeedAt(us: Utterance[], i: number, t: number): Speed {
  const a = autoSpeed(us[i], t)
  return a.rate === 1 || !us[i + 1] ? a : autoSpeed(us[i + 1], t)
}

export function usePlayback(audio: Blob, getUtts: () => Utterance[], on: { index(i: number): void; heard(ids: string[]): void; paused(): void }) {
  const el = useMemo(() => new Audio(), [])
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState<Speed>({ rate: 1 })
  const r = useRef({ back: false, stopAt: Infinity, last: 0, idx: -1, raf: 0, noHeard: false })
  const cb = useRef(on)
  cb.current = on

  useEffect(() => {
    const url = URL.createObjectURL(audio)
    el.src = url
    el.preload = 'auto'
    return () => {
      el.pause()
      URL.revokeObjectURL(url)
    }
  }, [audio, el])

  useEffect(() => {
    const s = r.current
    const step = () => {
      const t = el.currentTime
      const us = getUtts()
      if (us.length) {
        const i = locate(us, t)
        if (i !== s.idx) {
          s.idx = i
          cb.current.index(i)
        }
        // 이어서 재생하며 문장 끝을 지나간 초벌 문장 → 들음
        if (t > s.last && t - s.last < 1.5 && !s.noHeard) {
          const ids: string[] = []
          for (let k = Math.max(0, i - 3); k <= i; k++) if (us[k].end > s.last && us[k].end <= t) ids.push(us[k].id)
          if (ids.length) cb.current.heard(ids)
        }
        const st = getSettings()
        // 이 줄만 듣기·목소리 듣기(playRange)는 알아서 빨라지기와 관계없이 1배
        const sp = s.stopAt < Infinity ? { rate: st.autoSpeed ? 1 : st.speed } : st.autoSpeed ? autoSpeedAt(us, i, t) : { rate: st.speed }
        if (el.playbackRate !== sp.rate) el.playbackRate = sp.rate
        setSpeed((o) => (o.rate === sp.rate && o.why === sp.why ? o : sp))
      }
      if (t >= s.stopAt) {
        s.stopAt = Infinity
        s.noHeard = false
        el.pause()
      }
      s.last = t
    }
    const loop = () => {
      step()
      if (!el.paused) s.raf = requestAnimationFrame(loop)
    }
    // 다른 탭으로 가면 rAF가 멈추므로 timeupdate(초당 약 4번)로도 한 걸음씩
    const onTime = () => document.hidden && !el.paused && step()
    const onPlay = () => {
      setPlaying(true)
      s.last = el.currentTime
      cancelAnimationFrame(s.raf)
      s.raf = requestAnimationFrame(loop)
    }
    const onPause = () => {
      setPlaying(false)
      cancelAnimationFrame(s.raf)
      step()
      cb.current.paused()
    }
    const onSeeked = () => {
      s.last = el.currentTime
      const us = getUtts()
      const i = us.length ? locate(us, el.currentTime) : -1
      if (i !== s.idx) cb.current.index((s.idx = i))
    }
    el.addEventListener('play', onPlay)
    el.addEventListener('pause', onPause)
    el.addEventListener('seeked', onSeeked)
    el.addEventListener('timeupdate', onTime)
    return () => {
      el.removeEventListener('timeupdate', onTime)
      el.removeEventListener('play', onPlay)
      el.removeEventListener('pause', onPause)
      el.removeEventListener('seeked', onSeeked)
      cancelAnimationFrame(s.raf)
    }
  }, [el, getUtts])

  const ctl = useMemo(() => {
    const s = r.current
    // 옮기면 '이 줄만 듣기'의 멈출 곳도 풀린다(playRange는 옮긴 뒤 다시 정한다)
    const seek = (t: number) => {
      el.currentTime = Math.max(0, Math.min(t, el.duration || t))
      s.last = el.currentTime
      s.back = false
      s.stopAt = Infinity
      s.noHeard = false
    }
    const play = () => {
      if (s.back) el.currentTime = Math.max(0, el.currentTime - 2)
      s.back = false
      s.last = el.currentTime
      el.play().catch(() => {})
    }
    const pause = () => {
      s.stopAt = Infinity
      s.noHeard = false
      s.back = true
      el.pause()
    }
    return {
      el,
      seek,
      play,
      pause,
      toggle: () => (el.paused ? play() : pause()),
      skip: (d: number) => seek(el.currentTime + d),
      /** 이 줄만 듣기. sample=true(목소리 확인용)면 지나간 문장을 '들음'으로 두지 않는다 */
      playRange(start: number, end: number, sample = false) {
        seek(start)
        s.stopAt = end
        s.noHeard = sample
        el.play().catch(() => {})
      },
      applyRate() {
        const st = getSettings()
        if (!st.autoSpeed) el.playbackRate = st.speed
        setSpeed(st.autoSpeed ? autoSpeedAt(getUtts(), s.idx, el.currentTime) : { rate: st.speed })
      },
    }
  }, [el, getUtts])

  return { ...ctl, playing, speed }
}
