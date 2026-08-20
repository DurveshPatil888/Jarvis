/**
 * mockResolver.js — DEV/PROOF-OF-WIRING ONLY
 * -----------------------------------------------------------------
 * Deliberately dumb keyword matching, not real NLU. This exists to
 * prove the full pipeline (text -> resolved intent -> registry
 * validation -> ProcessManager.sendCommand -> real worker action)
 * actually works end-to-end before we spend an API key or design
 * a single prompt.
 *
 * Matches AIRouter's resolver contract exactly:
 *   async (text, registry) => { powerId, command, payload } | null
 *
 * Swap for a real LLM resolver later via aiRouter.setResolver(...) in
 * server.js -- nothing else in the system needs to change.
 */
export default async function mockResolver(text) {
  const lower = text.toLowerCase();

  if (lower.includes('whatsapp') && lower.includes('test')) {
    return { powerId: 'whatsapp', command: 'send_test_message', payload: {} };
  }

  return null; // no match -- AIRouter logs this as "no confident match"
}
