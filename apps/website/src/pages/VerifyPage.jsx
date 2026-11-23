import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { ArrowClockwise, ArrowRight, CheckCircle } from '@phosphor-icons/react'
import { ApiError, exchangeLoginToken } from '@capann/api-client'
import { API_URL } from '../premium/config.js'
import { ExtensionUnreachableError, findExtension, handOffSession } from '../premium/extension.js'
import { usePrivatePage } from '../premium/usePrivatePage.js'
import {
  Card,
  InstallLink,
  Notice,
  PageHeading,
  PremiumLayout,
  PRIMARY_BUTTON,
  SECONDARY_BUTTON,
  Spinner,
  StatusLine,
} from '../premium/PremiumLayout.jsx'

// /verify?token=… — the sign-in link the extension emails.
//
// The token is single-use, so it is exchanged only when the visitor clicks
// Continue (email scanners open links and would spend it on page load), and
// only after a Premium build of Capann answers in this browser. The 30-day
// session token is held in memory just long enough to hand to the extension;
// nothing is written to storage or cookies.

const HANDOFF_TIMEOUT_MS = 30_000

const SPENT_LINK = 'This sign-in link has expired or was already used. Request a new one from Capann’s Record view.'

const PROGRESS = {
  checking: 'Looking for Capann in this browser…',
  exchanging: 'Confirming your sign-in link…',
  'handing-off': 'Signing you in to Capann…',
}

function exchangeFailure(error) {
  // TOKEN_USED, TOKEN_EXPIRED, INVALID_TOKEN, WRONG_TOKEN: the link is spent.
  if (error instanceof ApiError && error.status === 401) return { message: SPENT_LINK, retry: false }
  return { message: error?.message || 'Capann couldn’t confirm your sign-in link. Try again.', retry: true }
}

function handoffFailure(error) {
  if (error instanceof ExtensionUnreachableError) {
    return 'Capann didn’t respond. Make sure it’s still installed and turned on in this browser, then try again.'
  }
  return error?.message || 'Capann couldn’t confirm this sign-in. Try again.'
}

function InstallNotice({ extension, onCheckAgain }) {
  const actions = (
    <>
      <InstallLink />
      <button type="button" onClick={onCheckAgain} className={SECONDARY_BUTTON}>
        <ArrowClockwise size={16} weight="bold" aria-hidden="true" />
        Check again
      </button>
    </>
  )

  if (extension.status === 'refused') {
    return (
      <Notice tone="error" role="alert" title="Capann couldn’t connect to this page" actions={actions}>
        Capann is installed but didn’t accept this page{extension.error ? ` (${extension.error})` : ''}. Open the
        sign-in link exactly as it appears in your email. Your link hasn’t been used.
      </Notice>
    )
  }

  return (
    <Notice tone="error" role="alert" title="Capann Premium must be installed in this browser" actions={actions}>
      {extension.status === 'free'
        ? 'This browser has the free edition of Capann, which can’t sign in. '
        : 'Capann Premium isn’t installed in this browser, or it’s turned off. '}
      Install it, then come back to this tab and choose Check again. Your sign-in link stays unused until you continue.
    </Notice>
  )
}

