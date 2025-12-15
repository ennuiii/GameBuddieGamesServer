/**
 * Bomberman Game Plugin
 */

import type {
  GamePlugin,
  Room,
  Player,
  SocketEventHandler,
  GameHelpers,
  RoomSettings
} from '../../core/types/core.js';
import type { Socket } from 'socket.io';
import {
  BombermanGameState,
  BombermanPlayerData,
  BombermanSettings,
  createInitialGameState,
  createInitialPlayerData,
  DEFAULT_SETTINGS,
  CellType,
  Bomb,
  Explosion,
  PowerUp,
  PowerUpType
} from './types.js';
import { playerReadySchema, gameStartSchema, playerMoveSchema, playerPlaceBombSchema, playerThrowBombSchema, playerPickupBombSchema } from './schemas.js';
import { randomUUID } from 'crypto';

const PLAYER_COLORS = ['#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF', '#00FFFF', '#FFA500', '#800080'];

class BombermanPlugin implements GamePlugin {
  id = 'bomberman';
  name = 'Bomberman';
  version = '1.0.0';
  description = 'Classic Bomberman clone';
  author = 'GameBuddies';
  namespace = '/bomberman';
  basePath = '/bomberman';

  defaultSettings: RoomSettings = {
    minPlayers: 2,
    maxPlayers: 4,
    gameSpecific: {
      ...DEFAULT_SETTINGS
    } as BombermanSettings
  };

  private io: any;
  private intervals = new Map<string, NodeJS.Timeout>();

  async onInitialize(io: any): Promise<void> {
    this.io = io;
    console.log(`[${this.name}] Plugin initialized`);
  }

  onRoomCreate(room: Room): void {
    console.log(`[${this.name}] Room created: ${room.code}`);
    const settings = room.settings.gameSpecific as BombermanSettings;
    room.gameState.data = createInitialGameState(settings);
    room.gameState.phase = 'lobby';
  }

  onPlayerJoin(room: Room, player: Player, isReconnecting?: boolean): void {
    console.log(`[${this.name}] Player ${player.name} ${isReconnecting ? 'reconnected' : 'joined'}`);

    if (!player.gameData) {
      const pData = createInitialPlayerData();
      const playerIndex = room.players.size - 1;
      pData.color = PLAYER_COLORS[playerIndex % PLAYER_COLORS.length];
      player.gameData = pData;
    }

    this.broadcastRoomState(room);
  }

  onPlayerLeave(room: Room, player: Player): void {
    console.log(`[${this.name}] Player ${player.name} left`);
    this.broadcastRoomState(room);
  }

  onRoomDestroy(room: Room): void {
    this.clearIntervals(room.code);
  }

  serializeRoom(room: Room, socketId: string): any {
    const gameState = room.gameState.data as BombermanGameState;
    const gameSettings = room.settings.gameSpecific as BombermanSettings;

    return {
      code: room.code,
      hostId: room.hostId,
      players: Array.from(room.players.values()).map(p => {
        const pData = p.gameData as BombermanPlayerData;
        return {
          id: p.id,
          socketId: p.socketId,
          name: p.name,
          isHost: p.isHost,
          connected: p.connected,
          isReady: pData?.isReady || false,
          score: pData?.score || 0,
          x: pData?.x,
          y: pData?.y,
          isAlive: pData?.isAlive,
          color: pData?.color,
          canKickBombs: pData?.canKickBombs || false,
          canPickUpBombs: pData?.canPickUpBombs || false,
          heldBomb: pData?.heldBomb || null,
          facing: pData?.facing || 'down',
          avatarUrl: p.avatarUrl
        };
      }),
      state: gameState.phase,
      settings: {
        minPlayers: room.settings.minPlayers,
        maxPlayers: room.settings.maxPlayers,
        maxRounds: gameSettings.maxRounds,
        timeLimit: gameSettings.timeLimit,
        mapSize: gameSettings.mapSize,
      },
      gameData: {
        currentRound: gameState.currentRound,
        timeLeft: gameState.timeLeft,
        grid: gameState.grid,
        bombs: gameState.bombs,
        explosions: gameState.explosions,
        winnerId: gameState.winnerId,
        powerups: gameState.powerups || []
      },
      mySocketId: socketId,
      isGameBuddiesRoom: room.isGameBuddiesRoom
    };
  }

