// 첫 화면 머리 줄의 "작업 폴더": 지금 폴더 이름, 그 폴더에서 작업 파일 열기, 다른 폴더로 바꾸기.
// Finder·탐색기로 폴더를 직접 여는 것은 브라우저가 허락하지 않아, 폴더 안 파일을 고르는 창을 그 폴더에서 연다.
import { useEffect, useRef, useState } from 'react'
import { canPickFolder, getFolder, openFromFolder, pickFolder } from '../storage/folder'

export function FolderMenu({ onFile }: { onFile: (f: File) => void }) {
  const [name, setName] = useState<string>()
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLSpanElement>(null)
  useEffect(() => void getFolder().then((d) => setName(d?.name)), [])
  useEffect(() => {
    if (!open) return
    const close = (e: Event) => !box.current?.contains(e.target as Node) && setOpen(false)
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    addEventListener('pointerdown', close)
    addEventListener('keydown', esc)
    return () => {
      removeEventListener('pointerdown', close)
      removeEventListener('keydown', esc)
    }
  }, [open])
  if (!canPickFolder()) return null

  const change = async () => {
    setOpen(false)
    const d = await pickFolder()
    if (d) setName(d.name)
  }
  const openFile = async () => {
    setOpen(false)
    const f = await openFromFolder()
    if (f) onFile(f)
  }
  return (
    <span className="pop-wrap" ref={box}>
      <button type="button" className="btn sm" aria-expanded={open} aria-haspopup="menu" onClick={() => (name ? setOpen((o) => !o) : change())}>
        <span aria-hidden="true">📁</span> {name ? `작업 폴더 ‘${name}’` : '작업 폴더 고르기'}
      </button>
      {open && (
        <span className="hint fmenu" role="menu" aria-label="작업 폴더">
          <span className="small muted">작업 파일(.transbee)은 ‘{name}’ 폴더에 저장돼요.</span>
          <button type="button" role="menuitem" className="btn sm" onClick={openFile}>
            이 폴더에서 작업 파일 열기
          </button>
          <button type="button" role="menuitem" className="btn sm" onClick={change}>
            다른 폴더로 바꾸기
          </button>
          <span className="small muted">
            바꾸면 앞으로의 저장이 새 폴더로 가요. 전에 저장한 파일은 옛 폴더에 그대로 있어요. Finder·탐색기에서 폴더를 바로 여는 것은 브라우저가 막아 두어서, 이 폴더의 파일을
            고르는 창을 열어 드려요.
          </span>
        </span>
      )}
    </span>
  )
}
