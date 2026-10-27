export function Brand({ size = 26, byline = false }: { size?: number; byline?: boolean }) {
  return (
    <span className="brand">
      <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
        <rect x="1" y="1" width="30" height="30" rx="8" fill="#0f1b2a" />
        <path d="M7 22h4l3-10 4 14 3-9h4" fill="none" stroke="#f26b1d" strokeWidth="2.4"
          strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="7" cy="22" r="1.8" fill="#4fc3dd" />
        <circle cx="25" cy="17" r="1.8" fill="#4fc3dd" />
      </svg>
      GridXray
      {byline && <ByZynplex />}
    </span>
  )
}

export function ByZynplex() {
  return (
    <a className="byline" href="https://zynplex.com" target="_blank" rel="noopener noreferrer">
      by <b>Zynplex</b>
    </a>
  )
}
