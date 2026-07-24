export default function Home() {
  return (
    <main style={{ fontFamily: "sans-serif", padding: "2rem" }}>
      <h1>MeetSweet API</h1>
      <p>
        Serverless backend for the MeetSweet mobile app. See{" "}
        <a href="/api/healthz">/api/healthz</a> for status.
      </p>
    </main>
  );
}
