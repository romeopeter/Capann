import { useEffect } from 'react'
import { Link } from 'react-router'
import { ArrowRight } from '@phosphor-icons/react'
import SiteFooter from '../components/SiteFooter.jsx'

const BASE = import.meta.env.BASE_URL

const SECTIONS = [
  ['information-we-handle', 'Information We Handle'],
  ['how-we-use-information', 'How We Use Information'],
  ['data-processing-storage-transmission', 'Data Processing, Storage, and Transmission'],
  ['third-party-service-providers-and-analytics', 'Third-Party Service Providers and Analytics'],
  ['browser-permissions', 'Browser Permissions'],
  ['retention-and-deletion', 'Data Retention and Deletion'],
  ['security', 'Security'],
  ['childrens-privacy', 'Children’s Privacy'],
  ['changes', 'Changes to This Policy'],
  ['contact', 'Contact Us'],
]

function Paragraph({ children }) {
  return <p className="mt-4 mb-0 text-[15px] leading-[1.8] text-body max-w-[72ch]">{children}</p>
}

function SubHeading({ children }) {
  return (
    <h3 className="flex items-center gap-2.5 mt-8 mb-0 first:mt-7 text-[15.5px] font-medium leading-[1.5] text-paper">
      <span aria-hidden="true" className="w-1.5 h-1.5 flex-none rounded-full bg-draw" />
      {children}
    </h3>
  )
}

function Bullets({ items }) {
  return (
    <ul className="flex flex-col gap-2.5 mt-4 mb-0 p-0 list-none max-w-[72ch]">
      {items.map(([lead, text], index) => (
        <li key={index} className="relative pl-5 text-[15px] leading-[1.75] text-body before:content-[''] before:absolute before:left-0 before:top-[0.7em] before:w-1 before:h-1 before:rounded-full before:bg-draw">
          {lead && <strong className="font-medium text-paper">{lead} </strong>}
          {text}
        </li>
      ))}
    </ul>
  )
}

function Section({ id, title, children }) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="scroll-mt-24 border-t border-white/10 pt-10 mt-10 first:border-t-0 first:pt-0 first:mt-0">
      <h2 id={`${id}-heading`} className="font-display font-bold text-[clamp(26px,3vw,34px)] leading-[1.05] tracking-[0.01em] m-0">
        {title}
      </h2>
      <div className="mt-3">{children}</div>
    </section>
  )
}

