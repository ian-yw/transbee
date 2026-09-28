// 새 버전 적용(UpdateBar)과 화면들 사이의 연결: 모델을 받거나 받아 적는 동안은 미루고, 새로고침 전에 저장을 끝낸다.
import { useEffect, useState } from 'react'

let busy = 0
const subs = new Set<() => void>()

/** 이 화면이 켜져 있는 동안 새 버전 적용을 미룬다(모델 받기·받아 적기) */
export function useHoldUpdate() {
  useEffect(() => {
    busy++
    subs.forEach((f) => f())
    return () => {
      busy--
      subs.forEach((f) => f())
    }
  }, [])
}

export function useUpdateHeld() {
  const [held, setHeld] = useState(busy > 0)
  useEffect(() => {
    const f = () => setHeld(busy > 0)
    subs.add(f)
    f()
    return () => void subs.delete(f)
  }, [])
  return held
}

/** 새로고침 전에 부를 저장들(편집 중인 축어록) */
export const beforeUpdate = new Set<() => Promise<unknown>>()

/** 새 버전으로 바꾸려고 새로고침하는 중: "나가시겠어요?" 확인을 띄우지 않는다(저장은 beforeUpdate로 끝냄) */
export const updating = { now: false }
