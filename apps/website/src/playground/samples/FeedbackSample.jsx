import { useMemo, useState } from 'react'
import { ArrowUpRight, Check, MagnifyingGlass } from '@phosphor-icons/react'

const VIEWS = [
  ['overview', 'Overview'],
  ['feedback', 'Feedback'],
  ['files', 'Files'],
]

const METRICS = [
  ['Open comments', '14', '+3 since yesterday'],
  ['Approval', '82%', 'Up from 74% last week'],
  ['Median response', '3.2h', 'Across 6 reviewers'],
]

const COMMENTS = [
  {
    id: 'c1',
    author: 'Maya Ortiz',
    initials: 'MO',
    time: '18 min ago',
    tag: 'Bug',
    body: 'The “Pay now” button sits too close to the order total on smaller laptops. It looks like one block.',
  },
  {
    id: 'c2',
    author: 'Dev Shah',
    initials: 'DS',
    time: '42 min ago',
    tag: 'Suggestion',
    body: 'Can we show the delivery estimate beside the subtotal? Support keeps getting asked about it.',
  },
  {
    id: 'c3',
    author: 'Lina Fischer',
    initials: 'LF',
    time: '1 hr ago',
    tag: 'Question',
    body: 'Is the disabled state for the promo code field intentional? It reads as broken on first load.',
  },
  {
    id: 'c4',
    author: 'Tomás Rivera',
    initials: 'TR',
    time: '2 hrs ago',
    tag: 'Bug',
    body: 'The card icon overlaps the expiry placeholder at 320px wide. Everything else holds up nicely.',
  },
]

const FILES = [
  { id: 'f1', name: 'Checkout — desktop', meta: 'Figma frame · 1440 × 1024', tone: 'violet' },
  { id: 'f2', name: 'Checkout — mobile', meta: 'Figma frame · 390 × 844', tone: 'slate' },
  { id: 'f3', name: 'Order summary', meta: 'Component set · 8 variants', tone: 'lilac' },
]

const ACTIVITY = [
  ['Maya Ortiz', 'left 3 comments on the payment step', '18 min ago'],
  ['Dev Shah', 'approved the empty cart state', '1 hr ago'],
  ['Lina Fischer', 'uploaded “Checkout — mobile”', '2 hrs ago'],
]

