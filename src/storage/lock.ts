// 같은 작업을 두 창에서 열면 늦게 연 창이 옛 상태로 덮어써 고친 내용이 사라지고,
// 받아 적기가 두 번 돌 수 있다. 작업마다 Web Lock 하나를 두어 가진 창만 받아 적기·편집을 한다.
// 창이 닫히면 브라우저가 자물쇠를 풀어 준다.
const held = new Map<string, () => void>()

export function acquireJob(id: string): Promise<boolean> {
  if (held.has(id)) return Promise.resolve(true)
  if (!navigator.locks) return Promise.resolve(true) // Chrome·Edge에는 늘 있다
  return new Promise((resolve) => {
    navigator.locks.request(`transbee-job-${id}`, { ifAvailable: true }, (lock) => {
      if (!lock) return resolve(false)
      resolve(true)
      return new Promise<void>((release) => held.set(id, release))
    })
  })
}

/** 첫 화면으로 돌아갈 때: 이 창이 쥔 자물쇠를 모두 푼다 */
export function releaseJobs() {
  for (const release of held.values()) release()
  held.clear()
}
