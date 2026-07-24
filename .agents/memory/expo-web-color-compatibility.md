---
name: Expo web color compatibility
description: Native Expo web preview behavior for shared Uniwind and HeroUI theme colors.
---

Shared theme CSS is consumed by the Expo web preview and native-style color parsing. Use broadly supported hex color literals rather than OKLCH values in those shared tokens.

**Why:** The preview rendered a blank screen and logged a color conversion error while the app bundle itself was healthy.

**How to apply:** When adding or changing shared theme variables in `global.css`, prefer hex or rgba values that React Native and the web preview both accept.