  socketHandlers: Record<string, SocketEventHandler> = {
    'player:ready': async (socket: Socket, data: { ready: boolean }, room: Room, helpers: GameHelpers) => {
      const validation = playerReadySchema.safeParse(data);
      if (!validation.success) return;

      const player = Array.from(room.players.values()).find(p => p.socketId === socket.id);
      if (player) {
        if (!player.gameData) player.gameData = createInitialPlayerData();
        (player.gameData as BombermanPlayerData).isReady = validation.data.ready;
        this.broadcastRoomState(room);
      }
    },

    'game:start': async (socket: Socket, data: any, room: Room, helpers: GameHelpers) => {
      const player = Array.from(room.players.values()).find(p => p.socketId === socket.id);
      if (!player?.isHost) return;
      this.startGame(room);
    },

    'player:move': async (socket: Socket, data: any, room: Room, helpers: GameHelpers) => {
      const validation = playerMoveSchema.safeParse(data);
      if (!validation.success) return;
      const { x, y } = validation.data;

      const player = Array.from(room.players.values()).find(p => p.socketId === socket.id);
      if (!player || !player.gameData) return;

      const pData = player.gameData as BombermanPlayerData;
      const gameState = room.gameState.data as BombermanGameState;

      if (gameState.phase !== 'playing' || !pData.isAlive) return;

      const dist = Math.abs(pData.x - x) + Math.abs(pData.y - y);
      if (dist !== 1) return;

      const size = gameState.settings.mapSize;
      if (x < 0 || x >= size || y < 0 || y >= size) return;

      if (gameState.grid[y][x] !== 'empty') return;

      const bombAtTarget = gameState.bombs.find(b => b.x === x && b.y === y);
      if (bombAtTarget) {
        if (pData.canKickBombs) {
          const dx = x - pData.x;
          const dy = y - pData.y;
          this.kickBomb(gameState, bombAtTarget, dx, dy);
          this.broadcastRoomState(room);
        }
        return;
      }

      // Calculate movement direction for facing
      const dx = x - pData.x;
      const dy = y - pData.y;

      pData.x = x;
      pData.y = y;

      // Update facing direction based on movement
      if (dx > 0) pData.facing = 'right';
      else if (dx < 0) pData.facing = 'left';
      else if (dy > 0) pData.facing = 'down';
      else if (dy < 0) pData.facing = 'up';

      const powerUpIndex = gameState.powerups.findIndex(p => p.x === x && p.y === y);
      if (powerUpIndex !== -1) {
        const powerUp = gameState.powerups[powerUpIndex];
        gameState.powerups.splice(powerUpIndex, 1);

        switch (powerUp.type) {
          case 'bomb_range':
            pData.bombRange++;
            break;
          case 'bomb_capacity':
            pData.bombCapacity++;
            break;
          case 'speed':
            break;
          case 'kick_bombs':
            pData.canKickBombs = true;
            break;
          case 'pickup_bombs':
            pData.canPickUpBombs = true;
            break;
        }
      }

      this.broadcastRoomState(room);
    },

    'player:placeBomb': async (socket: Socket, data: any, room: Room, helpers: GameHelpers) => {
      const player = Array.from(room.players.values()).find(p => p.socketId === socket.id);
      if (!player || !player.gameData) return;

      const pData = player.gameData as BombermanPlayerData;
      const gameState = room.gameState.data as BombermanGameState;

      if (gameState.phase !== 'playing' || !pData.isAlive) return;
      if (pData.activeBombs >= pData.bombCapacity) return;
      if (gameState.bombs.some(b => b.x === pData.x && b.y === pData.y)) return;

      const bomb: Bomb = {
        id: randomUUID(),
        x: pData.x,
        y: pData.y,
        playerId: player.id,
        range: pData.bombRange,
        createdAt: Date.now()
      };

      gameState.bombs.push(bomb);
      pData.activeBombs++;

      this.broadcastRoomState(room);

      setTimeout(() => {
        this.explodeBomb(room, bomb);
      }, 3000);
    },

    'player:pickupBomb': async (socket: Socket, data: any, room: Room, helpers: GameHelpers) => {
      const player = Array.from(room.players.values()).find(p => p.socketId === socket.id);
      if (!player || !player.gameData) return;

      const pData = player.gameData as BombermanPlayerData;
      const gameState = room.gameState.data as BombermanGameState;

      if (gameState.phase !== 'playing' || !pData.isAlive) return;
      if (!pData.canPickUpBombs || pData.heldBomb) return;

      // Direction offsets based on facing
      const dirs: Record<string, {dx: number, dy: number}> = {
        up: {dx: 0, dy: -1},
        down: {dx: 0, dy: 1},
        left: {dx: -1, dy: 0},
        right: {dx: 1, dy: 0}
      };
      const dir = dirs[pData.facing] || dirs.down;
      const frontX = pData.x + dir.dx;
      const frontY = pData.y + dir.dy;

      // Check current position first, then cell in front
      let bombIndex = gameState.bombs.findIndex(b => b.x === pData.x && b.y === pData.y);
      if (bombIndex === -1) {
        bombIndex = gameState.bombs.findIndex(b => b.x === frontX && b.y === frontY);
      }
      if (bombIndex === -1) return;

      pData.heldBomb = gameState.bombs[bombIndex];
      gameState.bombs.splice(bombIndex, 1);

      this.broadcastRoomState(room);
    },

    'player:throwBomb': async (socket: Socket, data: any, room: Room, helpers: GameHelpers) => {
      const validation = playerThrowBombSchema.safeParse(data);
      if (!validation.success) return;

      const player = Array.from(room.players.values()).find(p => p.socketId === socket.id);
      if (!player || !player.gameData) return;

      const pData = player.gameData as BombermanPlayerData;
      const gameState = room.gameState.data as BombermanGameState;

      if (gameState.phase !== 'playing' || !pData.isAlive) return;
      if (!pData.heldBomb) return;

      const { direction } = validation.data;
      const dirs: Record<string, {dx: number, dy: number}> = {
        up: {dx: 0, dy: -1},
        down: {dx: 0, dy: 1},
        left: {dx: -1, dy: 0},
        right: {dx: 1, dy: 0}
      };
      const {dx, dy} = dirs[direction];
      const mapSize = gameState.settings.mapSize;

      let targetX = pData.x + dx;
      let targetY = pData.y + dy;

      while (targetX >= 0 && targetX < mapSize && targetY >= 0 && targetY < mapSize) {
        const cell = gameState.grid[targetY][targetX];
        const hasBomb = gameState.bombs.some(b => b.x === targetX && b.y === targetY);

        if (cell === 'empty' && !hasBomb) break;

        targetX += dx;
        targetY += dy;
      }

      if (targetX < 0 || targetX >= mapSize || targetY < 0 || targetY >= mapSize) {
        targetX = pData.x;
        targetY = pData.y;
      }

      // Store throw origin for client animation
      (pData.heldBomb as any).throwFromX = pData.x;
      (pData.heldBomb as any).throwFromY = pData.y;
      (pData.heldBomb as any).thrownAt = Date.now();
      pData.heldBomb.x = targetX;
      pData.heldBomb.y = targetY;
      gameState.bombs.push(pData.heldBomb);
      pData.heldBomb = null;

      this.broadcastRoomState(room);
    },

    'game:restart': async (socket: Socket, data: any, room: Room, helpers: GameHelpers) => {
      const player = Array.from(room.players.values()).find(p => p.socketId === socket.id);
      if (!player?.isHost) return;

      const gameState = room.gameState.data as BombermanGameState;

      if (gameState.currentRound >= gameState.settings.maxRounds) {
        gameState.phase = 'lobby';
        gameState.currentRound = 0;
        gameState.winnerId = null;
        gameState.grid = [];
        gameState.bombs = [];
        gameState.explosions = [];
        gameState.powerups = [];

        room.players.forEach(p => {
          const pData = p.gameData as BombermanPlayerData;
          pData.score = 0;
          pData.isReady = false;
          pData.isAlive = true;
          pData.activeBombs = 0;
          pData.bombCapacity = 1;
          pData.bombRange = 1;
          pData.canKickBombs = false;
          pData.canPickUpBombs = false;
          pData.heldBomb = null;
        });

        room.gameState.phase = 'lobby';
      } else {
        this.startGame(room);
      }

      this.broadcastRoomState(room);
    }
  };

