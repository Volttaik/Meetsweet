import type { Metadata } from "next";
import {
  BG,
  BRAND,
  GRADIENT_BUTTON,
  GLOW_AMBER,
  GLOW_CARD,
  GLOW_CENTER,
  GLOW_TOP,
  SURFACE,
  SURFACE_2,
  TEXT_2,
  TEXT_3,
} from "@/lib/frontend/brand";

export const metadata: Metadata = {
  title: "Install MeetSweet — Android setup guide",
  description:
    "Step-by-step guide to installing the MeetSweet Android APK: download, Play Protect, unknown apps, and fixing 'App not installed' errors.",
};

const STEPS = [
  {
    n: 1,
    title: "Download the APK",
    image: "/install-help/step-1-download.svg",
    body: "Tap Download for Android below. When Chrome warns that the file could harm your device, tap Keep, then Open the downloaded file.",
  },
  {
    n: 2,
    title: "Install & bypass Play Protect",
    image: "/install-help/step-2-install-anyway.svg",
    body: "On the installer screen tap Install. If Play Protect says it doesn't recognize the developer, tap More details, then Install anyway.",
  },
  {
    n: 3,
    title: "Turn off Play Protect (only if it blocks)",
    image: "/install-help/step-3-play-protect-off.svg",
    body: "If the install is blocked with no Install anyway option, open the Play Store → your profile → Play Protect, and turn off Scan apps with Play Protect. Re-enable it after installing.",
  },
  {
    n: 4,
    title: "Allow unknown apps",
    image: "/install-help/step-4-unknown-sources.svg",
    body: "Settings → Apps → Special app access → Install unknown apps → allow the app you downloaded with (usually Chrome or Files).",
  },
  {
    n: 5,
    title: "Fix “App not installed”",
    image: "/install-help/step-5-not-installed.svg",
    body: "Allow unknown apps, free up storage space, and re-download the APK — the file may have been incomplete. Then tap the APK again.",
  },
  {
    n: 6,
    title: "You’re all set",
    image: "/install-help/step-6-done.svg",
    body: "Open MeetSweet, create your account, and start exploring creators, posts and albums.",
  },
];

const FAQS = [
  {
    q: "Why does Android warn me about the file?",
    a: "MeetSweet is not distributed through the Google Play Store, so Android shows a standard 'unknown developer' warning. Tap Keep to continue downloading — the APK is signed by our developer account.",
  },
  {
    q: "Play Protect keeps blocking the install",
    a: "Tap More details on the warning, then Install anyway. If there is no Install anyway button, temporarily turn off Scan apps with Play Protect in the Play Store (Step 3), install, then turn it back on.",
  },
  {
    q: "I see “App not installed”",
    a: "Usually one of three things: unknown apps are blocked (Step 4), the phone has no free storage, or the APK download was interrupted. Free up space, re-download the APK, and try again (Step 5).",
  },
  {
    q: "Do I need to turn off Play Protect forever?",
    a: "No. Turn it back on as soon as MeetSweet is installed so Google keeps protecting you from other apps.",
  },
];

