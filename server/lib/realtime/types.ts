/**
 * Durable persistence types used by the outbox and cross-instance bus.
 * Transport messages and event names live under sweet-socket/.
 */
export interface RealtimeEvent {
  id: string;
  seq: number | null;
  type: string;
  channel: string;
  ts: string;
  resourceId?: string;
  userId?: string;
  payload: Record<string, unknown>;
}

export interface EmitOptions {
  type: string;
  channel: string;
  resourceId?: string;
  userId?: string;
  payload?: Record<string, unknown>;
  durable?: boolean;
}
