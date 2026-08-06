---
name: Imported mobile archive limitation
description: What the available MeetSweet import contains when mobile verification is requested
---

The attached MeetSweet archive available in this workspace contains another server project, not the Expo/mobile source referenced by the backend handoff.

**Why:** Mobile-specific files such as API helpers, notification context, and the share deep-link screen cannot be safely edited or verified from that archive.

**How to apply:** When mobile integration is requested from this workspace, validate the server contract here, then ask for or work in the actual mobile repository before claiming client-side completion.