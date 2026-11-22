import { Link } from 'react-router'
import { CheckCircle, CircleNotch, Info, WarningCircle } from '@phosphor-icons/react'
import SiteFooter from '../components/SiteFooter.jsx'
import { INSTALL_URL } from './config.js'

// Shared chrome for the Capann Premium pages (/verify, /view-my-links,
// /upgraded): the landing's dark palette, a glass header like /privacy, and
// small building blocks for status, notices and buttons.

const BASE = import.meta.env.BASE_URL

const FOCUS_RING = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-violet'

export const PRIMARY_BUTTON = `inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-pill bg-accent-violet text-ink text-[14.5px] font-medium transition-colors hover:bg-accent-violet-hover disabled:opacity-70 disabled:hover:bg-accent-violet ${FOCUS_RING}`

export const SECONDARY_BUTTON = `inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-pill border border-border-hairline-strong text-text-primary text-[14.5px] transition-colors hover:bg-surface-elevated disabled:opacity-60 ${FOCUS_RING}`

export function PremiumLayout({ wide = false, children }) {
  return (
    <div className="min-h-screen flex flex-col bg-ink text-text-primary font-sans">
      <header className="fixed top-0 inset-x-0 z-50 px-[clamp(12px,3vw,32px)] pt-3">
        <nav
          aria-label="Primary"
          className="glass max-w-[1280px] mx-auto flex items-center gap-3 md:gap-7 px-3.5 md:px-7 py-3.5 rounded-[28px] shadow-[0_18px_50px_rgba(0,0,0,0.45)]"
        >
          <Link to="/" className={`flex items-center gap-2 md:gap-3 mr-auto rounded-full ${FOCUS_RING} focus-visible:outline-offset-4`}>
            <img src={`${BASE}svg/capann-icon-light.svg`} alt="" className="w-[26px] h-[26px] md:w-[30px] md:h-[30px]" />
            <span className="font-display font-bold text-[23px] md:text-[29px] leading-none tracking-[0.03em]">
              CAPA<span className="text-accent-violet">NN</span>
            </span>
          </Link>
          <span className="hidden sm:inline-flex items-center px-2.5 py-1 rounded-full border border-border-hairline text-[10.5px] uppercase tracking-[0.16em] text-text-muted">
            Premium
          </span>
          <Link to="/" className="text-[13.5px] text-text-muted hover:text-text-primary transition-colors">
            Back to site
          </Link>
        </nav>
      </header>

      <main
        className={`flex-1 w-full mx-auto px-[clamp(20px,5vw,56px)] pt-[118px] md:pt-[150px] pb-20 ${wide ? 'max-w-[920px]' : 'max-w-[680px]'}`}
      >
        {children}
      </main>

      <div className="w-full max-w-[1280px] mx-auto px-[clamp(20px,5vw,56px)]">
        <SiteFooter />
      </div>
    </div>
  )
}

export function Card({ children }) {
  return (
    <div className="rounded-panel bg-surface-base border border-border-hairline p-[clamp(24px,5vw,44px)] shadow-[0_24px_70px_rgba(0,0,0,0.45)]">
      {children}
    </div>
  )
}

export function PageHeading({ eyebrow = 'Capann Premium', children }) {
  return (
    <>
      <div className="text-xs tracking-[0.16em] uppercase text-text-muted mb-4">{eyebrow}</div>
      <h1 className="font-display font-bold leading-[0.95] tracking-[0.01em] m-0 text-[clamp(40px,6vw,60px)] wrap-anywhere">
        {children}
      </h1>
    </>
  )
}

export function Spinner({ size = 18, className = '' }) {
  return <CircleNotch size={size} weight="bold" aria-hidden="true" className={`flex-none motion-safe:animate-spin ${className}`} />
}

/**
 * The page's one polite live region. Keep it mounted in the same place across
 * state changes so screen readers announce updates. `quiet` keeps the text for
 * assistive tech but hides it visually.
 */
export function StatusLine({ busy = false, quiet = false, children }) {
  if (quiet) {
    return (
      <p role="status" className="sr-only">
        {children}
      </p>
    )
  }
  return (
    <p role="status" className="flex items-center gap-2.5 min-h-[22px] mt-6 mb-0 text-[14px] leading-[1.5] text-text-body">
      {children &&
        (busy ? (
          <Spinner className="text-accent-violet" />
        ) : (
          <span aria-hidden="true" className="w-2 h-2 flex-none rounded-full bg-accent-mint" />
        ))}
      {children}
    </p>
  )
}

const NOTICE_TONES = {
  error: { box: 'border-error/30 bg-error/[0.07]', icon: 'text-error', Icon: WarningCircle },
  success: { box: 'border-accent-mint/30 bg-accent-mint/[0.07]', icon: 'text-accent-mint', Icon: CheckCircle },
  info: { box: 'border-border-hairline-strong bg-surface-elevated', icon: 'text-accent-violet', Icon: Info },
}

export function Notice({ tone = 'info', role, title, actions, children }) {
  const { box, icon, Icon } = NOTICE_TONES[tone]
  return (
    <div role={role} className={`mt-6 p-5 rounded-[20px] border ${box}`}>
      <div className="flex gap-3.5">
        <Icon size={22} weight="fill" aria-hidden="true" className={`flex-none mt-px ${icon}`} />
        <div className="min-w-0 text-[14.5px] leading-[1.65] text-text-body">
          {title && <p className={`m-0 font-medium ${tone === 'error' ? 'text-error' : 'text-text-primary'}`}>{title}</p>}
          {children && <div className={title ? 'mt-1' : ''}>{children}</div>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap gap-3 mt-5 sm:pl-[36px]">{actions}</div>}
    </div>
  )
}

/** Opens the install page in a new tab so this tab stays put for "Check again". */
export function InstallLink({ className = PRIMARY_BUTTON }) {
  const href = INSTALL_URL || `${BASE}#pricing`
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
      Install Capann Premium
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  )
}
