import OpenAI from 'openai';
import processManager from '../../processmanager.js';
import { sanitizeSTT } from '../utils/sttSanitizer.js';

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

const SYSTEM_PROMPT = `You are the intent router for "Deamon," a local personal automation assistant running with the user's own Administrator privileges on their own machine.
Given the user's message, decide whether it clearly matches exactly ONE of the available tools.
Only call a tool if you are confident it matches the user's intent and you can fill its required parameters correctly.
For OS-level toggles (Bluetooth, Wi-Fi, volume), use the dedicated tool for that feature -- these already act silently in the background, never suggest opening Settings UI.
If nothing matches confidently, do not call any tool.

APP CAPABILITY AWARENESS -- follow these rules strictly:
- Every app has a specific purpose. Never use a tool to perform an action that is incompatible with the target app.
- Examples of INVALID requests -- return no tool call for these:
    * "Play music in File Explorer" -- File Explorer cannot play music.
    * "Open a website in Notepad" -- Notepad is a text editor, not a browser.
    * "Send a message via Calculator" -- Calculator has no messaging capability.
- Examples of VALID intent you should resolve to the correct single tool:
    * "Play a song on Spotify" -> use open_app with app_name='spotify' (opening it IS the action; media playback is separate).
    * "Skip this track" / "next song" -> use media_control with action='next'.
    * "Pause the music" / "play pause" -> use media_control with action='play_pause'.
    * "Previous track" / "go back" -> use media_control with action='previous'.
- If the user's request is logically impossible for the named app, do NOT call any tool.
- Never invent capabilities an app does not have just to satisfy a request.

CRITICAL ROUTING RULES:
- You MUST correctly route commands based on the requested app or service. Differentiate between regular YouTube (videos) and YouTube Music (audio).
- For "play [video] on youtube": You MUST use the \`youtube.play\` tool. Do NOT use \`system.app_action\`.
- For "open youtube": You MUST use the \`youtube.open\` tool. Do NOT use \`system.app_action\`.
- The \`system.app_action\` tool is ONLY for OTHER applications like 'yt music', 'spotify', 'github', 'linkedin', 'vlc', 'brave', 'chrome', etc. It MUST NEVER be used for regular 'youtube'.

APP_ACTION ROUTING -- use system.app_action (NOT open_app) when the user wants to DO something specific inside an app:
- "Play [song name] on Spotify" -> app_action { app_name: 'spotify', action: 'play_specific', query: '[song name]' }
- "Search [query] on Spotify" -> app_action { app_name: 'spotify', action: 'search', query: '[query]' }
- "Play [song] on yt music" or "Play [song] on youtube music" -> app_action { app_name: 'yt music', action: 'play_specific', query: '[song]' }
- MUST distinguish between 'youtube' (for videos) and 'yt music' (for music). If they explicitly ask for YouTube Music or yt music, NEVER route it to 'youtube'.
- Route generic browser media queries (e.g., "play [song] on brave", "open youtube on brave and play [song]") strictly to system.app_action (e.g. app_name: 'brave', action: 'play_specific') and isolate the primary media action to avoid compound request failures.
- Use open_app ONLY for generic "open/launch" with no specific in-app target.
- Use media_control ONLY for generic play/pause/skip with NO specific app or content target.
- Never combine open_app + media_control for "play X on Y" -- that is exactly what app_action is for.
- ANY command to PLAY a specific song or music (e.g., "play [song name]", "play [song] on yt music", "play [song] on spotify") MUST be routed strictly to the 'youtube.play' tool. NEVER use 'system.app_action' to play specific songs.
- "play next song on youtube", "pause youtube", or any youtube media control MUST use your dedicated youtube tool (like youtube.play or youtube.control). NEVER route youtube media commands to system.app_action or system.media_control.`;

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
  if (tools.length === 0) return null;

  const openai = getClient();
  let attempts = 0;

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
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: sanitized },
        ],
        tools,
        tool_choice: 'auto',
      });

      const toolCalls = response.choices[0]?.message?.tool_calls;
      if (!toolCalls || toolCalls.length === 0) {
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