import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import SiteFooter from '../components/SiteFooter.jsx'
import {
  ArrowRight,
  Check,
  CursorClick,
  DownloadSimple,
  ImageSquare,
  LinkSimple,
  List,
  PencilSimple,
  ShareNetwork,
  VideoCamera,
  X,
} from '@phosphor-icons/react'

const NAV_LINKS = [
  ['Who it’s for', '#uses'],
  ['What you get', '#features'],
  ['Pricing', '#pricing'],
  ['FAQ', '#faq'],
]

const USES = [
  { dot: 'bg-draw', title: 'For QA engineers and developers', body: 'Show exactly where a bug occurs, annotate unexpected behaviour, and record the steps needed to reproduce it. Give your team a clear visual report instead of another vague bug ticket.' },
  { dot: 'bg-rec', title: 'For teachers, trainers, and presenters', body: 'Guide your audience’s attention, highlight important details, and walk through complex ideas without losing people in a sea of information — live or in a recorded walkthrough.' },
  { dot: 'bg-hl', title: 'For salespeople and product demonstrators', body: 'Walk prospects through a product, point out the details that matter, and make demonstrations more engaging — without relying on lengthy explanations.' },
  { dot: 'bg-draw', title: 'For customer support agents', body: 'Help customers understand exactly what to click, where to look, and what to do next. Annotate a webpage, or record a walkthrough that resolves issues with fewer rounds of back-and-forth.' },
  { dot: 'bg-rec', title: 'For content creators and tutorial makers', body: 'Create clearer, click-by-click walkthroughs with visible cursor interactions, annotations, and optional camera footage. Turn what’s happening on your screen into a tutorial people can actually follow.' },
  { dot: 'bg-hl', title: 'For remote teams and collaborators', body: 'Give visual feedback on documents, designs, websites, and interfaces. Circle the problem, point to the solution, and keep discussions moving without another meeting.' },
  { dot: 'bg-draw', title: 'For freelancers and agencies', body: 'Present work to clients, explain design decisions, and deliver feedback that leaves little room for misunderstanding — without scheduling another call.' },
]

const FEATURE_GROUPS = [
  {
    icon: PencilSimple,
    tier: 'Free',
    title: 'ANNOTATION & DRAWING',
    items: [
      ['Draw, precisely', 'Pencil with a full colour palette and custom colour picker, a translucent highlighter, arrows with three head styles, filled or outlined rectangles and ellipses, and text callouts — all adjustable in size and colour.'],
      ['Fix a mistake without starting over', 'The eraser removes exactly the mark you click — nothing more.'],
      ['Annotations that stick around', 'Your marks persist per tab through switches and reloads, until you clear them yourself.'],
    ],
  },
  {
    icon: CursorClick,
    tier: 'Free',
    title: 'ATTENTION GUIDANCE',
    items: [
      ['Direct attention without blocking the page', 'The laser pointer leaves a fading trail as you talk. The spotlight dims everything except the area you’re focusing on. Both let you interact with the webpage underneath.'],
    ],
  },
  {
    icon: ImageSquare,
    tier: 'Free',
    title: 'SCREENSHOT CAPTURE',
    items: [
      ['Capture what you made', 'Save the visible tab as a PNG, composited with everything you’ve drawn — one click, instant download.'],
    ],
  },
  {
    icon: VideoCamera,
    tier: 'Pro',
    title: 'SCREEN & CAMERA RECORDING',
    items: [
      ['Record your screen, your camera, or both', 'Upgrade to capture your screen, your camera, or both in one recording. Start recording, do your walkthrough, and stop when you’re done.'],
    ],
  },
  {
    icon: ShareNetwork,
    tier: 'Pro',
    title: 'DOWNLOADING & SHARING',
    items: [
      ['Download the video to your device', 'Keep the video file on your device. Downloaded files never expire.'],
      ['Share a link that lasts seven days', 'Generate a shareable recording link. Recipients can watch without installing Capann or creating an account. Links expire after seven days.'],
    ],
  },
]

