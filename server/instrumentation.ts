/**
 * Server startup hook (Next.js instrumentation).
 *
 * `ws` (loaded by @vercel/functions' WebSocket upgrade AND by @libsql's
 * isomorphic-ws transport) tries to load the optional native addons
 * `bufferutil` and `utf-8-validate` at module load. Next.js's server bundler
 * cannot bundle native `.node` binaries, so those requires resolve to EMPTY
 * stubs instead of throwing. `ws` then swaps its pure-JS `unmask`/`mask` for
 * wrappers that call the missing native functions, and every masked client
 * frame >= 32 bytes crashes the realtime route with:
 *
 *     TypeError: b.unmask is not a function
 *         at a.exports.unmask
 *         at p.getData ...
 *
 * These env vars force the pure-JavaScript implementations (the officially
 * documented `ws` behavior — see the ws README "Usage with bundlers"). They
 * must be set BEFORE any application module evaluates, because `ws` is loaded
 * transitively by `@libsql/client` during route-module evaluation (via
 * `@libsql/hrana-client` -> `@libsql/isomorphic-ws`), before any route body
 * statements run. `register()` runs before the server starts accepting
 * requests, so this is the earliest possible point in the process.
 *
 * Set the same two values in the Vercel project environment as well, so every
 * function instance starts clean even if this hook is skipped for any reason.
 */
export async function register() {
  process.env.WS_NO_BUFFER_UTIL = "1";
  process.env.WS_NO_UTF_8_VALIDATE = "1";
}
