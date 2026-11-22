import { useRef, useState } from 'react'
import { CheckCircle, Copy, Warning } from '@phosphor-icons/react'

const INITIAL_VALUES = {
  name: 'Avery Chen',
  email: 'avery@northwind.example',
  card: '4242 4242 4242 4242',
  expiry: '04 / 21',
  cvc: '123',
}

const INITIAL_ERRORS = {
  expiry: 'This card has expired. Use a future date in MM / YY format.',
}

const DIAGNOSTICS = {
  error:
    'Status: 402 Payment Required\nCode: invalid_expiry_year\nRequest: req_demo_8f2c\nField: billing.expiry\nEnvironment: Chrome · demo workspace\nTrace: 21 Oct 2026, 14:32 UTC',
  success:
    'Status: 200 OK\nCode: demo_success\nRequest: req_demo_8f2c\nField: billing.card\nEnvironment: Chrome · demo workspace\nTrace: 21 Oct 2026, 14:33 UTC',
}

function validate(values) {
  const errors = {}

  if (!values.name.trim()) errors.name = 'Enter the name shown on the card.'
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email.trim())) {
    errors.email = 'Enter a valid billing email address.'
  }

  const digits = values.card.replace(/\s+/g, '')
  if (!/^\d{16}$/.test(digits)) errors.card = 'Enter the 16 digits printed on the card.'

  const match = values.expiry.trim().match(/^(\d{2})\s*\/\s*(\d{2})$/)
  if (!match) {
    errors.expiry = 'Use the format MM / YY.'
  } else {
    const month = Number(match[1])
    const year = 2000 + Number(match[2])
    if (month < 1 || month > 12) {
      errors.expiry = 'Month must be between 01 and 12.'
    } else if (new Date(year, month, 1) <= new Date()) {
      errors.expiry = 'This card has expired. Use a future date in MM / YY format.'
    }
  }

  if (!/^\d{3,4}$/.test(values.cvc.trim())) errors.cvc = 'Enter the 3 or 4 digit security code.'

  return errors
}

