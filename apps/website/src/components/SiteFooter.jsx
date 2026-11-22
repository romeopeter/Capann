import { Link } from 'react-router'

const YEAR = new Date().getFullYear()

export default function SiteFooter() {
  return (
    <footer className="pt-8 pb-16 border-t border-white/10 text-[13px] text-muted">
      <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
        <div className="flex items-center gap-2.5 mr-auto">
          <img src={`${import.meta.env.BASE_URL}svg/capann-icon-light.svg`} alt="" className="w-[22px] h-[22px] opacity-70" />
          <div>Built by <a href="https://duowork.tech" className="text-draw underline decoration-white/30 underline-offset-2 hover:text-draw-hover hover:decoration-draw-hover transition-colors">Duowork</a>. We build engines around how people and businesses work.</div>
        </div>
        <nav aria-label="Footer" className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <Link to="/" className="hover:text-paper transition-colors">Home</Link>
          <Link to="/playground" className="hover:text-paper transition-colors">Playground</Link>
          <Link to="/privacy" className="hover:text-paper transition-colors">Privacy</Link>
        </nav>
      </div>
      <div className="mt-3">© {YEAR} Capann · Free to use. Pro $10, one-time.</div>
    </footer>
  )
}
