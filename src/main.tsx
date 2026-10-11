import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { GmApp } from './gm/GmApp'
import { TableApp } from './table/TableApp'
import './styles.css'

const isTable = new URLSearchParams(location.search).get('view') === 'table'
document.title = isTable ? 'imagineVTT — Table' : 'imagineVTT — GM'

createRoot(document.getElementById('root')!).render(
  <StrictMode>{isTable ? <TableApp /> : <GmApp />}</StrictMode>,
)
