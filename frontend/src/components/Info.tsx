import { useId, useState, type ReactNode } from 'react'

/** Small (i) button with a plain-language explanation, on hover or keyboard focus. */
export function Info({ children, label = 'More information' }: { children: ReactNode; label?: string }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  return (
    <span className="info" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button type="button" aria-label={label} aria-describedby={open ? id : undefined}
        onFocus={() => setOpen(true)} onBlur={() => setOpen(false)} onClick={() => setOpen((o) => !o)}>
        i
      </button>
      {open && <span role="tooltip" id={id} className="info__pop">{children}</span>}
    </span>
  )
}
