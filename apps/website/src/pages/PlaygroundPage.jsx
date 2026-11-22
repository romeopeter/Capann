import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import {
  ArrowCounterClockwise,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  ArrowsInSimple,
  ArrowsOutSimple,
  Monitor,
} from '@phosphor-icons/react'
import { CHALLENGES, EXPERIENCES } from '../playground/experiences.js'
import FeedbackSample from '../playground/samples/FeedbackSample.jsx'
import TeachSample from '../playground/samples/TeachSample.jsx'
import DiagnoseSample from '../playground/samples/DiagnoseSample.jsx'
import '../playground/playground.css'

const SAMPLES = {
  feedback: FeedbackSample,
  teach: TeachSample,
  diagnose: DiagnoseSample,
}

const BASE = import.meta.env.BASE_URL
const STEP_MS = 280 // matches --animate-pg-step-in
const STEP_EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)'

export default function PlaygroundPage() {
  const [step, setStep] = useState(1)
  const [activeId, setActiveId] = useState(EXPERIENCES[0].id)
  const [resetCount, setResetCount] = useState(0)
  const [announcement, setAnnouncement] = useState('')
  const [maximized, setMaximized] = useState(false)
  const [showMobileNotice, setShowMobileNotice] = useState(() => {
    if (typeof window === 'undefined') return false
    if (!window.matchMedia('(max-width: 767px)').matches) return false
    try {
      return window.sessionStorage.getItem('capann-playground-mobile-notice') !== 'dismissed'
    } catch {
      return true
    }
  })
  const tabRefs = useRef([])
  const stepRef = useRef(null)
  const previousStepRef = useRef(step)
  const maximizeButtonRef = useRef(null)
  const mobileNoticeButtonRef = useRef(null)
  const panelRef = useRef(null)
  const flipRef = useRef(null)

  useEffect(() => {
    document.title = 'Capann Playground — annotate a real page'
    // Paint the browser canvas (overscroll + scrollbar) mint too.
    document.body.classList.add('bg-pg-bg')
    return () => document.body.classList.remove('bg-pg-bg')
  }, [])

  useEffect(() => {
    if (previousStepRef.current === step) return
    previousStepRef.current = step

    window.scrollTo({ top: 0, behavior: 'smooth' })
    stepRef.current?.focus({ preventScroll: true })
  }, [step])

  useEffect(() => {
    if (!maximized) return

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    maximizeButtonRef.current?.focus()

    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [maximized])

  // FLIP the sample panel between its in-page frame and the fixed overlay.
  useLayoutEffect(() => {
    const panel = panelRef.current
    const first = flipRef.current
    if (!first) return
    flipRef.current = null
    if (!panel) return

    const last = panel.getBoundingClientRect()
    if (!last.width || !last.height) return

    const translateX = first.left - last.left
    const translateY = first.top - last.top
    const scaleX = first.width / last.width
    const scaleY = first.height / last.height

    panel.style.transition = 'none'
    panel.style.transformOrigin = 'top left'
    panel.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scaleX}, ${scaleY})`
    panel.getBoundingClientRect()

    const frame = requestAnimationFrame(() => {
      panel.style.transition = `transform ${STEP_MS}ms ${STEP_EASE}`
      panel.style.transform = 'none'
    })

    const timeout = setTimeout(() => {
      panel.style.transition = ''
      panel.style.transform = ''
      panel.style.transformOrigin = ''
    }, STEP_MS + 60)

    return () => {
      cancelAnimationFrame(frame)
      clearTimeout(timeout)
      panel.style.transition = ''
      panel.style.transform = ''
      panel.style.transformOrigin = ''
    }
  }, [maximized])

  const active = EXPERIENCES.find((exp) => exp.id === activeId) ?? EXPERIENCES[0]
  const Sample = SAMPLES[active.id]

  const selectTab = (index) => {
    setActiveId(EXPERIENCES[index].id)
    tabRefs.current[index]?.focus()
  }

  const onTabKeyDown = (event) => {
    const index = EXPERIENCES.findIndex((exp) => exp.id === activeId)
    const last = EXPERIENCES.length - 1
    let next = null

    if (event.key === 'ArrowRight') next = index === last ? 0 : index + 1
    else if (event.key === 'ArrowLeft') next = index === 0 ? last : index - 1
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = last

    if (next !== null) {
      event.preventDefault()
      selectTab(next)
    }
  }

  const resetPlayground = () => {
    setResetCount((count) => count + 1)
    setAnnouncement('Playground reset. The sample page is back to its starting state.')
  }

  const goToStep = (nextStep) => {
    if (nextStep === 1) setMaximized(false)
    setStep(nextStep)
  }

  const toggleMaximized = useCallback(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setMaximized((value) => !value)
      return
    }

    const panel = panelRef.current
    if (!panel) {
      setMaximized((value) => !value)
      return
    }

    panel.style.transition = 'none'
    panel.style.transform = ''
    flipRef.current = panel.getBoundingClientRect()
    setMaximized((value) => !value)
  }, [])

  useEffect(() => {
    if (!maximized) return

    const onKeyDown = (event) => {
      if (event.key === 'Escape') toggleMaximized()
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [maximized, toggleMaximized])

  const dismissMobileNotice = useCallback(() => {
    setShowMobileNotice(false)
    try {
      window.sessionStorage.setItem('capann-playground-mobile-notice', 'dismissed')
    } catch {
      /* sessionStorage can be unavailable in private modes */
    }
  }, [])

  useEffect(() => {
    if (!showMobileNotice) return

    const previousOverflow = document.body.style.overflow
    const previousFocus = document.activeElement
    document.body.style.overflow = 'hidden'
    mobileNoticeButtonRef.current?.focus()

    const onKeyDown = (event) => {
      if (event.key === 'Escape') dismissMobileNotice()
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKeyDown)
      if (previousFocus instanceof HTMLElement) {
        previousFocus.focus({ preventScroll: true })
      }
    }
  }, [showMobileNotice, dismissMobileNotice])

  return (
    <div className="min-h-screen bg-pg-bg font-sans text-pg-ink [color-scheme:light] selection:bg-[rgba(20,20,23,0.16)] selection:text-pg-ink">
      <header inert={showMobileNotice} className="px-[clamp(12px,3vw,32px)] pt-3">
        <nav
          aria-label="Primary"
          className="mx-auto flex max-w-[1440px] items-center gap-3 rounded-[28px] border border-pg-line bg-white/70 px-5 py-3.5 shadow-[0_18px_50px_rgba(20,20,23,0.12)] backdrop-blur-panel md:px-7"
        >
          <Link to="/" className="flex cursor-pointer items-center gap-2.5 rounded-full focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink">
            <img src={`${BASE}svg/capann-icon-dark.svg`} alt="" className="h-[26px] w-[26px]" />
            <span className="font-display text-[24px] font-bold leading-none tracking-[0.03em]">
              CAPA<span className="text-draw">NN</span>
            </span>
          </Link>
          <span className="ml-1 hidden items-center rounded-full bg-ink px-2.5 py-1 text-[10.5px] uppercase tracking-[0.16em] text-white sm:inline-flex">
            Playground
          </span>
          <div className="ml-auto flex items-center gap-4">
            <Link to="/" className="hidden cursor-pointer text-[13px] text-pg-body transition-colors hover:text-pg-ink min-[400px]:inline">
              Back to site
            </Link>
            <a
              href={`${BASE}#pricing`}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-ink px-4 py-2 text-[12.5px] font-medium text-white transition-colors hover:bg-elevated"
            >
              Get Capann
              <ArrowUpRight size={13} weight="bold" aria-hidden="true" />
            </a>
          </div>
        </nav>
      </header>

      <main inert={showMobileNotice} className="mx-auto max-w-[1440px] px-[clamp(16px,3vw,32px)] pb-16">
        <div
          key={step}
          ref={stepRef}
          role="region"
          aria-label={step === 1 ? 'Step 1 of 2: Interactive playground' : 'Step 2 of 2: Choose a sample page'}
          tabIndex={-1}
          className="outline-none motion-safe:animate-pg-step-in"
        >
          {step === 1 ? (
            <>
              <section className="pb-10 pt-10 sm:pt-12">
                <div className="mb-4 text-[15px] uppercase text-pg-body">Step 1 of 2 · Interactive playground</div>
                <h1 className="m-0 max-w-[16ch] font-display text-[clamp(46px,7.4vw,96px)] font-bold leading-[0.86] tracking-[0.01em]">
                  GO ON. MAKE A{' '}
                  <span className="relative isolate inline-block">
                    <span
                      aria-hidden="true"
                      className="absolute inset-x-[-0.04em] bottom-[0.04em] -z-10 h-[0.32em] -rotate-[0.6deg] bg-hl"
                    />
                    POINT.
                  </span>
                </h1>
                <p className="mt-5 font-display text-[clamp(24px,2.6vw,34px)] font-bold leading-tight tracking-[0.01em] text-pg-body">
                  This page is yours to mark up.
                </p>
                <p className="mt-3 max-w-[62ch] text-[15.5px] leading-[1.65] text-pg-muted">
                  Try Capann on a real webpage. Draw, point, capture a screenshot, or record a walkthrough. Nothing you do changes the underlying page.
                </p>
              </section>

              <section aria-label="Playground instructions">
                <div className="flex flex-col gap-5 rounded-2xl border border-pg-line bg-pg-surface p-5 lg:flex-row lg:items-center lg:gap-8">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-[11px] uppercase text-pg-body">Your playground</div>
                    <p className="mt-2 text-[14.5px] leading-[1.6]">
                      Click the <strong className="font-medium text-pg-ink">Capann extension icon</strong> in your browser toolbar to start annotating.
                    </p>
                    <p className="mt-1 text-[12.5px] leading-[1.6] text-pg-muted">
                      Next, choose a sample page. Capann draws on top of it — nothing you do changes the underlying page.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 lg:ml-auto lg:flex-none">
                    <span className="hidden rounded-full bg-ink px-3 py-2 text-[11.5px] text-white sm:inline-flex">
                      <kbd className="mr-1.5 font-sans text-white">Alt+Shift+S</kbd> toggles draw mode
                    </span>
                  </div>
                </div>
              </section>

              <section aria-labelledby="pg-challenges-heading" className="mt-8">
                <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <h2 id="pg-challenges-heading" className="m-0 text-[11px] uppercase tracking-[0.16em] text-pg-body">
                    Optional challenges
                  </h2>
                  <p className="m-0 text-[12px] text-pg-muted">Suggestions, not a checklist. This page can’t track your progress.</p>
                </div>
                <ol className="grid list-none gap-3 p-0 sm:grid-cols-3">
                  {CHALLENGES.map(([title, body], index) => (
                    <li key={title} className="flex items-start gap-3 rounded-2xl border border-pg-line bg-pg-surface px-4 py-3.5">
                      <span
                        aria-hidden="true"
                        className="mt-0.5 grid h-6 w-6 flex-none place-items-center rounded-full bg-ink font-display text-[13px] font-bold text-white"
                      >
                        {index + 1}
                      </span>
                      <span>
                        <span className="block text-[12px] font-medium uppercase tracking-[0.08em] text-pg-ink">{title}</span>
                        <span className="mt-0.5 block text-[12.5px] leading-[1.5] text-pg-muted">{body}</span>
                      </span>
                    </li>
                  ))}
                </ol>
              </section>

              <section className="mt-8 flex flex-col gap-4 rounded-[24px] border border-pg-line bg-pg-surface p-6 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="m-0 font-display text-[clamp(22px,2.4vw,30px)] font-bold uppercase leading-none tracking-[0.02em]">
                    Ready to make your point?
                  </p>
                  <p className="mt-2 text-[13px] leading-[1.6] text-pg-muted">
                    Pick a sample page, then annotate it with the Capann extension.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => goToStep(2)}
                  className="inline-flex flex-none cursor-pointer items-center justify-center gap-2 rounded-full bg-ink px-5 py-3 text-[14px] font-medium text-white transition-colors hover:bg-elevated focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
                >
                  Choose a sample page
                  <ArrowRight size={16} weight="bold" aria-hidden="true" />
                </button>
              </section>
            </>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3 pb-4 pt-8">
                <button
                  type="button"
                  onClick={() => goToStep(1)}
                  className="inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-ink px-3.5 py-2 text-[12.5px] font-medium text-white transition-colors hover:bg-elevated focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
                >
                  <ArrowLeft size={14} weight="bold" aria-hidden="true" />
                  Back to intro
                </button>
                <span className="text-[15px] uppercase text-pg-body">Step 2 of 2 · Choose a page</span>
              </div>

              <section aria-labelledby="pg-experience-heading">
                <h2 id="pg-experience-heading" className="sr-only">
                  Choose a sample experience
                </h2>
                <div
                  role="tablist"
                  aria-label="Sample experiences"
                  aria-labelledby="pg-experience-heading"
                  className="grid gap-3 md:grid-cols-3"
                >
                  {EXPERIENCES.map((exp, index) => {
                    const isActive = exp.id === activeId
                    return (
                      <button
                        key={exp.id}
                        ref={(el) => {
                          tabRefs.current[index] = el
                        }}
                        type="button"
                        role="tab"
                        id={`pg-tab-${exp.id}`}
                        aria-selected={isActive}
                        aria-controls="pg-sample-panel"
                        tabIndex={isActive ? 0 : -1}
                        onClick={() => setActiveId(exp.id)}
                        onKeyDown={onTabKeyDown}
                        className={`flex cursor-pointer flex-col items-start gap-2 rounded-2xl p-4 text-left transition-colors duration-morph ease-morph focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink ${
                          isActive ? 'bg-pg-surface' : 'border-pg-line bg-gray-100 hover:bg-pg-surface-tint'
                        }`}
                      >
                        <span className="flex w-full items-center gap-2">
                          <span className="text-[14.5px] font-medium leading-tight">{exp.label}</span>
                          {isActive && (
                            <span
                              aria-hidden="true"
                              className="ml-auto flex-none rounded-full bg-ink px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.1em] text-white"
                            >
                              Viewing
                            </span>
                          )}
                        </span>
                        <span className={`text-[12.5px] leading-[1.5] ${isActive ? 'text-pg-body' : 'text-pg-muted'}`}>{exp.blurb}</span>
                      </button>
                    )
                  })}
                </div>
              </section>

              <section aria-label="Playground instructions" className="mt-6">
                <div className="flex flex-col gap-5 rounded-2xl border border-pg-line bg-pg-surface p-5 lg:flex-row lg:items-center lg:gap-8">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-[11px] uppercase text-pg-body">Your playground</div>
                    <p className="mt-2 text-[14.5px] leading-[1.6]">
                      Click the <strong className="font-medium text-pg-ink">Capann extension icon</strong> in your browser toolbar to start annotating.
                    </p>
                    <p className="mt-1 text-[12.5px] leading-[1.6] text-pg-muted">
                      Capann draws on top of this page. Reset restores the sample only — it never clears your drawings or recordings.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 lg:ml-auto lg:flex-none">
                    <span className="hidden rounded-full bg-ink px-3 py-2 text-[11.5px] text-white sm:inline-flex">
                      <kbd className="mr-1.5 font-sans text-white">Alt+Shift+S</kbd> toggles draw mode
                    </span>
                    <button
                      type="button"
                      onClick={resetPlayground}
                      className="inline-flex cursor-pointer items-center gap-2 rounded-full bg-ink px-4 py-2.5 text-[13px] font-medium text-white transition-colors hover:bg-elevated focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
                    >
                      <ArrowCounterClockwise size={15} weight="bold" aria-hidden="true" />
                      Reset playground
                    </button>
                  </div>
                </div>
                <p className="sr-only" role="status" aria-live="polite">
                  {announcement}
                </p>
              </section>

            </>
          )}
        </div>

        {step === 2 && (
          <section className="mt-6 motion-safe:animate-pg-fade-in">
            <div className={maximized ? 'fixed inset-0 z-[70] flex flex-col bg-pg-bg p-2 sm:p-4' : ''}>
              <div className="mb-2 flex items-center justify-between gap-3">
                <p className="m-0 text-[11px] uppercase tracking-[0.16em] text-pg-body">
                  Sample page <span className="normal-case tracking-normal text-pg-muted">· {active.label}</span>
                </p>
                <button
                  ref={maximizeButtonRef}
                  type="button"
                  aria-pressed={maximized}
                  aria-label={maximized ? 'Minimize sample' : 'Maximize sample'}
                  onClick={toggleMaximized}
                  className="inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-ink px-3 py-1.5 text-[11.5px] font-medium text-white transition-colors hover:bg-elevated focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
                >
                  {maximized ? (
                    <ArrowsInSimple size={14} weight="bold" aria-hidden="true" />
                  ) : (
                    <ArrowsOutSimple size={14} weight="bold" aria-hidden="true" />
                  )}
                  <span className="hidden sm:inline">{maximized ? 'Minimize' : 'Maximize'}</span>
                </button>
              </div>
              <div
                ref={panelRef}
                id="pg-sample-panel"
                role="tabpanel"
                aria-label={`${active.label} sample page`}
                tabIndex={0}
                className={`border border-pg-line-strong bg-browser shadow-[0_30px_80px_rgba(20,20,23,0.28)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink ${
                  maximized
                    ? 'min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-[26px]'
                    : 'overflow-hidden rounded-[26px]'
                }`}
              >
                <p className="sr-only">{active.challenge}</p>
                <Sample key={`${active.id}-${resetCount}`} />
              </div>
            </div>
          </section>
        )}

        <footer className="mt-10 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-pg-line pt-6 text-[12px] text-pg-muted">
          <span>All sample content is fictional. Nothing is sent anywhere.</span>
          <a href={`${BASE}#pricing`} className="ml-auto inline-flex cursor-pointer items-center gap-1 font-medium text-ink transition-colors hover:text-pg-muted">
            Get Capann Free
            <ArrowUpRight size={12} weight="bold" aria-hidden="true" />
          </a>
        </footer>
      </main>

      {showMobileNotice && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 motion-safe:animate-pg-fade-in">
          <div
            className="absolute inset-0 bg-ink/70 backdrop-blur-sm"
            aria-hidden="true"
            onClick={dismissMobileNotice}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="pg-mobile-notice-title"
            aria-describedby="pg-mobile-notice-desc"
            className="relative max-h-[calc(100dvh-2rem)] w-full max-w-[430px] overflow-y-auto rounded-[26px] border border-pg-line bg-pg-surface p-6 text-pg-ink shadow-[0_30px_90px_rgba(20,20,23,0.42)]"
          >
            <div className="flex items-start gap-4">
              <span className="grid h-11 w-11 flex-none place-items-center rounded-full bg-ink text-white">
                <Monitor size={20} weight="bold" aria-hidden="true" />
              </span>
              <div>
                <p className="text-[11px] uppercase tracking-[0.16em] text-pg-muted">Capann Playground</p>
                <h2
                  id="pg-mobile-notice-title"
                  className="mt-1 font-display text-[clamp(26px,7vw,34px)] font-bold leading-[0.95] tracking-[0.01em]"
                >
                  Best on a desktop.
                </h2>
              </div>
            </div>

            <p id="pg-mobile-notice-desc" className="mt-4 text-[14px] leading-[1.65] text-pg-body">
              The playground is for testing the Capann browser extension. You can browse the samples here on mobile;
              the drawing, pointing, and recording tools need the extension on a desktop browser.
            </p>

            <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:items-center">
              <Link
                to="/"
                className="cursor-pointer text-center text-[12.5px] font-medium text-pg-muted transition-colors hover:text-pg-ink sm:mr-auto"
              >
                Back to site
              </Link>
              <button
                ref={mobileNoticeButtonRef}
                type="button"
                onClick={dismissMobileNotice}
                className="inline-flex cursor-pointer items-center justify-center rounded-full bg-ink px-5 py-2.5 text-[13px] font-medium text-white transition-colors hover:bg-elevated focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
              >
                Continue anyway
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
