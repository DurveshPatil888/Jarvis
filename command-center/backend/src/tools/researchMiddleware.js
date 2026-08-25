import { evaluate } from 'mathjs';

import fetch from 'node-fetch';

export function fastMathHandler(args) {
  const { expression } = args;

  if (!expression || typeof expression !== 'string')
    return { success: false, error: 'Missing expression' };

  try {
    const normalized = expression

      .replace(/\bsquare of\s+(-?\d+(\.\d+)?)/gi, '$1^2')

      .replace(/\bx\b/gi, '*');

    const result = evaluate(normalized);

    return {
      success: true,

      expression,

      result: String(result),

      ttsText: String(result),
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

export const fastMathTool = {
  name: 'fast_math',

  description: 'Instantly evaluates a math expression locally.',

  parameters: {
    type: 'object',

    properties: { expression: { type: 'string' } },

    required: ['expression'],
  },

  handler: fastMathHandler,
};

const TAVILY_URL = 'https://api.tavily.com/search';

const MIN_CONFIDENT_ANSWER_LENGTH = 25;

function sanitizeForTTS(text) {
  if (!text) return text;

  return text

    .replace(/<[^>]*>/g, '')

    .replace(/[*_`#>]/g, '')

    .replace(/\[(\d+)\]/g, '')

    .replace(/\s+/g, ' ')

    .trim();
}

function isHighConfidenceAnswer(answer) {
  if (!answer || typeof answer !== 'string') return false;

  const trimmed = answer.trim();

  if (trimmed.length < MIN_CONFIDENT_ANSWER_LENGTH) return false;

  return !/\.\.\.| \| |^\W*(https?:\/\/)/i.test(trimmed);
}

export async function quickSearchHandler(args) {
  const { query } = args;

  if (!query) return { success: false, error: 'Missing query' };

  // --- 1. TAVILY API (Primary AI Search) ---

  if (process.env.TAVILY_API_KEY) {
    try {
      const res = await fetch('https://api.tavily.com/search', {
        method: 'POST',

        headers: { 'Content-Type': 'application/json' },

        body: JSON.stringify({
          api_key: process.env.TAVILY_API_KEY,

          query,

          search_depth: 'basic',

          include_answer: true,
        }),

        timeout: 4000,
      });

      if (res.ok) {
        const data = await res.json();

        const rawAnswer = data.answer || null;

        const confident = isHighConfidenceAnswer(rawAnswer);

        return {
          success: true,

          source: 'tavily',

          answer: rawAnswer,

          ttsText: confident ? sanitizeForTTS(rawAnswer) : null,

          bypassLLM: confident,

          results: (data.results || []).map((r) => ({
            title: r.title,

            url: r.url,

            snippet: r.content,
          })),
        };
      }

      // If Tavily fails (e.g., 429 limit), it falls through to the next block.

      console.log(
        `[WARN] Tavily failed with status ${res.status}. Falling back to Serper...`
      );
    } catch (err) {
      console.log(`[WARN] Tavily error: ${err.message}. Falling back...`);
    }
  }

  // --- 2. SERPER.DEV (Google Search Fallback) ---

  if (process.env.SERPER_API_KEY) {
    try {
      const res = await fetch('https://google.serper.dev/search', {
        method: 'POST',

        headers: {
          'X-API-KEY': process.env.SERPER_API_KEY,

          'Content-Type': 'application/json',
        },

        body: JSON.stringify({ q: query }),

        timeout: 4000,
      });

      if (res.ok) {
        const data = await res.json();

        // Serper puts the best answer in 'answerBox' or the first organic result snippet

        const rawAnswer =
          data.answerBox?.answer ||
          data.answerBox?.snippet ||
          data.organic?.[0]?.snippet ||
          null;

        const confident = isHighConfidenceAnswer(rawAnswer);

        return {
          success: true,

          source: 'serper',

          answer: rawAnswer,

          ttsText: confident ? sanitizeForTTS(rawAnswer) : null,

          bypassLLM: confident,

          results: (data.organic || [])

            .slice(0, 3)

            .map((r) => ({ title: r.title, url: r.link, snippet: r.snippet })),
        };
      }

      console.log(
        `[WARN] Serper failed with status ${res.status}. Falling back to DuckDuckGo...`
      );
    } catch (err) {
      console.log(`[WARN] Serper error: ${err.message}. Falling back...`);
    }
  }

  // --- 3. DUCKDUCKGO (The Unkillable Free Fallback) ---

  try {
    const params = new URLSearchParams({
      q: query,

      format: 'json',

      no_html: '1',

      skip_disambig: '1',
    });

    const res = await fetch(
      `https://api.duckduckgo.com/?${params.toString()}`,

      { timeout: 4000 }
    );

    if (res.ok) {
      const data = await res.json();

      const rawAnswer =
        data.AbstractText ||
        data.Answer ||
        data.RelatedTopics?.[0]?.Text ||
        null;

      const confident = isHighConfidenceAnswer(rawAnswer);

      return {
        success: !!rawAnswer,

        source: 'duckduckgo',

        answer: rawAnswer,

        ttsText: confident ? sanitizeForTTS(rawAnswer) : null,

        bypassLLM: confident,
      };
    }
  } catch (err) {
    return { success: false, error: 'All search fallbacks failed.' };
  }

  return { success: false, error: 'No results from any API.' };
}

export const quickSearchTool = {
  name: 'quick_search',

  description:
    'Fast lookup for general knowledge, history, or current info. Returns a short answer.',

  parameters: {
    type: 'object',

    properties: { query: { type: 'string' } },

    required: ['query'],
  },

  handler: quickSearchHandler,
};

export const VOICE_SYSTEM_PROMPT =
  'You are Jarvis. Keep replies SHORT. No markdown.';

export const TOOLS = [fastMathTool, quickSearchTool];
