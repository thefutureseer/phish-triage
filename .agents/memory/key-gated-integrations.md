---
name: Key-gated integrations
description: Product behavior for features that depend on external API keys.
---

When a feature needs an API key that is not configured, clicking it should open a Coming Soon page and explain what still works. Do not present fabricated output as if it came from the user's input.

**Why:** the user requested this behavior for the Phish Intake Analyzer.

**How to apply:** For vendor-backed features, check provider availability before enabling the action; keep credentials server-side and return an explicit unavailable response if the API is called without configuration.
