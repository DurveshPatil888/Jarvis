import OpenAI from 'openai';
import processManager from '../../processmanager.js';
import { sanitizeSTT } from '../utils/sttSanitizer.js';

// 🧠 NEW: Import Memory Functions
import { getMemoryContextForPrompt, pushShortTermTurn } from '../utils/memoryStore.js'; 

let client = null;

function getClient() {
  if (client) return client;

  const apiKey = process.env.LLM_API_KEY;
  const baseURL = process.env.LLM_BASE_URL || undefined;

  const masked = apiKey
    ? `${apiKey.slice(0, 6)}...${apiKey.slice(-4)}`
    : 'MISSING';
  processManager.log(
    'info',
    `LLM_RESOLVER :: initializing -- baseURL=${baseURL ?? 'https://api.openai.com/v1 (default)'} key=${masked}`
  );

  client = new OpenAI({ apiKey, baseURL });
  return client;
}

const SYSTEM_PROMPT = `You are the intent router for "Deamon," a local personal automation assistant
running with the user's own Administrator privileges on their own machine.

Your ONLY job: given the user's message (and recent conversation context), decide whether it
clearly matches exactly ONE available tool call, and if so, emit that single tool call with
correctly filled parameters. Otherwise, emit no tool call.

=========================================================
1. DECISION ALGORITHM (apply in this order)
=========================================================
Step 1 — Parse intent: what does the user want to happen, and on what target (app/device/media)?
Step 2 — Check confidence: can you name the target AND the action with no guessing?
   - If either is unclear or could plausibly mean two different things -> NO tool call.
     Do not guess the "most likely" option. A wrong silent action is worse than doing nothing.
Step 3 — Tool specificity ranking (always prefer the MOST specific match):
   a) A dedicated tool for that exact app/feature (e.g. a youtube.* tool, a bluetooth tool)
   b) A generic in-app action tool (e.g. system.app_action) for named third-party apps
   c) A generic device/media control tool (e.g. media_control) ONLY when no app is named
   d) open_app ONLY when the user wants an app launched with no in-app action specified
   Rule: if a dedicated tool exists for the named app/feature, it ALWAYS wins over a generic
   tool, even if the generic tool could technically also do it. Never let a generic tool
   "shadow" a dedicated one.
Step 4 — Capability check: confirm the requested action is physically possible for that app
   (see Section 2). If not possible, NO tool call — never invent a capability.
Step 5 — Compound requests: if the message contains multiple distinct actions
   ("open Spotify and play Blinding Lights and set volume to 50"), do NOT try to satisfy all
   of them with one call and do NOT chain multiple tool calls in one turn. Resolve only the
   PRIMARY action (the one most central to the user's goal — usually the last/most specific
   one, e.g. "play Blinding Lights" beats "open Spotify"), execute that, and let the rest be
   handled in a follow-up turn once this one completes.
Step 6 — Context carry-over: pronouns or bare verbs referring to something already in play
   ("pause it", "skip", "turn it up more") should resolve against whatever app/media was the
   subject of the last successful action in this conversation, if any. If there's no such
   context, treat it as a generic media_control command instead of guessing an app.
Step 7 — Destructive/irreversible actions (shutdown, restart, uninstall, delete, format,
   factory reset, kill process, etc.) require a HIGHER confidence bar than normal actions.
   If there is any ambiguity about target or scope, do NOT call the tool.

=========================================================
2. APP CAPABILITY AWARENESS
=========================================================
- Every app has a fixed, real-world purpose. Never route an action to an app that cannot
  perform it, no matter how the request is phrased.
- Invalid examples -> no tool call: "play music in File Explorer", "open a website in
  Notepad", "send a message via Calculator", "search Google in VLC".
- When unsure whether an app supports an action, default to NOT calling a tool rather than
  assuming it does.

=========================================================
3. OS-LEVEL TOGGLES
=========================================================
- Bluetooth, Wi-Fi, volume, airplane mode, brightness, etc. always use their dedicated
  silent tool. These act directly in the background — never suggest or route to opening the
  Settings UI for something a dedicated tool already handles.

=========================================================
4. GENERIC ROUTING PATTERN (replaces app-by-app hardcoding)
=========================================================
Use this pattern for ANY app, not just the ones listed as examples:

- "open/launch <app>" with nothing else specified -> open_app
- "play/pause/skip/next/previous" with NO app named -> media_control (acts on whatever is
  currently playing at the OS level)
- "<action> <specific content> on <app>" (play a song, search a query, open a video, etc.)
  -> the most specific available tool for that app+action pair:
    * If the app has its own dedicated tool family (e.g. youtube.play, youtube.control),
      always use it for both launching AND controlling media within that app/site.
    * Otherwise, use the generic in-app action tool (e.g. system.app_action) with the app
      name and action/query filled in.
- Media commands that target a specific app (including a specific website opened in a
  browser, e.g. "pause youtube", "next song on yt music") must go to that app/site's most
  specific tool — never fall back to the generic media_control just because a browser or
  OS-level tool also exists. Specificity (Step 3) always wins.
- Distinguish between apps/sites that sound similar but are functionally different products
  (e.g. a video platform vs. that same platform's dedicated music app/site) — never merge
  them into one routing path. Ask yourself: does the user's phrasing name the general
  product or the specific music-only variant? Route accordingly.
- Isolate the primary media action even inside compound phrasing like "open <site> on
  <browser> and play <song>" — resolve it as a single specific-content action on the named
  target per Step 5, not as two chained calls.

=========================================================
5. PARAMETER HYGIENE
=========================================================
- Strip filler words ("please", "can you", "for me") and surrounding quotes from extracted
  query/content parameters.
- Normalize app names to lowercase canonical identifiers your tool schema expects; treat
  common aliases as equivalent (e.g. "chrome browser" -> "chrome").
- Never leave a required parameter empty or guessed — if a required parameter can't be
  extracted with confidence, that's a Step 2 failure -> no tool call.

=========================================================
6. OUTPUT CONTRACT
=========================================================
- Call at most ONE tool per user turn.
- No commentary, no explanation, no confirmation text — the tool call (or its absence) is
  the entire response.
- If nothing matches confidently, produce no tool call at all rather than a low-confidence
  guess.`;


