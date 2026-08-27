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
  gradientText,
} from "@/lib/frontend/brand";

export const metadata: Metadata = {
  title: "MeetSweet — Download & Install",
  description:
    "Download the MeetSweet Android app and learn how to install the APK and enable notifications.",
};

const INSTALL_STEPS = [
  { title: "1. Download the APK", desc: "Tap the download button above to get the MeetSweet APK.", img: "/guide/install_1_download.jpg" },
  { title: "2. Install the App", desc: "Open the downloaded file and tap 'Install' when prompted.", img: "/guide/install_2_prompt.jpg" },
  { title: "3. If Installation Fails", desc: "If you see an 'App not installed' error, Google Play Protect might be blocking it.", img: "/guide/install_3_failed.jpg" },
  { title: "4. Turn Off Play Protect", desc: "Open the Google Play Store, go to Settings > Play Protect, and temporarily turn off scanning.", img: "/guide/install_4_play_protect_off.jpg" },
  { title: "5. Re-enable Play Protect", desc: "Retry installing MeetSweet. Once installed, turn Play Protect back on for security.", img: "/guide/install_5_play_protect_on.jpg" },
];

const NOTIF_STEPS = [
  { title: "1. Find MeetSweet", desc: "Locate the MeetSweet app on your home screen or app drawer.", img: "/guide/notif_1_icon.jpg" },
  { title: "2. Long Press", desc: "Press and hold the MeetSweet app icon until a menu appears.", img: "/guide/notif_2_longpress.jpg" },
  { title: "3. App Info", desc: "Tap the 'App info' (i) icon from the context menu.", img: "/guide/notif_3_appinfo.jpg" },
  { title: "4. Notifications", desc: "Tap on 'Notifications' or 'Permissions' in the settings menu.", img: "/guide/notif_4_permissions.jpg" },
  { title: "5. Allow Access", desc: "Toggle the switch to 'Allow notifications'. Return to MeetSweet and they will work.", img: "/guide/notif_5_allow.jpg" },
];

