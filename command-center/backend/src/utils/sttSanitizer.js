/**
 * sttSanitizer.js
 * -----------------------------------------------------------------
 * Fixes common STT (Speech-to-Text) homophone / mishearing errors
 * BEFORE the transcript reaches the LLM router.
 *
 * Rules use whole-word boundaries (\b) so "clothes" → "close" but
 * "clothespin" is left untouched. All matches are case-insensitive;
 * the replacement preserves the original casing style where possible
 * by lower-casing the output (the LLM doesn't care about casing).
 *
 * Add new pairs here as you discover recurring STT mistakes.
 */

/** @type {Array<{ pattern: RegExp, replacement: string }>} */
const RULES = [
  // "clothes" is frequently recognised instead of "close"
  { pattern: /\bclothes\b/gi, replacement: 'close' },

  // "play" ↔ "plea" mishear
  { pattern: /\bplea\b/gi, replacement: 'play' },

  // "four" / "for" / "fore" in numeric/command contexts
  { pattern: /\bfore\b/gi, replacement: 'for' },

  // "write" → "right" when used as a direction, handled both ways
  { pattern: /\bwrite code\b/gi, replacement: 'write code' }, // intentional keep

  // "tern" / "turn" confusion
  { pattern: /\btern\b/gi, replacement: 'turn' },

  // "wifi" normalisation (various STT spellings)
  { pattern: /\bwi\s+fi\b/gi, replacement: 'wifi' },
  { pattern: /\bwy\s*fi\b/gi, replacement: 'wifi' },

  // "bluetooth" normalisation
  { pattern: /\bblue\s+tooth\b/gi, replacement: 'bluetooth' },

  // "volume" mishears
  { pattern: /\bvolum\b/gi, replacement: 'volume' },

  // "next track" / "next rack"
  { pattern: /\bnext\s+rack\b/gi, replacement: 'next track' },

  // "pause" / "paws"
  { pattern: /\bpaws\b/gi, replacement: 'pause' },

  // "open" / "oven"
  { pattern: /\boven\b/gi, replacement: 'open' },
];

/**
 * Applies all STT correction rules to a raw transcript string.
 *
 * @param {string} transcript - The raw text from the STT engine.
 * @returns {string} The sanitized transcript, ready for the LLM router.
 */
export function sanitizeSTT(transcript) {
  if (typeof transcript !== 'string' || !transcript.trim()) return transcript;

  let result = transcript;
  for (const { pattern, replacement } of RULES) {
    result = result.replace(pattern, replacement);
  }
  return result;
}
