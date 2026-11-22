import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { ArrowClockwise, ArrowSquareOut, Check, Copy, LinkSimple, Timer } from '@phosphor-icons/react'
import { ApiError, listLinks } from '@capann/api-client'
import { RETENTION_DAYS } from '@capann/contract'
import { API_URL } from '../premium/config.js'
import { usePrivatePage } from '../premium/usePrivatePage.js'
import { Card, Notice, PageHeading, PremiumLayout, SECONDARY_BUTTON, StatusLine } from '../premium/PremiumLayout.jsx'

// /view-my-links?token=… — link recovery, emailed from the side panel's
// "Lost a link?". The links token lasts 15 minutes and is reusable, so loading
// on page load (and on reload) is fine.

const EXPIRED_TOKEN = 'This link expired. Request a new one from Capann’s side panel (Lost a link?).'
const TICK_MS = 30_000
const DAY_MS = 24 * 60 * 60 * 1000
const COPIED_MS = 2000

const uploadedFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })

function formatUploaded(iso) {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? 'Unknown date' : uploadedFormat.format(date)
}

function formatSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return null
  const mb = bytes / (1024 * 1024)
  if (mb < 1) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${mb.toFixed(mb < 100 ? 1 : 0)} MB`
}

function formatRemaining(ms) {
  const totalMinutes = Math.floor(ms / 60_000)
  const days = Math.floor(totalMinutes / 1440)
  const hours = Math.floor((totalMinutes % 1440) / 60)
  const minutes = totalMinutes % 60
  if (days > 0) return `${days}d ${hours}h left`
  if (hours > 0) return `${hours}h ${minutes}m left`
  if (minutes > 0) return `${minutes}m left`
  return 'Under 1m left'
}

function retentionDays(seconds) {
  const days = Math.round((Number(seconds) || 0) / 86_400)
  return days > 0 ? days : RETENTION_DAYS
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // No async clipboard (older browser or blocked): fall back to a selection.
    const focused = document.activeElement
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.cssText = 'position:fixed;top:0;left:0;opacity:0;'
    document.body.appendChild(area)
    area.select()
    let copied = false
    try {
      copied = document.execCommand('copy')
    } catch {
      copied = false
    }
    area.remove()
    focused?.focus?.()
    return copied
  }
}

/** Current time, refreshed every `intervalMs` and whenever the tab becomes visible. */
function useClock(intervalMs) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const tick = () => setNow(Date.now())
    const timer = setInterval(tick, intervalMs)
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [intervalMs])
  return now
}

function Countdown({ remainingMs }) {
  const expired = remainingMs <= 0
  const soon = !expired && remainingMs < DAY_MS
  const tone = expired
    ? 'border-border-hairline text-text-muted'
    : soon
      ? 'border-accent-cream/35 bg-accent-cream/10 text-accent-cream'
      : 'border-border-hairline-strong text-text-body'
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-pill border text-[12.5px] leading-none tabular-nums ${tone}`}>
      <Timer size={14} weight="bold" aria-hidden="true" />
      {expired ? 'Expired' : formatRemaining(remainingMs)}
    </span>
  )
}

