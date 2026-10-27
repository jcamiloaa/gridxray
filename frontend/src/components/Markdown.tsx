import type { ReactNode } from 'react'

/** Inline markdown: **bold**, *italic*, `code`; LaTeX delimiters \( \) are dropped. */
function inline(text: string): ReactNode[] {
  const clean = text.replace(/\\\(|\\\)/g, '').replace(/\\\[|\\\]/g, '')
  const parts = clean.split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*)/g)
  return parts.map((p, i) => {
    if (p.startsWith('**') && p.endsWith('**')) return <strong key={i}>{p.slice(2, -2)}</strong>
    if (p.startsWith('`') && p.endsWith('`')) return <code key={i}>{p.slice(1, -1)}</code>
    if (p.startsWith('*') && p.endsWith('*') && p.length > 2) return <em key={i}>{p.slice(1, -1)}</em>
    return p
  })
}

/** Small, safe markdown renderer for model output: headings, bullet/numbered lists and paragraphs. */
export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = []
  let list: { ordered: boolean; items: string[] } | null = null
  const flush = () => {
    if (!list) return
    const items = list.items.map((it, i) => <li key={i}>{inline(it)}</li>)
    blocks.push(list.ordered ? <ol key={blocks.length}>{items}</ol> : <ul key={blocks.length}>{items}</ul>)
    list = null
  }
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    const bullet = line.match(/^[-*•]\s+(.*)/)
    const numbered = line.match(/^\d+[.)]\s+(.*)/)
    const heading = line.match(/^#{1,4}\s+(.*)/) ?? line.match(/^\*\*([^*]+)\*\*:?$/)
    if (bullet || numbered) {
      const ordered = Boolean(numbered)
      if (!list || list.ordered !== ordered) { flush(); list = { ordered, items: [] } }
      list.items.push((bullet ?? numbered)![1])
    } else if (heading) {
      flush()
      blocks.push(<b key={blocks.length} className="md-h">{inline(heading[1])}</b>)
    } else if (line) {
      flush()
      blocks.push(<p key={blocks.length}>{inline(line)}</p>)
    } else {
      flush()
    }
  }
  flush()
  return <div className="md">{blocks}</div>
}
