/**
 * Shared page shell for MeetSweet link landing pages (share links and direct
 * content links). Server component: renders the ambient background, brand nav
 * and the client deep-link launcher. Kept in one place so every link page
 * renders identically without duplicating styles.
 */
import { BG, GLOW_AMBER, GLOW_TOP, GRADIENT_BUTTON, SURFACE, TEXT_2 } from "@/lib/frontend/brand";
import { ContentRedirectClient } from "./link-redirect-client";
import type { ContentLinkPreview } from "@/lib/frontend/content-link";

export function ContentLinkShell({
  deepLink,
  meta,
  preview,
}: {
  deepLink: string;
  meta: { label: string; description: string; icon: string };
  preview: ContentLinkPreview | null;
}) {
  return (
    <main style={pageStyle}>
      {/* Ambient background */}
      <div style={gradientStyle} aria-hidden="true" />

      {/* Nav */}
      <nav style={navStyle}>
        <a href="/" style={brandStyle}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/meetsweet-logo-white.png" alt="MeetSweet" width={26} height={26} style={logoImageStyle} />
          <span>MeetSweet</span>
        </a>
      </nav>

      {/* Spinner keyframe — injected once, server-side safe */}
      <style>{`@keyframes ms-spin { to { transform: rotate(360deg); } }`}</style>

      {/* Client component handles auto-redirect and fallback UI */}
      <ContentRedirectClient deepLink={deepLink} meta={meta} preview={preview} />
    </main>
  );
}

export function ContentLinkNotFound() {
  return (
    <main style={pageStyle}>
      <div style={gradientStyle} aria-hidden="true" />
      <nav style={navStyle}>
        <a href="/" style={brandStyle}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/meetsweet-logo-white.png" alt="MeetSweet" width={26} height={26} style={logoImageStyle} />
          <span>MeetSweet</span>
        </a>
      </nav>
      <section style={centerStyle}>
        <div style={cardStyle}>
          <div style={iconWrapStyle}><span style={{ fontSize: 32 }}>🔗</span></div>
          <h1 style={cardTitleStyle}>Link not found</h1>
          <p style={cardSubStyle}>
            This MeetSweet link has expired or no longer exists. Ask the creator to share it again.
          </p>
          <a href="/" style={btnPrimaryStyle}>Go to MeetSweet</a>
        </div>
      </section>
    </main>
  );
}

const pageStyle: React.CSSProperties = {
  minHeight: "100vh",
  background: BG,
  color: "#fff",
  fontFamily: "'Poppins', ui-sans-serif, system-ui, sans-serif",
  position: "relative",
  overflow: "hidden",
};
const gradientStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: `${GLOW_TOP}, ${GLOW_AMBER}`,
  pointerEvents: "none",
  zIndex: 0,
};
const navStyle: React.CSSProperties = {
  position: "relative",
  zIndex: 10,
  padding: "20px 24px",
  borderBottom: "1px solid rgba(255,255,255,0.05)",
  backdropFilter: "blur(12px)",
  backgroundColor: "rgba(12,12,15,0.6)",
};
const brandStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 10,
  fontSize: 20,
  fontWeight: 700,
  color: "#fff",
  textDecoration: "none",
  letterSpacing: "-0.5px",
};
const logoImageStyle: React.CSSProperties = {
  width: 26,
  height: 26,
  display: "block",
  flexShrink: 0,
};
const centerStyle: React.CSSProperties = {
  position: "relative",
  zIndex: 1,
  minHeight: "calc(100vh - 65px)",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  padding: "48px 24px",
  gap: 24,
};
const cardStyle: React.CSSProperties = {
  background: SURFACE,
  border: "1px solid rgba(255,255,255,0.07)",
  borderRadius: 28,
  padding: "40px 32px",
  maxWidth: 420,
  width: "100%",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  textAlign: "center",
  gap: 16,
  boxShadow: "0 24px 64px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,20,147,0.08)",
};
const iconWrapStyle: React.CSSProperties = {
  width: 72,
  height: 72,
  borderRadius: 22,
  background:
    "linear-gradient(135deg, rgba(255,20,147,0.24) 0%, rgba(128,0,128,0.1) 100%)",
  border: "1px solid rgba(255,20,147,0.2)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  marginBottom: 4,
};
const cardTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 22,
  fontWeight: 700,
  lineHeight: 1.3,
  letterSpacing: "-0.3px",
};
const cardSubStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 15,
  lineHeight: 1.65,
  color: TEXT_2,
};
const btnPrimaryStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  ...GRADIENT_BUTTON,
  border: "none",
  borderRadius: 50,
  padding: "16px 0",
  fontSize: 15,
  fontWeight: 600,
  textDecoration: "none",
  textAlign: "center",
  marginTop: 4,
};
