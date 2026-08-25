/**
 * emitEvent() — the single publish entry point for the realtime layer.
 *
 * Call it AFTER the authoritative database write, never instead of one.
 * Emission is durable-first (outbox) then local fan-out; it is fire-and-forget
 * and must never break the API response that triggered it.
 */

import { appendEvent, pruneEvents } from "./outbox";
import { fanOut } from "./hub";
import type { EmitInput } from "./types";

export function emitEvent(input: EmitInput): void {
  void (async () => {
    try {
      const event = await appendEvent(input);
      // Same-instance subscribers get the event instantly.
      fanOut(event);
      // Opportunistic pruning — keep reconnect windows bounded.
      if (event.seq % 500 === 0) void pruneEvents().catch(() => {});
    } catch (error) {
      // Never break the API response because of realtime delivery.
      console.error("[realtime] emitEvent failed:", error);
    }
  })();
}

export * from "./types";