function LinkRow({ item, remainingMs, onCopied }) {
  const [copyState, setCopyState] = useState(null) // null | 'copied' | 'failed'
  const resetTimer = useRef(0)
  useEffect(() => () => clearTimeout(resetTimer.current), [])

  const expired = remainingMs <= 0
  const size = formatSize(item.size)
  const labelId = `link-${item.id}-label`
  const uploaded = formatUploaded(item.uploadedAt)

  async function handleCopy() {
    const copied = await copyText(item.url)
    setCopyState(copied ? 'copied' : 'failed')
    onCopied(copied ? `Link to the recording from ${uploaded} copied.` : 'Couldn’t copy the link. Open it and copy the address instead.')
    clearTimeout(resetTimer.current)
    resetTimer.current = setTimeout(() => setCopyState(null), COPIED_MS)
  }

  const smallButton = 'inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-pill text-[13.5px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-violet'

  return (
    <li className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center p-5 sm:px-6 rounded-[22px] bg-surface-base border border-border-hairline">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span id={labelId} className="text-[15.5px] font-medium text-text-primary">
            <span className="sr-only">Recording uploaded </span>
            <time dateTime={item.uploadedAt}>{uploaded}</time>
          </span>
          <Countdown remainingMs={remainingMs} />
        </div>
        <div className="flex items-center gap-2 mt-2 text-[13px] text-text-muted min-w-0">
          {size && (
            <>
              <span className="flex-none tabular-nums">{size}</span>
              <span aria-hidden="true" className="flex-none">·</span>
            </>
          )}
          <span className="truncate">{item.url.replace(/^https?:\/\//, '')}</span>
        </div>
      </div>

      {!expired && (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleCopy}
            aria-describedby={labelId}
            className={`${smallButton} flex-1 sm:flex-none min-w-[118px] font-medium ${
              copyState === 'copied' ? 'bg-accent-mint text-save-ink' : 'bg-accent-violet text-ink hover:bg-accent-violet-hover'
            }`}
          >
            {copyState === 'copied' ? (
              <>
                <Check size={15} weight="bold" aria-hidden="true" />
                Copied
              </>
            ) : (
              <>
                <Copy size={15} weight="bold" aria-hidden="true" />
                {copyState === 'failed' ? 'Copy failed' : 'Copy link'}
              </>
            )}
          </button>
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-describedby={labelId}
            className={`${smallButton} flex-1 sm:flex-none border border-border-hairline-strong text-text-primary hover:bg-surface-elevated`}
          >
            Open
            <ArrowSquareOut size={15} weight="bold" aria-hidden="true" />
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        </div>
      )}
    </li>
  )
}

function LinkList({ items, skewMs, onCopied }) {
  const now = useClock(TICK_MS)
  const serverNow = now + skewMs
  return (
    <ul className="flex flex-col gap-3 mt-8 mb-0 p-0 list-none">
      {items.map((item) => (
        <LinkRow key={item.id} item={item} remainingMs={Date.parse(item.expiresAt) - serverNow} onCopied={onCopied} />
      ))}
    </ul>
  )
}

export default function ViewMyLinksPage() {
  usePrivatePage('Your links · Capann')

  const [searchParams] = useSearchParams()
  const token = (searchParams.get('token') || '').trim()

  const [state, setState] = useState({ status: 'loading' })
  const [loadRun, setLoadRun] = useState(0)
  const [announcement, setAnnouncement] = useState('')
  const announceTimer = useRef(0)
  useEffect(() => () => clearTimeout(announceTimer.current), [])

  useEffect(() => {
    if (!token) return undefined
    const controller = new AbortController()
    listLinks(API_URL, token, { signal: controller.signal }).then(
      (data) => {
        // Run countdowns on server time: skew = server clock − this clock.
        const serverNow = Date.parse(data.now)
        setState({
          status: 'ready',
          data,
          skewMs: Number.isFinite(serverNow) ? serverNow - Date.now() : 0,
        })
      },
      (error) => {
        if (error?.name === 'AbortError') return
        setState({
          status: 'error',
          expired: error instanceof ApiError && error.status === 401,
          message: error?.message,
        })
      },
    )
    return () => controller.abort()
  }, [token, loadRun])

  function retry() {
    setState({ status: 'loading' })
    setLoadRun((run) => run + 1)
  }

  function announce(message) {
    setAnnouncement(message)
    clearTimeout(announceTimer.current)
    announceTimer.current = setTimeout(() => setAnnouncement(''), COPIED_MS + 500)
  }

  if (!token) {
    return (
      <PremiumLayout>
        <Card>
          <PageHeading>
            YOUR <span className="text-accent-violet">LINKS</span>
          </PageHeading>
          <Notice tone="error" role="alert" title="This page needs the link from your email">
            Request a new one from Capann’s side panel (Lost a link?).
          </Notice>
        </Card>
      </PremiumLayout>
    )
  }

  const ready = state.status === 'ready'
  const items = ready && Array.isArray(state.data.items) ? state.data.items : []
  const days = ready ? retentionDays(state.data.retentionSeconds) : RETENTION_DAYS

  return (
    <PremiumLayout wide>
      {ready ? (
        <>
          <PageHeading>
            Links for <span className="text-accent-violet">{state.data.email}</span>
          </PageHeading>
          {items.length > 0 && (
            <p className="mt-5 mb-0 text-[16px] leading-[1.7] text-text-body">
              {items.length} live {items.length === 1 ? 'link' : 'links'}, newest first. Shared recordings stay up for {days} days.
            </p>
          )}
        </>
      ) : (
        <PageHeading>
          YOUR <span className="text-accent-violet">LINKS</span>
        </PageHeading>
      )}

      <StatusLine busy quiet={state.status !== 'loading'}>
        {state.status === 'loading' ? 'Loading your links…' : announcement}
      </StatusLine>

      {state.status === 'error' &&
        (state.expired ? (
          <Notice tone="error" role="alert" title="Link expired">
            {EXPIRED_TOKEN}
          </Notice>
        ) : (
          <Notice
            tone="error"
            role="alert"
            title="Couldn’t load your links"
            actions={
              <button type="button" onClick={retry} className={SECONDARY_BUTTON}>
                <ArrowClockwise size={16} weight="bold" aria-hidden="true" />
                Try again
              </button>
            }
          >
            {state.message || 'Something went wrong. Try again in a moment.'}
          </Notice>
        ))}

      {ready && items.length === 0 && (
        <div className="flex flex-col items-center gap-4 mt-10 px-6 py-14 rounded-panel border border-dashed border-border-hairline-strong text-center">
          <LinkSimple size={30} weight="bold" aria-hidden="true" className="text-text-muted" />
          <p className="m-0 max-w-[36ch] text-[15.5px] leading-[1.65] text-text-body">
            No live links. Shared recordings stay up for {days} days.
          </p>
        </div>
      )}

      {ready && items.length > 0 && <LinkList items={items} skewMs={state.skewMs} onCopied={announce} />}
    </PremiumLayout>
  )
}
