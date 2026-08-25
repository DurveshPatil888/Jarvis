/**
 * COMMAND_REGISTRY
 * -----------------------------------------------------------------
 * This is the SECOND security boundary in this system. powers.config.js
 * whitelists WHICH scripts can be forked; this whitelists WHICH commands
 * can be sent into an already-running one, and what parameters each
 * command accepts.
 *
 * Consumers, deliberately:
 *   1. ProcessManager.sendCommand() -- refuses to dispatch anything not
 *      listed here, regardless of who's asking (a UI button, a socket
 *      client, or an LLM-generated tool call).
 *   2. AIRouter -- converts these entries into the tool/function
 *      definitions handed to the LLM, so the model can only ever
 *      select a command that genuinely exists. It cannot invent one.
 *   3. AIRouter's META_COMMANDS map -- "system" has no forked child
 *      process behind it (see AIRouter.js), but it's whitelisted here
 *      like everything else so the LLM's tool list and the validation
 *      logic both stay generic instead of special-casing it twice.
 *
 * This file lives in src/powers/ (not src/router/) intentionally --
 * it's shared config both layers depend on, not an AI-specific
 * concept. ProcessManager must never import anything from src/router/.
 */
export const COMMAND_REGISTRY = {
  whatsapp: {
    label: 'WhatsApp Forwarder',
    commands: {
      send_test_message: {
        description:
          'Sends a diagnostic message to yourself to confirm the bot can send messages. No real-world side effects beyond your own chat.',
        parameters: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
      send_message: {
        description:
          "Sends a WhatsApp message to a contact, resolved dynamically by fuzzy name match from the user's real WhatsApp contact list. Always sends to the best match found, even if the name is ambiguous.",
        parameters: {
          type: 'object',
          properties: {
            target_name: {
              type: 'string',
              description:
                "The contact's name as saved in the user's phone, e.g. 'Rahul' or 'Mom'.",
            },
            message_text: {
              type: 'string',
              description:
                "The exact message body to send, in the user's own words.",
            },
          },
          required: ['target_name', 'message_text'],
        },
      },
      smart_reply: {
        description:
          "Reads the contact's most recent inbound message and drafts a short, casual reply using AI, written in the user's voice. Matches phrasings like 'reply to X', 'send reply to X', 'sent reply to X', 'give reply to X', 'text X back', 'text back to X', 'reply back to X', 'respond to X'. This does NOT send anything -- it only prepares a draft. Use confirm_reply afterward, in a separate step, to actually send it.",
        parameters: {
          type: 'object',
          properties: {
            target_name: {
              type: 'string',
              description:
                'The contact whose last message should be read and replied to.',
            },
          },
          required: ['target_name'],
        },
      },
      confirm_reply: {
        description:
          "Sends the most recently drafted smart_reply for a contact. Matches phrasings like 'confirm reply to X', 'send it', 'send that', 'confirm that', 'send the reply', 'go ahead and send it'. Only works if smart_reply was already run for that contact and produced a pending draft -- this is always a separate, explicit follow-up command, never automatic.",
        parameters: {
          type: 'object',
          properties: {
            target_name: {
              type: 'string',
              description:
                'The contact whose pending draft should be sent now.',
            },
          },
          required: ['target_name'],
        },
      },
    },
  },

  youtube: {
    label: 'YouTube Control',
    commands: {
      open: {
        description:
          "Opens or refocuses YouTube's homepage in the automation browser.",
        parameters: { type: 'object', properties: {}, required: [] },
      },
      play: {
        description:
          "Searches YouTube for the given query and plays the first video result. If the user does not specify a song/video, DO NOT fail -- generate a sensible default query yourself (e.g. 'trending music', 'coding lofi', 'top hits 2026') so this command always succeeds.",
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description:
                "What to search for, e.g. 'cyberpunk synthwave mix'. If the user didn't specify one, fill this with a reasonable default yourself -- never leave it empty.",
            },
          },
          required: ['query'],
        },
      },
      pause: {
        description: 'Pauses the currently playing YouTube video.',
        parameters: { type: 'object', properties: {}, required: [] },
      },
      resume: {
        description: 'Resumes a currently paused YouTube video.',
        parameters: { type: 'object', properties: {}, required: [] },
      },
      next: {
        description: 'Skips to the next video or song on YouTube.',
        parameters: { type: 'object', properties: {}, required: [] },
      },
      previous: {
        description: 'Goes back to the previous video or song on YouTube.',
        parameters: { type: 'object', properties: {}, required: [] },
      },
    },
  },

  system: {
    label: 'System',
    commands: {
      get_status: {
        description:
          'Reports which powers/workers are currently active, stopped, awaiting auth, or crashed.',
        parameters: { type: 'object', properties: {}, required: [] },
      },
      open_app: {
        description:
          "Opens/launches any application by name. Matches 'open X', 'launch X', 'start X', 'X khol'. Pass the app name as spoken, e.g. 'spotify', 'chrome', 'discord', 'notepad'. The system will resolve and launch it dynamically.",
        parameters: {
          type: 'object',
          properties: {
            app_name: {
              type: 'string',
              description:
                "The name of the app to open, exactly as spoken by the user, e.g. 'spotify', 'vs code', 'brave browser'.",
            },
          },
          required: ['app_name'],
        },
      },
      close_app: {
        description:
          "Forcefully closes/kills any running application by name. Matches 'close X', 'kill X', 'quit X', 'band kar X', 'X close kar'. Pass the app name as spoken. The system will find and terminate the matching process.",
        parameters: {
          type: 'object',
          properties: {
            app_name: {
              type: 'string',
              description:
                "The name of the app to close, exactly as spoken by the user, e.g. 'spotify', 'chrome', 'notepad'.",
            },
          },
          required: ['app_name'],
        },
      },
      lock_screen: {
        description:
          "Locks the Windows screen immediately. Matches 'lock screen', 'lock pc', 'lock my computer', 'PC lock kar', 'lock the system'.",
        parameters: { type: 'object', properties: {}, required: [] },
      },
      set_volume: {
        description:
          "Sets system volume to a percentage. Matches 'set volume to X', 'volume X percent', 'volume full kar' (=100), 'volume off/mute' (=0), 'turn it up/down'.",
        parameters: {
          type: 'object',
          properties: {
            percent: {
              type: 'number',
              description:
                "Target volume 0-100. 'full'/'max' = 100, 'mute'/'off' = 0.",
            },
          },
          required: ['percent'],
        },
      },
      set_bluetooth: {
        description:
          "Turns Bluetooth on or off silently, no Settings UI. Matches 'turn on/off bluetooth', 'bluetooth on/off', 'bluetooth chalu/band kar'.",
        parameters: {
          type: 'object',
          properties: {
            state: {
              type: 'string',
              enum: ['on', 'off'],
              description: 'Target Bluetooth state.',
            },
          },
          required: ['state'],
        },
      },
      set_wifi: {
        description:
          "Turns Wi-Fi on or off silently, no Settings UI. Matches 'turn on/off wifi', 'wifi on/off', 'wifi chalu/band kar'.",
        parameters: {
          type: 'object',
          properties: {
            state: {
              type: 'string',
              enum: ['on', 'off'],
              description: 'Target Wi-Fi state.',
            },
          },
          required: ['state'],
        },
      },
      media_control: {
        description:
          "Controls media playback globally (works with Spotify, YouTube, Windows Media Player, any active media). Matches 'play', 'pause', 'play/pause', 'next song/track', 'previous song/track', 'skip', 'go back'. Maps: play/pause → play_pause, skip/next → next, back/previous → previous.",
        parameters: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: ['play_pause', 'next', 'previous'],
              description:
                "Media action: 'play_pause' toggles play/pause, 'next' skips to next track, 'previous' goes to previous track.",
            },
          },
          required: ['action'],
        },
      },
      app_action: {
        description:
          "Performs a SPECIFIC IN-APP action, deeper than just opening or closing. Use this when the user asks to DO something INSIDE an app with a specific target. Examples: 'play [song] on Spotify', 'search [query] on YouTube', 'play [song] on YouTube'. Parameters: app_name (the app), action ('play_specific' for named song/video, 'search' for a search query, 'media_control' for play/pause/next/prev), query (the search term or song name). Do NOT use this for generic 'open/close' commands -- use open_app/close_app instead. Do NOT use this for generic media controls without a target -- use media_control instead.",
        parameters: {
          type: 'object',
          properties: {
            app_name: {
              type: 'string',
              description: "Target app, e.g. 'spotify', 'youtube', 'vlc'.",
            },
            action: {
              type: 'string',
              enum: ['play_specific', 'search', 'media_control'],
              description:
                "'play_specific': play a named song/video. 'search': open a search for the query. 'media_control': send a media key (requires query = play_pause | next | previous).",
            },
            query: {
              type: 'string',
              description:
                'The song name, search term, or media_control sub-action (play_pause / next / previous). Required for play_specific and search; required for media_control.',
            },
          },
          required: ['app_name', 'action'],
        },
      },
    },
  },

  research: {
    label: 'Research & Calculation',
    commands: {
      fast_math: {
        description:
          "Instantly evaluates mathematical expressions (e.g. 'square of 25', '15% of 200', '5 * 5'). Gives direct calculation results bypassing heavy search.",
        parameters: {
          type: 'object',
          properties: {
            expression: {
              type: 'string',
              description:
                'The mathematical expression to evaluate, exactly as spoken or in standard math notation.',
            },
          },
          required: ['expression'],
        },
      },
      quick_search: {
        description:
          "Searches the web for general knowledge, history, facts, or current events (e.g. 'Who was Shivaji Maharaj?', 'Capital of France'). Returns short, factual answers.",
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'The search query to look up on the web.',
            },
          },
          required: ['query'],
        },
      },
    },
  },
};
