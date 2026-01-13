/**
 * ColyseusServer - Wrapper for Colyseus server initialization
 *
 * Runs Colyseus on a separate port (3002) to avoid conflicts with Socket.IO.
 * This is the cleanest approach for coexistence.
 */

import { Server, matchMaker, Room } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { monitor } from '@colyseus/monitor';
import { createServer, Server as HTTPServer } from 'http';
import express, { Express, Request, Response } from 'express';
import cors from 'cors';

// Default Colyseus port - can be overridden via environment variable
const DEFAULT_COLYSEUS_PORT = 3002;

export interface ColyseusServerOptions {
  corsOrigins: string[];
  port?: number;
}

export class ColyseusServer {
  private gameServer: Server;
  private colyseusApp: Express;
  private colyseusHttpServer: HTTPServer;
  private port: number;

  constructor(options: ColyseusServerOptions) {
    this.port = options.port || parseInt(process.env.COLYSEUS_PORT || String(DEFAULT_COLYSEUS_PORT), 10);

    // Create a separate Express app for Colyseus
    this.colyseusApp = express();

    // Configure CORS to allow client connections
    this.colyseusApp.use(cors({
      origin: options.corsOrigins,
      credentials: true,
    }));

    // Parse JSON for matchmaking requests
    this.colyseusApp.use(express.json());

    // Create HTTP server for Colyseus
    this.colyseusHttpServer = createServer(this.colyseusApp);

    // Create Colyseus server with WebSocket transport
    this.gameServer = new Server({
      transport: new WebSocketTransport({
        server: this.colyseusHttpServer,
        pingInterval: 3000,
        pingMaxRetries: 3,
      }),
    });

    // Set up HTTP matchmaking routes
    this.setupMatchmakingRoutes();

    // Add Colyseus monitor route (admin panel)
    this.colyseusApp.use('/colyseus-monitor', monitor());

    // Health check endpoint
    this.colyseusApp.get('/health', (_req, res) => {
      res.json({ status: 'ok', server: 'colyseus', port: this.port });
    });

    console.log('[Colyseus] Server instance created');
  }

  /**
   * Define a room type
   */
  define<T extends Room>(name: string, roomClass: new (...args: any[]) => T, filterBy?: string[]): void {
    if (filterBy) {
      this.gameServer.define(name, roomClass).filterBy(filterBy);
      console.log(`[Colyseus] Room "${name}" defined with filterBy: [${filterBy.join(', ')}]`);
    } else {
      this.gameServer.define(name, roomClass);
      console.log(`[Colyseus] Room "${name}" defined`);
    }
  }

  /**
   * Set up HTTP matchmaking routes
   */
  private setupMatchmakingRoutes(): void {
    const app = this.colyseusApp;

    // GET /matchmake/ - List all rooms
    app.get('/matchmake/', async (_req: Request, res: Response) => {
      try {
        const rooms = await matchMaker.query({});
        res.json(rooms);
      } catch (e: any) {
        res.status(500).json({ error: e.message });
      }
    });

    // GET /matchmake/:roomName - List rooms by name
    app.get('/matchmake/:roomName', async (req: Request, res: Response) => {
      try {
        const rooms = await matchMaker.query({ name: req.params.roomName });
        res.json(rooms);
      } catch (e: any) {
        res.status(500).json({ error: e.message });
      }
    });

    // POST /matchmake/joinOrCreate/:roomName
    app.post('/matchmake/joinOrCreate/:roomName', async (req: Request, res: Response) => {
      try {
        const reservation = await matchMaker.joinOrCreate(req.params.roomName, req.body);
        res.json(reservation);
      } catch (e: any) {
        res.status(500).json({ error: e.message });
      }
    });

    // POST /matchmake/create/:roomName
    app.post('/matchmake/create/:roomName', async (req: Request, res: Response) => {
      try {
        const reservation = await matchMaker.create(req.params.roomName, req.body);
        res.json(reservation);
      } catch (e: any) {
        res.status(500).json({ error: e.message });
      }
    });

    // POST /matchmake/join/:roomName
    app.post('/matchmake/join/:roomName', async (req: Request, res: Response) => {
      try {
        const reservation = await matchMaker.join(req.params.roomName, req.body);
        res.json(reservation);
      } catch (e: any) {
        res.status(500).json({ error: e.message });
      }
    });

    // POST /matchmake/joinById/:roomId
    app.post('/matchmake/joinById/:roomId', async (req: Request, res: Response) => {
      try {
        const reservation = await matchMaker.joinById(req.params.roomId, req.body);
        res.json(reservation);
      } catch (e: any) {
        res.status(500).json({ error: e.message });
      }
    });

    // POST /matchmake/reconnect/:roomId
    app.post('/matchmake/reconnect/:roomId', async (req: Request, res: Response) => {
      try {
        const { sessionId } = req.body;
        const reservation = await matchMaker.reconnect(req.params.roomId, sessionId);
        res.json(reservation);
      } catch (e: any) {
        res.status(500).json({ error: e.message });
      }
    });
  }

  /**
   * Start Colyseus server on its own port
   */
  async listen(): Promise<void> {
    return new Promise((resolve) => {
      this.colyseusHttpServer.listen(this.port, () => {
        console.log(`[Colyseus] Server listening on port ${this.port}`);
        console.log(`[Colyseus] Matchmaking: http://localhost:${this.port}/matchmake/`);
        console.log(`[Colyseus] Monitor: http://localhost:${this.port}/colyseus-monitor`);
        resolve();
      });
    });
  }

  /**
   * Get the Colyseus port
   */
  getPort(): number {
    return this.port;
  }

  /**
   * Get Colyseus game server instance
   */
  getServer(): Server {
    return this.gameServer;
  }

  /**
   * Get room count for monitoring
   */
  async getRoomCount(): Promise<number> {
    try {
      const rooms = await matchMaker.query({});
      return rooms.length;
    } catch {
      return 0;
    }
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    console.log('[Colyseus] Shutting down...');
    await this.gameServer.gracefullyShutdown(true);
    this.colyseusHttpServer.close();
  }
}

/**
 * Create and initialize the Colyseus server
 */
export function createColyseusServer(options: ColyseusServerOptions): ColyseusServer {
  return new ColyseusServer(options);
}
