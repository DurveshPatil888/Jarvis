import processManager from '../../processmanager.js';
import { COMMAND_REGISTRY } from '../../commandRegistry.js';

/**
 * META_COMMANDS
 * -----------------------------------------------------------------
 * Commands that are whitelisted in COMMAND_REGISTRY (so the LLM sees
 * them as ordinary tools) but have NO backing child process to
 * dispatch to -- "system.get_status" is pure introspection over data
 * ProcessManager already holds in this same process. Forking a whole
 * Node child just to answer "what's running" would be process
 * isolation for no reason, so this handles it locally instead of
 * going through sendCommand()'s IPC path.
 *
 * Keyed as "<powerId>.<command>" to match how route() checks it.
 * Each handler receives the validated payload and is responsible for
 * producing its own visible output via processManager.log() -- same
 * as any worker's result would eventually surface, keeping the "watch
 * it happen live in the terminal" behavior consistent regardless of
 * whether a command went to a child process or not.
 */
const META_COMMANDS = {
  'system.get_status': () => {
    const snapshot = processManager.getSnapshot();
    const summary = snapshot
      .map(
        (p) =>
          `${p.label}=${p.status.toUpperCase()}${p.pid ? ` (pid ${p.pid})` : ''}`
      )
      .join('  |  ');
    processManager.log(
      'success',
      `SYSTEM_STATUS :: ${summary || 'no powers registered'}`
    );
  },
};

/**
 * AIRouter
 * -----------------------------------------------------------------
 * Central intelligence layer: raw natural language in, either a
 * validated ProcessManager.sendCommand() call or a local meta-command
 * out. This class never talks to an LLM API directly -- that's
 * delegated to a `resolver` function, swappable via setResolver().
 * Same pattern as useCommandSocket's mock -> real socket.io-client
 * migration on the frontend: prove the pipeline with a dumb resolver,
 * swap the internals, zero callers (socketHandler.js) need to change.
 *
 * Resolver contract:
 *   async (text, registry) => { powerId, command, payload } | null
 *
 * The resolver's job is ONLY to guess intent. It is never trusted
 * blindly -- AIRouter re-validates every resolved command against
 * COMMAND_REGISTRY before dispatch, same as ProcessManager does
 * internally. Two independent checks, because the resolver will
 * eventually be an LLM, and LLM output is not sanitized input.
 */
class AIRouter {
  #resolver = null;

  setResolver(resolverFn) {
    this.#resolver = resolverFn;
  }

  async route(text) {
    const trimmed = (text ?? '').trim();
    if (!trimmed) return;

    processManager.log('info', `AI_ROUTER :: parsing "${trimmed}"`);

    if (!this.#resolver) {
      processManager.log(
        'error',
        'AI_ROUTER :: no resolver configured, cannot route'
      );
      processManager.speak('Router not ready');
      return;
    }

    let intent;
    try {
      intent = await this.#resolver(trimmed, COMMAND_REGISTRY);
    } catch (err) {
      processManager.log(
        'error',
        `AI_ROUTER :: resolver threw - ${err.message}`
      );
      processManager.speak('Something broke');
      return;
    }

    if (!intent) {
      processManager.log(
        'warn',
        `AI_ROUTER :: no confident match for "${trimmed}"`
      );
      processManager.speak("Didn't catch that");
      return;
    }

    const { powerId, command, payload } = intent;

    // re-validate here too, independent of ProcessManager's own check --
    // never assume a resolver (especially an LLM one) only ever returns
    // well-formed, in-whitelist output.
    const entry = COMMAND_REGISTRY[powerId]?.commands?.[command];
    if (!entry) {
      processManager.log(
        'error',
        `AI_ROUTER :: resolver returned unknown command "${powerId}.${command}", refusing to dispatch`
      );
      return;
    }

    const metaKey = `${powerId}.${command}`;
    if (META_COMMANDS[metaKey]) {
      processManager.log(
        'success',
        `AI_ROUTER :: resolved -> ${metaKey} (handled locally, no worker involved)`
      );
      META_COMMANDS[metaKey](payload ?? {});
      return;
    }

    processManager.log(
      'success',
      `AI_ROUTER :: resolved -> ${powerId}.${command}`
    );
    processManager.sendCommand(powerId, command, payload ?? {});
  }
}

// singleton -- one router for the server's lifetime, same pattern as ProcessManager
export default new AIRouter();
