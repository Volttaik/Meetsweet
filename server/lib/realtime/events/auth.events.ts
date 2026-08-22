export const AUTH_EVENTS = {
  connected: "auth:connected",
  authenticated: "auth:authenticated",
  sessionExpired: "auth:session:expired",
  logout: "auth:logout",
  disconnected: "auth:disconnected",
} as const;

export type AuthEvent = typeof AUTH_EVENTS[keyof typeof AUTH_EVENTS];
