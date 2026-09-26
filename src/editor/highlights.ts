// 본문 글자는 그대로 두고 칠만 얹는다(CSS Custom Highlight API, Chrome·Edge 105+).
// 편집 중인 문장의 DOM을 건드리지 않아 커서가 튀지 않는다.
import type { Utterance } from '../types'
import { spots } from './ops'

type Name = 'tb-now' | 'tb-doubt' | 'tb-overlap'
const reg = (globalThis as unknown as { CSS?: { highlights?: Map<string, Set<Range>> } }).CSS?.highlights
const H = (globalThis as unknown as { Highlight?: new () => Set<Range> }).Highlight

function get(name: Name): Set<Range> | undefined {
  if (!reg || !H) return undefined
  let h = reg.get(name)
  if (!h) reg.set(name, (h = new H()))
  return h
}

const owned = new WeakMap<Element, [Name, Range][]>()

export function undecorate(el: Element) {
  for (const [n, r] of owned.get(el) ?? []) get(n)?.delete(r)
  owned.delete(el)
}

const range = (node: Node, a: number, b: number) => {
  const r = new Range()
  r.setStart(node, a)
  r.setEnd(node, b)
  return r
}

/** 잘 안 들린 말(점선 밑줄)과 두 사람이 같이 말한 곳(보라 밑줄). 어디인지는 ops.spots가 정한다(확인할 곳과 같은 기준). */
export function decorate(el: Element, u: Utterance) {
  undecorate(el)
  const node = el.firstChild
  if (!node || node.nodeType !== Node.TEXT_NODE) return
  const len = node.textContent?.length ?? 0
  const out: [Name, Range][] = spots(u)
    .filter((x) => x.to <= len)
    .map((x) => [x.kind === 'overlap' ? 'tb-overlap' : 'tb-doubt', range(node, x.from, x.to)])
  for (const [n, r] of out) get(n)?.add(r)
  owned.set(el, out)
}

let nowRange: Range | undefined
/** 지금 나오는 문장 형광펜 */
export function setNow(el: Element | null) {
  const h = get('tb-now')
  if (nowRange) h?.delete(nowRange)
  nowRange = undefined
  if (!el) return
  nowRange = new Range()
  nowRange.selectNodeContents(el)
  h?.add(nowRange)
}
