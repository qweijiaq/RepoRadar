import Link from 'next/link'

export function SiteBrand() {
  return (
    <Link className="brand" href="/">
      <span className="seal" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.4">
          <circle cx="12" cy="12" r="9" opacity="0.35" />
          <circle cx="12" cy="12" r="5.2" opacity="0.65" />
          <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
          <path d="M12 2v3M12 19v3M2 12h3M19 12h3" opacity="0.5" />
        </svg>
      </span>
      <span className="brand-text">
        <span className="brand-title">REPORADAR</span>
        <span className="brand-sub">OPEN SOURCE RADAR</span>
      </span>
    </Link>
  )
}