  private kickBomb(gameState: BombermanGameState, bomb: Bomb, dx: number, dy: number) {
    let newX = bomb.x;
    let newY = bomb.y;

    while (true) {
      const nextX = newX + dx;
      const nextY = newY + dy;

      if (nextX < 0 || nextX >= gameState.settings.mapSize ||
          nextY < 0 || nextY >= gameState.settings.mapSize) break;

      if (gameState.grid[nextY][nextX] !== 'empty') break;

      if (gameState.bombs.some(b => b.id !== bomb.id && b.x === nextX && b.y === nextY)) break;

      newX = nextX;
      newY = nextY;
    }

    bomb.x = newX;
    bomb.y = newY;
  }

  private startGame(room: Room) {
    const gameState = room.gameState.data as BombermanGameState;
    const settings = room.settings.gameSpecific as BombermanSettings;

    gameState.phase = 'playing';
    gameState.currentRound++;
    gameState.timeLeft = settings.timeLimit;
    gameState.bombs = [];
    gameState.explosions = [];
    gameState.powerups = [];
    gameState.winnerId = null;

    this.generateGrid(gameState);

    const players = Array.from(room.players.values());
    const spawnPoints = [
      { x: 0, y: 0 },
      { x: settings.mapSize - 1, y: settings.mapSize - 1 },
      { x: 0, y: settings.mapSize - 1 },
      { x: settings.mapSize - 1, y: 0 }
    ];

    players.forEach((p, index) => {
      const pData = p.gameData as BombermanPlayerData;
      pData.isAlive = true;
      pData.activeBombs = 0;
      pData.canKickBombs = false;
      pData.canPickUpBombs = false;
      pData.heldBomb = null;
      const spawn = spawnPoints[index % spawnPoints.length];
      pData.x = spawn.x;
      pData.y = spawn.y;

      if (gameState.grid[spawn.y] && gameState.grid[spawn.y][spawn.x]) {
        gameState.grid[spawn.y][spawn.x] = 'empty';
      }
      if (spawn.x + 1 < settings.mapSize && gameState.grid[spawn.y]) gameState.grid[spawn.y][spawn.x + 1] = 'empty';
      if (spawn.y + 1 < settings.mapSize && gameState.grid[spawn.y + 1]) gameState.grid[spawn.y + 1][spawn.x] = 'empty';
      if (spawn.x - 1 >= 0 && gameState.grid[spawn.y]) gameState.grid[spawn.y][spawn.x - 1] = 'empty';
      if (spawn.y - 1 >= 0 && gameState.grid[spawn.y - 1]) gameState.grid[spawn.y - 1][spawn.x] = 'empty';
    });

    room.gameState.phase = 'playing';
    this.startTimer(room);
    this.broadcastRoomState(room);
  }