export default function PrivacyPage() {
  useEffect(() => {
    document.title = 'Capann Privacy Policy — what we access and how it is handled'
  }, [])

  return (
    <div className="min-h-screen bg-ink text-paper font-sans">
      <header className="fixed top-0 inset-x-0 z-50 px-[clamp(12px,3vw,32px)] pt-3">
        <nav
          aria-label="Primary"
          className="glass max-w-[1280px] mx-auto flex items-center gap-3 md:gap-7 px-3.5 md:px-7 py-3.5 rounded-[28px] shadow-[0_18px_50px_rgba(0,0,0,0.45)]"
        >
          <Link to="/" className="flex items-center gap-2 md:gap-3 mr-auto rounded-full focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-draw">
            <img src={`${BASE}svg/capann-icon-light.svg`} alt="" className="w-[26px] h-[26px] md:w-[30px] md:h-[30px]" />
            <span className="font-display font-bold text-[23px] md:text-[29px] leading-none tracking-[0.03em]">
              CAPA<span className="text-draw">NN</span>
            </span>
          </Link>
          <span className="hidden sm:inline-flex items-center px-2.5 py-1 rounded-full border border-white/10 text-[10.5px] uppercase tracking-[0.16em] text-muted">
            Privacy
          </span>
          <Link to="/" className="hidden md:inline text-[13.5px] text-muted hover:text-paper transition-colors">
            Back to site
          </Link>
          <a href={`${BASE}#pricing`} className="inline-flex items-center gap-1.5 px-4 md:px-5 py-2 md:py-2.5 rounded-full bg-draw text-ink text-[12px] md:text-[13.5px] font-medium hover:bg-draw-hover transition-colors">
            Get Capann
            <ArrowRight size={13} weight="bold" aria-hidden="true" />
          </a>
        </nav>
      </header>

      <main className="max-w-[1280px] mx-auto px-[clamp(20px,5vw,56px)] pt-[118px] md:pt-[132px]">
        {/* Hero */}
        <div className="max-w-[78ch] pb-12">
          <div className="text-xs tracking-[0.16em] uppercase text-muted mb-4">Legal</div>
          <h1 className="font-display font-bold leading-[0.9] tracking-[0.01em] m-0 text-[clamp(52px,7vw,88px)]">
            PRIVACY <span className="text-draw">POLICY</span>
          </h1>
          <p className="mt-6 mb-0 text-[17px] leading-[1.66] text-body max-w-[62ch]">
            Capann is a browser extension developed by Duowork that helps people communicate visually on webpages through drawing, pointing, highlighting, screenshots, and screen recordings.
          </p>
          <p className="mt-4 mb-0 text-[17px] leading-[1.66] text-body max-w-[62ch]">
            This Privacy Policy explains what information Capann processes, how it is used and stored, when it is shared, and how users can exercise control over their information.
          </p>
          <dl className="flex flex-wrap gap-x-10 gap-y-3 mt-8 text-[13px] text-muted">
            <div className="flex items-center gap-2">
              <dt className="tracking-[0.08em] uppercase">Effective date</dt>
              <dd className="m-0 text-body"><time dateTime="2026-10-28">October 28, 2026</time></dd>
            </div>
            <div className="flex items-center gap-2">
              <dt className="tracking-[0.08em] uppercase">Last updated</dt>
              <dd className="m-0 text-body"><time dateTime="2026-10-28">October 28, 2026</time></dd>
            </div>
          </dl>
        </div>

        <div className="grid gap-y-10 pb-16 lg:grid-cols-[250px_minmax(0,1fr)] lg:gap-x-16">
          {/* On-page contents */}
          <aside className="hidden lg:block">
            <nav aria-label="On this page" className="sticky top-32 pt-1">
              <div className="text-[11px] tracking-[0.16em] uppercase text-muted mb-4">On this page</div>
              <ol className="flex flex-col gap-1 m-0 p-0 list-none">
                {SECTIONS.map(([id, label], index) => (
                  <li key={id}>
                    <a href={`#${id}`} className="group flex items-baseline gap-3 rounded-lg py-1.5 text-[13.5px] leading-[1.45] text-body hover:text-paper transition-colors">
                      <span aria-hidden="true" className="text-[11px] tabular-nums text-muted group-hover:text-draw transition-colors">{String(index + 1).padStart(2, '0')}</span>
                      {label}
                    </a>
                  </li>
                ))}
              </ol>
            </nav>
          </aside>

          <div className="max-w-[76ch]">
            <Section id="information-we-handle" title="1. Information We Handle">
              <SubHeading>Webpage content</SubHeading>
              <Paragraph>
                When you activate Capann on a webpage, the extension accesses the active tab as necessary to provide annotation and capture features you initiate.
              </Paragraph>

              <SubHeading>Annotations and feedback</SubHeading>
              <Paragraph>
                Capann processes drawings, highlights, pointers, and explanatory annotations you create to provide its visual communication features. Your annotations may contain information visible on the webpage you choose to mark up.
              </Paragraph>

              <SubHeading>Screenshots and recordings</SubHeading>
              <Paragraph>
                When you initiate a screenshot or recording, Capann processes the captured content in your browser. Depending on the feature used, recordings may include browser-tab content, camera video, and audio.
              </Paragraph>
              <Paragraph>
                Captured content may contain personal or confidential information visible or audible during the session. You should review sensitive content before sharing it.
              </Paragraph>

              <SubHeading>Shared content</SubHeading>
              <Paragraph>
                If you choose to generate a shareable link, the associated content is transmitted to Capann’s sharing service and stored using Cloudflare R2 so that it can be accessed through the link.
              </Paragraph>
              <Paragraph>
                Capann intends to make shared content available for seven days. Automatic deletion after that period is planned but not yet implemented, so shared content may remain accessible through its link until the retention mechanism is in place.
              </Paragraph>
              <Paragraph>
                Anyone with access to a shareable link may be able to view its associated content. Do not share sensitive information unless you are comfortable with the people who may access it.
              </Paragraph>

              <SubHeading>Extension settings</SubHeading>
              <Paragraph>
                Capann may store settings and other limited information necessary to maintain extension preferences and feature functionality.
              </Paragraph>

              <SubHeading>Account and purchase information</SubHeading>
              <Paragraph>
                As account and paid-feature functionality is introduced, Capann may process information such as your name, email address, purchase reference, transaction status, and subscription or entitlement details, where applicable.
              </Paragraph>
              <Paragraph>
                Payments are handled by Bachs Technologies Limited. Payment information is processed as necessary to complete transactions and verify purchases. Capann does not require payment card details for its annotation features.
              </Paragraph>
            </Section>

            <Section id="how-we-use-information" title="2. How We Use Information">
              <Paragraph>Capann uses information to:</Paragraph>
              <Bullets
                items={[
                  [null, 'Provide drawing, highlighting, pointing, and annotation tools.'],
                  [null, 'Capture screenshots and recordings when you initiate those actions.'],
                  [null, 'Generate and deliver shareable links when you request them.'],
                  [null, 'Store shared content so it can be accessed through shareable links.'],
                  [null, 'Verify purchases and provide access to paid features.'],
                  [null, 'Maintain extension settings and essential functionality.'],
                  [null, 'Protect the service and investigate technical or security issues where necessary.'],
                ]}
              />
              <Paragraph>
                Capann does not use webpage content, screenshots, recordings, or annotations for unrelated purposes.
              </Paragraph>
            </Section>

            <Section id="data-processing-storage-transmission" title="3. Data Processing, Storage, and Transmission">
              <Paragraph>
                Capann processes annotations and captures in the browser when users use those features.
              </Paragraph>
              <Paragraph>
                When users choose to create a shareable link, the selected content is uploaded to Capann’s sharing service and stored using Cloudflare R2. The uploaded content may contain webpage information, annotations, screenshots, screen recordings, camera video, or audio, depending on what the user chooses to capture.
              </Paragraph>
              <Paragraph>
                Shared content is accessible to people who obtain the corresponding shareable link. Users should avoid sharing sensitive information unless they are comfortable with the potential recipients accessing it.
              </Paragraph>
              <Paragraph>
                Capann intends to implement automatic deletion of shared content after seven days. Until this functionality is implemented and verified, users should not rely on seven-day deletion as a guaranteed retention limit. The availability of shared content and its deletion will depend on the sharing service’s implemented retention controls.
              </Paragraph>
              <Paragraph>
                Files downloaded to a user’s device are separate from cloud-hosted copies and are not automatically deleted when a shareable link expires.
              </Paragraph>
            </Section>

            <Section id="third-party-service-providers-and-analytics" title="4. Third-Party Service Providers and Analytics">
              <Paragraph>
                Duowork does not sell users’ personal information.
              </Paragraph>
              <Paragraph>
                Capann does not currently use analytics services to track users’ activity.
              </Paragraph>
              <Paragraph>
                Capann uses Cloudflare R2 to store content users choose to share through generated links. Consequently, selected screenshots and recordings are transmitted to Cloudflare’s storage infrastructure for this purpose.
              </Paragraph>
              <Paragraph>
                Payment processing is handled by Bachs Technologies Limited where applicable. Information necessary to process or verify purchases may be shared with that provider.
              </Paragraph>
              <Paragraph>
                These service providers may process information as necessary to deliver their respective services. Their handling of information is subject to their applicable terms and privacy policies.
              </Paragraph>
              <Paragraph>
                Information may also be disclosed where necessary to comply with applicable legal obligations or respond to valid legal requests.
              </Paragraph>
            </Section>

            <Section id="browser-permissions" title="5. Browser Permissions">
              <Paragraph>
                Capann requests permissions necessary to provide its functionality. Depending on the installed version, these may include:
              </Paragraph>
              <Bullets
                items={[
                  ['Active tab access:', 'to annotate or capture the webpage you choose.'],
                  ['Storage:', 'to maintain necessary settings or extension state.'],
                  ['Downloads:', 'to save screenshots, recordings, or other files you request.'],
                  ['Tab capture:', 'to capture browser-tab content for recording or related features.'],
                  ['Camera and microphone access:', 'where recording functionality uses camera or audio input and the relevant permissions have been granted.'],
                  ['Audio capture:', 'to include audio in a user-initiated recording when audio capture is supported and enabled.'],
                ]}
              />
              <Paragraph>
                Capann uses these capabilities to provide its stated features. Recording and capture actions are initiated by the user.
              </Paragraph>
              <Paragraph>
                Capann captures audio as part of a user-initiated recording when audio capture is supported and enabled. This allows users to explain their walkthroughs verbally and create more useful visual demonstrations. Audio capture is limited to the recording functionality and is not used for unrelated monitoring.
              </Paragraph>
            </Section>

            <Section id="retention-and-deletion" title="6. Data Retention and Deletion">
              <Paragraph>
                Capann intends to implement automatic deletion of shared content after seven days. Until that mechanism is implemented and verified, shared content may remain accessible through its shareable link, and users should not rely on seven-day deletion as a guaranteed retention limit.
              </Paragraph>
              <Paragraph>
                Users may also delete shared content earlier where the extension provides that capability.
              </Paragraph>
              <Paragraph>
                Files downloaded to your device are not automatically deleted when a shareable link expires. Copies saved or downloaded by recipients may also remain outside Capann’s control.
              </Paragraph>
              <Paragraph>
                Account and purchase records, when implemented, may be retained for as long as necessary to provide the service, verify transactions, address disputes, comply with legal obligations, or meet legitimate recordkeeping requirements.
              </Paragraph>
              <Paragraph>
                This policy will be updated when the seven-day retention mechanism is implemented, to describe the retention period and what happens to expired content.
              </Paragraph>
              <Paragraph>
                For privacy questions or requests concerning information handled by Duowork, contact the address provided below.
              </Paragraph>
            </Section>

            <Section id="security" title="7. Security">
              <Paragraph>
                Duowork takes reasonable measures to protect information handled by Capann against unauthorized access, disclosure, alteration, or destruction.
              </Paragraph>
              <Paragraph>
                No software, storage system, or transmission method can be guaranteed to be completely secure.
              </Paragraph>
              <Paragraph>
                Users should avoid sharing confidential information through links unless they understand who may access the content.
              </Paragraph>
            </Section>

            <Section id="childrens-privacy" title="8. Children’s Privacy">
              <Paragraph>
                Capann is a general-purpose productivity tool and is not specifically designed to collect personal information from children.
              </Paragraph>
              <Paragraph>
                If you believe a child has provided personal information to Duowork through a service associated with Capann, contact us so the matter can be reviewed.
              </Paragraph>
            </Section>

            <Section id="changes" title="9. Changes to This Policy">
              <Paragraph>
                This Privacy Policy may be updated when Capann’s features, data practices, or legal obligations change.
              </Paragraph>
              <Paragraph>
                The latest version will be published at this URL, with the effective or updated date shown at the top.
              </Paragraph>
            </Section>

            <Section id="contact" title="10. Contact Us">
              <Paragraph>
                For privacy questions, requests, or concerns about Capann, contact:
              </Paragraph>
              <dl className="grid gap-4 sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-x-8 sm:gap-y-4 mt-6 mb-0 p-6 rounded-3xl bg-panel border border-white/10 text-[15px]">
                <dt className="text-muted">Developer</dt>
                <dd className="m-0 text-paper font-medium sm:mt-0">Duowork</dd>
                <dt className="text-muted">Website</dt>
                <dd className="m-0">
                  <a href="https://duowork.tech" className="text-draw hover:text-draw-hover transition-colors">duowork.tech</a>
                </dd>
                <dt className="text-muted">Privacy contact</dt>
                <dd className="m-0">
                  <a href="mailto:reach@duowork.tech" className="text-draw hover:text-draw-hover transition-colors">reach@duowork.tech</a>
                </dd>
              </dl>
            </Section>

            <div className="mt-14 pt-8 border-t border-white/10">
              <p className="m-0 text-[14px] text-muted">Questions about how Capann handles your information?</p>
              <div className="flex flex-wrap gap-3 mt-4">
                <a href="mailto:reach@duowork.tech" className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-paper text-ink text-[14px] font-medium hover:bg-white transition-colors">
                  Email Duowork
                </a>
                <Link to="/" className="inline-flex items-center gap-2 px-6 py-3 rounded-full border border-white/15 text-paper text-[14px] hover:bg-elevated transition-colors">
                  Back to Capann
                </Link>
              </div>
            </div>
          </div>
        </div>

        <SiteFooter />
      </main>
    </div>
  )
}
