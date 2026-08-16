/**
 * Resolve a creator's base subscription price from the authoritative sources.
 *
 * `creator_settings.subscription_price` is NOT NULL with default 0, so a bare
 * `settings.subscription_price ?? legacyPrice` would silently mask a legacy
 * `profiles.subscription_price` with 0 whenever a creator_settings row exists
 * but hasn't been priced yet (rows are auto-created on "become creator").
 *
 * Only a positive settings price is authoritative; otherwise fall back to the
 * legacy profile price (itself 0 for a genuinely free creator). Use this in
 * every place the price is advertised or charged so the value is identical
 * across profile, list, and subscribe.
 */
export function resolveBasePrice(
  settingsPrice: number | null | undefined,
  legacyPrice: number | null | undefined,
): number {
  if (typeof settingsPrice === "number" && settingsPrice > 0) return settingsPrice;
  return typeof legacyPrice === "number" && legacyPrice > 0 ? legacyPrice : 0;
}