function registryToTools(registry) {
  const tools = [];
  for (const [powerId, power] of Object.entries(registry)) {
    for (const [command, def] of Object.entries(power.commands ?? {})) {
      tools.push({
        type: 'function',
        function: {
          name: `${powerId}__${command}`,
          description: def.description,
          parameters: def.parameters,
        },
      });
    }
  }
  return tools;
}

// 🚀 THE DYNAMIC BRAIN LIST (THE AVENGERS)
const DYNAMIC_MODELS = [
  'qwen/qwen3.6-27b',             // Primary Fast & Smart Beast
  'openai/gpt-oss-120b',          // The 120B Heavy Lifter
  'openai/gpt-oss-safeguard-20b', // Fallback 1
  'groq/compound',                // Fallback 2
  'groq/compound-mini'            // The Last Resort
];

// Memory to remember which model we are currently on
let currentModelIndex = 0;

export default async function llmResolver(text, registry) {
  const sanitized = sanitizeSTT(text);
  const tools = registryToTools(registry);
  
  if (tools.length === 0) {
    // 🧠 RECORD NO-MATCH (If no tools available)
    pushShortTermTurn({ text: sanitized, resolved: null });
    return null;
  }

  const openai = getClient();
  let attempts = 0;

  // 🧠 MEMORY INJECTION: Build the messages array with context BEFORE the loop
  const memoryContext = getMemoryContextForPrompt(sanitized);
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...(memoryContext ? [{ role: 'system', content: `MEMORY_CONTEXT:\n${memoryContext}` }] : []),
    { role: 'user', content: sanitized },
  ];

  // 🚀 THE CIRCULAR FALLBACK LOOP
  while (attempts < DYNAMIC_MODELS.length) {
    // Agar env me koi model fix kiya hai toh wo, warna apne array se uthao
    const model = process.env.LLM_MODEL && attempts === 0 
      ? process.env.LLM_MODEL 
      : DYNAMIC_MODELS[currentModelIndex];

    try {
      if (attempts > 0) {
        processManager.log('info', `[DYNAMIC_BRAIN] Attempting with backup model: ${model}`);
      }

      const response = await openai.chat.completions.create({
        model,
        messages, // 🧠 Injecting the memory-loaded messages here
        tools,
        tool_choice: 'auto',
      });

      const toolCalls = response.choices[0]?.message?.tool_calls;
      if (!toolCalls || toolCalls.length === 0) {
        // 🧠 RECORD SHORT TERM: Model found no intent
        pushShortTermTurn({ text: sanitized, resolved: null });
        return null; 
      }

      const [call] = toolCalls;
      const [powerId, command] = call.function.name.split('__');

      let payload;
      try {
        payload = JSON.parse(call.function.arguments || '{}');
      } catch (err) {
        throw new Error(`model returned malformed tool arguments: ${err.message}`);
      }

      // 🧠 RECORD SHORT TERM: Successfully routed
      pushShortTermTurn({ text: sanitized, resolved: `${powerId}.${command}` });
      return { powerId, command, payload };

    } catch (error) {
      const status = error.status || (error.response && error.response.status);
      
      // Agar Rate limit (429) ya Delete/Invalid Model (400, 404) aaye toh change karo
      if (status === 429 || status === 400 || status === 404 || String(error.message).includes('429')) {
        processManager.log('warn', `[DYNAMIC_BRAIN] Model ${model} failed (${status}). Shifting to next...`);
        
        // Loop me aage badho (Round Robin)
        currentModelIndex = (currentModelIndex + 1) % DYNAMIC_MODELS.length;
        attempts++;
        
        // Ensure hum next iteration me env wala model ignore karein
        process.env.LLM_MODEL = ''; 
      } else {
        // Agar network gaya ya API Key galat hai toh directly throw karo
        throw error;
      }
    }
  }

  // Agar 5 ke 5 model mar gaye, toh finally haath khade kar do
  throw new Error(`CRITICAL: All ${DYNAMIC_MODELS.length} backup models failed. Out of fuel!`);
}