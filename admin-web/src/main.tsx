import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ErrorBoundary } from './ErrorBoundary.tsx'

window.addEventListener('unhandledrejection', (ev) => {
  console.error('[admin-web] unhandled rejection', ev.reason)
})

window.addEventListener('error', (ev) => {
  console.error('[admin-web] uncaught error', ev.error ?? ev.message)
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
