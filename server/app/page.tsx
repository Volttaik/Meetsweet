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
  title: "MeetSweet — Connect. Create. Captivate.",
  description:
    "MeetSweet is a creator platform where you share exclusive content, connect with fans, and build your community. Available on Android.",
};

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
          <a href="#download" style={s.navCta}>
            Download
          </a>
        </div>
      </nav>

      {/* Hero */}
      <section style={s.hero}>
        <div style={s.heroInner}>
          <div style={s.badge}>Creator Platform</div>
          <h1 style={s.heroTitle}>
            Connect.{" "}
            <span style={s.accent}>Create.</span>{" "}
            Captivate.
          </h1>
          <p style={s.heroSub}>
            Share exclusive content, build a loyal subscriber base, and get paid
            doing what you love — all in one beautifully designed app.
          </p>
          <div style={s.heroCtas}>
            <a href="#download" style={s.btnPrimary}>
              Download the App
            </a>
            <a href="#features" style={s.btnGhost}>
              Learn more
            </a>
          </div>
        </div>

        {/* Decorative phone mockup */}
        <div style={s.phoneMockup} aria-hidden="true">
          <div style={s.phoneScreen}>
            <div style={s.phoneSurface}>
              <div style={s.phoneStatusBar}>
                <span style={s.phoneTime}>9:41</span>
              </div>
              <div style={s.phoneContent}>
                <div style={s.phoneAvatar} />
                <div style={s.phoneLine1} />
                <div style={s.phoneLine2} />
                <div style={s.phoneMediaCard} />
                <div style={s.phoneLine3} />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" style={s.features}>
        <div style={s.featuresInner}>
          <p style={s.sectionEyebrow}>Why MeetSweet</p>
          <h2 style={s.sectionTitle}>Everything creators need</h2>
          <div style={s.featureGrid}>
            {FEATURES.map((f) => (
              <div key={f.title} style={s.featureCard}>
                <h3 style={s.featureTitle}>{f.title}</h3>
                <p style={s.featureDesc}>{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Download */}
      <section id="download" style={s.download}>
        <div style={s.downloadInner}>
          <div style={s.downloadGlow} aria-hidden="true" />
          <p style={s.sectionEyebrow}>Get the app</p>
          <h2 style={s.sectionTitle}>Ready to join MeetSweet?</h2>
          <p style={s.downloadSub}>
            Available on Android. iOS coming soon.
          </p>
          <div style={s.downloadBtns}>
            <a
              href="https://files.catbox.moe/38gjad.apk"
              download
              style={s.btnPrimary}
            >
              ↓ Download for Android
            </a>
          </div>
          <p style={s.downloadNote}>
            APK · Requires Android 10+
          </p>
          <a href="/install-help" style={s.helpLink}>
            ⚠ Android warning or “App not installed”? Read the install guide
          </a>
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

const FEATURES = [
  {
    title: "Exclusive Content",
    desc: "Post photos, videos, short clips, and albums. Set tiers so your biggest fans unlock premium content.",
  },
  {
    title: "Subscriptions",
    desc: "Earn recurring income from subscribers. Set your own price and upgrade tiers for premium access.",
  },
  {
    title: "Direct Messages",
    desc: "Chat privately with your fans and subscribers. Send photos, voice notes, and more.",
  },
  {
    title: "Real-time Notifications",
    desc: "Stay on top of every like, comment, new subscriber, and message the moment it happens.",
  },
  {
    title: "Privacy First",
    desc: "Your data stays yours. No web app means only app users with accounts can access your content.",
  },
  {
    title: "Easy Payouts",
    desc: "Withdraw your earnings directly to your bank account — powered by Paystack.",
  },
];


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
    maxWidth: 1100,
    margin: "0 auto",
    padding: "80px 24px 100px",
    display: "flex",
    alignItems: "center",
    gap: 60,
    flexWrap: "wrap" as const,
  },
  heroInner: {
    flex: "1 1 400px",
    animation: "fadeUp 0.8s ease both",
  },
  badge: {
    display: "inline-block",
    background: "rgba(255,20,147,0.14)",
    color: BRAND.pink,
    borderRadius: 50,
    padding: "6px 16px",
    fontSize: 12,
    fontWeight: 600,
    letterSpacing: "0.08em",
    textTransform: "uppercase" as const,
    marginBottom: 24,
  },
  heroTitle: {
    margin: "0 0 20px",
    fontSize: "clamp(40px, 6vw, 68px)",
    fontWeight: 700,
    lineHeight: 1.1,
    letterSpacing: "-1.5px",
  },
  accent: gradientText(),
  heroSub: {
    margin: "0 0 36px",
    fontSize: 18,
    lineHeight: 1.7,
    color: TEXT_2,
    maxWidth: 520,
  },
  heroCtas: {
    display: "flex",
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

  // Phone mockup
  phoneMockup: {
    flex: "0 0 auto",
    display: "flex",
    justifyContent: "center",
    animation: "fadeUp 1s ease 0.2s both",
  },
  phoneScreen: {
    width: 220,
    height: 440,
    background: SURFACE,
    borderRadius: 36,
    border: "2px solid rgba(255,255,255,0.08)",
    overflow: "hidden",
    boxShadow: "0 40px 80px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,20,147,0.1)",
  },
  phoneSurface: {
    height: "100%",
    background: `linear-gradient(160deg, ${SURFACE_2} 0%, ${SURFACE} 100%)`,
    padding: 16,
  },
  phoneStatusBar: {
    marginBottom: 16,
    display: "flex",
    justifyContent: "flex-end",
  },
  phoneTime: { fontSize: 11, fontWeight: 600, color: TEXT_2 },
  phoneContent: { display: "flex", flexDirection: "column" as const, gap: 10 },
  phoneAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    background: "linear-gradient(135deg, #FF8C00 0%, #FF1493 45%, #800080 100%)",
  },
  phoneLine1: {
    height: 12,
    borderRadius: 6,
    background: "rgba(255,255,255,0.15)",
    width: "70%",
  },
  phoneLine2: {
    height: 10,
    borderRadius: 5,
    background: "rgba(255,255,255,0.08)",
    width: "50%",
  },
  phoneMediaCard: {
    height: 140,
    borderRadius: 16,
    background:
      "linear-gradient(135deg, rgba(255,20,147,0.28) 0%, rgba(128,0,128,0.22) 100%)",
    marginTop: 4,
    border: "1px solid rgba(255,20,147,0.22)",
  },
  phoneLine3: {
    height: 10,
    borderRadius: 5,
    background: "rgba(255,255,255,0.1)",
    width: "60%",
  },

  // Features
  features: {
    position: "relative",
    zIndex: 1,
    padding: "80px 24px",
    background: "rgba(255,255,255,0.015)",
    borderTop: "1px solid rgba(255,255,255,0.05)",
    borderBottom: "1px solid rgba(255,255,255,0.05)",
  },
  featuresInner: {
    maxWidth: 1100,
    margin: "0 auto",
    textAlign: "center" as const,
  },
  sectionEyebrow: {
    margin: "0 0 12px",
    color: BRAND.pink,
    fontSize: 12,
    fontWeight: 600,
    letterSpacing: "0.1em",
    textTransform: "uppercase" as const,
  },
  sectionTitle: {
    margin: "0 0 48px",
    fontSize: "clamp(28px, 4vw, 42px)",
    fontWeight: 700,
    letterSpacing: "-0.8px",
  },
  featureGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
    gap: 20,
    textAlign: "left" as const,
  },
  featureCard: {
    background: SURFACE,
    border: "1px solid rgba(255,255,255,0.05)",
    borderRadius: 20,
    padding: "28px 24px",
  },
  featureIcon: { fontSize: 28, marginBottom: 14 },
  featureTitle: {
    margin: "0 0 8px",
    fontSize: 16,
    fontWeight: 600,
  },
  featureDesc: {
    margin: 0,
    fontSize: 14,
    lineHeight: 1.65,
    color: TEXT_2,
  },

  // Download
  download: {
    position: "relative",
    zIndex: 1,
    padding: "100px 24px",
    textAlign: "center" as const,
    overflow: "hidden",
  },
  downloadInner: {
    maxWidth: 600,
    margin: "0 auto",
    position: "relative",
    zIndex: 1,
  },
  downloadGlow: {
    position: "absolute",
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -50%)",
    width: 500,
    height: 500,
    background: GLOW_CARD,
    pointerEvents: "none",
    zIndex: 0,
  },
  downloadSub: {
    margin: "0 0 36px",
    fontSize: 17,
    color: TEXT_2,
  },
  downloadBtns: {
    display: "flex",
    justifyContent: "center",
    gap: 16,
    flexWrap: "wrap" as const,
  },
  downloadNote: {
    marginTop: 20,
    fontSize: 13,
    color: TEXT_3,
  },
  helpLink: {
    display: "inline-block",
    marginTop: 16,
    color: BRAND.pink,
    fontSize: 14,
    fontWeight: 600,
    textDecoration: "none",
    borderBottom: "1px solid rgba(255,20,147,0.35)",
    transition: "opacity 0.2s",
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
