import { useMemo, useState } from 'react'
import { Check } from '@phosphor-icons/react'

const STEPS = [
  {
    title: 'Heat the water',
    body: 'Bring fresh, filtered water to 92–96°C. Take it off the heat for thirty seconds before pouring so the bed settles.',
    tip: 'No thermometer? Boil, then wait about a minute.',
  },
  {
    title: 'Rinse the filter',
    body: 'Pour a little hot water through the paper filter to remove the papery taste and warm the brewer.',
    tip: 'Tip the rinse water away before you add the grounds.',
  },
  {
    title: 'Pour in stages',
    body: 'Start with a slow bloom pour, wait forty seconds, then add the rest in two steady circles.',
    tip: 'Keep the water level below the rim so the bed can breathe.',
  },
  {
    title: 'Taste and adjust',
    body: 'Sour and thin means the water was too cool. Bitter and drying means it was too hot or the grind too fine.',
    tip: 'Change one variable at a time so you know what worked.',
  },
]

const ZONES = [
  { max: 91, label: 'Below range', note: 'Sour, thin, and easy to over-extract unevenly.' },
  { max: 96, label: 'In range', note: 'Balanced sweetness with a clean, bright finish.' },
  { max: 200, label: 'Above range', note: 'Bitter and drying — the heat pulls out harsh compounds.' },
]

