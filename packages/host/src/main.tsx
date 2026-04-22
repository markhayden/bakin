/**
 * Client entry for the Bakin host. Mounts the React root into #root.
 *
 * The real routing + shell come in TC2/TC3. For TC1 this is just proof
 * of the Bun.build() → browser pipeline.
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'

const root = document.getElementById('root')
if (!root) throw new Error('#root element missing from index.html')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