const FREE_FEATURES = [
  'Draw and sketch over any webpage',
  'Pencil, colour picker, and highlighter',
  'Arrows, rectangles, ellipses, and text callouts',
  'Laser pointer and spotlight',
  'Erase individual annotations',
  'Annotations persist across tab switches and reloads',
  'Save annotated screenshots as PNG files',
  'Keyboard shortcuts for a faster workflow',
]

const PRO_FEATURES = [
  'Everything in Free',
  'Record your screen, camera, or both',
  'Download recordings directly to your device',
  'Generate shareable recording links',
  'Recipients watch without Capann or an account',
  'Share links expire after seven days',
]

const SHORTCUTS = [
  ['Alt+Shift+S', 'Toggle draw mode on the active tab'],
  ['Alt+Shift+T', 'Cycle to the next tool'],
  ['Alt+Shift+C', 'Clear all annotations'],
  ['Esc', 'Exit draw mode without losing your marks'],
]

const FAQS = [
  ['Is Capann free?', 'Yes. Every annotation tool — drawing, highlighter, arrows, shapes, text callouts, laser pointer, spotlight, eraser, persistent annotations, PNG screenshots, and keyboard shortcuts — is free.'],
  ['What does Pro add?', 'Pro adds screen, camera, and screen-plus-camera recording, downloading recordings to your device, and shareable recording links. It costs $10 once and unlocks Pro permanently for your user account. No subscription, no renewal.'],
  ['Is Pro a subscription?', 'No. Pro is a single $10 payment for permanent access. There is no monthly bill, no recurring charge, and no renewal.'],
  ['How long do shareable recording links last?', 'Shared recording links expire after seven days. That expiry applies only to the links — video files you download to your device never expire.'],
  ['Can other people watch a shared recording?', 'Yes. Recipients can open a share link and watch without installing Capann or creating an account.'],
  ['Do my annotations change the webpage?', 'No. Everything you draw floats above the page and disappears when you clear it. Your annotations never permanently alter the underlying page.'],
  ['Will my annotations disappear if I switch tabs or refresh?', 'No — your marks persist on that tab through switches and reloads. They only clear when you hit Clear yourself (or use the Alt+Shift+C shortcut).'],
  ['Which browsers does Capann work on?', 'Capann works on Chromium-based browsers — Chrome, Edge, and Brave.'],
]

const TOOLS_ROW1 = [
  { id: 'pencil', path: (<><path d="M12 19l7-7-4-4-7 7-1 5 5-1z" /><path d="M18 6l1-1" /></>) },
  { id: 'highlighter', path: (<><path d="M9 11l-4 4v4h4l10-10-4-4-6 6z" /><path d="M4 21h16" /></>) },
  { id: 'arrow', path: (<><path d="M7 17L17 7" /><path d="M9 7h8v8" /></>) },
  { id: 'rect', path: (<rect x="4" y="5" width="16" height="14" rx="3" />) },
  { id: 'circle', path: (<circle cx="12" cy="12" r="8" />) },
  { id: 'text', path: (<><path d="M5 6h14" /><path d="M12 6v13" /></>) },
]

