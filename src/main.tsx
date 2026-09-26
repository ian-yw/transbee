import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './app/fonts.css'
import './index.css'
import App from './App.tsx'
import { applyTheme } from './app/settings'
import { UpdateNote } from './app/ui'

applyTheme()
// 앱 셸 보관(인터넷 없이 열기). 빌드 결과에만 sw.js가 있다.
if (import.meta.env.PROD && 'serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <UpdateNote />
  </StrictMode>,
)