export default function HomePage() {
  return (
    <main style={s.page}>
      {/* Ambient background gradient */}
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
          <a href="https://files.catbox.moe/8rjgoq.apk" download style={s.navCta}>
            Download APK
          </a>
        </div>
      </nav>

      {/* Hero / Download Section */}
      <section style={s.hero}>
        <div style={s.heroInner}>
          <div style={s.badge}>Android APK</div>
          <h1 style={s.heroTitle}>
            Install{" "}
            <span style={s.accent}>MeetSweet.</span>
          </h1>
          <p style={s.heroSub}>
            Follow the visual guides below to install the app safely and ensure you never miss a message from your favorite creators.
          </p>
          <div style={s.heroCtas}>
            <a href="https://files.catbox.moe/8rjgoq.apk" download style={s.btnPrimary}>
              ↓ Download the APK
            </a>
          </div>
          <p style={s.downloadNote}>Requires Android 10+ · Version 1.0.0</p>
        </div>
      </section>

      {/* Installation Carousel */}
      <section style={s.guideSection}>
        <div style={s.guideHeader}>
          <h2 style={s.sectionTitle}>How to install MeetSweet</h2>
          <p style={s.sectionEyebrow}>Troubleshooting Play Protect & "App not installed"</p>
        </div>
        <div style={s.carouselWrapper}>
          {INSTALL_STEPS.map((step, i) => (
            <div key={i} style={s.carouselCard}>
              <img src={step.img} alt={step.title} style={s.cardImg} loading="lazy" />
              <h3 style={s.stepTitle}>{step.title}</h3>
              <p style={s.stepBody}>{step.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Notification Carousel */}
      <section style={s.guideSection}>
        <div style={s.guideHeader}>
          <h2 style={s.sectionTitle}>Enable Notifications</h2>
          <p style={s.sectionEyebrow}>Don't miss direct messages or new posts</p>
        </div>
        <div style={s.carouselWrapper}>
          {NOTIF_STEPS.map((step, i) => (
            <div key={i} style={s.carouselCard}>
              <img src={step.img} alt={step.title} style={s.cardImg} loading="lazy" />
              <h3 style={s.stepTitle}>{step.title}</h3>
              <p style={s.stepBody}>{step.desc}</p>
            </div>
          ))}
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
    top: "60%",
    left: "50%",
    transform: "translate(-50%, -50%)",
    width: 800,
    height: 800,
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
  navCta: {
    ...GRADIENT_BUTTON,
    border: "none",
    borderRadius: 50,
    padding: "10px 24px",
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
    textDecoration: "none",
  },

  // Hero
  hero: {
    position: "relative",
    zIndex: 1,
    maxWidth: 900,
    margin: "0 auto",
    padding: "60px 24px",
    textAlign: "center",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
  },
  heroInner: {
    position: "relative",
    zIndex: 2,
  },
  badge: {
    display: "inline-block",
    padding: "6px 16px",
    background: "rgba(255, 20, 147, 0.1)",
    border: "1px solid rgba(255, 20, 147, 0.2)",
    color: BRAND.pink,
    borderRadius: 50,
    fontSize: 14,
    fontWeight: 600,
    marginBottom: 24,
  },
  heroTitle: {
    fontSize: "clamp(40px, 6vw, 64px)",
    fontWeight: 700,
    lineHeight: 1.1,
    margin: "0 0 24px",
    letterSpacing: "-1px",
  },
  accent: {
    ...gradientText,
  },
  heroSub: {
    fontSize: 18,
    color: TEXT_2,
    lineHeight: 1.6,
    margin: "0 auto 40px",
    maxWidth: 500,
  },
  heroCtas: {
    display: "flex",
    gap: 16,
    justifyContent: "center",
    marginBottom: 16,
  },
  btnPrimary: {
    ...GRADIENT_BUTTON,
    border: "none",
    padding: "16px 32px",
    borderRadius: 50,
    fontSize: 16,
    fontWeight: 600,
    cursor: "pointer",
    textDecoration: "none",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
  },
  downloadNote: {
    fontSize: 14,
    color: TEXT_3,
    margin: 0,
  },

  // Guide Section
  guideSection: {
    position: "relative",
    zIndex: 1,
    width: "100%",
    padding: "40px 0",
  },
  guideHeader: {
    maxWidth: 1100,
    margin: "0 auto",
    padding: "0 24px 24px",
    textAlign: "left",
  },
  sectionTitle: {
    fontSize: 32,
    fontWeight: 700,
    margin: "0 0 8px 0",
    letterSpacing: "-0.5px",
  },
  sectionEyebrow: {
    color: BRAND.pink,
    fontWeight: 600,
    fontSize: 14,
    margin: 0,
    textTransform: "uppercase",
    letterSpacing: "1px",
  },

  // Carousel
  carouselWrapper: {
    display: "flex",
    overflowX: "auto",
    gap: "24px",
    padding: "0 24px 24px",
    scrollSnapType: "x mandatory",
    scrollbarWidth: "none",
    WebkitOverflowScrolling: "touch",
    maxWidth: 1148,
    margin: "0 auto",
  },
  carouselCard: {
    minWidth: "300px",
    maxWidth: "300px",
    flexShrink: 0,
    scrollSnapAlign: "start",
    background: SURFACE_2,
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: "24px",
    padding: "20px",
    display: "flex",
    flexDirection: "column",
    gap: "16px",
    boxShadow: "0 8px 32px rgba(0,0,0,0.2)",
  },
  cardImg: {
    width: "100%",
    height: "200px",
    objectFit: "cover",
    borderRadius: "12px",
    background: SURFACE,
  },
  stepTitle: {
    fontSize: 20,
    fontWeight: 600,
    margin: 0,
    color: "#fff",
  },
  stepBody: {
    fontSize: 15,
    color: TEXT_2,
    margin: 0,
    lineHeight: 1.5,
  },

  // Footer
  footer: {
    position: "relative",
    zIndex: 1,
    borderTop: "1px solid rgba(255,255,255,0.05)",
    padding: "40px 24px",
    marginTop: 80,
  },
  footerInner: {
    maxWidth: 1100,
    margin: "0 auto",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 20,
  },
  footerBrand: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    fontSize: 18,
    fontWeight: 600,
    color: "#fff",
    textDecoration: "none",
  },
  footerMuted: {
    color: TEXT_3,
    fontSize: 14,
  },
};

