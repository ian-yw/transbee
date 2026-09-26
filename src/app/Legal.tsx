// 이용약관·개인정보처리방침(원문은 src/legal/*.md 하나 — 문서 기록과 화면이 같은 글), 사업자 정보·고객지원.
import terms from '../legal/이용약관.md?raw'
import privacy from '../legal/개인정보처리방침.md?raw'
import { Dialog } from '../editor/Dialogs'

export const KAKAO_URL = 'http://pf.kakao.com/_xcYpcn/chat'
export const SUPPORT_EMAIL = 'beevelop@gmail.com'
export const SUPPORT_PHONE = '070-4591-1369'

export type LegalDoc = 'terms' | 'privacy'
const DOCS: Record<LegalDoc, { title: string; md: string }> = {
  terms: { title: '이용약관', md: terms },
  privacy: { title: '개인정보처리방침', md: privacy },
}

/** 약관 글(# 제목, ## 조, - 목록, 빈 줄로 나눈 문단)만 그리는 작은 변환 */
function Md({ md }: { md: string }) {
  const blocks = md.trim().split(/\n\s*\n/)
  return (
    <>
      {blocks.map((b, i) => {
        const lines = b.split('\n')
        if (lines[0].startsWith('# ')) return null // 창 제목으로 대신
        const head = lines[0].startsWith('## ') ? <h3 className="gl">{lines[0].slice(3)}</h3> : null
        const rest = head ? lines.slice(1) : lines
        const items = rest.filter((l) => /^\s*- /.test(l))
        const text = rest.filter((l) => !/^\s*- /.test(l)).join(' ')
        return (
          <section key={i}>
            {head}
            {text && <p>{text}</p>}
            {items.length > 0 && (
              <ul>
                {items.map((l, k) => (
                  <li key={k} className={/^\s{2,}- /.test(l) ? 'sub' : undefined}>
                    {l.replace(/^\s*- /, '')}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )
      })}
    </>
  )
}

export function LegalDialog({ doc, onClose }: { doc: LegalDoc | null; onClose: () => void }) {
  const d = doc && DOCS[doc]
  return (
    <Dialog open={!!doc} onClose={onClose} label={d?.title ?? '법적 고지'} wide>
      {d && (
        <>
          <h2 className="h">transbee {d.title}</h2>
          <div className="legal">
            <Md md={d.md} />
          </div>
          <div className="dlg-foot">
            <button type="button" className="btn pri" onClick={onClose} data-autofocus>
              닫기
            </button>
          </div>
        </>
      )}
    </Dialog>
  )
}

/** 첫 화면 정보 아래: 서비스 · 법적 고지 · 고객지원, 사업자 정보(Beevelop 사이트 푸터와 같은 내용) */
export function SiteInfo({ onDoc }: { onDoc: (d: LegalDoc) => void }) {
  return (
    <section className="siteinfo" aria-label="서비스·법적 고지·고객지원">
      <div className="cols">
        <div>
          <h3 className="gl">서비스</h3>
          <ul>
            <li>
              <button type="button" className="link" onClick={() => scrollTo({ top: 0, behavior: 'smooth' })}>
                transbee 축어록 편집 앱
              </button>
            </li>
            <li>
              <a href="https://beevelop.ai/ko/courses" target="_blank" rel="noopener noreferrer">
                Beevelop상담교육센터
              </a>
            </li>
          </ul>
        </div>
        <div>
          <h3 className="gl">법적 고지</h3>
          <ul>
            <li>
              <button type="button" className="link" onClick={() => onDoc('terms')}>
                이용약관
              </button>
            </li>
            <li>
              <button type="button" className="link" onClick={() => onDoc('privacy')}>
                개인정보처리방침
              </button>
            </li>
          </ul>
        </div>
        <div>
          <h3 className="gl">고객지원</h3>
          <ul>
            <li>
              <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
            </li>
            <li>
              <a href={`tel:${SUPPORT_PHONE}`}>{SUPPORT_PHONE}</a>
            </li>
            <li>
              <a href={KAKAO_URL} target="_blank" rel="noopener noreferrer">
                카카오톡 상담
              </a>
            </li>
          </ul>
        </div>
      </div>
      <div className="biz">
        <p>상호: 비벨롭(Beevelop) | 대표자: 최영원 | 사업자등록번호: 497-74-00582</p>
        <p>주소: 경기도 수원시 영통구 광교로 145 차세대융합기술연구원 C동 2층 창업지원센터</p>
        <p>
          이메일: <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> | 전화: <a href={`tel:${SUPPORT_PHONE}`}>{SUPPORT_PHONE}</a>
        </p>
      </div>
    </section>
  )
}
