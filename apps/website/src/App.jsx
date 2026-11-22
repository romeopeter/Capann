import { useEffect } from 'react'
import { BrowserRouter, Route, Routes, useLocation } from 'react-router'
import { WEBSITE_PATHS } from '@capann/contract'
import LandingPage from './pages/LandingPage.jsx'
import PlaygroundPage from './pages/PlaygroundPage.jsx'
import PrivacyPage from './pages/PrivacyPage.jsx'
import UpgradedPage from './pages/UpgradedPage.jsx'
import VerifyPage from './pages/VerifyPage.jsx'
import ViewMyLinksPage from './pages/ViewMyLinksPage.jsx'

// The site is served from the configured Vite base (custom domain → "/").
const basename = import.meta.env.BASE_URL.replace(/\/+$/, '') || '/'

function ScrollToTop() {
  const { pathname } = useLocation()

  useEffect(() => {
    // Leave in-page anchors (e.g. /#pricing) to the browser.
    if (!window.location.hash) window.scrollTo(0, 0)
  }, [pathname])

  return null
}

export default function App() {
  return (
    <BrowserRouter basename={basename}>
      <ScrollToTop />
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/playground" element={<PlaygroundPage />} />
        <Route path="/privacy" element={<PrivacyPage />} />
        
        {/* Capann Premium: emailed sign-in and link-recovery pages (paths shared
            with the API, which emails them), and the post-checkout page. */}
        <Route path={WEBSITE_PATHS.login} element={<VerifyPage />} />
        <Route path={WEBSITE_PATHS.links} element={<ViewMyLinksPage />} />
        <Route path="/upgraded" element={<UpgradedPage />} />
        <Route path="*" element={<LandingPage />} />
      </Routes>
    </BrowserRouter>
  )
}
