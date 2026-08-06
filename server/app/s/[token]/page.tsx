import type { Metadata } from "next";
import { headers } from "next/headers";

type ContentType = "post" | "video" | "short" | "album" | "creator";

type ShareData = {
  content_type: ContentType;
  content_id: string;
  token: string;
  expires_at?: string | null;
};

const CONTENT_META: Record<
  ContentType,
  { label: string; icon: string; description: string; deepLinkPath: string }
> = {
  post:    { label: "Post",     icon: "📸", description: "someone shared a post with you",     deepLinkPath: "/post"    },
  video:   { label: "Video",    icon: "🎬", description: "someone shared a video with you",    deepLinkPath: "/videos"  },
  short:   { label: "Short",   icon: "🎞️", description: "someone shared a short with you",    deepLinkPath: "/shorts"  },
  album:   { label: "Album",   icon: "🗂️", description: "someone shared an album with you",   deepLinkPath: "/album"   },
  creator: { label: "Creator", icon: "⭐",  description: "someone shared a creator with you", deepLinkPath: "/creator" },
};

async function resolveShare(token: string): Promise<ShareData | null> {
  try {
    const h = await headers();
    const host = h.get("host") ?? "meetsweet.space";
    const proto = h.get("x-forwarded-proto") ?? "https";
    const baseUrl = `${proto}://${host}`;

    const res = await fetch(`${baseUrl}/api/shares/${encodeURIComponent(token)}`, {
      cache: "no-store",
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { ok: boolean; data: ShareData };
    if (!json.ok) return null;
    return json.data;
  } catch {
    return null;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  const share = await resolveShare(token);

  if (!share) {
    return {
      title: "Link not found — MeetSweet",
      description: "This MeetSweet link has expired or no longer exists.",
    };
  }

  const meta = CONTENT_META[share.content_type] ?? CONTENT_META.post;
  return {
    title: `MeetSweet ${meta.label}`,
    description: `Open this ${meta.label.toLowerCase()} in the MeetSweet app.`,
    openGraph: {
      title: `MeetSweet ${meta.label}`,
      description: `Open this ${meta.label.toLowerCase()} in the MeetSweet app.`,
      siteName: "MeetSweet",
      type: "website",
    },
    twitter: {
      card: "summary",
      title: `MeetSweet ${meta.label}`,
      description: `Open this ${meta.label.toLowerCase()} in the MeetSweet app.`,
    },
  };
}

export default async function SharePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const share = await resolveShare(token);

  if (!share) return <NotFound />;

  const meta = CONTENT_META[share.content_type] ?? CONTENT_META.post;

  // Deep link URI — opens the app if installed
  let deepLink = `meetsweet://s/${token}`;

  return (
    <main style={s.page}>
      {/* Ambient background */}
      <div style={s.gradient} aria-hidden="true" />

      {/* Nav */}
      <nav style={s.nav}>
        <a href="/" style={s.brand}>MeetSweet</a>
      </nav>

      <section style={s.center}>
        {/* Content card */}
        <div style={s.card}>
          <div style={s.iconWrap}>
            <span style={s.icon}>{meta.icon}</span>
          </div>

          <span style={s.contentTypeBadge}>{meta.label}</span>
          <h1 style={s.cardTitle}>Someone shared a {meta.label.toLowerCase()} with you</h1>
          <p style={s.cardSub}>
            Open MeetSweet to see this {meta.label.toLowerCase()} and interact with the creator.
          </p>

          {/* Primary CTA — deep link, opens app if installed */}
          <a href={deepLink} style={s.btnPrimary}>
            Open in MeetSweet
          </a>

          {/* Divider */}
          <div style={s.divider}>
            <div style={s.dividerLine} />
            <span style={s.dividerText}>Don't have the app?</span>
            <div style={s.dividerLine} />
          </div>

          {/* Download CTA */}
          <a href="/#download" style={s.btnGhost}>
            Download MeetSweet
          </a>
        </div>

        {/* What you'll get */}
        <div style={s.perks}>
          {PERKS.map((p) => (
            <div key={p.text} style={s.perk}>
              <span style={s.perkIcon}>{p.icon}</span>
              <span style={s.perkText}>{p.text}</span>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

function NotFound() {
  return (
    <main style={s.page}>
      <div style={s.gradient} aria-hidden="true" />
      <nav style={s.nav}>
        <a href="/" style={s.brand}>MeetSweet</a>
      </nav>
      <section style={s.center}>
        <div style={s.card}>
          <div style={s.iconWrap}>
            <span style={s.icon}>🔗</span>
          </div>
          <h1 style={s.cardTitle}>Link not found</h1>
          <p style={s.cardSub}>
            This MeetSweet link has expired or no longer exists. Ask the creator to share it again.
          </p>
          <a href="/" style={s.btnPrimary}>Go to MeetSweet</a>
        </div>
      </section>
    </main>
  );
}

const PERKS = [
  { icon: "🎬", text: "Exclusive creator content" },
  { icon: "💳", text: "Subscribe to your favourites" },
  { icon: "💬", text: "Direct messages with creators" },
];

const ACCENT = "#C45A72";
const BG = "#0C0C0F";
const SURFACE = "#161619";
const SURFACE_2 = "#1E1E24";
const TEXT_2 = "rgba(255,255,255,0.55)";
const TEXT_3 = "rgba(255,255,255,0.32)";

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
    background:
      "radial-gradient(ellipse 80% 50% at 50% -10%, rgba(196,90,114,0.2) 0%, transparent 60%)",
    pointerEvents: "none",
    zIndex: 0,
  },
  nav: {
    position: "relative",
    zIndex: 10,
    padding: "20px 24px",
    borderBottom: "1px solid rgba(255,255,255,0.05)",
    backdropFilter: "blur(12px)",
    backgroundColor: "rgba(12,12,15,0.6)",
  },
  brand: {
    fontSize: 20,
    fontWeight: 700,
    color: "#fff",
    textDecoration: "none",
    letterSpacing: "-0.5px",
  },
  center: {
    position: "relative",
    zIndex: 1,
    minHeight: "calc(100vh - 65px)",
    display: "flex",
    flexDirection: "column" as const,
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
    flexDirection: "column" as const,
    alignItems: "center",
    textAlign: "center" as const,
    gap: 16,
    boxShadow: "0 24px 64px rgba(0,0,0,0.4), 0 0 0 1px rgba(196,90,114,0.08)",
  },
  iconWrap: {
    width: 72,
    height: 72,
    borderRadius: 22,
    background: `linear-gradient(135deg, rgba(196,90,114,0.25) 0%, rgba(196,90,114,0.08) 100%)`,
    border: "1px solid rgba(196,90,114,0.2)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  icon: { fontSize: 32 },
  contentTypeBadge: {
    background: "rgba(196,90,114,0.15)",
    color: ACCENT,
    borderRadius: 50,
    padding: "4px 14px",
    fontSize: 12,
    fontWeight: 600,
    letterSpacing: "0.06em",
    textTransform: "uppercase" as const,
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
    textAlign: "center" as const,
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
    whiteSpace: "nowrap" as const,
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
    textAlign: "center" as const,
  },
  perks: {
    display: "flex",
    gap: 12,
    flexWrap: "wrap" as const,
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
