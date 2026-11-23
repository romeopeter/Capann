import { useEffect, useState } from 'react'
import { ArrowClockwise, CheckCircle } from '@phosphor-icons/react'
import { findExtension, refreshExtension } from '../premium/extension.js'
import { usePrivatePage } from '../premium/usePrivatePage.js'
import { Card, Notice, PageHeading, PremiumLayout, SECONDARY_BUTTON, StatusLine } from '../premium/PremiumLayout.jsx'

// /upgraded — the Bachs post-checkout redirect. Asks the extension to re-check
// `paid` with the server. The payment webhook can land a few seconds after the
// visitor does, so it retries briefly before offering a manual re-check. The
// extension also re-checks when the visitor returns to its tab, so this page is
// a nicety, not a requirement.

const ATTEMPTS = 4
const RETRY_DELAY_MS = 3000
const REFRESH_TIMEOUT_MS = 20_000

const SUMMARY = {
  checking: 'Checking your upgrade with Capann…',
  paid: 'Premium is active. You can close this tab.',
  pending: 'Capann hasn’t seen your payment yet.',
  'signed-out': 'Capann isn’t signed in in this browser.',
  'no-extension': 'Couldn’t reach Capann Premium from this page.',
  error: '',
}

export default function UpgradedPage() {
  usePrivatePage('Upgrade · Capann')

  const [state, setState] = useState({ status: 'checking' })
  const [run, setRun] = useState(0)

  useEffect(() => {
    let active = true
    let timer = 0
    const wait = (ms) =>
      new Promise((resolve) => {
        timer = setTimeout(resolve, ms)
      })

    async function check() {
      const found = await findExtension()
      if (!active) return
      if (found.status !== 'premium') {
        setState({ status: 'no-extension' })
        return
      }

      for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
        let reply
        try {
          reply = await refreshExtension(found.id, REFRESH_TIMEOUT_MS)
        } catch {
          // No reply (removed, disabled, or timed out).
          if (active) setState({ status: 'no-extension' })
          return
        }
        if (!active) return
        if (!reply?.ok) {
          setState({ status: 'error', message: reply?.error })
          return
        }
        if (reply.paid) {
          setState({ status: 'paid' })
          return
        }
        if (!reply.signedIn) {
          setState({ status: 'signed-out' })
          return
        }
        if (attempt < ATTEMPTS) {
          await wait(RETRY_DELAY_MS)
          if (!active) return
        }
      }
      setState({ status: 'pending' })
    }

    check()
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [run])

  function checkAgain() {
    setState({ status: 'checking' })
    setRun((value) => value + 1)
  }

  const { status } = state
  const paid = status === 'paid'
  const checkAgainButton = (
    <button type="button" onClick={checkAgain} className={SECONDARY_BUTTON}>
      <ArrowClockwise size={16} weight="bold" aria-hidden="true" />
      Check again
    </button>
  )

  return (
    <PremiumLayout>
      <Card>
        {paid && <CheckCircle size={44} weight="fill" aria-hidden="true" className="mb-6 text-accent-mint" />}
        <PageHeading>
          {paid ? (
            <>
              PREMIUM IS <span className="text-accent-mint">ACTIVE</span>
            </>
          ) : (
            <>
              FINISHING YOUR <span className="text-accent-violet">UPGRADE</span>
            </>
          )}
        </PageHeading>
        <p className="mt-5 mb-0 text-[16px] leading-[1.7] text-text-body">
          {paid
            ? 'Stopping a recording now gives you a link. You can close this tab.'
            : 'Thanks for upgrading. Capann is confirming your payment so recordings can be shared as links.'}
        </p>

        <StatusLine busy quiet={status !== 'checking'}>
          {SUMMARY[status]}
        </StatusLine>

        {status === 'pending' && (
          <Notice title="Your payment hasn’t reached Capann yet" actions={checkAgainButton}>
            It usually arrives within a minute. Capann also checks again when you go back to the tab where you started.
          </Notice>
        )}

        {status === 'signed-out' && (
          <Notice title="Capann isn’t signed in in this browser" actions={checkAgainButton}>
            Sign in from Capann’s Record view with the email you used at checkout, and Premium will be there.
          </Notice>
        )}

        {status === 'no-extension' && (
          <Notice title="Couldn’t reach Capann Premium from this page" actions={checkAgainButton}>
            Go back to the tab where you started checkout. Capann checks your upgrade when you return to it.
          </Notice>
        )}

        {status === 'error' && (
          <Notice tone="error" role="alert" title="Couldn’t check your upgrade" actions={checkAgainButton}>
            {state.message || 'Capann didn’t answer as expected. Try again in a moment.'}
          </Notice>
        )}
      </Card>
    </PremiumLayout>
  )
}
