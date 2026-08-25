import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "../../data");
const DB_PATH = path.join(DATA_DIR, "deamon-memory.db");

/**
 * memoryStore.js
 * -----------------------------------------------------------------
 * Lives in the MAIN process only. Workers never touch this file or
 * the DB directly -- they send { type: "remember", key, value } over
 * IPC, same as they already send "log"/"ai_speak", and ProcessManager
 * relays it here.
 */

const MAX_SHORT_TERM_TURNS = 5;
const MAX_FACTS_INJECTED = 5;
const MAX_CONTEXT_CHARS = 800; // ~200 tokens, generous but bounded

let db = null;

// deliberately NOT persisted -- see file header
const shortTermBuffer = [];

export function initMemoryStore() {
  if (db) return db; // idempotent, safe to call more than once

  fs.mkdirSync(DATA_DIR, { recursive: true });
  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL"); // safer if the process gets killed abruptly

  db.exec(`
    CREATE TABLE IF NOT EXISTS facts (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  return db;
}

function requireDb() {
  if (!db) {
    throw new Error("memoryStore.initMemoryStore() must be called once at server boot before use");
  }
  return db;
}

// ---- long-term facts (SQLite, persisted) -----------------------------

export function rememberFact(key, value) {
  if (!key || typeof key !== "string") {
    throw new Error("fact key must be a non-empty string");
  }
  const stmt = requireDb().prepare(`
    INSERT INTO facts (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `);
  stmt.run(key.trim().toLowerCase(), String(value ?? ""), Date.now());
}

export function recallFact(key) {
  const row = requireDb()
    .prepare(`SELECT value FROM facts WHERE key = ?`)
    .get((key || "").trim().toLowerCase());
  return row ? row.value : null;
}

export function forgetFact(key) {
  requireDb().prepare(`DELETE FROM facts WHERE key = ?`).run((key || "").trim().toLowerCase());
}

export function listFacts() {
  return requireDb()
    .prepare(`SELECT key, value, updated_at FROM facts ORDER BY updated_at DESC`)
    .all();
}

/**
 * Lightweight keyword-overlap relevance search -- NOT embeddings/RAG.
 */
function recallRelevantFacts(queryText, limit = MAX_FACTS_INJECTED) {
  const queryWords = new Set(
    (queryText || "").toLowerCase().split(/\W+/).filter((w) => w.length > 2)
  );
  if (queryWords.size === 0) return [];

  const scored = listFacts()
    .map((fact) => {
      const factWords = new Set(`${fact.key} ${fact.value}`.toLowerCase().split(/\W+/));
      let overlap = 0;
      for (const w of queryWords) if (factWords.has(w)) overlap++;
      return { fact, overlap };
    })
    .filter((s) => s.overlap > 0)
    .sort((a, b) => b.overlap - a.overlap);

  return scored.slice(0, limit).map((s) => s.fact);
}

// ---- short-term buffer (in-memory, not persisted) ---------------------

export function pushShortTermTurn(turn) {
  shortTermBuffer.push({ ...turn, at: Date.now() });
  while (shortTermBuffer.length > MAX_SHORT_TERM_TURNS) shortTermBuffer.shift();
}

export function getShortTermTurns() {
  return [...shortTermBuffer];
}

// ---- prompt assembly ----------------------------------------------------

/**
 * Builds ONE compact context block for injection into the LLM call.
 */
export function getMemoryContextForPrompt(currentText) {
  const facts = recallRelevantFacts(currentText);
  const turns = getShortTermTurns();

  const lines = [];

  if (turns.length > 0) {
    lines.push("Recent turns:");
    for (const t of turns) {
      lines.push(`- "${t.text}" -> ${t.resolved ?? "no match"}`);
    }
  }

  if (facts.length > 0) {
    lines.push("Known facts:");
    for (const f of facts) {
      lines.push(`- ${f.key}: ${f.value}`);
    }
  }

  if (lines.length === 0) return "";

  let block = lines.join("\n");
  if (block.length > MAX_CONTEXT_CHARS) {
    block = block.slice(0, MAX_CONTEXT_CHARS) + "\n[...memory truncated]";
  }
  return block;
}