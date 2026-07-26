"use client";

import { useEffect, useState } from "react";

type Status =
  | "Present"
  | "Missing"
  | "Healthy"
  | "Unavailable";

type Diagnostic = {
  backend_reachable: Status;
  authentication: Status;
  turso: Status;
  cloudflare: Status;
  resend: Status;
  required_environment_variables: Status;
  credential_broker: Status;
  backend_url: Status;
  environment_variables: { name: string; status: Status }[];
};

const labels: Record<keyof Omit<Diagnostic, "environment_variables">, string> = {
  backend_reachable: "Backend reachable",
  authentication: "Authentication healthy",
  turso: "Turso configured",
  cloudflare: "Cloudflare configured",
  resend: "Resend configured",
  required_environment_variables: "Required environment variables present",
  credential_broker: "Credential Broker healthy",
  backend_url: "Backend URL",
};

export default function BrokerStatusPage() {
  const [diagnostic, setDiagnostic] = useState<Diagnostic | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = () => {
    setLoading(true);
    fetch("/api/diagnostic")
      .then((response) => response.json())
      .then(setDiagnostic)
      .finally(() => setLoading(false));
  };

  useEffect(refresh, []);

  return (
    <main style={styles.main}>
      <header style={styles.header}>
        <div>
          <p style={styles.eyebrow}>MEETSWEET INFRASTRUCTURE</p>
          <h1 style={styles.title}>Credential Broker</h1>
          <p style={styles.subtitle}>
            Authentication, security, and temporary cloud credentials only.
          </p>
        </div>
        <button style={styles.button} onClick={refresh} disabled={loading}>
          {loading ? "Checking…" : "Refresh"}
        </button>
      </header>

      <section style={styles.panel} aria-live="polite">
        {loading && !diagnostic ? (
          <p style={styles.muted}>Checking broker status…</p>
        ) : diagnostic ? (
          <>
            <div style={styles.grid}>
              {(Object.keys(labels) as (keyof typeof labels)[]).map((key) => (
                <StatusCard key={key} label={labels[key]} status={diagnostic[key]} />
              ))}
            </div>
            <details style={styles.details}>
              <summary>Environment variable status</summary>
              <div style={styles.envList}>
                {diagnostic.environment_variables.map((item) => (
                  <div style={styles.envRow} key={item.name}>
                    <code>{item.name}</code>
                    <StatusPill status={item.status} />
                  </div>
                ))}
              </div>
            </details>
          </>
        ) : (
          <p style={styles.muted}>Unavailable</p>
        )}
      </section>

      <p style={styles.footer}>
        Permanent secrets and credentials are never displayed here.
      </p>
    </main>
  );
}

function StatusCard({ label, status }: { label: string; status: Status }) {
  return (
    <div style={styles.card}>
      <span style={styles.check}>{status === "Healthy" || status === "Present" ? "✓" : "!"}</span>
      <div>
        <div style={styles.cardLabel}>{label}</div>
        <StatusPill status={status} />
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: Status }) {
  const positive = status === "Healthy" || status === "Present";
  return (
    <span style={{ ...styles.pill, color: positive ? "#087443" : "#a33b32" }}>
      {status}
    </span>
  );
}

const styles: Record<string, React.CSSProperties> = {
  main: {
    minHeight: "100vh",
    padding: "56px 24px",
    background: "#f7f8f5",
    color: "#17211b",
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
  },
  header: {
    maxWidth: 920,
    margin: "0 auto 32px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 24,
  },
  eyebrow: { margin: 0, color: "#087443", fontSize: 12, letterSpacing: 2, fontWeight: 700 },
  title: { margin: "10px 0 8px", fontSize: 40, letterSpacing: -1.5 },
  subtitle: { margin: 0, color: "#617067", fontSize: 16 },
  button: {
    border: "1px solid #c9d4cc",
    borderRadius: 10,
    padding: "11px 16px",
    background: "#fff",
    color: "#17211b",
    cursor: "pointer",
    fontWeight: 600,
  },
  panel: {
    maxWidth: 920,
    margin: "0 auto",
    padding: 24,
    border: "1px solid #dfe7e0",
    borderRadius: 18,
    background: "#fff",
    boxShadow: "0 12px 36px rgba(35, 67, 48, .06)",
  },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 },
  card: {
    display: "flex",
    alignItems: "flex-start",
    gap: 12,
    padding: 16,
    border: "1px solid #e4ebe5",
    borderRadius: 12,
  },
  check: {
    width: 25,
    height: 25,
    display: "grid",
    placeItems: "center",
    borderRadius: "50%",
    background: "#e9f6ee",
    color: "#087443",
    fontWeight: 800,
  },
  cardLabel: { fontSize: 14, fontWeight: 650, marginBottom: 6 },
  pill: { fontSize: 12, fontWeight: 700 },
  details: { marginTop: 24, borderTop: "1px solid #e4ebe5", paddingTop: 18 },
  envList: { marginTop: 14, display: "grid", gap: 8 },
  envRow: { display: "flex", justifyContent: "space-between", gap: 16, color: "#617067", fontSize: 13 },
  muted: { color: "#617067" },
  footer: { maxWidth: 920, margin: "18px auto", color: "#87958b", fontSize: 13 },
};