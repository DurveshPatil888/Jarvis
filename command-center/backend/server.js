import 'dotenv/config'; 

import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';

import processManager from './processmanager.js';
import registerSocketHandlers from './src/socket/Sockethandler.js';
import aiRouter from './src/router/AIRouter.js';
import mockResolver from './src/resolvers/mockResolver.js'; 
import llmResolver from './src/resolvers/llmResolver.js';

// active resolver setup
aiRouter.setResolver(llmResolver);

const PORT = process.env.PORT || 4000;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';

const app = express();
app.use(cors({ origin: CLIENT_ORIGIN }));
app.use(express.json());

// simple liveness probe
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: { origin: CLIENT_ORIGIN, methods: ['GET', 'POST'] },
});

// ==========================================
// 🚀 THE OFFLINE MIC ROUTE (PYTHON TO NODE)
// ==========================================
app.post('/api/voice', async (req, res) => {
    const { command } = req.body;
    
    if (command) {
        processManager.log('info', `🗣️ Voice Command Triggered: "${command}"`);
        
        try {
            // 🚀 YEH HAI WOH MAGIC LINE JO TERE AI KO ZINDA KAREGI
            aiRouter.route(command); 
            
        } catch (err) {
            processManager.log('error', `AI Route failed: ${err.message}`);
        }
    }
    
    res.sendStatus(200);
});
// ==========================================

registerSocketHandlers(io, processManager, aiRouter);

httpServer.listen(PORT, () => {
  processManager.log('success', `EXPRESS_SERVER :: listening on port ${PORT}`);
});

/**
 * Graceful shutdown
 */
const shutdown = (signal) => {
  processManager.log('warn', `SERVER :: received ${signal}, shutting down...`);
  processManager.shutdownAll();

  httpServer.close(() => process.exit(0));

  setTimeout(() => process.exit(1), 6000);
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

process.once('SIGUSR2', () => {
  processManager.log(
    'warn',
    'SERVER :: nodemon restart detected (SIGUSR2), cleaning up children...'
  );
  processManager.shutdownAll();
  setTimeout(() => process.kill(process.pid, 'SIGUSR2'), 300);
});