/**
 * SweetSocket rate limiting.
 *
 * Two independent budgets, both per-user and in-memory (per Function
 * instance). In-memory is sufficient: the limits are an anti-flood backstop,
 * not an accounting system — a client that hops instances during reconnect
 * simply gets a fresh budget, and resets are harmless.
 *
 *   - COMMANDS: durable mutations (message.send, chat.history, …).
 *   - RELAYS:   ephemeral signals (typing / presence / chat open-close). The
 *               relay budget ALSO applies a per-(user, channel, event) cooldown
 *               to high-frequency typing signals, so a hostile client cannot
 *               flood the fanout even under the global relay budget.
 */

const COMMAND_WINDOW_MS = 10_000;
const MAX_COMMANDS_PER_WINDOW = 40;

const RELAY_WINDOW_MS = 10_000;
const MAX_RELAYS_PER_WINDOW = 30;
const RELAY_COOLDOWN_MS = 800;
const TYPING_RELAY_TYPES = new Set(["typing:start", "typing.stop", "chat.typing.started"]);

const commandTimestamps = new Map<string, number[]>();
const relayTimestamps = new Map<string, number[]>();
const relayCooldown = new Map<string, number>();

export function consumeCommandRateLimit(userId: string): boolean {
  const now = Date.now();
  const current = (commandTimestamps.get(userId) ?? []).filter((timestamp) => timestamp > now - COMMAND_WINDOW_MS);
  if (current.length >= MAX_COMMANDS_PER_WINDOW) {
    commandTimestamps.set(userId, current);
    return false;
  }
  current.push(now);
  commandTimestamps.set(userId, current);
  return true;
}

export function consumeRelayRateLimit(userId: string, channel: string, eventType: string): boolean {
  const now = Date.now();

  // Per-(user, channel, event) cooldown for the high-frequency signals
  // (typing start) so a hostile client cannot flood the fanout.
  const cooldownKey = `${userId}:${channel}:${eventType}`;
  if (TYPING_RELAY_TYPES.has(eventType)) {
    const last = relayCooldown.get(cooldownKey) ?? 0;
    if (now - last < RELAY_COOLDOWN_MS) return false;
    relayCooldown.set(cooldownKey, now);
  }

  // Global relay budget per user, per window.
  const current = (relayTimestamps.get(userId) ?? []).filter((timestamp) => timestamp > now - RELAY_WINDOW_MS);
  if (current.length >= MAX_RELAYS_PER_WINDOW) {
    relayTimestamps.set(userId, current);
    return false;
  }
  current.push(now);
  relayTimestamps.set(userId, current);
  return true;
}

/** Test-only: clear all in-memory budgets. */
export function resetRateLimitsForTest(): void {
  commandTimestamps.clear();
  relayTimestamps.clear();
  relayCooldown.clear();
}