export default function VerifyPage() {
  usePrivatePage('Sign in to Capann')

  const [searchParams] = useSearchParams()
  const token = (searchParams.get('token') || '').trim()

  // null while looking; otherwise the result of findExtension().
  const [extension, setExtension] = useState(null)
  const [detectRun, setDetectRun] = useState(0)
  const [phase, setPhase] = useState({ step: 'idle' })
  const sessionRef = useRef(null)
  const busyRef = useRef(false)

  // Pinging is harmless (it doesn't touch the token), so do it up front.
  useEffect(() => {
    if (!token) return undefined
    let active = true
    findExtension().then((found) => {
      if (active) setExtension(found)
    })
    return () => {
      active = false
    }
  }, [token, detectRun])

  function checkAgain() {
    setExtension(null)
    setDetectRun((run) => run + 1)
  }

  async function handleContinue() {
    if (busyRef.current) return
    busyRef.current = true
    try {
      // Look again: the extension may have been removed or disabled since load.
      setPhase({ step: 'checking' })
      const found = await findExtension()
      setExtension(found)
      if (found.status !== 'premium') {
        setPhase({ step: 'idle' })
        return
      }

      // Reuse a session from an earlier attempt whose hand-off failed: the
      // login token is already spent, but the session token is still good.
      let session = sessionRef.current
      if (!session) {
        setPhase({ step: 'exchanging' })
        try {
          session = await exchangeLoginToken(API_URL, token)
        } catch (error) {
          setPhase({ step: 'error', ...exchangeFailure(error) })
          return
        }
        sessionRef.current = session
      }

      setPhase({ step: 'handing-off' })
      try {
        const reply = await handOffSession(found.id, session.token, HANDOFF_TIMEOUT_MS)
        if (!reply?.ok) throw new Error(reply?.error)
        sessionRef.current = null
        setPhase({ step: 'done', email: reply.email ?? session.email, paid: reply.paid ?? session.paid })
      } catch (error) {
        setPhase({ step: 'error', message: handoffFailure(error), retry: true })
      }
    } finally {
      busyRef.current = false
    }
  }

  if (!token) {
    return (
      <PremiumLayout>
        <Card>
          <PageHeading>
            SIGN IN TO CAPA<span className="text-accent-violet">NN</span>
          </PageHeading>
          <Notice tone="error" role="alert" title="This page needs the sign-in link from your email">
            Open the link in the email Capann sent you, or request a new one from Capann’s Record view.
          </Notice>
        </Card>
      </PremiumLayout>
    )
  }

  const done = phase.step === 'done'
  const busy = phase.step in PROGRESS
  const looking = extension === null
  const ready = extension?.status === 'premium'
  const spent = phase.step === 'error' && !phase.retry

  let status = ''
  if (done) status = `You’re signed in to Capann as ${phase.email}. You can close this tab.`
  else if (busy) status = PROGRESS[phase.step]
  else if (looking) status = PROGRESS.checking
  else if (ready && !spent) status = `Capann Premium${extension.version ? ` ${extension.version}` : ''} is ready in this browser.`

  return (
    <PremiumLayout>
      <Card>
        {done && <CheckCircle size={44} weight="fill" aria-hidden="true" className="mb-6 text-accent-mint" />}
        <PageHeading>
          {done ? (
            <>
              YOU’RE SIGNED <span className="text-accent-mint">IN</span>
            </>
          ) : (
            <>
              SIGN IN TO CAPA<span className="text-accent-violet">NN</span>
            </>
          )}
        </PageHeading>
        <p className="mt-5 mb-0 text-[16px] leading-[1.7] text-text-body">
          {done ? (
            <>
              You’re signed in to Capann as{' '}
              <strong className="font-medium text-text-primary wrap-anywhere">{phase.email}</strong>. You can close this tab.
            </>
          ) : (
            'Continue to finish signing in to Capann in this browser. This link works once and expires 15 minutes after it was sent.'
          )}
        </p>

        <StatusLine busy={busy || looking} quiet={done || !status}>
          {status}
        </StatusLine>

        {done &&
          (phase.paid ? (
            <Notice tone="success">Premium is active — stopping a recording now gives you a link.</Notice>
          ) : (
            <Notice>Upgrade from Capann’s Record view to share recordings as links.</Notice>
          ))}

        {!done && !busy && extension && !ready && <InstallNotice extension={extension} onCheckAgain={checkAgain} />}

        {phase.step === 'error' && (
          <Notice tone="error" role="alert" title={spent ? 'Link expired' : 'Sign-in didn’t finish'}>
            {phase.message}
          </Notice>
        )}

        {!done && !spent && (ready || busy) && (
          <div className="mt-8">
            <button type="button" onClick={handleContinue} disabled={busy} className={`${PRIMARY_BUTTON} w-full sm:w-auto`}>
              {busy ? (
                <>
                  <Spinner size={17} />
                  Signing in…
                </>
              ) : (
                <>
                  {phase.step === 'error' ? 'Try again' : 'Continue to Capann'}
                  <ArrowRight size={17} weight="bold" aria-hidden="true" />
                </>
              )}
            </button>
          </div>
        )}
      </Card>
    </PremiumLayout>
  )
}
