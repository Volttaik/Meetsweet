import { NextResponse, type NextRequest } from "next/server";

// Routes that bypass the X-Client-App-Id check entirely
const PUBLIC_BYPASS = new Set([
  "/api/health",
  "/api/healthz",
  "/api/diagnostic",
  // Vercel Cron — the renewal endpoint validates its own CRON_SECRET header
  // before doing any work, but it must not be rejected here for lacking the
  // mobile client app-id header.
  "/api/cron/renew-subscriptions",
]);

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isPublicShareLookup =
    req.method === "GET" &&
    (pathname === "/api/shares" || pathname.startsWith("/api/shares/"));

  // ── OPTIONS preflight — return CORS headers immediately ─────────────────
  if (req.method === "OPTIONS") {
    return new NextResponse(null, {
      status: 204,
      headers: corsHeaders(),
    });
  }

  // ── X-Client-App-Id guard ────────────────────────────────────────────────
  // Rejects requests that don't carry the expected client identifier.
  // This is a lightweight first-line defence against naked/scripted access;
  // JWT auth on each route is the real auth layer.
  //
  // Requests that already carry a Bearer token are passed through — the JWT
  // check inside requireAuth() is the real security gate for those routes.
  // This handles upload/media flows where the HTTP client may not attach the
  // app-id header but does include the user's auth token.
  const clientAppId = process.env.CLIENT_APP_ID ?? "meetsweet-mobile";
  const sentId = req.headers.get("x-client-app-id");
  const hasBearerToken = req.headers.get("authorization")?.startsWith("Bearer ");
  if (
    !PUBLIC_BYPASS.has(pathname) &&
    !isPublicShareLookup &&
    sentId !== clientAppId &&
    !hasBearerToken
  ) {
    return new NextResponse(
      JSON.stringify({ error: "Forbidden" }),
      {
        status: 403,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders(),
        },
      },
    );
  }

  // ── Normal response with security + CORS headers ─────────────────────────
  const res = NextResponse.next();
  applyHeaders(res);
  return res;
}

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-App-Id",
    "Access-Control-Max-Age": "86400",
  };
}

function applyHeaders(res: NextResponse) {
  // CORS
  for (const [k, v] of Object.entries(corsHeaders())) res.headers.set(k, v);

  // Prevent MIME sniffing
  res.headers.set("X-Content-Type-Options", "nosniff");

  // Deny framing (clickjacking)
  res.headers.set("X-Frame-Options", "DENY");

  // Legacy XSS filter (belt-and-suspenders for old browsers)
  res.headers.set("X-XSS-Protection", "1; mode=block");

  // Referrer
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");

  // Feature policy — this is a backend API; no camera/mic/geo needed
  res.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");

  // HSTS — tell browsers to always use HTTPS (1 year, include subdomains)
  res.headers.set(
    "Strict-Transport-Security",
    "max-age=31536000; includeSubDomains; preload",
  );

  // Content-Security-Policy — API only; no inline scripts/styles needed
  res.headers.set(
    "Content-Security-Policy",
    "default-src 'none'; frame-ancestors 'none'",
  );
}

export const config = {
  matcher: "/api/:path*",
};