export default function DiagnoseSample() {
  const [values, setValues] = useState(INITIAL_VALUES)
  const [errors, setErrors] = useState(INITIAL_ERRORS)
  const [success, setSuccess] = useState(false)
  const [copyState, setCopyState] = useState('idle')
  const inputs = useRef({})

  const errorCount = Object.keys(errors).length

  const update = (field) => (event) => {
    const value = event.target.value
    setValues((state) => ({ ...state, [field]: value }))
    setSuccess(false)
    setCopyState('idle')
    setErrors((state) => {
      if (!state[field]) return state
      const next = { ...state }
      delete next[field]
      return next
    })
  }

  const onSubmit = (event) => {
    event.preventDefault()
    const nextErrors = validate(values)
    setErrors(nextErrors)

    const order = ['name', 'email', 'card', 'expiry', 'cvc']
    const first = order.find((field) => nextErrors[field])
    if (first) {
      setSuccess(false)
      inputs.current[first]?.focus()
      return
    }

    setSuccess(true)
    setCopyState('idle')
  }

  const copyDiagnostics = async () => {
    const text = success ? DIAGNOSTICS.success : DIAGNOSTICS.error
    try {
      await navigator.clipboard.writeText(text)
      setCopyState('copied')
    } catch {
      try {
        const area = document.createElement('textarea')
        area.value = text
        area.setAttribute('readonly', '')
        area.style.position = 'fixed'
        area.style.opacity = '0'
        document.body.appendChild(area)
        area.select()
        const copied = document.execCommand('copy')
        area.remove()
        setCopyState(copied ? 'copied' : 'failed')
      } catch {
        setCopyState('failed')
      }
    }
  }

  const fieldProps = (field) => ({
    id: `dg-${field}`,
    name: field,
    value: values[field],
    onChange: update(field),
    'aria-invalid': errors[field] ? 'true' : undefined,
    'aria-describedby': errors[field] ? `dg-${field}-error` : undefined,
  })

  return (
    <div className="dg pg-sample">
      <header className="dg-top">
        <div className="dg-brand">
          <span aria-hidden="true" className="dg-logo">
            L
          </span>
          <span className="dg-brand-name">Ledgerly</span>
        </div>
        <div className="dg-crumb" aria-label="Current section">
          <span>Settings</span>
          <span aria-hidden="true">/</span>
          <strong>Billing</strong>
        </div>
        <span className="dg-env">Demo workspace</span>
        <span className="dg-avatar" aria-hidden="true">
          AC
        </span>
      </header>

      <div className="dg-layout">
        <div className="dg-main">
          <p className="dg-eyebrow">Billing settings</p>
          <h2 className="dg-title">Update your payment method</h2>
          <p className="dg-lede">
            Replace the card on file for the Northwind workspace. Changes apply to the next invoice.
          </p>

          {success ? (
            <div className="dg-banner dg-banner-success" role="status">
              <CheckCircle size={18} weight="fill" aria-hidden="true" />
              <div>
                <strong>Payment method updated.</strong> This is simulated. Nothing was sent anywhere and no card was charged.
                Use <em>Reset playground</em> above to start over.
              </div>
            </div>
          ) : (
            errorCount > 0 && (
              <div className="dg-banner dg-banner-error" role="alert">
                <Warning size={18} weight="fill" aria-hidden="true" />
                <div>
                  <strong>
                    We couldn’t update your payment method ({errorCount} {errorCount === 1 ? 'issue' : 'issues'}).
                  </strong>{' '}
                  {errors.expiry ?? 'Check the highlighted fields and try again.'} This is a simulated error,  no
                  request was made.
                </div>
              </div>
            )
          )}

          <form className="dg-form" onSubmit={onSubmit} noValidate>
            <div className="dg-field">
              <label htmlFor="dg-name">Name on card</label>
              <input
                {...fieldProps('name')}
                type="text"
                autoComplete="off"
                spellCheck="false"
                ref={(el) => {
                  inputs.current.name = el
                }}
              />
              {errors.name && (
                <p id="dg-name-error" className="dg-field-error">
                  {errors.name}
                </p>
              )}
            </div>

            <div className="dg-field">
              <label htmlFor="dg-email">Billing email</label>
              <input
                {...fieldProps('email')}
                type="email"
                autoComplete="off"
                spellCheck="false"
                ref={(el) => {
                  inputs.current.email = el
                }}
              />
              {errors.email && (
                <p id="dg-email-error" className="dg-field-error">
                  {errors.email}
                </p>
              )}
            </div>

            <div className="dg-field">
              <label htmlFor="dg-card">Card number</label>
              <input
                {...fieldProps('card')}
                type="text"
                inputMode="numeric"
                autoComplete="off"
                spellCheck="false"
                ref={(el) => {
                  inputs.current.card = el
                }}
              />
              {errors.card && (
                <p id="dg-card-error" className="dg-field-error">
                  {errors.card}
                </p>
              )}
            </div>

            <div className="dg-field-row">
              <div className="dg-field">
                <label htmlFor="dg-expiry">Expiry</label>
                <input
                  {...fieldProps('expiry')}
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  spellCheck="false"
                  placeholder="MM / YY"
                  ref={(el) => {
                    inputs.current.expiry = el
                  }}
                />
                {errors.expiry && (
                  <p id="dg-expiry-error" className="dg-field-error">
                    {errors.expiry}
                  </p>
                )}
              </div>
              <div className="dg-field">
                <label htmlFor="dg-cvc">CVC</label>
                <input
                  {...fieldProps('cvc')}
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  spellCheck="false"
                  ref={(el) => {
                    inputs.current.cvc = el
                  }}
                />
                {errors.cvc && (
                  <p id="dg-cvc-error" className="dg-field-error">
                    {errors.cvc}
                  </p>
                )}
              </div>
            </div>

            <div className="dg-form-actions">
              <button type="submit" className="dg-btn dg-btn-primary">
                Update payment method
              </button>
              <button
                type="button"
                className="dg-btn dg-btn-quiet"
                onClick={() => {
                  setValues(INITIAL_VALUES)
                  setErrors(INITIAL_ERRORS)
                  setSuccess(false)
                  setCopyState('idle')
                }}
              >
                Restore demo values
              </button>
            </div>
            <p className="dg-fine">Simulated form. No payment provider, network request, or real account is involved.</p>
          </form>

          <div className="dg-issue">
            <h3 className="dg-h3">Simulated issue</h3>
            <p>
              A customer replaced their card, but the saved expiry date was already in the past. The form rejected the
              update before any request left the browser. Point at the expiry field to show exactly what failed.
            </p>
          </div>
        </div>

        <aside className="dg-aside" aria-label="Session diagnostics">
          <div className="dg-panel">
            <div className="dg-panel-head">
              <h3 className="dg-h3">Session diagnostics</h3>
              <span className={`dg-code ${success ? 'dg-code-ok' : ''}`}>{success ? '200' : '402'}</span>
            </div>
            <dl className="dg-diagnostics">
              <div>
                <dt>Status</dt>
                <dd>{success ? 'OK' : 'Payment Required'}</dd>
              </div>
              <div>
                <dt>Code</dt>
                <dd>{success ? 'demo_success' : 'invalid_expiry_year'}</dd>
              </div>
              <div>
                <dt>Request</dt>
                <dd>req_demo_8f2c</dd>
              </div>
              <div>
                <dt>Field</dt>
                <dd>{success ? 'billing.card' : 'billing.expiry'}</dd>
              </div>
              <div>
                <dt>Environment</dt>
                <dd>Chrome · demo workspace</dd>
              </div>
            </dl>
            <button type="button" className="dg-btn dg-btn-outline dg-copy" onClick={copyDiagnostics}>
              <Copy size={14} weight="bold" aria-hidden="true" />
              Copy diagnostics
            </button>
            <p className="dg-copy-state" role="status">
              {copyState === 'copied' && 'Copied to clipboard.'}
              {copyState === 'failed' && 'Copy failed — select the text above manually.'}
            </p>
          </div>

          <div className="dg-panel dg-panel-note">
            <h3 className="dg-h3">What to include in a report</h3>
            <ul className="dg-list">
              <li>The field that failed and what was entered.</li>
              <li>The request ID from this panel.</li>
              <li>A screenshot of the form with the error visible.</li>
            </ul>
          </div>
        </aside>
      </div>
    </div>
  )
}