export default function TeachSample() {
  const [stepIndex, setStepIndex] = useState(0)
  const [temp, setTemp] = useState(94)
  const [completed, setCompleted] = useState(false)

  const step = STEPS[stepIndex]
  const zone = ZONES.find((entry) => temp <= entry.max)
  const progress = completed ? 100 : Math.round(((stepIndex + 1) / (STEPS.length + 1)) * 100)

  const mercury = useMemo(() => {
    // Tube runs from y=235 (80 °C) to y=40 (100 °C).
    const ratio = Math.min(1, Math.max(0, (temp - 80) / 20))
    return 235 - ratio * 195
  }, [temp])

  return (
    <div className="te pg-sample">
      <header className="te-top">
        <div className="te-brand">
          <span aria-hidden="true" className="te-logo" />
          <span className="te-brand-name">Forma</span>
        </div>
        <div className="te-crumb" aria-label="Current course">
          <span>Brewing Fundamentals</span>
          <span aria-hidden="true">/</span>
          <strong>Water &amp; temperature</strong>
        </div>
        <div className="te-top-progress">
          <span>Lesson 3 of 8</span>
          <span className="te-top-bar" aria-hidden="true">
            <span style={{ width: '37.5%' }} />
          </span>
        </div>
      </header>

      <div className="te-layout">
        <article className="te-main">
          <p className="te-eyebrow">Module 2 · Water</p>
          <h2 className="te-title">Why temperature changes the cup</h2>
          <p className="te-lede">
            Water is the only ingredient that touches every particle of coffee. A few degrees either way changes which
            flavours end up in your cup — and which stay in the grounds.
          </p>

          <div className="te-progress">
            <div className="te-progress-head">
              <span>Lesson progress</span>
              <strong>{progress}%</strong>
            </div>
            <div
              className="te-progress-track"
              role="progressbar"
              aria-label="Lesson progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progress}
            >
              <span style={{ width: `${progress}%` }} />
            </div>
          </div>

          <h3 className="te-h3">Follow the steps</h3>
          <ol className="te-steps">
            {STEPS.map((entry, index) => {
              const isCurrent = index === stepIndex
              return (
                <li key={entry.title}>
                  <button
                    type="button"
                    aria-current={isCurrent ? 'step' : undefined}
                    onClick={() => setStepIndex(index)}
                    className={`te-step ${isCurrent ? 'te-step-current' : ''}`}
                  >
                    <span className="te-step-index" aria-hidden="true">
                      {completed ? <Check size={13} weight="bold" /> : index + 1}
                    </span>
                    <span className="te-step-title">{entry.title}</span>
                    {isCurrent && <span className="te-step-badge">Current</span>}
                  </button>
                </li>
              )
            })}
          </ol>

          <div className="te-step-panel" role="region" aria-live="polite" aria-labelledby="te-step-title">
            <span className="te-step-number" aria-hidden="true">
              {String(stepIndex + 1).padStart(2, '0')}
            </span>
            <div>
              <h4 id="te-step-title" className="te-step-heading">
                {step.title}
              </h4>
              <p>{step.body}</p>
              <p className="te-tip">{step.tip}</p>
            </div>
          </div>

          <div className="te-step-actions">
            <button
              type="button"
              className="te-btn te-btn-quiet"
              onClick={() => setStepIndex((index) => index - 1)}
              disabled={stepIndex === 0}
            >
              Previous step
            </button>
            <button
              type="button"
              className="te-btn te-btn-primary"
              onClick={() => setStepIndex((index) => index + 1)}
              disabled={stepIndex === STEPS.length - 1}
            >
              Next step
            </button>
            <button
              type="button"
              className={`te-btn ${completed ? 'te-btn-done' : 'te-btn-outline'}`}
              aria-pressed={completed}
              onClick={() => setCompleted((value) => !value)}
            >
              {completed ? (
                <>
                  <Check size={14} weight="bold" aria-hidden="true" /> Completed — undo
                </>
              ) : (
                'Mark lesson complete'
              )}
            </button>
          </div>

          <section className="te-example" aria-labelledby="te-example-title">
            <div className="te-example-head">
              <div>
                <h3 id="te-example-title" className="te-h3">
                  Try it: set the temperature
                </h3>
                <p className="te-sub">Move the slider and watch the reading change.</p>
              </div>
              <span className={`te-zone te-zone-${zone.label === 'In range' ? 'good' : 'off'}`}>{zone.label}</span>
            </div>

            <div className="te-example-body">
              <div className="te-thermo">
                <svg viewBox="0 0 260 300" role="img" aria-labelledby="te-thermo-title">
                  <title id="te-thermo-title">
                    Thermometer showing {temp} degrees Celsius; the recommended band is 92 to 96 degrees.
                  </title>
                  <rect x="116" y="79" width="42" height="39" rx="8" className="te-band" />
                  <rect x="120" y="30" width="34" height="218" rx="17" className="te-tube" />
                  <rect x="128" y={mercury} width="18" height={235 - mercury} rx="9" className="te-mercury" />
                  <circle cx="137" cy="250" r="27" className="te-bulb" />
                  <line x1="100" y1="235" x2="112" y2="235" className="te-tick" />
                  <line x1="100" y1="137" x2="112" y2="137" className="te-tick" />
                  <line x1="100" y1="40" x2="112" y2="40" className="te-tick" />
                  <text x="92" y="239" className="te-tick-label" textAnchor="end">80°</text>
                  <text x="92" y="141" className="te-tick-label" textAnchor="end">90°</text>
                  <text x="92" y="44" className="te-tick-label" textAnchor="end">100°</text>
                  <line x1="160" y1="98" x2="172" y2="98" className="te-band-line" />
                  <text x="178" y="95" className="te-band-label">92–96°C</text>
                  <text x="178" y="110" className="te-band-label te-band-label-sub">recommended</text>
                </svg>
                <output htmlFor="te-temp" className="te-temp">
                  {temp}°C
                </output>
              </div>

              <div className="te-controls">
                <label htmlFor="te-temp" className="te-label">
                  Water temperature
                </label>
                <input
                  id="te-temp"
                  type="range"
                  min="80"
                  max="100"
                  step="1"
                  value={temp}
                  onChange={(event) => setTemp(Number(event.target.value))}
                  aria-valuetext={`${temp} degrees Celsius, ${zone.label.toLowerCase()}`}
                  className="te-range"
                />
                <div className="te-range-scale" aria-hidden="true">
                  <span>80°C</span>
                  <span>90°C</span>
                  <span>100°C</span>
                </div>
                <p className="te-verdict">
                  <strong>{zone.label === 'In range' ? 'Right where you want it.' : 'Adjust the heat.'}</strong>{' '}
                  {zone.note}
                </p>
              </div>
            </div>
          </section>
        </article>

        <aside className="te-aside" aria-label="Lesson notes">
          <div className="te-aside-card">
            <h3 className="te-h3">Key takeaways</h3>
            <ul className="te-list">
              <li>92–96°C extracts sweetness without the harsh edges.</li>
              <li>Cooler water needs a finer grind or more time.</li>
              <li>Hotter water speeds extraction — watch for bitterness.</li>
            </ul>
          </div>

          <details className="te-details">
            <summary>Why not just use boiling water?</summary>
            <p>
              At a full boil, volatile aromatics flash off and bitter compounds arrive early. Letting the kettle rest for
              thirty seconds gets you into the useful range without another tool.
            </p>
          </details>

          <div className="te-note">
            <span className="te-note-dot" aria-hidden="true" />
            <p>Sample lesson. Progress stays on this page and resets with the playground.</p>
          </div>
        </aside>
      </div>
    </div>
  )
}
