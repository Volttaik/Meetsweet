"use client";

import { useEffect, useState } from "react";
import { GRADIENT_BUTTON } from "@/lib/frontend/brand";

export default function ReferralPage({ params }: { params: Promise<{ code: string }> }) {
  const [code, setCode] = useState("");
  const [opened, setOpened] = useState(false);

  useEffect(() => {
    params.then(({ code: raw }) => {
      const normalized = raw.trim().toUpperCase();
      setCode(normalized);
      const ua = navigator.userAgent;
      if (/android/i.test(ua)) {
        const fallback = `${window.location.origin}/r/${encodeURIComponent(normalized)}?noapp=1`;
        window.location.href = `intent://r/${encodeURIComponent(normalized)}#Intent;scheme=meetsweet;package=com.meetsweet.app;S.browser_fallback_url=${encodeURIComponent(fallback)};end`;
      } else if (!/iPad|iPhone|iPod/i.test(ua)) {
        window.location.href = `meetsweet://r/${encodeURIComponent(normalized)}`;
      } else {
        setOpened(true);
      }
      const timer = setTimeout(() => setOpened(true), 1600);
      return () => clearTimeout(timer);
    });
  }, [params]);

  return (
    <main style={styles.page}>
      <div style={styles.card}>
        <img
          src="/meetsweet-logo-white.png"
          alt="MeetSweet"
          width={64}
          height={64}
          style={styles.logo}
        />
        <h1 style={styles.title}>{opened ? "Join MeetSweet" : "Opening MeetSweet…"}</h1>
        <p style={styles.body}>
          {code ? `You were invited with referral code ${code}.` : "Your creator invitation is ready."}
          {" "}Your referral attribution will be attached when you register.
        </p>
        <a style={styles.primary} href={code ? `meetsweet://r/${encodeURIComponent(code)}` : "meetsweet://"}>Open in MeetSweet</a>
        <a style={styles.secondary} href={`/?referral=${encodeURIComponent(code)}`}>Install MeetSweet</a>
      </div>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { minHeight: "100vh", background: "#0C0C0F", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, fontFamily: "system-ui, sans-serif" },
  card: { maxWidth: 420, width: "100%", background: "#161619", border: "1px solid rgba(255,255,255,.08)", borderRadius: 24, padding: 32, textAlign: "center" },
  logo: { width: 64, height: 64, margin: "0 auto 18px", display: "block" },
  title: { fontSize: 24, margin: "0 0 12px" },
  body: { color: "rgba(255,255,255,.6)", lineHeight: 1.6, margin: "0 0 24px" },
  primary: { display: "block", padding: "14px 18px", borderRadius: 999, ...GRADIENT_BUTTON, textDecoration: "none", fontWeight: 700, marginBottom: 10 },
  secondary: { display: "block", padding: "14px 18px", borderRadius: 999, background: "rgba(255,255,255,.08)", color: "#fff", textDecoration: "none", fontWeight: 600 },
};