const TOOLS_ROW2 = [
  { id: 'laser', path: (<><circle cx="12" cy="12" r="3" /><path d="M12 3v3M12 18v3M3 12h3M18 12h3" /></>) },
  { id: 'spotlight', path: (<><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none" /></>) },
  { id: 'eraser', path: (<><path d="M17 6l-9 9-4-3 9-6z" /><path d="M6 20h12" /></>) },
]

const COLORS = ['#A78BFA', '#86EFAC', '#F5E8A6', '#F5F5F7']

function ToolbarDemo() {
  const [tool, setTool] = useState('pencil')
  const [color, setColor] = useState('#A78BFA')
  const [size, setSize] = useState(54)

  const btn = (id) =>
    `grid place-items-center h-[34px] rounded-xl transition-colors cursor-pointer border-0 bg-transparent ${
      tool === id ? 'tool-active' : 'text-muted hover:bg-elevated hover:text-paper'
    }`

  return (
    <div className="w-full max-w-[480px] rounded-[34px] bg-[#0F0F12] border border-white/10 shadow-[0_30px_70px_rgba(0,0,0,0.5)] p-[18px] flex flex-col gap-[14px]">
      <div className="flex items-center gap-2.5 px-1">
        <div className="flex gap-1.5">
          {[0, 1, 2].map((i) => (
            <div key={i} className="w-2.5 h-2.5 rounded-full bg-white/15" />
          ))}
        </div>
        <div className="flex-1 h-[22px] rounded-full bg-panel" />
      </div>

      <div className="relative rounded-3xl bg-panel h-[250px] overflow-hidden">
        <div className="absolute left-[26px] top-[28px] w-[146px] h-3 rounded-full bg-white/10" />
        <div className="absolute left-[26px] top-[52px] w-[100px] h-3 rounded-full bg-white/5" />
        <div className="absolute left-[26px] top-[104px] w-[138px] h-[74px] rounded-[18px] bg-white/5" />
        <div className="absolute right-10 top-[30px] w-24 h-3 rounded bg-hl opacity-50" />
        <div className="absolute right-7 top-[100px] w-32 h-[82px] rounded-[18px] border-2" style={{ borderColor: color }} />
        <div className="absolute left-[176px] top-[150px] w-[92px] h-[2.5px] rounded-sm rotate-[-30deg]" style={{ background: color }} />
        <div className="absolute left-6 bottom-4 flex items-center gap-2 px-3.5 py-1.5 rounded-full glass text-[11.5px]">
          <div className="w-2 h-2 rounded-full bg-rec" />
          Recording
        </div>
      </div>

      <div className="flex flex-col gap-3 p-3.5 rounded-[28px] glass">
        <div className="grid grid-cols-6 gap-1.5">
          {TOOLS_ROW1.map((t) => (
            <button key={t.id} aria-label={t.id} onClick={() => setTool(t.id)} className={btn(t.id)}>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.75" strokeLinecap="round" strokeLinejoin="round">{t.path}</svg>
            </button>
          ))}
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          {TOOLS_ROW2.map((t) => (
            <button key={t.id} aria-label={t.id} onClick={() => setTool(t.id)} className={btn(t.id)}>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.75" strokeLinecap="round" strokeLinejoin="round">{t.path}</svg>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2.5">
          {COLORS.map((c) => (
            <button
              key={c}
              aria-label={`color ${c}`}
              onClick={() => setColor(c)}
              className={`w-[18px] h-[18px] rounded-full cursor-pointer border-0 p-0 ${color === c ? 'shadow-[0_0_0_2px_#F5F5F7]' : ''}`}
              style={{ background: c }}
            />
          ))}
          <div
            className="ml-auto h-1 w-[88px] rounded-full bg-white/10 cursor-pointer"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect()
              setSize(Math.round(((e.clientX - r.left) / r.width) * 100))
            }}
          >
            <div className="h-1 rounded-full bg-draw" style={{ width: size }} />
          </div>
        </div>
        <div className="flex gap-2">
          <button className="flex-1 grid place-items-center h-8 rounded-full border border-white/15 text-[13px] bg-transparent text-paper cursor-pointer">Clear</button>
          <button className="flex-1 grid place-items-center h-8 rounded-full bg-rec text-[#0A2E1B] text-[13px] font-medium border-0 cursor-pointer">Save</button>
        </div>
      </div>
    </div>
  )
}

function TierBadge({ tier }) {
  const pro = tier === 'Pro'
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-medium tracking-[0.08em] uppercase ${pro ? 'bg-rec text-[#0A2E1B]' : 'bg-elevated text-body'}`}>
      {tier}
    </span>
  )
}

function CheckItem({ children, pro }) {
  return (
    <li className="flex items-start gap-2.5 text-[14.5px] leading-[1.6] text-body">
      <Check size={17} weight="bold" aria-hidden="true" className={`flex-none mt-[3px] ${pro ? 'text-rec' : 'text-draw'}`} />
      <span>{children}</span>
    </li>
  )
}

export default function LandingPage() {
  const [scrolled, setScrolled] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const headerRef = useRef(null)

  useEffect(() => {
    document.title = 'Capann — Show, don’t tell | Annotate & record any page'
  }, [])

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    if (!menuOpen) return

    const onKeyDown = (event) => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    const onPointerDown = (event) => {
      if (headerRef.current && !headerRef.current.contains(event.target)) {
        setMenuOpen(false)
      }
    }
    const desktop = window.matchMedia('(min-width: 768px)')
    const onDesktop = (event) => {
      if (event.matches) setMenuOpen(false)
    }

    window.addEventListener('keydown', onKeyDown)
    document.addEventListener('pointerdown', onPointerDown)
    desktop.addEventListener('change', onDesktop)

    return () => {
      window.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('pointerdown', onPointerDown)
      desktop.removeEventListener('change', onDesktop)
    }
  }, [menuOpen])

  return (
    <div className="min-h-screen bg-ink text-paper font-sans">
      <header ref={headerRef} className="fixed top-0 inset-x-0 z-50 px-[clamp(12px,3vw,32px)] pt-3">
        <nav aria-label="Primary" className={`max-w-[1280px] mx-auto flex items-center gap-2 md:gap-7 px-3.5 md:px-7 py-3.5 rounded-[28px] border transition-all duration-morph ease-morph ${scrolled ? 'glass shadow-[0_18px_50px_rgba(0,0,0,0.45)]' : 'bg-transparent border-transparent'}`}>
          <div className="flex items-center gap-2 md:gap-3 mr-auto">
            <img src={`${import.meta.env.BASE_URL}svg/capann-icon-light.svg`} alt="Capann" className="w-[26px] h-[26px] md:w-[30px] md:h-[30px]" />
            <div className="font-display font-bold text-[23px] md:text-[29px] leading-none tracking-[0.03em]">
              CAPA<span className="text-draw">NN</span>
            </div>
          </div>
          <div className="hidden md:flex items-center gap-7">
            {NAV_LINKS.map(([label, href]) => (
              <a key={href + label} href={href} className="text-[13.5px] text-muted hover:text-paper transition-colors">{label}</a>
            ))}
            <Link to="/playground" className="text-[13.5px] text-muted hover:text-paper transition-colors">Playground</Link>
          </div>
          <a href="#pricing" onClick={() => setMenuOpen(false)} className="inline-flex items-center px-3 md:px-5 py-2 md:py-2.5 rounded-full bg-draw text-ink text-[12px] md:text-[13.5px] font-medium hover:bg-draw-hover transition-colors">
            Get Capann<span className="hidden sm:inline"> Free</span>
          </a>
          <button
            type="button"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            aria-controls="landing-mobile-menu"
            onClick={() => setMenuOpen((open) => !open)}
            className="md:hidden inline-flex h-9 w-9 flex-none cursor-pointer items-center justify-center rounded-full border border-white/10 text-paper transition-colors hover:bg-elevated"
          >
            {menuOpen ? <X size={18} weight="bold" aria-hidden="true" /> : <List size={18} weight="bold" aria-hidden="true" />}
          </button>
        </nav>
        <div
          id="landing-mobile-menu"
          aria-hidden={!menuOpen}
          inert={!menuOpen}
          className={`md:hidden max-w-[1280px] mx-auto grid overflow-hidden transition-[grid-template-rows,opacity] duration-morph ease-morph motion-reduce:transition-none ${
            menuOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
          }`}
        >
          <div className="min-h-0">
            <nav aria-label="Mobile" className="mt-2 rounded-[22px] glass p-2 shadow-[0_18px_50px_rgba(0,0,0,0.35)]">
              {NAV_LINKS.map(([label, href]) => (
                <a
                  key={href + label}
                  href={href}
                  onClick={() => setMenuOpen(false)}
                  className="flex items-center rounded-2xl px-4 py-3 text-[14px] text-body transition-colors hover:bg-white/5 hover:text-paper"
                >
                  {label}
                </a>
              ))}
              <Link
                to="/playground"
                onClick={() => setMenuOpen(false)}
                className="flex items-center justify-between rounded-2xl px-4 py-3 text-[14px] text-paper transition-colors hover:bg-white/5"
              >
                Playground
                <ArrowRight size={14} weight="bold" aria-hidden="true" className="text-draw" />
              </Link>
            </nav>
          </div>
        </div>
      </header>

      <main className="max-w-[1280px] mx-auto px-[clamp(20px,5vw,56px)] pt-[110px]">
        {/* Hero */}
        <section className="grid gap-14 items-center py-14 pb-24 lg:grid-cols-[1.05fr_0.95fr]">
          <div>
            <h1 className="font-display font-bold leading-[0.86] tracking-[0.01em] m-0 text-[clamp(64px,8.4vw,116px)]">
              <span className="block">SHOW,</span>
              <span className="block">DON’T <span className="text-draw">TELL.</span></span>
            </h1>
            <p className="text-[17px] leading-[1.66] max-w-[46ch] mt-[30px] text-body">
              Capann is the browser extension that lets you draw, point, highlight, and guide attention directly over any webpage. Explain what matters, make your point clear, and record walkthroughs when you need more than a screenshot.
            </p>
            <div className="mt-7 text-[15.5px] leading-[1.85]">
              Start annotating for free. Upgrade once to record, download, and share your screen.
            </div>
            <div className="mt-2 text-[15.5px] leading-[1.85] font-medium">
              <span className="relative inline-block pb-[16px]">
                Free to use. Pro for $10, one-time.
                <svg viewBox="0 0 320 16" preserveAspectRatio="none" fill="none" className="absolute left-[-8px] bottom-0 w-[calc(100%+16px)] h-[16px]">
                  <path d="M4 10.5 C 60 3, 110 13, 160 7 C 210 1.5, 260 12.5, 316 9" stroke="#86EFAC" strokeWidth="5" strokeLinecap="round" />
                </svg>
              </span>
            </div>
            <div className="flex flex-wrap gap-3 mt-8">
              <a href="#pricing" className="inline-flex items-center px-[26px] py-[15px] rounded-full bg-draw text-ink text-[14.5px] font-medium hover:bg-draw-hover transition-colors">
                Get Capann Free
              </a>
              <a href="#features" className="inline-flex items-center px-6 py-[15px] rounded-full border border-white/15 text-paper text-[14.5px] hover:bg-elevated transition-colors">
                See it in action ↓
              </a>
            </div>
          </div>
          <div className="flex flex-col items-center">
            <ToolbarDemo />
          </div>
        </section>

        {/* Problem */}
        <section className="grid gap-7 py-6 pb-24 items-start lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)] lg:gap-x-[clamp(24px,5vw,88px)]">
          <div>
            <div className="text-xs tracking-[0.16em] uppercase text-muted mb-4">The problem</div>
            <h2 className="font-display font-bold leading-[0.92] tracking-[0.01em] m-0 max-w-[20ch] text-[clamp(38px,4.4vw,56px)]">
              STOP EXPLAINING WHAT A PICTURE COULD SHOW
            </h2>
          </div>
          <div>
            <p className="text-[17px] leading-[1.68] mb-5 text-body max-w-[54ch]">
              Ever tried explaining a bug, walking someone through a complicated interface, or showing a client exactly what you mean — only to end up typing a wall of text?
            </p>
            <p className="text-[17px] leading-[1.68] mb-5 text-body max-w-[54ch]">
              A screenshot helps, but sometimes a static image isn’t enough. You need to point at a specific detail, highlight a field, demonstrate a sequence of clicks, or guide someone’s attention while you explain. And opening a separate recording or editing tool just to show one small thing? That’s another interruption you don’t need.
            </p>
            <p className="text-[17px] leading-[1.68] m-0 max-w-[54ch]">
              <strong className="font-medium">Capann makes showing easier than explaining.</strong> Draw over any webpage — circle the problem, highlight the important detail, or point people in the right direction. Save an annotated screenshot for free, or upgrade to record your screen and share a walkthrough.
            </p>
            <p className="text-[15px] leading-[1.68] mt-5 mb-0 text-muted max-w-[54ch]">
              Everything you draw floats above the webpage and disappears when you’re done. Your annotations don’t permanently alter the page.
            </p>
          </div>
        </section>

        {/* Uses */}
        <section id="uses" className="pb-24 scroll-mt-28">
          <div className="text-xs tracking-[0.16em] uppercase text-muted mb-4">Who it’s for</div>
          <h2 className="font-display font-bold leading-[0.92] tracking-[0.01em] mt-0 mb-11 max-w-[26ch] text-[clamp(38px,4.6vw,60px)]">
            BUILT FOR ANYONE WHO NEEDS TO SHOW, EXPLAIN, OR DEMONSTRATE
          </h2>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {USES.map((u) => (
              <div key={u.title} className="flex flex-col gap-3 p-7 rounded-[28px] bg-panel border border-white/10">
                <div className={`w-2.5 h-2.5 rounded-full ${u.dot}`} />
                <h3 className="text-base font-medium leading-[1.35] m-0">{u.title}</h3>
                <p className="text-[14.5px] leading-[1.62] m-0 text-muted">{u.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Features */}
        <section id="features" className="pb-24 scroll-mt-28">
          <div className="text-xs tracking-[0.16em] uppercase text-muted mb-4">What you get</div>
          <h2 className="font-display font-bold leading-[0.92] tracking-[0.01em] mt-0 mb-11 max-w-[26ch] text-[clamp(38px,4.6vw,60px)]">
            FREE TO ANNOTATE. PAY ONCE TO RECORD AND SHARE.
          </h2>
          <div className="flex flex-col gap-4">
            {FEATURE_GROUPS.map((g) => (
              <div key={g.title} className="p-[clamp(24px,4vw,40px)] rounded-[32px] bg-panel border border-white/10">
                <div className="flex flex-wrap items-center gap-3 mb-6">
                  <span className="grid place-items-center w-10 h-10 rounded-2xl bg-elevated text-draw">
                    <g.icon size={20} aria-hidden="true" />
                  </span>
                  <h3 className="font-display font-bold text-[26px] leading-none tracking-[0.02em] m-0 mr-auto">{g.title}</h3>
                  <TierBadge tier={g.tier} />
                </div>
                <div className="grid gap-x-[clamp(24px,5vw,64px)] md:grid-cols-2">
                  {g.items.map(([t, b]) => (
                    <div key={t} className="flex flex-col gap-2 py-5 border-t border-white/10">
                      <h4 className="text-[15px] font-medium leading-[1.4] m-0">{t}</h4>
                      <p className="text-[14.5px] leading-[1.65] m-0 text-muted max-w-[52ch]">{b}</p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Pricing */}
        <section id="pricing" className="pb-24 scroll-mt-28">
          <div className="text-xs tracking-[0.16em] uppercase text-muted mb-4">Pricing</div>
          <h2 className="font-display font-bold leading-[0.92] tracking-[0.01em] mt-0 mb-5 max-w-[26ch] text-[clamp(38px,4.6vw,60px)]">
            START FREE. UPGRADE ONCE.
          </h2>
          <p className="text-[16.5px] leading-[1.66] mt-0 mb-10 text-body max-w-[60ch]">
            Start with Capann for free — annotate, guide attention, and save screenshots without paying anything. When you need screen recording and shareable video links, upgrade to Pro with a single $10 payment.
          </p>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="flex flex-col p-9 rounded-[32px] bg-panel border border-white/10">
              <div className="font-display font-bold text-[34px] leading-none m-0">FREE</div>
              <div className="mt-2 text-[15px] text-body">Everything you need to make your point.</div>
              <div className="mt-4 mb-6 text-[15px]"><span className="font-display font-bold text-[44px] leading-none">$0</span></div>
              <ul className="flex flex-col gap-2.5 m-0 p-0 list-none">
                {FREE_FEATURES.map((f) => (
                  <CheckItem key={f}>{f}</CheckItem>
                ))}
              </ul>
              <a href="#pricing" className="inline-flex items-center justify-center gap-2 mt-8 px-[26px] py-4 rounded-full border border-white/15 text-paper text-[15px] font-medium hover:bg-elevated transition-colors">
                Get Capann Free
              </a>
              <div className="mt-3 text-center text-[13px] text-muted">No subscription required.</div>
            </div>
            <div className="flex flex-col p-9 rounded-[32px] bg-panel border border-white/15 shadow-[0_24px_70px_rgba(0,0,0,0.45)]">
              <div className="flex items-center gap-3">
                <div className="font-display font-bold text-[34px] leading-none m-0 mr-auto">PRO</div>
                <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-rec text-[#0A2E1B] text-[11px] font-medium tracking-[0.08em] uppercase">One-time</span>
              </div>
              <div className="mt-2 text-[15px] text-body">Record it. Download it. Share it.</div>
              <div className="mt-4 mb-6 text-[15px]"><span className="font-display font-bold text-[44px] leading-none">$10</span> <span className="text-muted">one-time</span></div>
              <ul className="flex flex-col gap-2.5 m-0 p-0 list-none">
                {PRO_FEATURES.map((f) => (
                  <CheckItem key={f} pro>{f}</CheckItem>
                ))}
              </ul>
              <a href="#pricing" className="inline-flex items-center justify-center gap-2 mt-8 px-[26px] py-4 rounded-full bg-draw text-ink text-[15px] font-medium hover:bg-draw-hover transition-colors">
                Unlock Pro — $10 <ArrowRight size={17} weight="bold" aria-hidden="true" />
              </a>
              <div className="mt-3 text-center text-[13px] text-muted">Pay once. Unlock Pro permanently. No subscription. No renewal.</div>
            </div>
          </div>
        </section>

        {/* Why Pro */}
        <section className="pb-24">
          <div className="grid gap-10 items-center p-[clamp(28px,4vw,52px)] rounded-[40px] bg-panel border border-white/10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-x-[clamp(24px,5vw,80px)]">
            <div>
              <h2 className="font-display font-bold leading-[0.92] tracking-[0.01em] m-0 max-w-[20ch] text-[clamp(34px,3.8vw,48px)]">
                WHY PAY FOR PRO?
              </h2>
              <p className="text-[15px] leading-[1.65] mt-5 mb-0 text-muted max-w-[44ch]">
                Most annotation tools make you pay just to get started. Capann lets you annotate for free, then gives you the option to unlock more when you need it. No monthly bill. No recurring charges. One payment of $10 for permanent Pro access.
              </p>
            </div>
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-4 p-5 rounded-3xl bg-elevated">
                <DownloadSimple size={22} aria-hidden="true" className="flex-none text-draw" />
                <div className="text-[14.5px] leading-[1.6]"><strong className="font-medium text-paper">Download:</strong> <span className="text-muted">keep the video file on your device. It never expires.</span></div>
              </div>
              <div className="flex items-center gap-4 p-5 rounded-3xl bg-elevated">
                <LinkSimple size={22} aria-hidden="true" className="flex-none text-rec" />
                <div className="text-[14.5px] leading-[1.6]"><strong className="font-medium text-paper">Share:</strong> <span className="text-muted">send a link anyone can open — no Capann, no account. Links expire after seven days.</span></div>
              </div>
              <div className="flex flex-wrap gap-3">
                <a href="#pricing" className="inline-flex items-center px-6 py-3.5 rounded-full bg-draw text-ink text-[14px] font-medium hover:bg-draw-hover transition-colors">
                  Get Capann Free
                </a>
                <a href="#pricing" className="inline-flex items-center gap-2 px-6 py-3.5 rounded-full border border-white/15 text-paper text-[14px] hover:bg-elevated transition-colors">
                  Unlock Pro — $10 <ArrowRight size={16} weight="bold" aria-hidden="true" />
                </a>
              </div>
            </div>
          </div>
        </section>

        {/* Shortcuts */}
        <section id="shortcuts" className="pb-24 scroll-mt-28">
          <div className="grid gap-10 items-center p-[clamp(28px,4vw,52px)] rounded-[40px] bg-panel border border-white/10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:gap-x-[clamp(24px,5vw,80px)]">
            <div>
              <h2 className="font-display font-bold leading-[0.92] tracking-[0.01em] m-0 max-w-[20ch] text-[clamp(34px,3.8vw,48px)]">
                FAST TO USE, FASTER TO FORGET YOU’RE USING IT
              </h2>
              <p className="text-[15px] leading-[1.65] mt-5 mb-0 text-muted max-w-[40ch]">
                The floating toolbar drags anywhere out of your way. It’s built to disappear until the moment you need it. Everything you draw floats above the webpage — when you’re done, clear your annotations and get back to browsing.
              </p>
            </div>
            <div className="flex flex-col gap-2.5">
              {SHORTCUTS.map(([k, v]) => (
                <div key={k} className="flex flex-col gap-2 rounded-2xl bg-elevated px-4 py-3.5 sm:flex-row sm:items-center sm:gap-[18px] sm:rounded-full sm:px-5 sm:py-[15px]">
                  <kbd className="inline-flex w-fit font-sans text-[12px] font-medium tracking-[0.04em] text-draw tabular-nums sm:min-w-[104px] sm:text-[13px]">{k}</kbd>
                  <span className="text-[14px] leading-[1.55] sm:text-[14.5px]">{v}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" className="pb-24 scroll-mt-28">
          <div className="text-xs tracking-[0.16em] uppercase text-muted mb-4">FAQ</div>
          <h2 className="font-display font-bold leading-[0.92] tracking-[0.01em] mt-0 mb-10 text-[clamp(38px,4.6vw,60px)]">QUESTIONS, ANSWERED</h2>
          <div className="grid gap-x-[clamp(24px,5vw,72px)] md:grid-cols-2">
            {FAQS.map(([q, a]) => (
              <div key={q} className="flex flex-col gap-2.5 py-[26px] border-t border-white/10">
                <h3 className="text-base font-medium leading-[1.4] m-0">{q}</h3>
                <p className="text-[14.5px] leading-[1.65] m-0 text-muted max-w-[50ch]">{a}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Final CTA */}
        <section className="pb-24">
          <div className="flex flex-col gap-[26px] items-start p-[clamp(32px,5vw,64px)] rounded-[44px] bg-gradient-to-br from-panel to-ink border border-white/10">
            <h2 className="font-display font-bold leading-[0.9] tracking-[0.01em] m-0 max-w-[24ch] text-[clamp(40px,5.6vw,80px)]">
              STOP DESCRIBING YOUR SCREEN. START <span className="text-draw">SHOWING</span> IT.
            </h2>
            <p className="text-[16px] leading-[1.65] m-0 text-body max-w-[52ch]">
              Annotate any webpage for free. Upgrade when you’re ready to record, download, and share.
            </p>
            <div className="flex flex-wrap gap-3">
              <a href="#pricing" className="inline-flex items-center gap-2.5 px-7 py-4 rounded-full bg-paper text-ink text-[15px] font-medium hover:bg-white transition-colors">
                Get Capann Free
              </a>
              <a href="#pricing" className="inline-flex items-center gap-2 px-7 py-4 rounded-full border border-white/15 text-paper text-[15px] hover:bg-elevated transition-colors">
                Unlock Pro — $10 <ArrowRight size={16} weight="bold" aria-hidden="true" />
              </a>
            </div>
          </div>
        </section>

        <SiteFooter />
      </main>
    </div>
  )
}
