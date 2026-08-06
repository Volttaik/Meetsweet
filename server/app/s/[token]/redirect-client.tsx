"use client";

import { useEffect, useState } from "react";

const ACCENT = "#C45A72";
const BG = "#0C0C0F";
const SURFACE = "#161619";
const SURFACE_2 = "#1E1E24";
const TEXT_2 = "rgba(255,255,255,0.55)";
const TEXT_3 = "rgba(255,255,255,0.32)";

type ContentMeta = { label: string; description: string; icon: string };

const PERKS = [
  { icon: "🎬", text: "Exclusive creator content" },
  { icon: "💳", text: "Subscribe to your favourites" },
  { icon: "💬", text: "Direct messages with creators" },
];

export function ShareRedirectClient({
  deepLink,
  meta,
  preview,
}: {
  deepLink: string;
  meta: ContentMeta;
  preview: {
    title: string | null;
    description: string | null;
    authorName: string | null;
    imageUrl: string | null;
  } | null;
}) {
  // Start in fallback mode when we know the app is absent; otherwise attempt launch.
  const [showFallback, setShowFallback] = useState(false);

  useEffect(() => {
    const ua = navigator.userAgent;
    const isAndroid = /android/i.test(ua);
    const isIOS = /iPad|iPhone|iPod/.test(ua);

    // ── Android: intent:// with loop-safe fallback ────────────────────────
    // Chrome processes `browser_fallback_url` when the package is absent. We
    // append ?noapp=1 to the fallback URL so that when this page remounts after
    // a failed intent the param is present and we immediately show the download
    // card — preventing the intent from being re-launched in an infinite loop.
    if (isAndroid) {
      const params = new URLSearchParams(window.location.search);
      if (params.get("noapp") === "1") {
        // Arrived here from the Android fallback redirect — app not installed.
        setShowFallback(true);
        return;
      }

      const intentPath = deepLink.replace(/^[a-z][a-z0-9+\-.]*:\/\//i, "");
      // Fallback lands on the same page but with noapp=1 to suppress re-launch.
      const fallbackUrl = `${window.location.origin}${window.location.pathname}?noapp=1`;
      const launchUrl = `intent://${intentPath}#Intent;scheme=meetsweet;package=com.meetsweet.app;S.browser_fallback_url=${encodeURIComponent(fallbackUrl)};end`;
      window.location.href = launchUrl;

      const timer = setTimeout(() => setShowFallback(true), 1800);
      const onHide = () => { if (document.hidden) clearTimeout(timer); };
      document.addEventListener("visibilitychange", onHide);
      return () => {
        clearTimeout(timer);
        document.removeEventListener("visibilitychange", onHide);
      };
    }

    // ── iOS: Universal Links handle the direct-open case before this page ──
    // When the AASA is configured correctly and the app is installed, iOS
    // intercepts the HTTPS share URL at the OS level and the user never reaches
    // this page. Reaching here means the app is absent OR the link was opened
    // inside a WebView/context where UL is suppressed.
    // Auto-navigating to meetsweet:// in that situation shows an ugly "Cannot
    // Open Page" alert on iOS when the app isn't installed. So we skip the
    // auto-fire on iOS and show the download card immediately — the "Open in
    // MeetSweet" button (custom-scheme href) is still available for tapping.
    if (isIOS) {
      setShowFallback(true);
      return;
    }

    // ── Desktop / unknown browser ─────────────────────────────────────────
    // Fire the custom scheme; if the OS handles it the page gets hidden.
    // After 1800 ms we reveal the download card for users without the app.
    window.location.href = deepLink;
    const timer = setTimeout(() => setShowFallback(true), 1800);
    const onHide = () => { if (document.hidden) clearTimeout(timer); };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [deepLink]);

  if (!showFallback) {
    // Brief loading state while we attempt the deep link
    return (
      <section style={s.center}>
        <div style={s.card}>
          <div style={s.iconWrap}>
            <span style={s.icon}>{meta.icon}</span>
          </div>
          <h1 style={s.cardTitle}>Opening MeetSweet…</h1>
          <p style={s.cardSub}>
            If the app doesn&apos;t open automatically,{" "}
            <a href={deepLink} style={s.inlineLink}>
              tap here
            </a>
            .
          </p>
          <div style={s.spinner} aria-label="loading" />
        </div>
      </section>
    );
  }

  // App not installed (or desktop browser) — show the full download card
  return (
    <section style={s.center}>
      <div style={s.card}>
        <div style={s.iconWrap}>
          <span style={s.icon}>{meta.icon}</span>
        </div>

        <span style={s.contentTypeBadge}>{meta.label}</span>
        {preview?.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview.imageUrl} alt="" style={s.previewImage} />
        ) : null}
        <h1 style={s.cardTitle}>
          {preview?.title ?? `Someone shared ${meta.description} with you`}
        </h1>
        {preview?.authorName ? (
          <p style={s.author}>By {preview.authorName}</p>
        ) : null}
        <p style={s.cardSub}>
          {preview?.description ??
            `Open MeetSweet to see this ${meta.label.toLowerCase()} and interact with the creator.`}
        </p>

        {/* Try again — may work after the user installs the app */}
        <a href={deepLink} style={s.btnPrimary}>
          Open in MeetSweet
        </a>

        <div style={s.divider}>
          <div style={s.dividerLine} />
          <span style={s.dividerText}>Don&apos;t have the app?</span>
          <div style={s.dividerLine} />
        </div>

        <a href="/#download" style={s.btnGhost}>
          Download MeetSweet
        </a>
      </div>

      <div style={s.perks}>
        {PERKS.map((p) => (
          <div key={p.text} style={s.perk}>
            <span style={s.perkIcon}>{p.icon}</span>
            <span style={s.perkText}>{p.text}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

const s: Record<string, React.CSSProperties> = {
  center: {
    position: "relative",
    zIndex: 1,
    minHeight: "calc(100vh - 65px)",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: "48px 24px",
    gap: 24,
  },
  card: {
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
    boxShadow: "0 24px 64px rgba(0,0,0,0.4), 0 0 0 1px rgba(196,90,114,0.08)",
  },
  iconWrap: {
    width: 72,
    height: 72,
    borderRadius: 22,
    background:
      "linear-gradient(135deg, rgba(196,90,114,0.25) 0%, rgba(196,90,114,0.08) 100%)",
    border: "1px solid rgba(196,90,114,0.2)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  icon: { fontSize: 32 },
  spinner: {
    width: 28,
    height: 28,
    borderRadius: "50%",
    border: `3px solid rgba(196,90,114,0.2)`,
    borderTopColor: ACCENT,
    animation: "ms-spin 0.8s linear infinite",
  },
  inlineLink: {
    color: ACCENT,
    textDecoration: "underline",
  },
  previewImage: {
    display: "block",
    width: "100%",
    maxHeight: 260,
    objectFit: "cover",
    borderRadius: 18,
    border: "1px solid rgba(255,255,255,0.08)",
  },
  author: {
    margin: "-4px 0 0",
    color: ACCENT,
    fontSize: 13,
    fontWeight: 600,
  },
  contentTypeBadge: {
    background: "rgba(196,90,114,0.15)",
    color: ACCENT,
    borderRadius: 50,
    padding: "4px 14px",
    fontSize: 12,
    fontWeight: 600,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
  },
  cardTitle: {
    margin: 0,
    fontSize: 22,
    fontWeight: 700,
    lineHeight: 1.3,
    letterSpacing: "-0.3px",
  },
  cardSub: {
    margin: 0,
    fontSize: 15,
    lineHeight: 1.65,
    color: TEXT_2,
  },
  btnPrimary: {
    display: "block",
    width: "100%",
    background: ACCENT,
    color: "#fff",
    border: "none",
    borderRadius: 50,
    padding: "16px 0",
    fontSize: 15,
    fontWeight: 600,
    textDecoration: "none",
    textAlign: "center",
    marginTop: 4,
  },
  divider: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    width: "100%",
  },
  dividerLine: {
    flex: 1,
    height: 1,
    background: "rgba(255,255,255,0.07)",
  },
  dividerText: {
    fontSize: 12,
    color: TEXT_3,
    whiteSpace: "nowrap",
  },
  btnGhost: {
    display: "block",
    width: "100%",
    background: "rgba(255,255,255,0.06)",
    color: "#fff",
    border: "1px solid rgba(255,255,255,0.10)",
    borderRadius: 50,
    padding: "16px 0",
    fontSize: 15,
    fontWeight: 600,
    textDecoration: "none",
    textAlign: "center",
  },
  perks: {
    display: "flex",
    gap: 12,
    flexWrap: "wrap",
    justifyContent: "center",
    maxWidth: 420,
  },
  perk: {
    background: SURFACE_2,
    border: "1px solid rgba(255,255,255,0.05)",
    borderRadius: 50,
    padding: "8px 16px",
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  perkIcon: { fontSize: 15 },
  perkText: { fontSize: 13, color: TEXT_2, fontWeight: 500 },
};
