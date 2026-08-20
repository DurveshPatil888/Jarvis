import pkg from 'whatsapp-web.js';
import qrcode from 'qrcode';
import path from 'path';
import { fileURLToPath } from 'url';
import { rm } from 'fs/promises';
import OpenAI from 'openai';

const { Client, LocalAuth } = pkg;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// shared by both the LocalAuth constructor below and clearInvalidSession() --
// keeping these as single constants means the two can never drift apart
const CLIENT_ID = 'command-center';
const AUTH_DATA_PATH = path.join(__dirname, '../../.wwebjs_auth');

/**
 * whatsapp.worker.js
 * -----------------------------------------------------------------
 * Runs as an isolated child process (see ProcessManager#start). If this
 * process's Chromium instance segfaults, hangs, or gets banned/logged
 * out, it dies alone -- Express/Socket.io and every other power keep
 * running. That isolation is the entire reason this is a fork, not
 * in-process code.
 *
 * IPC CONTRACT this worker follows (see ProcessManager child.on("message")):
 *   [worker -> parent]
 *   process.send({ type: "ready" })                    -> fully authenticated, session live
 *   process.send({ type: "qr", qr: "<data:image/png..>" }) -> needs a scan, ProcessManager
 *                                                             flips status to AWAITING_QR
 *   process.send({ type: "log", level, message })       -> any log line
 *
 *   [parent -> worker]
 *   process.on("message", { type: "command", command, payload }) -> see COMMAND_HANDLERS below.
 *   This is the same shape the YouTube/Puppeteer worker will reuse -- proving it here
 *   once means the pattern doesn't need re-deciding for the next worker.
 *
 *   process.on("SIGTERM", ...) -> clean up, then process.exit(0)
 *
 * Auth/session failures now self-heal ONE step before handing off to
 * ProcessManager: they wipe the invalid LocalAuth session directory so
 * the NEXT restart hits a genuinely clean slate and falls through to
 * QR generation, instead of repeatedly trying (and failing) to restore
 * the same dead session. ProcessManager still owns the actual
 * crash-detection + capped-restart decision -- this worker just makes
 * sure that restart has a chance of succeeding instead of looping.
 */

process.send?.({
  type: 'log',
  level: 'info',
  message: 'launching whatsapp-web.js client...',
});

/**
 * Deletes the LocalAuth session folder for this client. Safe to call
 * even if the folder doesn't exist (force: true). This is what turns
 * "auth failed, retry the exact same broken state" into "auth failed,
 * retry from zero" -- the actual fix for the crash loop.
 *
 * Note: this assumes whatsapp-web.js's LocalAuth internal folder
 * naming convention (`session-<clientId>`), which is version-
 * dependent and not part of its public API. If a future library
 * version changes this, the symptom would be the crash loop
 * returning -- worth a quick check of node_modules/whatsapp-web.js's
 * LocalAuth source if that ever happens again.
 */
async function clearInvalidSession(reason) {
  const sessionDir = path.join(AUTH_DATA_PATH, `session-${CLIENT_ID}`);
  try {
    await rm(sessionDir, { recursive: true, force: true });
    process.send?.({
      type: 'log',
      level: 'warn',
      message: `cleared invalid session (${reason}) -- next restart will request a fresh QR`,
    });
  } catch (err) {
    process.send?.({
      type: 'log',
      level: 'error',
      message: `failed to clear session directory: ${err.message}`,
    });
  }
}

const client = new Client({
  authStrategy: new LocalAuth({
    clientId: CLIENT_ID,
    // session tokens persist here across restarts so you only scan
    // the QR once, not on every fork. This folder holds live
    // credentials -- see the .gitignore note below.
    dataPath: AUTH_DATA_PATH,
  }),
  puppeteer: {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  },
});

client.on('qr', async (qr) => {
  try {
    // raw QR is just a string -- encode it to a base64 PNG so the
    // frontend can render it directly as <img src={qr}> with zero
    // QR-rendering logic of its own.
    const qrDataUrl = await qrcode.toDataURL(qr);
    process.send?.({ type: 'qr', qr: qrDataUrl });
    process.send?.({
      type: 'log',
      level: 'warn',
      message: 'QR code generated, awaiting scan',
    });
  } catch (err) {
    process.send?.({
      type: 'log',
      level: 'error',
      message: `failed to encode QR: ${err.message}`,
    });
  }
});

