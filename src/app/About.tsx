// transbee 정보(첫 화면에 늘 보임): 버전, 무료·회원가입 없음·오픈소스, 쓰는 AI 모델(이 컴퓨터에서만 돈다), 만든 곳, 후원.
import { version } from '../../package.json'
import { MODEL_INFO } from '../engine/models'
import { Logo } from './ui'
import { Dialog } from '../editor/Dialogs'

/** 후원 링크(커피 한 잔): 크티 후원 페이지(원화 결제). 비우면 "준비 중"으로 보인다. */
export const SUPPORT_URL = 'https://ctee.kr/place/beevelop'
/** 공개 저장소 주소. 공개 전에는 비워 둔다. */
export const REPO_URL = 'https://github.com/ian-yw/transbee'
/** 사용법 쇼츠(YouTube) 영상 ID. 비우면 첫 화면 단추를 숨긴다. 누를 때만 쿠키 없는 재생 창(youtube-nocookie)을 연다. */
export const GUIDE_ID = 'EFclaVkC7hk'
/** 문의: 카카오톡 상담(Beevelop 사이트 고객지원과 같은 채널) */
export { KAKAO_URL as CONTACT } from './Legal'

export const APP_VERSION = version

/** GitHub 표시(Octicons mark-github). 개발자가 아닌 분도 알아보게 "소스코드" 글자와 같이 쓴다 */
export const GitHubMark = () => (
  <svg className="gh" width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
    <path
      fill="currentColor"
      d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"
    />
  </svg>
)

/** 소스코드(GitHub)·후원 링크. 주소가 아직 없으면 "준비 중"으로 보인다. */
export function LinkRow() {
  return (
    <p className="about-links">
      <a className="btn sm ghbtn" href={REPO_URL} target="_blank" rel="noopener noreferrer" title="transbee 소스코드 저장소(GitHub)">
        <GitHubMark /> 소스코드 <span className="muted">GitHub</span>
      </a>
      {SUPPORT_URL ? (
        <a className="btn sm" href={SUPPORT_URL} target="_blank" rel="noopener noreferrer">
          ☕ 커피 한 잔으로 응원하기
        </a>
      ) : (
        <span className="btn sm soon" aria-disabled="true">
          ☕ 커피 한 잔으로 응원하기 · 준비 중
        </span>
      )}
    </p>
  )
}

/** 첫 화면 "녹음 파일을 여기에 놓으세요" 아래에 늘 보이는 transbee 소개(버전, 나누는 뜻, 소스코드·후원, 쓰는 AI 모델) */
export function AboutPanel() {
  return (
    <section className="about" id="about" aria-labelledby="about-h">
      <h2 id="about-h" className="about-h">
        <Logo /> 정보 <span className="about-v">버전 {APP_VERSION}</span>
      </h2>
      <p className="about-lead">
        Beevelop상담교육센터가 <b>상담사 선생님들을 위해 나누는</b> 프로그램이에요. <em>결제, 계정 생성이 필요 없고</em>, 프로그램 소스코드도 <em>누구나 볼 수 있게 공개</em>합니다.
      </p>
      <LinkRow />
      <div className="models-card">
      <h3 className="gl">쓰는 AI 모델</h3>
      <p className="muted">두 모델 모두 이 컴퓨터 안에서만 돌아요. 녹음과 축어록은 어디에도 보내지 않아요.</p>
      <dl className="models">
        {MODEL_INFO.map((m) => (
          <div key={m.repo}>
            <dt>{m.role}</dt>
            <dd>
              <b>{m.name}</b> · {m.by} · {m.license}
              <span className="small muted"> · 버전 {m.rev.slice(0, 7)}</span>
            </dd>
          </div>
        ))}
      </dl>
      <p className="muted">모델이 새 버전으로 바뀌면, 다음에 받아 적을 때 새 AI 모델을 한 번 받고 예전 모델은 지워요.</p>
      </div>
          <p className="scope in-about">
            <span>개인상담(두 사람) 녹음을 위한 도구예요.</span>
            <span className="chip-tbd" aria-disabled="true" aria-describedby="tbd-note" title="세 사람 이상이 함께하는 상담(부부·가족·집단)은 준비 중이에요">
              부부·집단상담 · 준비 중
            </span>
            <span id="tbd-note" className="sr-only">
              세 사람 이상이 함께하는 상담(부부·가족·집단)은 준비 중이에요
            </span>
          </p>
    </section>
  )
}

/** 개인정보 안내(푸터에서 누르면 뜨는 창). 실제 동작과 다르면 안 된다 — 네트워크로 나가는 것을 바꾸면 여기도 고친다. */
export function PrivacyDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} label="개인정보 안내" wide>
      <h2 className="h">개인정보 안내</h2>
      <div className="privacy">
        <h3 className="gl">녹음과 축어록</h3>
        <p>
          녹음 파일과 축어록은 이 컴퓨터에만 저장돼요. 브라우저 안 저장 공간과, 직접 고른 저장 폴더 두 곳이에요. transbee는 녹음이나 축어록을 어디에도 보내지 않아요.
          받아 적기와 화자 나누기도 이 컴퓨터 안에서 해요.
        </p>
        <h3 className="gl">모으지 않는 것</h3>
        <p>회원가입이 없어서 이름·이메일·전화번호를 받지 않아요. 사용 기록을 모으는 분석·추적 도구도 넣지 않았어요.</p>
        <h3 className="gl">인터넷을 쓰는 때</h3>
        <ul>
          <li>transbee를 처음 열 때와 새 버전이 나왔을 때, 이 사이트에서 프로그램 파일을 받아요.</li>
          <li>처음 받아 적기 전에 AI 모델 파일(약 700MB)을 Hugging Face(모델 공개 사이트)에서 한 번 받아요. 이때 녹음은 보내지 않고 모델 파일만 받아요.</li>
          <li>
            파일을 받을 때 이 사이트와 Hugging Face의 서버에는 보통의 접속 기록(IP 주소, 받은 시각 등)이 남을 수 있어요. 녹음·축어록 내용은 들어가지 않아요.
          </li>
          <li>첫 화면의 "1분 사용법 영상"을 누를 때만 YouTube 재생 창을 열어요. 쿠키를 남기지 않는 방식으로 열지만, 재생하는 동안 YouTube에 보통의 접속 기록이 남을 수 있어요.</li>
        </ul>
        <h3 className="gl">지우는 법</h3>
        <ul>
          <li>첫 화면 "하던 작업"에서 [지우기]를 누르면 이 브라우저에 있던 녹음과 축어록이 지워져요.</li>
          <li>저장 폴더에 있는 작업 파일(.transbee)과 내보낸 한글·엑셀 파일은 폴더에서 직접 지워 주세요.</li>
        </ul>
        <h3 className="gl">옮기거나 나눌 때</h3>
        <p>
          작업 파일(.transbee)에는 녹음이 들어 있어요. 메신저나 클라우드로 옮기면 그곳에도 저장되니, USB나 AirDrop을 권해요. 축어록을 보고서에 쓰거나 나누기 전에는 [이름
          가리기]로 이름을 바꿔 주세요.
        </p>
      </div>
      <div className="dlg-foot">
        <button type="button" className="btn pri" onClick={onClose} data-autofocus>
          닫기
        </button>
      </div>
    </Dialog>
  )
}