export default function InstallHelpPage() {
  return (
    <main style={s.page}>
      <div style={s.gradient} aria-hidden="true" />
      <div style={s.ambientGlow} aria-hidden="true" />

      {/* Nav */}
      <nav style={s.nav}>
        <div style={s.navInner}>
          <a href="/" style={s.navBrand}>
            <img
              src="/meetsweet-logo-white.png"
              alt="MeetSweet"
              width={26}
              height={26}
              style={s.logoImage}
            />
            <span>MeetSweet</span>
          </a>
          <a href="/" style={s.navBack}>
            ← Back to home
          </a>
        </div>
      </nav>

      {/* Hero */}
      <section style={s.hero}>
        <div style={s.heroInner}>
          <p style={s.sectionEyebrow}>Install guide</p>
          <h1 style={s.heroTitle}>How to install MeetSweet</h1>
          <p style={s.heroSub}>
            MeetSweet is distributed as an Android APK, so your phone may ask
            you to allow the install. Follow these six steps — including what
            to do when Play Protect or an “App not installed” error gets in
            the way.
          </p>
          <div style={s.heroCtas}>
            <a href="https://files.catbox.moe/qyq5k9.apk" download style={s.btnPrimary}>
              ↓ Download for Android
            </a>
            <a href="#steps" style={s.btnGhost}>
              Read the steps
            </a>
          </div>
          <p style={s.downloadNote}>APK · Requires Android 10+ · ~24 MB</p>
        </div>
      </section>

      {/* Steps */}
      <section id="steps" style={s.steps}>
        <div style={s.stepsInner}>
          <p style={s.sectionEyebrow}>Step by step</p>
          <h2 style={s.sectionTitle}>Six steps to get started</h2>
          <div style={s.stepGrid}>
            {STEPS.map((step) => (
              <div key={step.n} style={s.stepCard}>
                <div style={s.stepImageWrap}>
                  <img
                    src={step.image}
                    alt={`Step ${step.n}: ${step.title}`}
                    style={s.stepImage}
                    loading="lazy"
                  />
                </div>
                <div style={s.stepBadge}>Step {step.n}</div>
                <h3 style={s.stepTitle}>{step.title}</h3>
                <p style={s.stepBody}>{step.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section style={s.faq}>
        <div style={s.faqInner}>
          <p style={s.sectionEyebrow}>Troubleshooting</p>
          <h2 style={s.sectionTitle}>Common questions</h2>
          <div style={s.faqList}>
            {FAQS.map((f) => (
              <div key={f.q} style={s.faqCard}>
                <h3 style={s.faqQ}>{f.q}</h3>
                <p style={s.faqA}>{f.a}</p>
              </div>
            ))}
          </div>

          <div style={s.downloadCta}>
            <div style={s.downloadGlow} aria-hidden="true" />
            <h2 style={s.ctaTitle}>Ready to join?</h2>
            <a href="https://files.catbox.moe/qyq5k9.apk" download style={s.btnPrimary}>
              ↓ Download for Android
            </a>
            <p style={s.downloadNote}>
              Having trouble? Re-read Steps 3–5 above — Play Protect and
              “App not installed” are the two most common hurdles.
            </p>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer style={s.footer}>
        <div style={s.footerInner}>
          <a href="/" style={s.footerBrand}>
            <img
              src="/meetsweet-logo-white.png"
              alt="MeetSweet"
              width={22}
              height={22}
              style={s.footerLogo}
            />
            <span>MeetSweet</span>
          </a>
          <span style={s.footerMuted}>
            © {new Date().getFullYear()} MeetSweet. All rights reserved.
          </span>
        </div>
      </footer>
    </main>
  );
}

const s: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    background: BG,
    color: "#fff",
    fontFamily: "'Poppins', ui-sans-serif, system-ui, sans-serif",
    position: "relative",
    overflow: "hidden",
  },
  gradient: {
    position: "fixed",
    inset: 0,
    background: `${GLOW_TOP}, ${GLOW_AMBER}`,
    pointerEvents: "none",
    zIndex: 0,
  },
  ambientGlow: {
    position: "fixed",
    top: "70%",
    left: "50%",
    transform: "translate(-50%, -50%)",
    width: 900,
    height: 900,
    background: GLOW_CENTER,
    pointerEvents: "none",
    zIndex: 0,
  },

  // Nav
  nav: {
    position: "relative",
    zIndex: 10,
    borderBottom: "1px solid rgba(255,255,255,0.05)",
    backdropFilter: "blur(12px)",
    backgroundColor: "rgba(12,12,15,0.7)",
  },
  navInner: {
    maxWidth: 1100,
    margin: "0 auto",
    padding: "18px 24px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  navBrand: {
    display: "inline-flex",
    alignItems: "center",
    gap: 10,
    fontSize: 20,
    fontWeight: 700,
    letterSpacing: "-0.5px",
    color: "#fff",
    textDecoration: "none",
  },
  logoImage: {
    width: 26,
    height: 26,
    display: "block",
    flexShrink: 0,
  },
  footerLogo: {
    width: 22,
    height: 22,
    display: "block",
    flexShrink: 0,
  },
  navBack: {
    color: TEXT_2,
    fontSize: 14,
    fontWeight: 600,
    textDecoration: "none",
    transition: "color 0.2s",
  },

  // Hero
  hero: {
    position: "relative",
    zIndex: 1,
    maxWidth: 820,
    margin: "0 auto",
    padding: "80px 24px 72px",
    textAlign: "center" as const,
  },
  heroInner: {
    animation: "fadeUp 0.8s ease both",
  },
  sectionEyebrow: {
    margin: "0 0 12px",
    color: BRAND.pink,
    fontSize: 12,
    fontWeight: 600,
    letterSpacing: "0.1em",
    textTransform: "uppercase" as const,
  },
  heroTitle: {
    margin: "0 0 20px",
    fontSize: "clamp(36px, 5.5vw, 56px)",
    fontWeight: 700,
    lineHeight: 1.15,
    letterSpacing: "-1.2px",
  },
  heroSub: {
    margin: "0 auto 36px",
    fontSize: 17,
    lineHeight: 1.7,
    color: TEXT_2,
    maxWidth: 640,
  },
  heroCtas: {
    display: "flex",
    justifyContent: "center",
    gap: 16,
    flexWrap: "wrap" as const,
  },
  btnPrimary: {
    ...GRADIENT_BUTTON,
    border: "none",
    borderRadius: 50,
    padding: "16px 32px",
    fontSize: 15,
    fontWeight: 600,
    cursor: "pointer",
    textDecoration: "none",
    display: "inline-block",
    transition: "opacity 0.2s, transform 0.15s",
  },
  btnGhost: {
    background: "rgba(255,255,255,0.08)",
    color: "#fff",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 50,
    padding: "16px 32px",
    fontSize: 15,
    fontWeight: 600,
    cursor: "pointer",
    textDecoration: "none",
    display: "inline-block",
  },
  downloadNote: {
    marginTop: 20,
    fontSize: 13,
    color: TEXT_3,
  },

  // Steps
  steps: {
    position: "relative",
    zIndex: 1,
    padding: "72px 24px",
    background: "rgba(255,255,255,0.015)",
    borderTop: "1px solid rgba(255,255,255,0.05)",
    borderBottom: "1px solid rgba(255,255,255,0.05)",
  },
  stepsInner: {
    maxWidth: 1100,
    margin: "0 auto",
    textAlign: "center" as const,
  },
  sectionTitle: {
    margin: "0 0 48px",
    fontSize: "clamp(28px, 4vw, 42px)",
    fontWeight: 700,
    letterSpacing: "-0.8px",
  },
  stepGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
    gap: 24,
    textAlign: "left" as const,
  },
  stepCard: {
    background: SURFACE,
    border: "1px solid rgba(255,255,255,0.05)",
    borderRadius: 24,
    padding: 16,
    display: "flex",
    flexDirection: "column" as const,
    transition: "transform 0.25s ease, border-color 0.25s ease",
  },
  stepImageWrap: {
    borderRadius: 18,
    overflow: "hidden",
    background: "#101014",
    border: "1px solid rgba(255,255,255,0.06)",
    marginBottom: 18,
    lineHeight: 0,
  },
  stepImage: {
    width: "100%",
    height: "auto",
    display: "block",
  },
  stepBadge: {
    display: "inline-block",
    alignSelf: "flex-start",
    background: "rgba(255,20,147,0.14)",
    color: BRAND.pink,
    borderRadius: 50,
    padding: "5px 14px",
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: "0.08em",
    textTransform: "uppercase" as const,
    marginBottom: 12,
  },
  stepTitle: {
    margin: "0 0 8px",
    fontSize: 18,
    fontWeight: 600,
  },
  stepBody: {
    margin: 0,
    fontSize: 14,
    lineHeight: 1.65,
    color: TEXT_2,
  },

  // FAQ
  faq: {
    position: "relative",
    zIndex: 1,
    padding: "72px 24px",
  },
  faqInner: {
    maxWidth: 820,
    margin: "0 auto",
    textAlign: "center" as const,
  },
  faqList: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 16,
    textAlign: "left" as const,
    marginBottom: 72,
  },
  faqCard: {
    background: SURFACE,
    border: "1px solid rgba(255,255,255,0.05)",
    borderRadius: 20,
    padding: "24px 26px",
  },
  faqQ: {
    margin: "0 0 8px",
    fontSize: 16,
    fontWeight: 600,
  },
  faqA: {
    margin: 0,
    fontSize: 14,
    lineHeight: 1.65,
    color: TEXT_2,
  },

  // Bottom CTA
  downloadCta: {
    position: "relative",
    overflow: "hidden",
    background: SURFACE_2,
    border: "1px solid rgba(255,255,255,0.06)",
    borderRadius: 28,
    padding: "56px 24px",
    textAlign: "center" as const,
  },
  downloadGlow: {
    position: "absolute",
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -50%)",
    width: 460,
    height: 460,
    background: GLOW_CARD,
    pointerEvents: "none",
    zIndex: 0,
  },
  ctaTitle: {
    position: "relative",
    zIndex: 1,
    margin: "0 0 24px",
    fontSize: "clamp(26px, 3.5vw, 38px)",
    fontWeight: 700,
    letterSpacing: "-0.8px",
  },

  // Footer
  footer: {
    position: "relative",
    zIndex: 1,
    borderTop: "1px solid rgba(255,255,255,0.05)",
    padding: "28px 24px",
  },
  footerInner: {
    maxWidth: 1100,
    margin: "0 auto",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap" as const,
    gap: 12,
  },
  footerBrand: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    fontWeight: 700,
    fontSize: 15,
  },
  footerMuted: { fontSize: 13, color: TEXT_2 },
};