client.on('authenticated', () => {
  process.send?.({
    type: 'log',
    level: 'success',
    message: 'authenticated, restoring session...',
  });
});

client.on('ready', () => {
  process.send?.({
    type: 'log',
    level: 'success',
    message: 'client ready, listening for messages',
  });
  process.send?.({ type: 'ready' });
});

// RECEIVE proof: every inbound message gets logged live to the dashboard
// terminal. This is deliberately just visibility for now -- the real
// auto-forward routing logic (which chats get forwarded, to where) is
// a separate feature to build once I/O itself is confirmed working.
client.on('message', (message) => {
  const preview = message.body?.slice(0, 80) || '[non-text message]';
  process.send?.({
    type: 'log',
    level: 'info',
    message: `INBOUND :: from ${message.from} :: "${preview}"`,
  });
});

client.on('auth_failure', async (msg) => {
  process.send?.({
    type: 'log',
    level: 'error',
    message: `auth failure: ${msg}`,
  });
  await clearInvalidSession('auth_failure');
  process.exit(1); // let ProcessManager's crash/restart handling take over
});

client.on('disconnected', async (reason) => {
  process.send?.({
    type: 'log',
    level: 'error',
    message: `session disconnected: ${reason}`,
  });
  // a manual logout from the phone surfaces here (reason is typically
  // "LOGOUT" or "NAVIGATION" depending on version) -- treat it the
  // same as auth_failure, since the local session is equally invalid
  await clearInvalidSession(`disconnected: ${reason}`);
  process.exit(1);
});

client.initialize();

// SEND proof: parent-triggered commands. Keyed by command name so this
// scales cleanly -- adding "send_message" with a real target later is
// just another case here, not a new IPC mechanism.
/**
 * Strips spaces, emoji, and punctuation, lowercases, but keeps letters
 * from ANY script (Devanagari, etc.) via Unicode property escapes --
 * a plain [^a-z0-9] filter would incorrectly strip non-Latin names.
 */
