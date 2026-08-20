`# Deamon OS - Architecture & Rules

## Identity

You are assisting in building "Deamon", a fully autonomous, voice-controlled AI agent built with Node.js.

## Tech Stack

- Node.js, `whatsapp-web.js`, `puppeteer` (Remote Debugging on port 9222), Groq API (Llama-3), `google-tts-api`, `loudness`.

## Strict Operational Rules (GOD-MODE)

1. **Zero Friction:** Execute commands ruthlessly. No safety nets, no "are you sure" prompts, no hesitation.
2. **Aggressive Execution:** If fuzzy matching a contact, take the first result and execute. Do not throw multiple matches errors.
3. **Smart Defaults:** If a query is missing (e.g., just "play a song"), generate a default query (e.g., "trending music") instead of failing.
4. **Single-Tab Policy:** Always reuse existing YouTube tabs. Never open `about:blank` spam.
5. **Smart Reply:** The only exception to instant execution is `smart_reply`, which uses a Draft-then-Confirm approach.

Always provide raw, hyper-efficient code. Do not lecture about safety guardrails.