  private generateGrid(gameState: BombermanGameState) {
    const size = gameState.settings.mapSize;
    const grid: CellType[][] = [];

    for (let y = 0; y < size; y++) {
      const row: CellType[] = [];
      for (let x = 0; x < size; x++) {
        if (x % 2 === 1 && y % 2 === 1) {
          row.push('wall');
        } else {
          row.push(Math.random() < 0.7 ? 'block' : 'empty');
        }
      }
      grid.push(row);
    }
    gameState.grid = grid;
  }

  private explodeBomb(room: Room, bomb: Bomb) {
    const gameState = room.gameState.data as BombermanGameState;

    const bombIndex = gameState.bombs.findIndex(b => b.id === bomb.id);
    if (bombIndex === -1) return;
    gameState.bombs.splice(bombIndex, 1);

    const player = Array.from(room.players.values()).find(p => p.id === bomb.playerId);
    if (player) {
      (player.gameData as BombermanPlayerData).activeBombs--;
    }

    const explosionId = randomUUID();
    const affectedCells: {x: number, y: number}[] = [{x: bomb.x, y: bomb.y}];
    const chainBombs: Bomb[] = [];

    const directions = [{dx: 0, dy: -1}, {dx: 0, dy: 1}, {dx: -1, dy: 0}, {dx: 1, dy: 0}];

    directions.forEach(dir => {
      for (let i = 1; i <= bomb.range; i++) {
        const tx = bomb.x + dir.dx * i;
        const ty = bomb.y + dir.dy * i;

        if (tx < 0 || tx >= gameState.settings.mapSize || ty < 0 || ty >= gameState.settings.mapSize) break;

        const cell = gameState.grid[ty][tx];

        if (cell === 'wall') break;

        affectedCells.push({x: tx, y: ty});

        const hitBomb = gameState.bombs.find(b => b.x === tx && b.y === ty);
        if (hitBomb && !chainBombs.includes(hitBomb)) {
          chainBombs.push(hitBomb);
        }

        if (cell === 'block') {
          gameState.grid[ty][tx] = 'empty';

          if (Math.random() < 0.3) {
            const powerUpTypes: PowerUpType[] = ['bomb_range', 'bomb_capacity', 'speed', 'kick_bombs', 'pickup_bombs'];
            const randomType = powerUpTypes[Math.floor(Math.random() * powerUpTypes.length)];
            const powerUp: PowerUp = {
              id: randomUUID(),
              x: tx,
              y: ty,
              type: randomType
            };
            gameState.powerups.push(powerUp);
          }

          break;
        }
      }
    });

    affectedCells.forEach(pos => {
      gameState.explosions.push({
        id: explosionId,
        x: pos.x,
        y: pos.y,
        createdAt: Date.now()
      });
    });

    room.players.forEach(p => {
      const pData = p.gameData as BombermanPlayerData;
      if (pData.isAlive) {
        if (affectedCells.some(cell => cell.x === pData.x && cell.y === pData.y)) {
          pData.isAlive = false;
        }
      }
    });

    chainBombs.forEach((chainBomb, index) => {
      setTimeout(() => {
        this.explodeBomb(room, chainBomb);
      }, 50 * (index + 1));
    });

    setTimeout(() => {
      gameState.explosions = gameState.explosions.filter(e => e.id !== explosionId);
      this.broadcastRoomState(room);
    }, 500);

    this.checkWin(room);
    this.broadcastRoomState(room);
  }

