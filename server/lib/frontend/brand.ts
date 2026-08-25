import type { CSSProperties } from "react";

/**
 * MeetSweet brand tokens shared by every server-rendered page.
 *
 * The platform gradient matches the mobile app's `AppGradients.brand`
 * (MeetSweet-mobile/.../constants/theme.ts): amber → pink → orchid → plum →
 * violet, flowing from top-right (amber) to bottom-left (violet). The server
 * frontend uses the same visual language as the app.
 */

export const BRAND = {
  amber: "#FF8C00",
  pink: "#FF1493",
  orchid: "#B521C4",
  plum: "#8E0E9E",
  violet: "#800080",
} as const;

/** Diagonal platform gradient (amber top-right → violet bottom-left). */
export const BRAND_GRADIENT =
  "linear-gradient(135deg, #FF8C00 0%, #FF1493 20%, #B521C4 45%, #8E0E9E 72%, #800080 100%)";

/** Solid surface + text tokens (dark theme, matching the app's dark mode). */
export const BG = "#0C0C0F";
export const SURFACE = "#161619";
export const SURFACE_2 = "#1E1E24";
export const TEXT_2 = "rgba(255,255,255,0.55)";
export const TEXT_3 = "rgba(255,255,255,0.28)";

/** Ambient glows derived from the gradient (pink/amber/violet at low opacity). */
export const GLOW_TOP =
  "radial-gradient(ellipse 80% 50% at 50% -10%, rgba(255,20,147,0.16) 0%, transparent 60%)";
export const GLOW_AMBER =
  "radial-gradient(ellipse 55% 40% at 88% -5%, rgba(255,140,0,0.13) 0%, transparent 60%)";
export const GLOW_CENTER =
  "radial-gradient(circle, rgba(255,20,147,0.06) 0%, transparent 70%)";
export const GLOW_CARD =
  "radial-gradient(circle, rgba(255,20,147,0.15) 0%, transparent 65%)";

/**
 * Gradient text (e.g. accents, wordmarks). Degrades to a solid hot pink where
 * `background-clip: text` is unsupported.
 */
export function gradientText(): CSSProperties {
  return {
    backgroundImage: BRAND_GRADIENT,
    WebkitBackgroundClip: "text",
    backgroundClip: "text",
    color: BRAND.pink,
    WebkitTextFillColor: "transparent",
  };
}

/** Primary button surface: platform gradient with white label. */
export const GRADIENT_BUTTON: CSSProperties = {
  backgroundImage: BRAND_GRADIENT,
  color: "#fff",
  boxShadow: "0 8px 24px rgba(255,20,147,0.28)",
};

/** Small tinted chip (badges, pills) in the gradient family. */
export function gradientChip(opacity = 0.16): CSSProperties {
  return {
    background: `linear-gradient(135deg, rgba(255,140,0,${opacity}) 0%, rgba(255,20,147,${opacity}) 45%, rgba(128,0,128,${opacity}) 100%)`,
  };
}
