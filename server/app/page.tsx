"use client";

import { useEffect, useState } from "react";

type EnvVar = {
  key: string;
  label: string;
  critical: boolean;
  set: boolean;
  hint?: string;
};

type ServiceHealth = {
  ok: boolean;
  latencyMs?: number;
  error?: string;
  note?: string;
};

type DiagnosticData = {
  server: string;
  version: string;
  timestamp: string;
  environment: string;
  health: {
    database: ServiceHealth;
    jwt: ServiceHealth;
    blob: ServiceHealth;
    email: ServiceHealth;
    payments: ServiceHealth;
  };
  envStatus: EnvVar[];
  missingCritical: string[];
  ready: boolean;
  apiEndpoints: { group: string; endpoints: string[] }[];
};

export default function DiagnosticPage() {
  const [data, setData] = useState<DiagnosticData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"overview" | "env" | "endpoints">("overview");

  useEffect(() => {
    fetch("/api/diagnostic")
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false); })
      .catch((e) => { setError(String(e)); setLoading(false); });
  }, []);

  const refresh = () => {
    setLoading(true);
    setError(null);
    fetch("/api/diagnostic")
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false); })
      .catch((e) => { setError(String(e)); setLoading(false); });
  };

  return (
    <div style={styles.root}>
      <header style={styles.header}>
        <div style={styles.headerInner}>
          <div>
            <div style={styles.logo}>
              <span style={styles.logoIcon}>🍯</span>
              <span style={styles.logoText}>MeetSweet</span>
              <span style={styles.badge}>API Server</span>
            </div>
            <p style={styles.subtitle}>Diagnostic Dashboard — check environment, services, and endpoints</p>
          </div>
          <button onClick={refresh} style={styles.refreshBtn} disabled={loading}>
            {loading ? "Checking…" : "↻ Refresh"}
          </button>
        </div>
      </header>

      <main style={styles.main}>
        {loading && (
          <div style={styles.loadingBox}>
            <div style={styles.spinner} />
            <p style={{ color: "#888", marginTop: 12 }}>Running diagnostics…</p>
          </div>
        )}

        {error && (
          <div style={styles.fatalError}>
            <h2 style={{ margin: "0 0 8px", fontSize: 18 }}>⛔ Server Error</h2>
            <p style={{ margin: 0, fontFamily: "monospace", fontSize: 13 }}>{error}</p>
            <p style={{ margin: "12px 0 0", fontSize: 13, color: "#f88" }}>
              The server may not be running or has a fatal startup error. Check the console/logs.
            </p>
          </div>
        )}

        {data && !loading && (
          <>
            {/* Status banner */}
            <div style={{ ...styles.banner, ...(data.ready ? styles.bannerOk : styles.bannerErr) }}>
              <span style={styles.bannerIcon}>{data.ready ? "✅" : "⚠️"}</span>
              <div>
                <strong>{data.ready ? "Server is operational" : "Server has issues"}</strong>
                <span style={{ marginLeft: 16, fontSize: 13, opacity: 0.85 }}>
                  {data.timestamp} · {data.environment}
                </span>
                {!data.ready && data.missingCritical.length > 0 && (
                  <p style={{ margin: "4px 0 0", fontSize: 13 }}>
                    Missing critical env vars: <code style={styles.code}>{data.missingCritical.join(", ")}</code>
                  </p>
                )}
              </div>
            </div>

            {/* Tabs */}
            <div style={styles.tabs}>
              {(["overview", "env", "endpoints"] as const).map((tab) => (
                <button
                  key={tab}
                  style={{ ...styles.tab, ...(activeTab === tab ? styles.tabActive : {}) }}
                  onClick={() => setActiveTab(tab)}
                >
                  {{ overview: "🔍 Services", env: "🔑 Env Vars", endpoints: "🛣 Endpoints" }[tab]}
                </button>
              ))}
            </div>

            {/* Overview */}
            {activeTab === "overview" && (
              <div style={styles.grid}>
                {Object.entries(data.health).map(([name, svc]) => (
                  <ServiceCard key={name} name={name} svc={svc as ServiceHealth} />
                ))}
              </div>
            )}

            {/* Env vars */}
            {activeTab === "env" && (
              <div style={styles.table}>
                <div style={styles.tableHeader}>
                  <span style={{ flex: 2 }}>Variable</span>
                  <span style={{ flex: 3 }}>Label</span>
                  <span style={{ flex: 1, textAlign: "center" as const }}>Required</span>
                  <span style={{ flex: 1, textAlign: "center" as const }}>Status</span>
                </div>
                {data.envStatus.map((ev) => (
                  <div key={ev.key} style={{ ...styles.tableRow, ...(ev.critical && !ev.set ? styles.tableRowError : {}) }}>
                    <span style={{ flex: 2, fontFamily: "monospace", fontSize: 13 }}>{ev.key}</span>
                    <span style={{ flex: 3, fontSize: 13, color: "#bbb" }}>{ev.label}</span>
                    <span style={{ flex: 1, textAlign: "center" as const, fontSize: 12 }}>
                      {ev.critical ? <span style={{ color: "#f99" }}>required</span> : <span style={{ color: "#888" }}>optional</span>}
                    </span>
                    <span style={{ flex: 1, textAlign: "center" as const }}>
                      {ev.set
                        ? <span style={{ color: "#4ade80", fontSize: 13 }}>✓ set</span>
                        : <span style={{ color: "#f87171", fontSize: 13 }}>✗ missing</span>}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Endpoints */}
            {activeTab === "endpoints" && (
              <div>
                {data.apiEndpoints.map((group) => (
                  <div key={group.group} style={styles.endpointGroup}>
                    <h3 style={styles.groupTitle}>{group.group}</h3>
                    <div style={styles.endpointList}>
                      {group.endpoints.map((ep) => {
                        const [method, ...rest] = ep.trim().split(/\s+/);
                        const path = rest.join(" ");
                        const methodColor: Record<string, string> = {
                          GET: "#34d399", POST: "#60a5fa", PATCH: "#fbbf24",
                          PUT: "#a78bfa", DELETE: "#f87171",
                        };
                        return (
                          <div key={ep} style={styles.endpoint}>
                            <span style={{ ...styles.method, background: (methodColor[method] ?? "#888") + "22", color: methodColor[method] ?? "#888" }}>
                              {method}
                            </span>
                            <code style={styles.path}>{path}</code>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}

function ServiceCard({ name, svc }: { name: string; svc: ServiceHealth }) {
  const label: Record<string, string> = {
    database: "Database (Turso)",
    jwt: "JWT / Auth",
    blob: "Blob Storage",
    email: "Email (Resend)",
    payments: "Payments (Paystack)",
  };
  return (
    <div style={{ ...styles.card, ...(svc.ok ? styles.cardOk : styles.cardErr) }}>
      <div style={styles.cardHeader}>
        <span style={styles.cardIcon}>{svc.ok ? "✅" : "❌"}</span>
        <span style={styles.cardName}>{label[name] ?? name}</span>
      </div>
      {svc.latencyMs !== undefined && (
        <p style={styles.cardMeta}>{svc.latencyMs}ms</p>
      )}
      {svc.error && (
        <p style={styles.cardError}>{svc.error}</p>
      )}
      {svc.note && (
        <p style={styles.cardNote}>{svc.note}</p>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    minHeight: "100vh",
    background: "#0f0f14",
    color: "#e2e8f0",
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  },
  header: {
    background: "#1a1a2e",
    borderBottom: "1px solid #2d2d4e",
    padding: "20px 24px",
  },
  headerInner: {
    maxWidth: 1100,
    margin: "0 auto",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  logo: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginBottom: 6,
  },
  logoIcon: { fontSize: 24 },
  logoText: { fontSize: 22, fontWeight: 700, color: "#fff" },
  badge: {
    fontSize: 11,
    fontWeight: 600,
    background: "#7c3aed22",
    color: "#a78bfa",
    border: "1px solid #7c3aed55",
    borderRadius: 4,
    padding: "2px 8px",
    letterSpacing: "0.5px",
    textTransform: "uppercase" as const,
  },
  subtitle: { margin: 0, fontSize: 13, color: "#888" },
  refreshBtn: {
    background: "#2d2d4e",
    color: "#e2e8f0",
    border: "1px solid #3d3d6e",
    borderRadius: 6,
    padding: "8px 16px",
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 500,
  },
  main: {
    maxWidth: 1100,
    margin: "0 auto",
    padding: "24px",
  },
  loadingBox: {
    textAlign: "center" as const,
    padding: "80px 0",
  },
  spinner: {
    width: 36,
    height: 36,
    border: "3px solid #2d2d4e",
    borderTop: "3px solid #a78bfa",
    borderRadius: "50%",
    animation: "spin 0.8s linear infinite",
    margin: "0 auto",
  },
  fatalError: {
    background: "#2d1515",
    border: "1px solid #7f1d1d",
    borderRadius: 10,
    padding: 20,
    marginBottom: 20,
  },
  banner: {
    display: "flex",
    alignItems: "flex-start",
    gap: 14,
    padding: "14px 18px",
    borderRadius: 8,
    marginBottom: 24,
    border: "1px solid",
  },
  bannerOk: {
    background: "#052e1633",
    borderColor: "#16a34a55",
    color: "#86efac",
  },
  bannerErr: {
    background: "#2d1515",
    borderColor: "#f8717166",
    color: "#fca5a5",
  },
  bannerIcon: { fontSize: 20, lineHeight: 1.4 },
  tabs: {
    display: "flex",
    gap: 4,
    marginBottom: 20,
    borderBottom: "1px solid #2d2d4e",
    paddingBottom: 0,
  },
  tab: {
    background: "none",
    border: "none",
    color: "#888",
    fontSize: 13,
    fontWeight: 500,
    padding: "8px 16px",
    cursor: "pointer",
    borderBottom: "2px solid transparent",
    marginBottom: -1,
    transition: "color 0.15s",
  },
  tabActive: {
    color: "#a78bfa",
    borderBottom: "2px solid #a78bfa",
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
    gap: 16,
  },
  card: {
    background: "#1a1a2e",
    border: "1px solid #2d2d4e",
    borderRadius: 10,
    padding: 18,
  },
  cardOk: { borderColor: "#16a34a44" },
  cardErr: { borderColor: "#f8717155" },
  cardHeader: { display: "flex", alignItems: "center", gap: 10, marginBottom: 8 },
  cardIcon: { fontSize: 18 },
  cardName: { fontWeight: 600, fontSize: 15 },
  cardMeta: { margin: "4px 0 0", fontSize: 12, color: "#4ade80" },
  cardError: {
    margin: "8px 0 0",
    fontSize: 12,
    color: "#f87171",
    background: "#2d1515",
    borderRadius: 4,
    padding: "6px 8px",
    fontFamily: "monospace",
    wordBreak: "break-word" as const,
  },
  cardNote: { margin: "8px 0 0", fontSize: 12, color: "#94a3b8" },
  table: {
    background: "#1a1a2e",
    border: "1px solid #2d2d4e",
    borderRadius: 10,
    overflow: "hidden",
  },
  tableHeader: {
    display: "flex",
    padding: "10px 16px",
    background: "#0f0f14",
    fontSize: 12,
    fontWeight: 600,
    color: "#666",
    borderBottom: "1px solid #2d2d4e",
    textTransform: "uppercase" as const,
    letterSpacing: "0.5px",
  },
  tableRow: {
    display: "flex",
    padding: "11px 16px",
    borderBottom: "1px solid #1e1e30",
    alignItems: "center",
  },
  tableRowError: {
    background: "#2d151522",
  },
  code: {
    fontFamily: "monospace",
    fontSize: 12,
    background: "#ffffff11",
    padding: "2px 6px",
    borderRadius: 3,
  },
  endpointGroup: { marginBottom: 24 },
  groupTitle: {
    fontSize: 14,
    fontWeight: 600,
    color: "#a78bfa",
    margin: "0 0 10px",
    borderBottom: "1px solid #2d2d4e",
    paddingBottom: 8,
  },
  endpointList: {
    background: "#1a1a2e",
    borderRadius: 8,
    border: "1px solid #2d2d4e",
    overflow: "hidden",
  },
  endpoint: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "8px 14px",
    borderBottom: "1px solid #1e1e30",
  },
  method: {
    fontSize: 11,
    fontWeight: 700,
    padding: "2px 7px",
    borderRadius: 3,
    fontFamily: "monospace",
    minWidth: 52,
    textAlign: "center" as const,
  },
  path: {
    fontSize: 13,
    color: "#cbd5e1",
    fontFamily: "monospace",
  },
};
