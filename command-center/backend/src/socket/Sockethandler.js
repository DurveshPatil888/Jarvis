/**
 * registerSocketHandlers
 * -----------------------------------------------------------------
 * Bridges Socket.io <-> ProcessManager. ProcessManager doesn't know
 * this file exists; it just emits "log" and "power:sync" into the
 * void, and this is the one place that turns those into `io.emit`.
 */
export default function registerSocketHandlers(io, processManager, aiRouter) {
  io.on('connection', (socket) => {
    processManager.log('info', `CLIENT_CONNECTED :: ${socket.id}`);

    // new client needs the full current state immediately, not just future deltas
    socket.emit('power:sync', processManager.getSnapshot());

    // the new "brain" entry point -- raw natural language in, AIRouter
    // handles parsing + validation + dispatch entirely on its own
    socket.on('router:command', ({ text } = {}) => {
      if (typeof text !== 'string') {
        processManager.log(
          'error',
          `SOCKET :: malformed router:command payload from ${socket.id}`
        );
        return;
      }
      aiRouter.route(text);
    });

    socket.on('power:toggle', (payload) => {
      // never trust the socket payload shape -- validate before it touches ProcessManager
      const { id, nextState } = payload ?? {};
      if (typeof id !== 'string' || typeof nextState !== 'boolean') {
        processManager.log(
          'error',
          `SOCKET :: malformed power:toggle payload from ${socket.id}`
        );
        return;
      }

      if (nextState) {
        processManager.start(id);
      } else {
        processManager.stop(id);
      }
    });

    socket.on('power:command', (payload) => {
      const { id, command, commandPayload } = payload ?? {};
      if (typeof id !== 'string' || typeof command !== 'string') {
        processManager.log(
          'error',
          `SOCKET :: malformed power:command payload from ${socket.id}`
        );
        return;
      }
      processManager.sendCommand(id, command, commandPayload ?? {});
    });

    socket.on('disconnect', () => {
      processManager.log('info', `CLIENT_DISCONNECTED :: ${socket.id}`);
    });
  });

  // relay every backend event out to all connected clients
  processManager.on('log', (entry) => io.emit('log', entry));
  processManager.on('power:sync', (snapshot) =>
    io.emit('power:sync', snapshot)
  );
  processManager.on('ai_speak', (payload) => io.emit('ai_speak', payload));
}
