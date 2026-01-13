/**
 * Bomberman Game Plugin for GameBuddies Platform
 *
 * Classic Bomberman multiplayer with kick/throw mechanics
 * Ported from Colyseus implementation
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

import { GAME_CONFIG, TILE, GAME_PHASE, GAME_MODE, DIRECTION, Direction } from './shared/constants.js';
import {
  BombermanGameState,
  BombermanPlayerData,
  SerializedRoom,
  SerializedPlayer,
  SerializedBomb,
  SerializedExplosion,
  createDefaultPlayerData,
  createDefaultGameState,
} from './types.js';
import { MapGenerator } from './game/MapGenerator.js';
import { GameLoop } from './game/GameLoop.js';
import { BombManager } from './game/BombManager.js';
import { PlayerManager, MoveResult } from './game/PlayerManager.js';
import { CurseManager } from './game/CurseManager.js';
import { SuddenDeathManager } from './game/SuddenDeathManager.js';
import { ProgressionManager } from './game/ProgressionManager.js';
import type { BomberClassId, RuneId, PlayerProfile, MatchRewards } from './shared/progression.js';
import { BOMBER_CLASS } from './shared/progression.js';

class BombermanPlugin implements GamePlugin {
  // Plugin metadata
  id = 'bomberman';
  name = 'Bomberman';
  version = '1.0.0';
  description = 'Classic Bomberman multiplayer with power-ups, kick, and throw mechanics';
  author = 'GameBuddies';
  namespace = '/bomberman';
  basePath = '/bomberman';

  // Default settings
  defaultSettings: RoomSettings = {
    minPlayers: GAME_CONFIG.MIN_PLAYERS,
    maxPlayers: GAME_CONFIG.MAX_PLAYERS,
    gameSpecific: {
      gameMode: GAME_MODE.LAST_MAN_STANDING,
    }
  };

  // Private properties
  private io: any;
  private gameLoops = new Map<string, GameLoop>();
  private respawnTimers = new Map<string, NodeJS.Timeout>();
  // Progression: player loadouts (stored per room:player)
  private playerLoadouts = new Map<string, { bomberClass: BomberClassId; runes: RuneId[] }>();
  // Match rewards to send at game end
  private pendingRewards = new Map<string, Map<string, MatchRewards>>();

  // ============================================================================
  // LIFECYCLE HOOKS
  // ============================================================================

  async onInitialize(io: any): Promise<void> {
    this.io = io;
    console.log(`[${this.name}] Plugin initialized`);
  }

  onRoomCreate(room: Room): void {
    console.log(`[${this.name}] Room created: ${room.code}`);

    // Initialize game state
    room.gameState.data = createDefaultGameState();
    room.gameState.phase = 'lobby';

    const gameState = room.gameState.data as BombermanGameState;

    // Initialize host player data (host is already in room.players but onPlayerJoin is not called)
    room.players.forEach((player) => {
      if (!player.gameData) {
        const spawnIndex = 0;
        gameState.usedSpawnIndices.add(spawnIndex);
        const spawn = GAME_CONFIG.SPAWN_POSITIONS[spawnIndex];
        const color = GAME_CONFIG.PLAYER_COLORS[spawnIndex];
        player.gameData = createDefaultPlayerData(spawnIndex, spawn, color);
        console.log(`[${this.name}] Initialized host ${player.name} with spawn ${spawnIndex}`);
      }
    });

    // Generate map for the host
    if (room.players.size >= 1) {
      gameState.tiles = MapGenerator.generate(GAME_CONFIG.MAX_PLAYERS);
      console.log(`[${this.name}] Generated map for room ${room.code}`);
    }

    // Start game loop
    this.startGameLoop(room);
  }

  onPlayerJoin(room: Room, player: Player, isReconnecting?: boolean): void {
    console.log(`[${this.name}] Player ${player.name} ${isReconnecting ? 'reconnected to' : 'joined'} room ${room.code}`);

    const gameState = room.gameState.data as BombermanGameState;

    if (!isReconnecting) {
      // Find available spawn index
      let spawnIndex = 0;
      for (let i = 0; i < GAME_CONFIG.MAX_PLAYERS; i++) {
        if (!gameState.usedSpawnIndices.has(i)) {
          spawnIndex = i;
          break;
        }
      }
      gameState.usedSpawnIndices.add(spawnIndex);

      const spawn = GAME_CONFIG.SPAWN_POSITIONS[spawnIndex];
      const color = GAME_CONFIG.PLAYER_COLORS[spawnIndex];

      // Initialize player data
      player.gameData = createDefaultPlayerData(spawnIndex, spawn, color);

      // Generate map when first player joins
      if (room.players.size === 1) {
        gameState.tiles = MapGenerator.generate(GAME_CONFIG.MAX_PLAYERS);
      }
    }

    // Broadcast updated state
    this.broadcastRoomState(room);
  }

  onPlayerDisconnected(room: Room, player: Player): void {
    console.log(`[${this.name}] Player ${player.name} disconnected from room ${room.code}`);
    this.broadcastRoomState(room);
  }

  onPlayerLeave(room: Room, player: Player): void {
    console.log(`[${this.name}] Player ${player.name} removed from room ${room.code}`);

    const gameState = room.gameState.data as BombermanGameState;
    const playerData = player.gameData as BombermanPlayerData;

    // Release spawn index
    if (playerData) {
      gameState.usedSpawnIndices.delete(playerData.spawnIndex);
    }

    // Clear any respawn timer for this player
    const timerKey = `${room.code}:${player.id}:respawn`;
    if (this.respawnTimers.has(timerKey)) {
      clearTimeout(this.respawnTimers.get(timerKey)!);
      this.respawnTimers.delete(timerKey);
    }

    // Check win condition
    if (gameState.phase === 'playing') {
      const winnerId = PlayerManager.checkWinCondition(room, gameState);
      if (winnerId !== null) {
        this.endGame(room, winnerId);
      }
    }

    this.broadcastRoomState(room);
  }

  onRoomDestroy?(room: Room): void {
    console.log(`[${this.name}] Room ${room.code} is being destroyed`);

    // Stop game loop
    const gameLoop = this.gameLoops.get(room.code);
    if (gameLoop) {
      gameLoop.stop();
      this.gameLoops.delete(room.code);
    }

    // Clear all respawn timers for this room
    this.respawnTimers.forEach((timer, key) => {
      if (key.startsWith(room.code)) {
        clearTimeout(timer);
        this.respawnTimers.delete(key);
      }
    });
  }

  // ============================================================================
  // SERIALIZATION
  // ============================================================================

  serializeRoom(room: Room, socketId: string): SerializedRoom {
    const gameState = room.gameState.data as BombermanGameState;

    // Serialize players
    const players: SerializedPlayer[] = Array.from(room.players.values()).map(p => {
      const data = p.gameData as BombermanPlayerData;
      return {
        id: p.id,
        socketId: p.socketId,
        name: p.name,
        isHost: p.isHost,
        connected: p.connected,
        gridX: data?.gridX ?? 0,
        gridY: data?.gridY ?? 0,
        maxBombs: data?.maxBombs ?? 1,
        bombsPlaced: data?.bombsPlaced ?? 0,
        fireRange: data?.fireRange ?? 2,
        speed: data?.speed ?? 150,
        alive: data?.alive ?? true,
        color: data?.color ?? 0xffffff,
        kills: data?.kills ?? 0,
        deaths: data?.deaths ?? 0,
        hasKick: data?.hasKick ?? false,
        hasThrow: data?.hasThrow ?? false,
        stunnedUntil: data?.stunnedUntil ?? 0,
        facingDir: data?.facingDir ?? DIRECTION.DOWN,
        // New power-up flags
        hasPunch: data?.hasPunch ?? false,
        hasPierce: data?.hasPierce ?? false,
        hasBombPass: data?.hasBombPass ?? false,
        curseType: data?.curseType ?? null,
        curseEndTime: data?.curseEndTime ?? 0,
        // Roguelite progression
        bomberClass: data?.bomberClass ?? BOMBER_CLASS.CLASSIC,
        ultimateCharge: data?.ultimateCharge ?? 0,
        ultimateActive: data?.ultimateActive ?? false,
        ultimateEndTime: data?.ultimateEndTime ?? 0,
        equippedRunes: data?.equippedRunes ?? [],
        soulsCollected: data?.soulsCollected ?? 0,
        extraLivesRemaining: data?.runeState?.extraLivesRemaining ?? 0,
      };
    });

    // Serialize bombs
    const bombs: SerializedBomb[] = [];
    gameState.bombs.forEach((bomb) => {
      bombs.push({
        id: bomb.id,
        ownerId: bomb.ownerId,
        gridX: bomb.gridX,
        gridY: bomb.gridY,
        range: bomb.range,
        timer: bomb.timer,
        isMoving: bomb.isMoving,
        moveDir: bomb.moveDir,
        isFlying: bomb.isFlying,
        flyDir: bomb.flyDir,
        targetX: bomb.targetX,
        targetY: bomb.targetY,
        isPiercing: bomb.isPiercing,
        isPunched: bomb.isPunched,
      });
    });

    // Serialize explosions
    const explosions: SerializedExplosion[] = [];
    gameState.explosions.forEach((explosion) => {
      explosions.push({
        id: explosion.id,
        gridX: explosion.gridX,
        gridY: explosion.gridY,
        timer: explosion.timer,
      });
    });

    return {
      code: room.code,
      hostId: room.hostId,
      mySocketId: socketId,
      players,
      state: gameState.phase,
      settings: {
        minPlayers: room.settings?.minPlayers || GAME_CONFIG.MIN_PLAYERS,
        maxPlayers: room.settings?.maxPlayers || GAME_CONFIG.MAX_PLAYERS,
        gameMode: gameState.gameModeString || 'classic',
      },
      gameData: {
        tiles: gameState.tiles,
        bombs,
        explosions,
        countdown: gameState.countdown,
        timeRemaining: gameState.timeRemaining,
        gameMode: gameState.gameMode,
        winnerId: gameState.winnerId,
        // Sudden Death
        suddenDeathActive: gameState.suddenDeathActive,
        fallingBlocks: gameState.fallingBlocks.map(fb => ({
          x: fb.x,
          y: fb.y,
          fallTime: fb.fallTime,
        })),
        // Teams
        teams: gameState.teams || [],
      },
    };
  }

  // ============================================================================
  // SOCKET HANDLERS
  // ============================================================================

  socketHandlers: Record<string, SocketEventHandler> = {
    /**
     * Player movement
     */
    'player:move': async (socket: Socket, data: { direction: number }, room: Room) => {
      const gameState = room.gameState.data as BombermanGameState;
      if (gameState.phase !== 'playing') return;

      const player = Array.from(room.players.values()).find(p => p.socketId === socket.id);
      if (!player) return;

      const result = PlayerManager.handleMove(player, data.direction as Direction, room, gameState);

      // If player walked into an explosion, kill them
      if (result.walkedIntoExplosion) {
        this.handlePlayerKill(room, player, player.id); // Self-kill (suicide by fire)
      }

      this.broadcastRoomState(room);
    },

    /**
     * Place bomb
     */
    'player:bomb': async (socket: Socket, data: any, room: Room) => {
      const gameState = room.gameState.data as BombermanGameState;
      if (gameState.phase !== 'playing') return;

      const player = Array.from(room.players.values()).find(p => p.socketId === socket.id);
      if (!player) return;

      const playerData = player.gameData as BombermanPlayerData;
      if (!playerData.alive) return;

      BombManager.placeBomb(room, player, gameState);
      this.broadcastRoomState(room);
    },

    /**
     * Throw bomb
     */
    'player:throw': async (socket: Socket, data: any, room: Room) => {
      const gameState = room.gameState.data as BombermanGameState;
      if (gameState.phase !== 'playing') return;

      const player = Array.from(room.players.values()).find(p => p.socketId === socket.id);
      if (!player) return;

      const playerData = player.gameData as BombermanPlayerData;
      if (!playerData.alive || !playerData.hasThrow) return;
      if (playerData.stunnedUntil > Date.now()) return;

      // Find bomb at player's position
      const bomb = BombManager.findBombAt(gameState, playerData.gridX, playerData.gridY);
      if (bomb) {
        BombManager.throwBomb(bomb, player, gameState);
        this.broadcastRoomState(room);
      }
    },

    /**
     * Punch bomb (boxing glove power-up)
     */
    'player:punch': async (socket: Socket, data: any, room: Room) => {
      const gameState = room.gameState.data as BombermanGameState;
      if (gameState.phase !== 'playing') return;

      const player = Array.from(room.players.values()).find(p => p.socketId === socket.id);
      if (!player) return;

      const playerData = player.gameData as BombermanPlayerData;
      if (!playerData.alive || !playerData.hasPunch) return;
      if (playerData.stunnedUntil > Date.now()) return;

      // Punch bomb in front of player
      const punched = BombManager.punchBomb(player, gameState, room, (hitPlayer) => {
        PlayerManager.stunPlayer(hitPlayer);
      });

      if (punched) {
        this.broadcastRoomState(room);
      }
    },

    /**
     * Start game (host only)
     */
    'game:start': async (socket: Socket, data: any, room: Room) => {
      const player = Array.from(room.players.values()).find(p => p.socketId === socket.id);
      if (!player?.isHost) {
        socket.emit('error', { message: 'Only the host can start the game' });
        return;
      }

      const gameState = room.gameState.data as BombermanGameState;
      if (gameState.phase !== 'lobby') {
        socket.emit('error', { message: 'Game is not in lobby' });
        return;
      }

      const connectedPlayers = Array.from(room.players.values()).filter(p => p.connected);
      if (connectedPlayers.length < GAME_CONFIG.MIN_PLAYERS) {
        socket.emit('error', { message: `Need at least ${GAME_CONFIG.MIN_PLAYERS} players` });
        return;
      }

      // Start countdown
      this.startCountdown(room);
    },

    /**
     * Set game mode (host only) - Legacy numeric mode
     */
    'game:setMode': async (socket: Socket, data: { mode: number }, room: Room) => {
      const player = Array.from(room.players.values()).find(p => p.socketId === socket.id);
      if (!player?.isHost) return;

      const gameState = room.gameState.data as BombermanGameState;
      if (gameState.phase !== 'lobby') return;

      gameState.gameMode = data.mode;
      this.broadcastRoomState(room);
    },

    /**
     * Update game settings (host only) - Handles string game modes
     */
    'settings:update': async (socket: Socket, data: { settings: { gameMode?: 'classic' | 'teams' | 'dungeon' } }, room: Room) => {
      const player = Array.from(room.players.values()).find(p => p.socketId === socket.id);
      if (!player?.isHost) {
        socket.emit('error', { message: 'Only host can update settings' });
        return;
      }

      const gameState = room.gameState.data as BombermanGameState;
      if (gameState.phase !== 'lobby') {
        socket.emit('error', { message: 'Can only update settings in lobby' });
        return;
      }

      const newSettings = data.settings;

      // Handle game mode change
      if (newSettings.gameMode !== undefined && newSettings.gameMode !== gameState.gameModeString) {
        gameState.gameModeString = newSettings.gameMode;

        // Map string mode to numeric mode
        switch (newSettings.gameMode) {
          case 'classic':
            gameState.gameMode = GAME_MODE.LAST_MAN_STANDING;
            gameState.teams = [];
            break;
          case 'teams':
            gameState.gameMode = GAME_MODE.LAST_MAN_STANDING; // Teams use same win condition
            // Initialize teams
            gameState.teams = [
              { id: 'red', name: 'Team Red', color: '#ff4444', playerIds: [] },
              { id: 'blue', name: 'Team Blue', color: '#4444ff', playerIds: [] },
            ];
            // Auto-assign all players to teams
            room.players.forEach(p => {
              this.autoAssignToTeam(room, p);
            });
            console.log(`[${this.name}] Teams mode enabled, ${room.players.size} players assigned`);
            break;
          case 'dungeon':
            gameState.gameMode = GAME_MODE.DUNGEON;
            gameState.teams = [];
            console.log(`[${this.name}] Dungeon mode enabled`);
            break;
        }
      }

      console.log(`[${this.name}] Settings updated by ${player.name}: gameMode=${newSettings.gameMode}`);
      this.broadcastRoomState(room);
    },

    /**
     * Shuffle teams (host only)
     */
    'game:shuffle-teams': async (socket: Socket, data: any, room: Room) => {
      const player = Array.from(room.players.values()).find(p => p.socketId === socket.id);
      if (!player?.isHost) {
        socket.emit('error', { message: 'Only host can shuffle teams' });
        return;
      }

      const gameState = room.gameState.data as BombermanGameState;
      if (gameState.gameModeString !== 'teams' || gameState.teams.length === 0) {
        return;
      }

      // Clear all team assignments
      gameState.teams.forEach(team => {
        team.playerIds = [];
      });

      // Shuffle players and reassign
      const shuffledPlayers = Array.from(room.players.values()).sort(() => Math.random() - 0.5);
      shuffledPlayers.forEach(p => {
        this.autoAssignToTeam(room, p);
      });

      console.log(`[${this.name}] Teams shuffled by ${player.name}`);
      this.broadcastRoomState(room);
    },

    /**
     * Switch team (player request)
     */
    'game:switch-team': async (socket: Socket, data: { teamId: string }, room: Room) => {
      const player = Array.from(room.players.values()).find(p => p.socketId === socket.id);
      if (!player) return;

      const gameState = room.gameState.data as BombermanGameState;
      if (gameState.gameModeString !== 'teams' || gameState.teams.length === 0) {
        return;
      }

      const targetTeam = gameState.teams.find(t => t.id === data.teamId);
      if (!targetTeam) return;

      // Check balance - don't allow if it would create imbalance > 1
      const currentTeam = gameState.teams.find(t => t.playerIds.includes(player.socketId));
      if (currentTeam && currentTeam.id !== targetTeam.id) {
        const newTargetSize = targetTeam.playerIds.length + 1;
        const newCurrentSize = currentTeam.playerIds.length - 1;
        if (newTargetSize - newCurrentSize > 1) {
          socket.emit('error', { message: 'Cannot switch - would create team imbalance' });
          return;
        }

        // Remove from current team
        currentTeam.playerIds = currentTeam.playerIds.filter(id => id !== player.socketId);
      }

      // Add to target team (if not already on it)
      if (!targetTeam.playerIds.includes(player.socketId)) {
        targetTeam.playerIds.push(player.socketId);
      }

      console.log(`[${this.name}] ${player.name} switched to ${targetTeam.name}`);
      this.broadcastRoomState(room);
    },

    /**
     * Restart game (host only)
     */
    'game:restart': async (socket: Socket, data: any, room: Room) => {
      const player = Array.from(room.players.values()).find(p => p.socketId === socket.id);
      if (!player?.isHost) {
        socket.emit('error', { message: 'Only the host can restart the game' });
        return;
      }

      this.resetGame(room);
    },

    // ============================================================================
    // PROGRESSION HANDLERS
    // ============================================================================

    /**
     * Sync player profile from client
     */
    'profile:sync': async (socket: Socket, data: { profile: Partial<PlayerProfile> }, room: Room) => {
      const player = Array.from(room.players.values()).find(p => p.socketId === socket.id);
      if (!player) return;

      // Sync profile with server cache
      const profile = ProgressionManager.syncProfile(player.id, data.profile);

      // Send back validated profile
      socket.emit('profile:synced', { profile: ProgressionManager.serializeProfile(profile) });
    },

    /**
     * Set loadout (bomber class + runes)
     */
    'loadout:set': async (socket: Socket, data: { bomberClass: BomberClassId; runes: RuneId[] }, room: Room) => {
      const gameState = room.gameState.data as BombermanGameState;
      if (gameState.phase !== 'lobby') {
        socket.emit('error', { message: 'Can only change loadout in lobby' });
        return;
      }

      const player = Array.from(room.players.values()).find(p => p.socketId === socket.id);
      if (!player) return;

      // Get player profile and validate loadout
      const profile = ProgressionManager.getProfile(player.id);
      const validated = ProgressionManager.validateLoadout(profile, data.bomberClass, data.runes);

      // Store loadout for when game starts
      const loadoutKey = `${room.code}:${player.id}`;
      this.playerLoadouts.set(loadoutKey, validated);

      // Send back validated loadout
      socket.emit('loadout:validated', validated);

      console.log(`[${this.name}] Player ${player.name} set loadout: ${validated.bomberClass}, runes: ${validated.runes.join(', ')}`);
    },

    /**
     * Get profile (for initial load)
     */
    'profile:get': async (socket: Socket, data: any, room: Room) => {
      const player = Array.from(room.players.values()).find(p => p.socketId === socket.id);
      if (!player) return;

      const profile = ProgressionManager.getProfile(player.id);
      socket.emit('profile:data', { profile: ProgressionManager.serializeProfile(profile) });
    },

    /**
     * Activate ultimate ability
     */
    'player:ultimate': async (socket: Socket, data: any, room: Room) => {
      const gameState = room.gameState.data as BombermanGameState;
      if (gameState.phase !== 'playing') return;

      const player = Array.from(room.players.values()).find(p => p.socketId === socket.id);
      if (!player) return;

      const playerData = player.gameData as BombermanPlayerData;
      if (!playerData.alive) return;

      // Try to activate ultimate
      const activated = ProgressionManager.activateUltimate(playerData, gameState);

      if (activated) {
        // Handle instant ultimates
        this.handleUltimateActivation(room, player, playerData);
        this.broadcastRoomState(room);
      }
    },
  };

  // ============================================================================
  // GAME LOOP
  // ============================================================================

  private startGameLoop(room: Room): void {
    const gameLoop = new GameLoop();
    this.gameLoops.set(room.code, gameLoop);

    gameLoop.start((deltaTime) => {
      this.update(room, deltaTime);
    }, GAME_CONFIG.TICK_RATE);
  }

  private update(room: Room, deltaTime: number): void {
    const gameState = room.gameState.data as BombermanGameState;

    switch (gameState.phase) {
      case 'countdown':
        this.updateCountdown(room, deltaTime);
        break;
      case 'playing':
        this.updatePlaying(room, deltaTime);
        break;
    }
  }

  private updateCountdown(room: Room, deltaTime: number): void {
    const gameState = room.gameState.data as BombermanGameState;

    gameState.countdown -= deltaTime;
    if (gameState.countdown <= 0) {
      gameState.countdown = 0;
      gameState.phase = 'playing';

      if (gameState.gameMode === GAME_MODE.DEATHMATCH) {
        gameState.timeRemaining = GAME_CONFIG.DEATHMATCH_TIME;
      }

      console.log(`[${this.name}] Game started in room ${room.code}!`);
      this.broadcastRoomState(room);
    } else {
      // During countdown, only broadcast at 10Hz (every 100ms) for countdown display
      const now = Date.now();
      const lastBroadcast = (gameState as any)._lastBroadcast || 0;
      if (now - lastBroadcast >= 100) {
        (gameState as any)._lastBroadcast = now;
        this.broadcastRoomState(room);
      }
    }
  }

  private updatePlaying(room: Room, deltaTime: number): void {
    const gameState = room.gameState.data as BombermanGameState;

    // Update deathmatch timer
    if (gameState.gameMode === GAME_MODE.DEATHMATCH) {
      gameState.timeRemaining -= deltaTime;
      if (gameState.timeRemaining <= 0) {
        const winnerId = PlayerManager.getDeathmatchWinner(room);
        this.endGame(room, winnerId);
        return;
      }
    }

    // Update curse effects for all players
    room.players.forEach((player) => {
      CurseManager.updateCurse(player, room, gameState);
    });

    // Update sudden death (arena shrinking)
    SuddenDeathManager.update(gameState, room, (player, killerId) => {
      this.handlePlayerKill(room, player, killerId);
    });

    // Update moving bombs (kick)
    BombManager.updateMovingBombs(gameState, room, (player) => {
      PlayerManager.stunPlayer(player);
    });

    // Update flying bombs (throw)
    BombManager.updateFlyingBombs(gameState, room, (player) => {
      PlayerManager.stunPlayer(player);
    });

    // Update bombs
    BombManager.updateBombs(deltaTime, room, gameState, (bomb) => {
      // After explosion, check for kills
      PlayerManager.checkExplosionKills(bomb.ownerId, room, gameState, (player, killerId) => {
        this.handlePlayerKill(room, player, killerId);
      });
    });

    // Update explosions
    BombManager.updateExplosions(deltaTime, gameState);

    // Broadcast state at 20Hz (every 50ms) to reduce client load
    // Game runs at 60Hz but clients don't need that many updates
    const now = Date.now();
    const lastBroadcast = (gameState as any)._lastBroadcast || 0;
    if (now - lastBroadcast >= 50) {
      (gameState as any)._lastBroadcast = now;
      this.broadcastRoomState(room);
    }
  }

  // ============================================================================
  // TEAM HELPERS
  // ============================================================================

  /**
   * Auto-assign a player to the team with fewer players
   */
  private autoAssignToTeam(room: Room, player: Player): void {
    const gameState = room.gameState.data as BombermanGameState;
    if (gameState.teams.length === 0) return;

    // Find team with fewest players
    const sortedTeams = [...gameState.teams].sort((a, b) => a.playerIds.length - b.playerIds.length);
    const targetTeam = sortedTeams[0];

    // Remove from any existing team
    gameState.teams.forEach(team => {
      team.playerIds = team.playerIds.filter(id => id !== player.socketId);
    });

    // Add to target team
    targetTeam.playerIds.push(player.socketId);
  }

  // ============================================================================
  // GAME LOGIC
  // ============================================================================

  private startCountdown(room: Room): void {
    const gameState = room.gameState.data as BombermanGameState;

    gameState.countdown = GAME_CONFIG.COUNTDOWN_TIME;
    gameState.phase = 'countdown';

    // Apply player loadouts (class + runes)
    room.players.forEach((player) => {
      const loadoutKey = `${room.code}:${player.id}`;
      const loadout = this.playerLoadouts.get(loadoutKey) || {
        bomberClass: BOMBER_CLASS.CLASSIC as BomberClassId,
        runes: [] as RuneId[],
      };

      const playerData = player.gameData as BombermanPlayerData;
      if (playerData) {
        // Set bomber class and runes
        playerData.bomberClass = loadout.bomberClass;
        playerData.equippedRunes = loadout.runes;

        // Apply class passive
        ProgressionManager.applyClassPassive(playerData, loadout.bomberClass);

        // Apply rune starting effects
        ProgressionManager.applyRuneEffects(playerData, loadout.runes);

        console.log(`[${this.name}] Applied loadout to ${player.name}: ${loadout.bomberClass}, runes: ${loadout.runes.join(', ')}`);
      }
    });

    console.log(`[${this.name}] Countdown started in room ${room.code}!`);
    this.broadcastRoomState(room);
  }

  private handlePlayerKill(room: Room, player: Player, killerId: string): void {
    const gameState = room.gameState.data as BombermanGameState;
    const playerData = player.gameData as BombermanPlayerData;

    // Check if player is saved by Tank passive or Second Wind rune
    const actuallyDied = ProgressionManager.handleDeath(playerData, room);

    if (!actuallyDied) {
      // Player was saved! Broadcast the survival
      this.broadcastRoomState(room);
      return;
    }

    // Player actually died
    PlayerManager.killPlayer(player, killerId, room, gameState);

    // Credit the killer with ultimate charge and souls
    if (killerId && killerId !== player.id) {
      const killer = room.players.get(killerId);
      if (killer) {
        const killerData = killer.gameData as BombermanPlayerData;
        if (killerData) {
          ProgressionManager.handleKill(killerData, playerData);
        }
      }
    }

    // Handle based on game mode
    if (gameState.gameMode === GAME_MODE.DEATHMATCH) {
      // Respawn after delay
      const timerKey = `${room.code}:${player.id}:respawn`;
      const timer = setTimeout(() => {
        PlayerManager.respawnPlayer(player);
        this.respawnTimers.delete(timerKey);
        this.broadcastRoomState(room);
      }, 2000);
      this.respawnTimers.set(timerKey, timer);
    } else {
      // Last man standing - check win
      const winnerId = PlayerManager.checkWinCondition(room, gameState);
      if (winnerId !== null) {
        this.endGame(room, winnerId);
      }
    }
  }

  private endGame(room: Room, winnerId: string): void {
    const gameState = room.gameState.data as BombermanGameState;

    gameState.winnerId = winnerId;
    gameState.phase = 'ended';

    const winner = room.players.get(winnerId);
    console.log(`[${this.name}] Game ended in room ${room.code}! Winner: ${winner?.name || 'None'}`);

    // Process match rewards for all players
    const rewards = ProgressionManager.processMatchEnd(room, gameState);
    this.pendingRewards.set(room.code, rewards);

    // Send rewards to each player
    const namespace = this.io?.of(this.namespace);
    if (namespace) {
      room.players.forEach((player) => {
        const playerRewards = rewards.get(player.id);
        if (playerRewards) {
          namespace.to(player.socketId).emit('match:rewards', {
            rewards: playerRewards,
            profile: ProgressionManager.serializeProfile(ProgressionManager.getProfile(player.id)),
          });
          console.log(`[${this.name}] Sent rewards to ${player.name}: +${playerRewards.xpGained} XP, +${playerRewards.fameGained} Fame`);
        }
      });
    }

    this.broadcastRoomState(room);

    // Auto-reset after delay
    setTimeout(() => {
      this.resetGame(room);
    }, 5000);
  }

  private resetGame(room: Room): void {
    const gameState = room.gameState.data as BombermanGameState;

    // Clear all bombs and explosions
    gameState.bombs.clear();
    gameState.explosions.clear();

    // Reset players
    room.players.forEach((player) => {
      PlayerManager.resetPlayer(player);
    });

    // Regenerate map
    gameState.tiles = MapGenerator.generate(GAME_CONFIG.MAX_PLAYERS);

    // Reset game state
    gameState.winnerId = null;
    gameState.phase = 'lobby';
    gameState.countdown = 0;
    gameState.timeRemaining = 0;

    // Reset sudden death
    SuddenDeathManager.reset(gameState);

    console.log(`[${this.name}] Game reset in room ${room.code}!`);
    this.broadcastRoomState(room);
  }

  // ============================================================================
  // ULTIMATE ABILITIES
  // ============================================================================

  private handleUltimateActivation(room: Room, player: Player, playerData: BombermanPlayerData): void {
    const gameState = room.gameState.data as BombermanGameState;

    switch (playerData.bomberClass) {
      case BOMBER_CLASS.CLASSIC:
        // Mega Bomb: Next bomb has 3x range
        // This is handled in BombManager when placing bomb
        break;

      case BOMBER_CLASS.SPEEDSTER:
        // Time Warp: Freeze all bomb timers for 3 seconds
        // Duration-based ultimate - bombs won't tick down while active
        // This is handled in the update loop
        break;

      case BOMBER_CLASS.TANK:
        // Shield Dome: Block all explosions for 4 seconds
        // Duration-based ultimate - handled in explosion damage check
        break;

      case BOMBER_CLASS.PYROMANIAC:
        // Inferno: All player's bombs on field detonate instantly
        const playerBombs: string[] = [];
        gameState.bombs.forEach((bomb, id) => {
          if (bomb.ownerId === player.id) {
            playerBombs.push(id);
          }
        });
        // Trigger all bombs
        for (const bombId of playerBombs) {
          const bomb = gameState.bombs.get(bombId);
          if (bomb) {
            bomb.timer = 0; // Force immediate detonation
          }
        }
        break;

      case BOMBER_CLASS.TRICKSTER:
        // Decoy Bombs: Place 3 fake bombs nearby
        // TODO: Implement decoy bomb placement
        break;

      case BOMBER_CLASS.NECROMANCER:
        // Revive: This is handled when player dies and has enough souls
        // For now, just mark as used
        break;
    }

    console.log(`[${this.name}] ${player.name} activated ultimate: ${playerData.bomberClass}`);
  }

  // ============================================================================
  // HELPERS
  // ============================================================================

  private broadcastRoomState(room: Room): void {
    if (!this.io) return;

    const namespace = this.io.of(this.namespace);

    // Send personalized state to each player
    room.players.forEach(player => {
      const serialized = this.serializeRoom(room, player.socketId);
      namespace.to(player.socketId).emit('roomStateUpdated', serialized);
    });
  }
}

export default new BombermanPlugin();