export default function FeedbackSample() {
  const [view, setView] = useState('overview')
  const [query, setQuery] = useState('')
  const [changesRequested, setChangesRequested] = useState(false)
  const [resolved, setResolved] = useState({})
  const [selectedFile, setSelectedFile] = useState('f1')

  const resolvedCount = Object.values(resolved).filter(Boolean).length
  const openCount = COMMENTS.length - resolvedCount

  const visibleComments = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return COMMENTS
    return COMMENTS.filter((comment) =>
      `${comment.author} ${comment.tag} ${comment.body}`.toLowerCase().includes(needle),
    )
  }, [query])

  const selected = FILES.find((file) => file.id === selectedFile) ?? FILES[0]

  return (
    <div className="fb pg-sample">
      <header className="fb-top">
        <div className="fb-brand">
          <span aria-hidden="true" className="fb-logo">
            N
          </span>
          <span className="fb-brand-name">Northwind</span>
        </div>
        <div className="fb-crumb" aria-label="Current project">
          <span>Website refresh</span>
          <span aria-hidden="true">/</span>
          <strong>Checkout</strong>
        </div>
        <label className="fb-search">
          <MagnifyingGlass size={15} aria-hidden="true" />
          <span className="sr-only">Search feedback</span>
          <input
            type="search"
            value={query}
            placeholder="Search feedback"
            onChange={(event) => {
              setQuery(event.target.value)
              if (event.target.value) setView('feedback')
            }}
          />
        </label>
        <span className="fb-avatar" title="Signed in as Avery Chen">
          AC
        </span>
      </header>

      <aside className="fb-side" aria-label="Project navigation">
        <div className="fb-side-block">
          <div className="fb-side-label">Workspace</div>
          <nav className="fb-nav">
            {VIEWS.map(([id, label]) => (
              <button
                key={id}
                type="button"
                aria-current={view === id ? 'page' : undefined}
                onClick={() => setView(id)}
                className="fb-nav-btn"
              >
                <span>{label}</span>
                {id === 'feedback' && <span className="fb-count">{openCount}</span>}
              </button>
            ))}
          </nav>
        </div>

        <div className="fb-side-card">
          <div className="fb-side-label">Project</div>
          <div className="fb-side-title">Checkout refresh</div>
          <div className="fb-side-meta">12 files · {openCount} open comments</div>
          <div className="fb-team" aria-label="Reviewers">
            {['MO', 'DS', 'LF', 'TR'].map((initials) => (
              <span key={initials} className="fb-team-chip" aria-hidden="true">
                {initials}
              </span>
            ))}
            <span className="fb-team-more">+2</span>
          </div>
        </div>
      </aside>

      <div className="fb-main">
        {view === 'overview' && (
          <>
            <div className="fb-heading-row">
              <div>
                <p className="fb-eyebrow">Website refresh</p>
                <h2 className="fb-title">Checkout</h2>
                <p className="fb-sub">Reviewing the new payment step · updated 12 minutes ago</p>
              </div>
              <div className="fb-heading-actions">
                <button
                  type="button"
                  className={`fb-btn ${changesRequested ? 'fb-btn-quiet' : 'fb-btn-primary'}`}
                  onClick={() => setChangesRequested((value) => !value)}
                >
                  {changesRequested ? 'Undo request' : 'Request changes'}
                  {!changesRequested && <ArrowUpRight size={14} weight="bold" aria-hidden="true" />}
                </button>
              </div>
            </div>

            {changesRequested && (
              <div className="fb-banner" role="status">
                <strong>Changes requested.</strong> This is sample state only, nobody was notified. Draw on the
                preview so your team can see exactly what you mean.
              </div>
            )}

            <div className="fb-metrics">
              {METRICS.map(([label, value, note]) => (
                <div key={label} className="fb-metric">
                  <div className="fb-metric-label">{label}</div>
                  <div className="fb-metric-value">{value}</div>
                  <div className="fb-metric-note">{note}</div>
                </div>
              ))}
            </div>

            <div className="fb-review">
              <div className="fb-review-head">
                <div>
                  <h3 className="fb-h3">Payment step preview</h3>
                  <p className="fb-sub">Desktop · 1440 × 1024</p>
                </div>
                <span className="fb-pill">Needs eyes</span>
              </div>

              <div className="fb-preview" role="img" aria-label="Preview of a checkout payment form">
                <div className="fb-preview-bar">
                  <span />
                  <span />
                  <span />
                  <span className="fb-preview-url">northwind.shop/checkout</span>
                </div>
                <div className="fb-preview-body">
                  <div className="fb-preview-summary">
                    <div className="fb-skeleton fb-skeleton-sm" />
                    <div className="fb-skeleton fb-skeleton-lg" />
                    <div className="fb-skeleton" />
                    <div className="fb-preview-total">
                      <span>Total</span>
                      <strong>$148.00</strong>
                    </div>
                  </div>
                  <div className="fb-preview-form">
                    <div className="fb-field">
                      <span>Card number</span>
                      <div className="fb-input">4242 4242 4242 4242</div>
                    </div>
                    <div className="fb-field-row">
                      <div className="fb-field">
                        <span>Expiry</span>
                        <div className="fb-input">04 / 28</div>
                      </div>
                      <div className="fb-field">
                        <span>CVC</span>
                        <div className="fb-input">•••</div>
                      </div>
                    </div>
                    <div className="fb-preview-pay">Pay $148.00</div>
                    <p className="fb-preview-fine">Sample interface. No payment is taken.</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="fb-activity">
              <h3 className="fb-h3">Recent activity</h3>
              <ul>
                {ACTIVITY.map(([who, what, when]) => (
                  <li key={what}>
                    <span className="fb-activity-dot" aria-hidden="true" />
                    <span>
                      <strong>{who}</strong> {what}
                    </span>
                    <span className="fb-activity-time">{when}</span>
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}

        {view === 'feedback' && (
          <>
            <div className="fb-heading-row">
              <div>
                <p className="fb-eyebrow">Feedback</p>
                <h2 className="fb-title">Open comments</h2>
                <p className="fb-sub">
                  {openCount} open · {resolvedCount} resolved
                </p>
              </div>
              <span className="fb-pill">{openCount === 0 ? 'All clear' : 'Needs review'}</span>
            </div>

            <ul className="fb-comments">
              {visibleComments.map((comment) => (
                <li key={comment.id} className={`fb-comment ${resolved[comment.id] ? 'fb-comment-resolved' : ''}`}>
                  <span className="fb-avatar fb-avatar-sm" aria-hidden="true">
                    {comment.initials}
                  </span>
                  <div className="fb-comment-body">
                    <div className="fb-comment-meta">
                      <strong>{comment.author}</strong>
                      <span>{comment.time}</span>
                      <span className="fb-tag">{comment.tag}</span>
                    </div>
                    <p>{comment.body}</p>
                  </div>
                  <button
                    type="button"
                    className={`fb-btn fb-btn-small ${resolved[comment.id] ? 'fb-btn-quiet' : 'fb-btn-outline'}`}
                    aria-pressed={Boolean(resolved[comment.id])}
                    onClick={() => setResolved((state) => ({ ...state, [comment.id]: !state[comment.id] }))}
                  >
                    {resolved[comment.id] ? (
                      <>
                        <Check size={13} weight="bold" aria-hidden="true" /> Resolved
                      </>
                    ) : (
                      'Resolve'
                    )}
                  </button>
                </li>
              ))}
            </ul>

            {visibleComments.length === 0 && (
              <p className="fb-empty">No comments match “{query}”. Try another word or clear the search.</p>
            )}
          </>
        )}

        {view === 'files' && (
          <>
            <div className="fb-heading-row">
              <div>
                <p className="fb-eyebrow">Files</p>
                <h2 className="fb-title">Project files</h2>
                <p className="fb-sub">3 items · shared with 6 reviewers</p>
              </div>
            </div>

            <div className="fb-files">
              {FILES.map((file) => {
                const isSelected = file.id === selectedFile
                return (
                  <button
                    key={file.id}
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => setSelectedFile(file.id)}
                    className={`fb-file ${isSelected ? 'fb-file-selected' : ''}`}
                  >
                    <span className={`fb-file-thumb fb-tone-${file.tone}`} aria-hidden="true">
                      <span />
                      <span />
                      <span />
                    </span>
                    <span className="fb-file-name">{file.name}</span>
                    <span className="fb-file-meta">{file.meta}</span>
                    <span className="fb-file-state">{isSelected ? 'Selected' : 'Select'}</span>
                  </button>
                )
              })}
            </div>

            <div className="fb-selection" role="status">
              <strong>{selected.name}</strong>
              <span>{selected.meta}</span>
              <span className="fb-selection-note">Local demo selection — nothing is uploaded.</span>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
