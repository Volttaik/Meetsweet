/**
 * In-memory sliding-window rate limiter.
 *
 * Keyed by arbitrary strings (e.g. "ip:1.2.3.4", "email:user@example.com").
 * Each bucket holds the timestamps of recent hits; old entries are pruned on
 * every check so memory stays bounded.
 *
 * Note: per-process — effective against the vast majority of abuse, but for
 * multi-instance deployments a Redis-backed limiter would share state across
 * workers. This is the right default for a single-server Replit deployment.
 */

interface Bucket {
  hits: number[];   // Unix timestamps (ms) of recent requests
}

const store = new Map<string, Bucket>();

/** Remove buckets that have been idle for more than 2× their window. */
function pruneStore(windowMs: number) {
  const cutoff = Date.now() - windowMs * 2;
  for (const [key, bucket] of store) {
    if (bucket.hits.length === 0 || bucket.hits[bucket.hits.length - 1] < cutoff) {
      store.delete(key);
    }
  }
}

let pruneCounter = 0;

/**
 * Check and record a rate-limit hit.
 *
 * @param key     Unique key for this limit (e.g. `ip:1.2.3.4`)
 * @param limit   Maximum requests allowed in the window
 * @param windowMs Window size in milliseconds
 * @returns `{ allowed: boolean; remaining: number; resetIn: number }`
 */
export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): { allowed: boolean; remaining: number; resetIn: number } {
  const now = Date.now();
  const cutoff = now - windowMs;

  // Periodic store pruning (every 500 calls)
  if (++pruneCounter % 500 === 0) pruneStore(windowMs);

  let bucket = store.get(key);
  if (!bucket) {
    bucket = { hits: [] };
    store.set(key, bucket);
  }

  // Slide the window: remove hits older than the window
  bucket.hits = bucket.hits.filter((t) => t > cutoff);

  if (bucket.hits.length >= limit) {
    const oldestHit = bucket.hits[0];
    const resetIn = Math.ceil((oldestHit + windowMs - now) / 1000);
    return { allowed: false, remaining: 0, resetIn };
  }

  bucket.hits.push(now);
  return { allowed: true, remaining: limit - bucket.hits.length, resetIn: 0 };
}

/** Convenience: check TWO keys simultaneously (e.g. IP + email). */
export function rateLimitMulti(
  checks: Array<{ key: string; limit: number; windowMs: number }>,
): { allowed: boolean; remaining: number; resetIn: number } {
  for (const { key, limit, windowMs } of checks) {
    const result = rateLimit(key, limit, windowMs);
    if (!result.allowed) return result;
  }
  return { allowed: true, remaining: Infinity, resetIn: 0 };
}

// ── Predefined limits ────────────────────────────────────────────────────────

const MIN = 60_000;
const HOUR = 60 * MIN;

/** Login: 10 attempts / 15 min per IP; 5 attempts / 15 min per email */
export function loginLimit(ip: string, email: string) {
  return rateLimitMulti([
    { key: `login:ip:${ip}`,    limit: 10, windowMs: 15 * MIN },
    { key: `login:email:${email}`, limit: 5, windowMs: 15 * MIN },
  ]);
}

/** Register: 5 accounts / hour per IP */
export function registerLimit(ip: string) {
  return rateLimit(`register:ip:${ip}`, 5, HOUR);
}

/** Forgot-password: 5 / 15 min per IP; 3 / hour per email */
export function forgotPasswordLimit(ip: string, email: string) {
  return rateLimitMulti([
    { key: `forgot:ip:${ip}`,     limit: 5, windowMs: 15 * MIN },
    { key: `forgot:email:${email}`, limit: 3, windowMs: HOUR },
  ]);
}

/** Resend-verification: 5 / 15 min per IP; 3 / hour per email */
export function resendVerificationLimit(ip: string, email: string) {
  return rateLimitMulti([
    { key: `resend:ip:${ip}`,     limit: 5, windowMs: 15 * MIN },
    { key: `resend:email:${email}`, limit: 3, windowMs: HOUR },
  ]);
}

/** Verify-email: 10 / 15 min per IP */
export function verifyEmailLimit(ip: string) {
  return rateLimit(`verify:ip:${ip}`, 10, 15 * MIN);
}

/** Generic API abuse guard: 200 requests / min per IP (all non-auth routes) */
export function apiLimit(ip: string) {
  return rateLimit(`api:ip:${ip}`, 200, MIN);
}

/** Helper: extract client IP from a Next.js request */
export function getClientIp(req: { headers: { get(name: string): string | null } }): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown"
  );
}

/** Helper: return a 429 response with Retry-After header */
export function tooManyRequests(resetIn: number): Response {
  return new Response(
    JSON.stringify({ error: "Too many requests. Please try again later." }),
    {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(resetIn),
      },
    },
  );
}