function normalize(str) {
  return (str || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

/**
 * resolveContact
 * -----------------------------------------------------------------
 * Dynamically searches the user's real WhatsApp contacts by name --
 * no static whitelist, no ambiguity check. Always returns the top
 * scored match unconditionally, even with multiple equal matches.
 *
 * Scoring (substring-based, on normalized strings):
 *   exact match       -> 3
 *   name starts with  -> 2
 *   name includes      -> 1
 * Only contacts with isMyContact=true are considered.
 */
async function resolveContact(targetName) {
  if (!targetName || typeof targetName !== 'string') {
    throw new Error('target_name missing or invalid');
  }
  const needle = normalize(targetName);
  if (!needle) {
    throw new Error('target_name was empty after normalization');
  }

  const allContacts = await client.getContacts();
  const candidates = allContacts.filter(
    (c) => c.isMyContact && (c.name || c.pushname)
  );

  const scored = candidates
    .map((c) => {
      const rawName = c.name || c.pushname || '';
      const normName = normalize(rawName);
      let score = 0;
      if (normName === needle) score = 3;
      else if (normName.startsWith(needle)) score = 2;
      else if (normName.includes(needle)) score = 1;
      return { contact: c, name: rawName, score };
    })
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    throw new Error(`no saved contact matching "${targetName}" found`);
  }

  return scored[0];
}

// -----------------------------------------------------------------
// Smart Reply: reads the last inbound message from a contact, drafts
// a reply via a direct Groq call, and holds it as a PENDING draft --
// it is never sent automatically. confirm_reply is a separate,
// explicit command that actually dispatches it. See the reasoning at
// the top of this response for why that split exists: the LLM is
// composing words that will appear to come from the user, sent to a
// real person who has no way to know it wasn't actually them typing --
// that's the one step kept manual regardless of how aggressive
// everything else here is.
// -----------------------------------------------------------------

let groqClient = null;
function getGroqClient() {
  if (!groqClient) {
    groqClient = new OpenAI({
      apiKey: process.env.LLM_API_KEY,
      baseURL: process.env.LLM_BASE_URL || undefined,
    });
  }
  return groqClient;
}

async function generateReply(lastMessageText) {
  const model = process.env.LLM_MODEL || 'llama3-8b-8192';
  if (!process.env.LLM_API_KEY) {
    throw new Error(
      'LLM_API_KEY is not set -- smart_reply cannot call Groq without it'
    );
  }
  const openai = getGroqClient();

  let response;
  try {
    response = await openai.chat.completions.create({
      model,
      messages: [
        {
          role: 'system',
          content:
            'You are drafting a WhatsApp reply on behalf of the user, in their voice. Keep it very short and casual, like a real text message. Reply with ONLY the message text -- no quotes, no explanation, no extra commentary.',
        },
        {
          role: 'user',
          content: `They just texted: "${lastMessageText}"\n\nWrite my reply.`,
        },
      ],
    });
  } catch (err) {
    throw new Error(
      `Groq chat completion request failed: ${err?.message || err}`
    );
  }

  const text = response.choices[0]?.message?.content?.trim();
  if (!text) throw new Error('Groq returned an empty reply');
  return text;
}

// contactId -> { text, contactName, draftedAt }
const pendingReplies = new Map();
const MAX_DRAFT_AGE_MS = 15 * 60 * 1000; // a 15-minute-old draft is probably stale context, regenerate instead

const COMMAND_HANDLERS = {
  send_test_message: async () => {
    const self = client.info?.wid?._serialized;
    if (!self) {
      throw new Error(
        'client.info not populated yet -- is the session actually ready?'
      );
    }
    await client.sendMessage(
      self,
      '🟢 Command Center I/O test -- if you see this, send works.'
    );
  },

  send_message: async ({ target_name, message_text }) => {
    if (typeof message_text !== 'string' || !message_text.trim()) {
      throw new Error('message_text missing or empty');
    }

    const match = await resolveContact(target_name);

    // logged BEFORE sending, on purpose -- this is the visibility net
    // that replaces the static whitelist. You always see exactly who
    // Deamon resolved the name to, live in the terminal, before the
    // message goes out.
    process.send?.({
      type: 'log',
      level: 'info',
      message: `resolved "${target_name}" -> ${match.name} (${match.contact.id._serialized})`,
    });

    await client.sendMessage(match.contact.id._serialized, message_text);
    process.send?.({ type: 'ai_speak', text: 'Message fired' });
  },

  smart_reply: async ({ target_name }) => {
    const match = await resolveContact(target_name);
    const contactId = match.contact.id._serialized;

    let chat;
    try {
      chat = await client.getChatById(contactId);
    } catch (err1) {
      // getChatById fails with an unhelpful internal error most often
      // when there's no existing conversation thread with this contact
      // yet -- try the contact's own getChat() as a fallback path
      try {
        chat = await match.contact.getChat();
      } catch (err2) {
        throw new Error(
          `failed to load chat for ${match.name} (getChatById: ${err1?.message || err1}; ` +
            `getChat fallback: ${err2?.message || err2}) -- most likely cause: no existing ` +
            `WhatsApp conversation with this contact yet`
        );
      }
    }

    let messages;
    try {
      messages = await chat.fetchMessages({ limit: 5 });
    } catch (err) {
      throw new Error(
        `failed to fetch messages for ${match.name}: ${err?.message || err}`
      );
    }

    const lastInbound = [...messages].reverse().find((m) => !m.fromMe);
    if (!lastInbound) {
      throw new Error(
        `no recent inbound message from ${match.name} to reply to`
      );
    }

    const draft = await generateReply(lastInbound.body || '[non-text message]');
    pendingReplies.set(contactId, {
      text: draft,
      contactName: match.name,
      draftedAt: Date.now(),
    });

    process.send?.({
      type: 'log',
      level: 'success',
      message: `DRAFT_READY :: reply to ${match.name} -- "${draft}" -- say "confirm reply to ${match.name}" to send it`,
    });
    process.send?.({
      type: 'ai_speak',
      text: 'Draft ready, waiting for confirm',
    });
  },

  confirm_reply: async ({ target_name }) => {
    const match = await resolveContact(target_name);
    const contactId = match.contact.id._serialized;

    const pending = pendingReplies.get(contactId);
    if (!pending) {
      throw new Error(
        `no pending draft for ${match.name} -- run smart_reply first`
      );
    }
    if (Date.now() - pending.draftedAt > MAX_DRAFT_AGE_MS) {
      pendingReplies.delete(contactId);
      throw new Error(
        `draft for ${match.name} is stale (>15min old) -- run smart_reply again`
      );
    }

    await client.sendMessage(contactId, pending.text);
    pendingReplies.delete(contactId);

    process.send?.({
      type: 'log',
      level: 'success',
      message: `sent confirmed reply to ${pending.contactName}: "${pending.text}"`,
    });
    process.send?.({ type: 'ai_speak', text: 'Reply sent' });
  },
};

process.on('message', async (msg) => {
  if (msg?.type !== 'command') return;

  const handler = COMMAND_HANDLERS[msg.command];
  if (!handler) {
    process.send?.({
      type: 'log',
      level: 'error',
      message: `unknown command "${msg.command}"`,
    });
    return;
  }

  try {
    await handler(msg.payload ?? {});
    process.send?.({
      type: 'log',
      level: 'success',
      message: `command "${msg.command}" completed`,
    });
  } catch (err) {
    const detail =
      err instanceof Error ? err.stack || err.message : String(err);
    process.send?.({
      type: 'log',
      level: 'error',
      message: `command "${msg.command}" failed: ${detail}`,
    });
  }
});

// Chromium close can genuinely take several seconds, especially with a
// large profile -- but we still need a hard ceiling so a hung destroy()
// can't leave us waiting forever. This must stay comfortably UNDER
// ProcessManager's KILL_GRACE_MS (see ProcessManager.js), or the outer
// SIGKILL fires before this handler finishes its own cleanup, defeating
// the whole point.
const SHUTDOWN_TIMEOUT_MS = 6000;

process.on('SIGTERM', async () => {
  process.send?.({
    type: 'log',
    level: 'warn',
    message: 'received SIGTERM, closing client...',
  });

  // grab a direct handle to the underlying Chromium OS process BEFORE
  // calling destroy() -- if destroy() hangs or the WhatsApp-level close
  // doesn't fully tear down the process tree (the actual root cause of
  // the Windows zombie-lock bug), this is our fallback path to force it.
  const browserProcess = client.pupBrowser?.process?.() ?? null;

  const destroyPromise = client.destroy().catch((err) => {
    process.send?.({
      type: 'log',
      level: 'error',
      message: `client.destroy() threw: ${err.message}`,
    });
  });

  const timedOut = await Promise.race([
    destroyPromise.then(() => false),
    new Promise((resolve) =>
      setTimeout(() => resolve(true), SHUTDOWN_TIMEOUT_MS)
    ),
  ]);

  if (timedOut) {
    process.send?.({
      type: 'log',
      level: 'warn',
      message: `client.destroy() did not resolve within ${SHUTDOWN_TIMEOUT_MS}ms, forcing browser shutdown...`,
    });
  }

  // belt-and-suspenders: force-kill the actual Chromium process if it's
  // still alive, regardless of whether destroy() reported success. This
  // is what actually releases the profile's SingletonLock file -- relying
  // on client.destroy() alone, or on the parent Node process exiting,
  // does not reliably terminate Chromium's own subprocess tree on Windows.
  //
  // Note: `client.pupBrowser` is an internal/undocumented whatsapp-web.js
  // property, not part of its public API -- same category of caveat as
  // the session folder naming in clearInvalidSession() above. If a future
  // library version restructures this, the symptom would be zombie
  // processes returning, and this is the first place to check.
  if (
    browserProcess &&
    browserProcess.exitCode === null &&
    !browserProcess.killed
  ) {
    process.send?.({
      type: 'log',
      level: 'warn',
      message: 'force-killing lingering Chromium process...',
    });
    browserProcess.kill('SIGKILL');
  }

  process.send?.({
    type: 'log',
    level: 'info',
    message: 'shutdown complete, releasing session lock',
  });
  process.exit(0);
});