  private checkWin(room: Room) {
    const gameState = room.gameState.data as BombermanGameState;
    const alivePlayers = Array.from(room.players.values()).filter(p => (p.gameData as BombermanPlayerData).isAlive);

    if (alivePlayers.length <= 1 && room.players.size > 1) {
       if (alivePlayers.length === 1) {
         const winner = alivePlayers[0];
         (winner.gameData as BombermanPlayerData).score++;
         gameState.winnerId = winner.id;
       } else {
         gameState.winnerId = null;
       }

       gameState.phase = 'ended';
       this.clearIntervals(room.code);
       this.broadcastRoomState(room);
    }
  }

  private startTimer(room: Room) {
    this.clearIntervals(room.code);
    const interval = setInterval(() => {
       const gameState = room.gameState.data as BombermanGameState;
       gameState.timeLeft--;
       if (gameState.timeLeft <= 0) {
         this.endGame(room);
       } else {
         this.broadcastRoomState(room);
       }
    }, 1000);
    this.intervals.set(room.code, interval);
  }

  private endGame(room: Room) {
      const gameState = room.gameState.data as BombermanGameState;
      gameState.phase = 'ended';
      this.clearIntervals(room.code);
      this.broadcastRoomState(room);
  }

  private clearIntervals(roomCode: string) {
    if (this.intervals.has(roomCode)) {
      clearInterval(this.intervals.get(roomCode)!);
      this.intervals.delete(roomCode);
    }
  }

  private broadcastRoomState(room: Room): void {
    if (!this.io) return;
    const namespace = this.io.of(this.namespace);

    Array.from(room.players.values()).forEach(player => {
      namespace.to(player.socketId).emit('roomStateUpdated', this.serializeRoom(room, player.socketId));
    });
  }
}

export default new BombermanPlugin();