/**
 * Canvas Chaos - Game Plugin
 * A party game with multiple drawing-based modes:
 * - Freeze Frame: Draw on frozen video frames
 * - Artistic Differences: Spot the secret modifier
 * - Evolution: Mutate creatures together
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
  GameMode,
  GamePhase,
  CanvasChaosGameState,
  CanvasChaosPlayerData,
  CanvasChaosSettings,
  FreezeFrameData,
  ArtisticDiffData,
  EvolutionData,
  DrawingSubmission,
  PlayerPromptSubmission,
  createInitialGameState,
  createInitialPlayerData,
  createFreezeFrameData,
  createArtisticDiffData,
  createEvolutionData,
} from './types.js';

import { contentService } from './services/contentService.js';

import {
  selectModeSchema,
  submitPromptSchema,
  submitDrawingSchema,
  captureFrameSchema,
  submitVoteSchema,
  submitModifierGuessSchema,
  submitNameSchema,
  voteMutationSchema,
  voteNameSchema,
  updateSettingsSchema,
} from './schemas.js';

// ============================================================================
// PLUGIN CLASS
// ============================================================================

class CanvasChaosPlugin implements GamePlugin {
  // Metadata
  id = 'canvas-chaos';
  name = 'Canvas Chaos';
  version = '1.0.0';
  description = 'A party game with multiple drawing-based modes';
  author = 'GameBuddies';
  namespace = '/canvas-chaos';
  basePath = '/canvas-chaos';

  // Default settings
  defaultSettings: RoomSettings = {
    minPlayers: 3,
    maxPlayers: 12,
    gameSpecific: {
      defaultMode: 'freeze-frame',
      roundsPerGame: 3,
      drawingTime: 45,
      votingTime: 20,
      freezeFramePrompts: true,
      modifierDifficulty: 'medium',
      mutationTime: 15,
      originTime: 20,
      useMutationPrompts: true,
      useDatabasePrompts: false,   // false = use player prompts by default
      promptSubmissionTime: 30,    // 30 seconds for prompt submission
    } as CanvasChaosSettings
  };

  // Private properties
  private io: any;
  private timers = new Map<string, NodeJS.Timeout>();
  private intervals = new Map<string, NodeJS.Timeout>();
  private transitionLock = new Map<string, boolean>(); // FIX #6: Prevent double transitions

  // Helper to ensure player gameData is initialized
  private ensurePlayerData(player: Player): CanvasChaosPlayerData {
    if (!player.gameData) {
      player.gameData = createInitialPlayerData();
    }
    return player.gameData as CanvasChaosPlayerData;
  }

  // ============================================================================
  // LIFECYCLE HOOKS
  // ============================================================================

  async onInitialize(io: any): Promise<void> {
    this.io = io;
    // Preload content from database
    await contentService.preloadContent();
    console.log(`[${this.name}] Plugin initialized`);
  }

  onRoomCreate(room: Room): void {
    console.log(`[${this.name}] Room created: ${room.code}`);
    room.gameState.data = createInitialGameState();
    room.gameState.phase = 'lobby';
  }

  onPlayerJoin(room: Room, player: Player, isReconnecting?: boolean): void {
    console.log(`[${this.name}] Player ${player.name} ${isReconnecting ? 'reconnected to' : 'joined'} room ${room.code}`);

    // FIX #3: Preserve existing game data on reconnect
    if (isReconnecting && player.gameData) {
      // Player is reconnecting - keep their submission state
      console.log(`[${this.name}] Preserving game state for reconnecting player ${player.name}`);
    } else {
      // New player - initialize fresh data
      this.ensurePlayerData(player);
    }

    this.broadcastRoomState(room);
  }

  onPlayerDisconnected(room: Room, player: Player): void {
    console.log(`[${this.name}] Player ${player.name} disconnected from room ${room.code}`);

    const gameState = room.gameState.data as CanvasChaosGameState;

    // FIX #1: Handle mode-specific disconnection scenarios
    if (room.gameState.phase === 'playing' && gameState.phase !== 'lobby') {
      switch (gameState.mode) {
        case 'evolution': {
          const modeData = gameState.modeData as EvolutionData;
          // If the current artist disconnected, advance to next artist
          if (modeData.currentArtistId === player.id) {
            console.log(`[${this.name}] Current Evolution artist disconnected, advancing chain`);
            this.advanceEvolutionAfterDisconnect(room);
          }
          break;
        }

        case 'freeze-frame': {
          const modeData = gameState.modeData as FreezeFrameData;
          // If the subject disconnected during countdown/capture, use fallback
          if (modeData.subjectPlayerId === player.id && gameState.phase === 'playing') {
            console.log(`[${this.name}] Freeze Frame subject disconnected, using fallback`);
            this.handleCaptureFallback(room);
          }
          break;
        }

        case 'artistic-diff': {
          const modeData = gameState.modeData as ArtisticDiffData;
          // FIX #21: Auto-submit modifier's drawing on disconnect so voting works
          if (modeData.modifierPlayerId === player.id && gameState.phase === 'drawing') {
            console.log(`[${this.name}] Modifier player disconnected during drawing - auto-submitting`);
            const playerData = player.gameData as CanvasChaosPlayerData | undefined;
            if (playerData?.currentDrawing && !playerData.hasSubmitted) {
              modeData.submissions.set(player.id, {
                playerId: player.id,
                playerName: player.name,
                imageData: playerData.currentDrawing,
              });
              playerData.hasSubmitted = true;
            }
          }
          break;
        }
      }

      // Check if we still have enough players for the mode
      this.checkMinimumPlayersForMode(room);
    }

    this.broadcastRoomState(room);
  }

  onPlayerLeave(room: Room, player: Player): void {
    console.log(`[${this.name}] Player ${player.name} removed from room ${room.code}`);

    const connectedPlayers = Array.from(room.players.values()).filter(p => p.connected);
    if (room.gameState.phase !== 'lobby' && connectedPlayers.length < room.settings.minPlayers) {
      this.endGame(room, 'Not enough players');
    }

    this.broadcastRoomState(room);
  }

  onRoomDestroy?(room: Room): void {
    console.log(`[${this.name}] Room ${room.code} is being destroyed`);
    this.clearRoomTimers(room.code);
  }

  // ============================================================================
  // SERIALIZATION
  // ============================================================================

  serializeRoom(room: Room, socketId: string): any {
    const gameState = room.gameState.data as CanvasChaosGameState;
    const requestingPlayer = Array.from(room.players.values()).find(p => p.socketId === socketId);

    return {
      code: room.code,
      hostId: room.hostId,

      players: Array.from(room.players.values()).map(p => {
        const playerData = p.gameData as CanvasChaosPlayerData;
        return {
          socketId: p.socketId,
          id: p.id,
          name: p.name,
          isHost: p.isHost,
          connected: p.connected,
          disconnectedAt: p.disconnectedAt,
          score: playerData?.score || 0,
          isReady: playerData?.isReady || false,
          hasSubmitted: playerData?.hasSubmitted || false,
          hasVideo: playerData?.hasVideo || false,
          premiumTier: p.premiumTier,
          avatarUrl: p.avatarUrl,
        };
      }),

      state: room.gameState.phase,

      gameData: this.serializeGameData(gameState, requestingPlayer),

      settings: {
        ...room.settings,
        gameSpecific: room.settings.gameSpecific as CanvasChaosSettings
      },

      messages: room.messages.slice(-100),
      mySocketId: socketId,
      isGameBuddiesRoom: room.isGameBuddiesRoom || false,
      gameBuddiesRoomId: room.gameBuddiesRoomId
    };
  }

  private serializeGameData(gameState: CanvasChaosGameState, player?: Player): any {
    const baseData = {
      mode: gameState.mode,
      phase: gameState.phase,
      round: gameState.round,
      totalRounds: gameState.totalRounds,
      timeRemaining: gameState.timeRemaining,
      awaitingNextRound: gameState.awaitingNextRound,
      // Serialize promptSubmissions Map to object for client
      promptSubmissions: gameState.promptSubmissions
        ? Object.fromEntries(
            Array.from(gameState.promptSubmissions.entries()).map(([id, sub]) => [
              id,
              { playerId: sub.playerId, playerName: sub.playerName, prompt: sub.prompt, modifier: sub.modifier, used: sub.used }
            ])
          )
        : {},
    };

    if (!gameState.modeData) {
      return baseData;
    }

    // Serialize mode-specific data
    switch (gameState.mode) {
      case 'freeze-frame':
        return {
          ...baseData,
          modeData: this.serializeFreezeFrameData(gameState.modeData as FreezeFrameData),
        };
      case 'artistic-diff':
        return {
          ...baseData,
          modeData: this.serializeArtisticDiffData(gameState.modeData as ArtisticDiffData, player, gameState),
        };
      case 'evolution':
        return {
          ...baseData,
          modeData: this.serializeEvolutionData(gameState.modeData as EvolutionData),
        };
      default:
        return baseData;
    }
  }

  private serializeFreezeFrameData(data: FreezeFrameData): any {
    return {
      subjectPlayerId: data.subjectPlayerId,
      subjectPlayerName: data.subjectPlayerName,
      frozenFrame: data.frozenFrame,
      prompt: data.prompt,
      submissions: Array.from(data.submissions.entries()).map(([id, sub]) => ({
        playerId: sub.playerId,
        playerName: sub.playerName,
        imageData: sub.imageData,
      })),
      votes: Object.fromEntries(data.votes),
      subjectHistory: data.subjectHistory,
      subjectDisconnected: data.subjectDisconnected,
      skippedRound: data.skippedRound,
      skipReason: data.skipReason,
    };
  }

  private serializeArtisticDiffData(data: ArtisticDiffData, player?: Player, gameState?: CanvasChaosGameState): any {
    // Only the modifier player sees the modifier text during drawing
    const isModifierPlayer = player?.id === data.modifierPlayerId;
    // Show modifier to everyone during reveal/results phases
    const isRevealPhase = gameState?.phase === 'reveal' || gameState?.phase === 'results';

    return {
      prompt: data.prompt,
      // Show modifier to the modifier player OR during reveal
      modifier: (isModifierPlayer || isRevealPhase) ? data.modifier : null,
      // Show who has modifier during reveal (so voting UI shows "You have the modifier!")
      modifierPlayerId: isModifierPlayer ? data.modifierPlayerId : (isRevealPhase ? data.modifierPlayerId : null),
      modifierPlayerName: isRevealPhase ? data.modifierPlayerName : null,
      // Show whether the current player has the modifier
      hasModifier: isModifierPlayer,
      submissions: Array.from(data.submissions.entries()).map(([id, sub]) => ({
        playerId: sub.playerId,
        playerName: sub.playerName,
        imageData: sub.imageData,
      })),
      votes: Object.fromEntries(data.votes),
      skippedRound: data.skippedRound,
      skipReason: data.skipReason,
    };
  }

  private serializeEvolutionData(data: EvolutionData): any {
    return {
      chain: data.chain ? {
        id: data.chain.id,
        layers: data.chain.layers,
        mutationOrder: data.chain.mutationOrder,
        finalName: data.chain.finalName,
      } : null,
      currentArtistId: data.currentArtistId,
      currentArtistName: data.currentArtistName,
      stageNumber: data.stageNumber,
      mutationPrompt: data.mutationPrompt,
      nameSubmissions: data.nameSubmissions ? Object.fromEntries(data.nameSubmissions) : {},
      votes: data.votes ? {
        bestMutation: Object.fromEntries(data.votes.bestMutation),
        bestName: Object.fromEntries(data.votes.bestName),
      } : { bestMutation: {}, bestName: {} },
      skippedRound: data.skippedRound,
      skipReason: data.skipReason,
    };
  }

  // ============================================================================
  // SOCKET HANDLERS
  // ============================================================================

  socketHandlers: Record<string, SocketEventHandler> = {
    // -------------------------------------------------------------------------
    // LOBBY & MODE SELECTION
    // -------------------------------------------------------------------------

    'player:ready': async (socket: Socket, data: { ready: boolean }, room: Room, helpers: GameHelpers) => {
      const player = this.getPlayer(room, socket.id);
      if (!player) return;

      const playerData = this.ensurePlayerData(player);
      playerData.isReady = data.ready;

      this.broadcastRoomState(room);
    },

    'player:videoStatus': async (socket: Socket, data: { hasVideo: boolean }, room: Room, helpers: GameHelpers) => {
      const player = this.getPlayer(room, socket.id);
      if (!player) return;

      const playerData = this.ensurePlayerData(player);
      playerData.hasVideo = data.hasVideo;

      console.log(`[${this.name}] Player ${player.name} video status: ${data.hasVideo}`);
      this.broadcastRoomState(room);
    },

    'room:updateLanguage': async (socket: Socket, data: { language: 'en' | 'de' }, room: Room, helpers: GameHelpers) => {
      // Update room language for prompt fetching
      const validLanguages = ['en', 'de'];
      if (data.language && validLanguages.includes(data.language)) {
        room.settings.language = data.language;
        helpers.sendToRoom(room.code, 'room:languageUpdated', { language: data.language });
        console.log(`[${this.name}] Room language updated to: ${data.language}`);
      }
    },

    'player:kick': async (socket: Socket, data: { roomCode: string; playerId: string }, room: Room, helpers: GameHelpers) => {
      const { playerId } = data;

      // Find current player (the one who clicked kick)
      const currentPlayer = Array.from(room.players.values())
        .find(p => p.socketId === socket.id);

      // Only host can kick
      if (!currentPlayer?.isHost) {
        socket.emit('error', { message: 'Only host can kick players' });
        return;
      }

      // Find target player
      const targetPlayer = Array.from(room.players.values())
        .find(p => p.id === playerId);

      if (!targetPlayer) {
        socket.emit('error', { message: 'Player not found' });
        return;
      }

      // Cannot kick the host
      if (targetPlayer.isHost) {
        socket.emit('error', { message: 'Cannot kick the host' });
        return;
      }

      console.log(`[${this.name}] Host ${currentPlayer.name} kicking ${targetPlayer.name}`);

      // 1. Notify kicked player FIRST
      helpers.sendToPlayer(targetPlayer.socketId, 'player:kicked', {
        message: 'You have been kicked by the host'
      });

      // 2. Invalidate session to prevent auto-reconnect
      if (targetPlayer.sessionToken) {
        helpers.invalidateSession(targetPlayer.sessionToken);
      }

      // 3. Remove from room
      helpers.removePlayerFromRoom(room.code, targetPlayer.socketId);

      // 4. Notify remaining players
      helpers.sendToRoom(room.code, 'player:left', {
        playerId: targetPlayer.socketId,
        playerName: targetPlayer.name,
        reason: 'kicked'
      });

      // 5. Broadcast updated state
      this.broadcastRoomState(room);
    },

    'mode:select': async (socket: Socket, data: any, room: Room, helpers: GameHelpers) => {
      const player = this.getPlayer(room, socket.id);
      if (!player?.isHost) {
        socket.emit('error', { message: 'Only the host can select the mode' });
        return;
      }

      const parsed = selectModeSchema.safeParse(data);
      if (!parsed.success) {
        socket.emit('error', { message: 'Invalid mode' });
        return;
      }

      const gameState = room.gameState.data as CanvasChaosGameState;
      gameState.mode = parsed.data.mode;

      helpers.sendToRoom(room.code, 'mode:selected', { mode: parsed.data.mode });
      this.broadcastRoomState(room);
    },

    'prompt:submit': async (socket: Socket, data: any, room: Room, helpers: GameHelpers) => {
      const player = this.getPlayer(room, socket.id);
      if (!player) return;

      const gameState = room.gameState.data as CanvasChaosGameState;

      // Only accept during prompt-submission phase
      if (gameState.phase !== 'prompt-submission') {
        socket.emit('error', { message: 'Not in prompt submission phase' });
        return;
      }

      const parsed = submitPromptSchema.safeParse(data);
      if (!parsed.success) {
        socket.emit('error', { message: 'Invalid prompt data' });
        return;
      }

      // Check if already submitted
      if (gameState.promptSubmissions.has(player.id)) {
        socket.emit('error', { message: 'You have already submitted a prompt' });
        return;
      }

      // Store the submission
      const submission: PlayerPromptSubmission = {
        playerId: player.id,
        playerName: player.name,
        prompt: parsed.data.prompt,
        modifier: parsed.data.modifier,
        used: false,
      };

      gameState.promptSubmissions.set(player.id, submission);

      helpers.sendToRoom(room.code, 'prompt:submitted', { playerName: player.name });
      console.log(`[${this.name}] ${player.name} submitted prompt: "${parsed.data.prompt}"${parsed.data.modifier ? ` with modifier: "${parsed.data.modifier}"` : ''}`);

      // Check if all connected players have submitted
      const connectedPlayers = Array.from(room.players.values()).filter(p => p.connected);
      if (gameState.promptSubmissions.size >= connectedPlayers.length) {
        this.clearRoomTimers(room.code);
        await this.transitionToNextPhase(room);
      }

      this.broadcastRoomState(room);
    },

    'game:start': async (socket: Socket, data: any, room: Room, helpers: GameHelpers) => {
      const player = this.getPlayer(room, socket.id);
      if (!player?.isHost) {
        socket.emit('error', { message: 'Only the host can start the game' });
        return;
      }

      const connectedPlayers = Array.from(room.players.values()).filter(p => p.connected);
      if (connectedPlayers.length < room.settings.minPlayers) {
        socket.emit('error', { message: `Need at least ${room.settings.minPlayers} players` });
        return;
      }

      const gameState = room.gameState.data as CanvasChaosGameState;
      const settings = room.settings.gameSpecific as CanvasChaosSettings;

      // Use selected mode or default
      if (!gameState.mode) {
        gameState.mode = settings.defaultMode;
      }

      gameState.round = 1;

      // For Evolution mode, set totalRounds to number of connected players
      // so everyone gets a chance to draw
      if (gameState.mode === 'evolution') {
        gameState.totalRounds = connectedPlayers.length;
        console.log(`[${this.name}] Evolution mode: ${connectedPlayers.length} players = ${connectedPlayers.length} rounds`);
      } else {
        gameState.totalRounds = settings.roundsPerGame;
      }


      // Enforce rounds <= players (each player's prompt is used once)
      if (gameState.totalRounds > connectedPlayers.length) {
        gameState.totalRounds = connectedPlayers.length;
        console.log(`[${this.name}] Capped rounds to ${connectedPlayers.length} (player count)`);
      }

      // Initialize mode-specific data
      this.initializeModeData(room, gameState);

      // Clear any old prompt submissions
      gameState.promptSubmissions = new Map();

      // Check if we should use database prompts or player submissions
      const useDbPrompts = settings.useDatabasePrompts ?? false;
      if (useDbPrompts) {
        // Skip prompt submission phase, go directly to first round
        await this.startRound(room);
        helpers.sendToRoom(room.code, 'game:started', { mode: gameState.mode });
        console.log(`[${this.name}] Game started with DB prompts in room ${room.code}`);
      } else {
        // Enter prompt-submission phase
        room.gameState.phase = 'playing';  // Client routing - show GamePage
        gameState.phase = 'prompt-submission';
        gameState.timeRemaining = settings.promptSubmissionTime || 30;
        this.startTimer(room);
        helpers.sendToRoom(room.code, 'game:started', { mode: gameState.mode });
        console.log(`[${this.name}] Game started - prompt submission phase in room ${room.code}`);
      }

      this.broadcastRoomState(room);
    },

    'game:backToLobby': async (socket: Socket, data: any, room: Room, helpers: GameHelpers) => {
      const player = this.getPlayer(room, socket.id);
      if (!player?.isHost) {
        socket.emit('error', { message: 'Only the host can return to lobby' });
        return;
      }

      // Clear all timers
      this.clearRoomTimers(room.code);

      // Reset game state to lobby
      const gameState = room.gameState.data as CanvasChaosGameState;
      gameState.phase = 'lobby';
      gameState.round = 0;
      gameState.timeRemaining = 0;
      gameState.modeData = null;  // Reset mode data for fresh start
      gameState.mode = null;     // Reset mode selection
      room.gameState.phase = 'lobby';

      // Reset player states AND scores for fresh start
      room.players.forEach(p => {
        const playerData = this.ensurePlayerData(p);
        playerData.score = 0;  // Reset scores to 0
        playerData.hasSubmitted = false;
        playerData.currentDrawing = null;
        playerData.votedFor = null;
        playerData.isReady = false;
      });

      helpers.sendToRoom(room.code, 'game:backToLobby', {});
      this.broadcastRoomState(room);
      console.log(`[${this.name}] Host returned room ${room.code} to lobby`);
    },

    // -------------------------------------------------------------------------
    // FREEZE FRAME
    // -------------------------------------------------------------------------

    'freezeframe:capture': async (socket: Socket, data: any, room: Room, helpers: GameHelpers) => {
      const player = this.getPlayer(room, socket.id);
      if (!player) return;

      const parsed = captureFrameSchema.safeParse(data);
      if (!parsed.success) {
        socket.emit('error', { message: 'Invalid frame data' });
        return;
      }

      const gameState = room.gameState.data as CanvasChaosGameState;
      if (gameState.mode !== 'freeze-frame') return;

      // Don't process if already in drawing phase (timeout already triggered)
      if (gameState.phase === 'drawing') {
        console.log(`[${this.name}] Ignoring late frame capture, already in drawing phase`);
        return;
      }

      const modeData = gameState.modeData as FreezeFrameData;

      // Verify sender is the target player (or host for manual capture)
      const isTarget = player.id === modeData.subjectPlayerId;
      const isHost = player.isHost;
      if (!isTarget && !isHost) {
        socket.emit('error', { message: 'Only the target player can send their frame' });
        return;
      }

      // Clear capture timeout since we got the frame
      this.clearTimer(`${room.code}:captureTimeout`);

      // Store the frozen frame
      modeData.frozenFrame = parsed.data.frameData;

      // Add to subject history if not already there
      if (!modeData.subjectHistory.includes(modeData.subjectPlayerId!)) {
        modeData.subjectHistory.push(modeData.subjectPlayerId!);
      }

      // Use player-submitted prompts if available, otherwise fallback to DB
      const settings = room.settings.gameSpecific as CanvasChaosSettings;
      if (settings.freezeFramePrompts) {
        const promptSubmissions = gameState.promptSubmissions;
        const unusedPrompts = Array.from(promptSubmissions.values()).filter(sub => !sub.used);

        if (unusedPrompts.length > 0) {
          const selectedPromptSub = unusedPrompts[Math.floor(Math.random() * unusedPrompts.length)];
          modeData.prompt = selectedPromptSub.prompt;
          selectedPromptSub.used = true;
          console.log(`[${this.name}] FreezeFrame using player prompt: "${modeData.prompt}"`);
        } else {
          // Fallback to DB
          modeData.prompt = await contentService.getRandomFreezeFramePrompt(room.settings.language || 'en');
          console.log(`[${this.name}] FreezeFrame using DB prompt`);
        }
      }


      gameState.phase = 'drawing';
      gameState.timeRemaining = settings.drawingTime;

      this.startTimer(room);
      helpers.sendToRoom(room.code, 'freezeframe:captured', {
        subjectName: modeData.subjectPlayerName,
        frozenFrame: modeData.frozenFrame,
        prompt: modeData.prompt,
      });

      this.broadcastRoomState(room);
      console.log(`[${this.name}] Frame captured from ${player.name}, transitioning to drawing phase`);
    },

    'freezeframe:captureError': async (socket: Socket, data: { reason?: string }, room: Room, helpers: GameHelpers) => {
      const player = this.getPlayer(room, socket.id);
      if (!player) return;

      console.log(`[${this.name}] Capture error from ${player.name}: ${data.reason || 'Unknown'}`);

      const gameState = room.gameState.data as CanvasChaosGameState;
      if (gameState.mode !== 'freeze-frame') return;
      if (gameState.phase === 'drawing') return; // Already transitioned

      const modeData = gameState.modeData as FreezeFrameData;

      // FIX #18: Use Buffer.from for consistency (Node.js native)
      // Use placeholder image (simple gray rectangle with text)
      modeData.frozenFrame = 'data:image/svg+xml;base64,' + Buffer.from(`
        <svg xmlns="http://www.w3.org/2000/svg" width="640" height="480">
          <rect width="100%" height="100%" fill="#1a1a2e"/>
          <text x="50%" y="50%" text-anchor="middle" fill="#00f5ff" font-size="24" font-family="sans-serif">Video unavailable</text>
        </svg>
      `).toString('base64');

      // Clear capture timeout
      this.clearTimer(`${room.code}:captureTimeout`);

      // Add to history and continue
      if (modeData.subjectPlayerId && !modeData.subjectHistory.includes(modeData.subjectPlayerId)) {
        modeData.subjectHistory.push(modeData.subjectPlayerId);
      }

      const settings = room.settings.gameSpecific as CanvasChaosSettings;
      // Use player-submitted prompts if available
      if (settings.freezeFramePrompts) {
        const promptSubmissions = gameState.promptSubmissions;
        const unusedPrompts = Array.from(promptSubmissions.values()).filter(sub => !sub.used);

        if (unusedPrompts.length > 0) {
          const selectedPromptSub = unusedPrompts[Math.floor(Math.random() * unusedPrompts.length)];
          modeData.prompt = selectedPromptSub.prompt;
          selectedPromptSub.used = true;
          console.log(`[${this.name}] FreezeFrame using player prompt (error path): "${modeData.prompt}"`);
        } else {
          modeData.prompt = await contentService.getRandomFreezeFramePrompt(room.settings.language || 'en');
        }
      }

      gameState.phase = 'drawing';
      gameState.timeRemaining = settings.drawingTime;

      this.startTimer(room);
      helpers.sendToRoom(room.code, 'freezeframe:captured', {
        subjectName: modeData.subjectPlayerName,
        frozenFrame: modeData.frozenFrame,
        prompt: modeData.prompt,
      });

      this.broadcastRoomState(room);
      console.log(`[${this.name}] Using placeholder frame, transitioning to drawing phase`);
    },

    // -------------------------------------------------------------------------
    // DRAWING SUBMISSION (ALL MODES)
    // -------------------------------------------------------------------------

    'drawing:submit': async (socket: Socket, data: any, room: Room, helpers: GameHelpers) => {
      const player = this.getPlayer(room, socket.id);
      if (!player) return;

      const gameState = room.gameState.data as CanvasChaosGameState;

      // FIX #4: Validate we're in drawing phase before accepting submissions
      if (gameState.phase !== 'drawing') {
        socket.emit('error', { message: 'Not in drawing phase' });
        return;
      }

      const parsed = submitDrawingSchema.safeParse(data);
      if (!parsed.success) {
        socket.emit('error', { message: 'Invalid drawing data' });
        return;
      }

      const playerData = this.ensurePlayerData(player);

      if (playerData.hasSubmitted) {
        socket.emit('error', { message: 'You have already submitted' });
        return;
      }

      playerData.hasSubmitted = true;
      playerData.currentDrawing = parsed.data.imageData;

      const submission: DrawingSubmission = {
        playerId: player.id,
        playerName: player.name,
        imageData: parsed.data.imageData,
        timestamp: Date.now(),
      };

      // Add to mode-specific submissions
      switch (gameState.mode) {
        case 'freeze-frame': {
          const modeData = gameState.modeData as FreezeFrameData;
          modeData.submissions.set(player.id, submission);
          break;
        }
        case 'artistic-diff': {
          const modeData = gameState.modeData as ArtisticDiffData;
          modeData.submissions.set(player.id, submission);
          break;
        }
        case 'evolution': {
          const modeData = gameState.modeData as EvolutionData;
          modeData.chain.layers.push({
            stageNumber: modeData.stageNumber,
            artistId: player.id,
            artistName: player.name,
            canvasData: parsed.data.imageData,
            timestamp: Date.now(),
          });
          break;
        }
      }

      helpers.sendToRoom(room.code, 'drawing:submitted', { playerName: player.name });

      // Check if all required players have submitted
      if (this.checkAllSubmitted(room)) {
        this.clearRoomTimers(room.code);
        await this.transitionToNextPhase(room);
      }

      this.broadcastRoomState(room);
    },

    // -------------------------------------------------------------------------
    // VOTING (ALL MODES)
    // -------------------------------------------------------------------------

    'vote:submit': async (socket: Socket, data: any, room: Room, helpers: GameHelpers) => {
      const player = this.getPlayer(room, socket.id);
      if (!player) return;

      const gameState = room.gameState.data as CanvasChaosGameState;
      if (gameState.phase !== 'voting') {
        socket.emit('error', { message: 'Not in voting phase' });
        return;
      }

      const parsed = submitVoteSchema.safeParse(data);
      if (!parsed.success) {
        socket.emit('error', { message: 'Invalid vote' });
        return;
      }

      const playerData = this.ensurePlayerData(player);

      // FIX #19: Prevent double-voting
      if (playerData.votedFor !== null) {
        socket.emit("error", { message: "You have already voted" });
        return;
      }

      // FIX #5: Validate vote target exists before accepting vote
      switch (gameState.mode) {
        case 'freeze-frame': {
          const modeData = gameState.modeData as FreezeFrameData;
          // Subject CAN vote - they pick their favorite interpretation!
          // Validate target is in submissions
          if (!modeData.submissions.has(parsed.data.targetId)) {
            socket.emit('error', { message: 'Invalid vote target' });
            return;
          }
          // Can't vote for yourself
          if (parsed.data.targetId === player.id) {
            socket.emit('error', { message: 'Cannot vote for yourself' });
            return;
          }
          playerData.votedFor = parsed.data.targetId;
          modeData.votes.set(player.id, parsed.data.targetId);
          break;
        }
        case 'artistic-diff': {
          const modeData = gameState.modeData as ArtisticDiffData;
          // Validate target is a valid player who submitted
          if (!modeData.submissions.has(parsed.data.targetId)) {
            socket.emit('error', { message: 'Invalid vote target' });
            return;
          }
          playerData.votedFor = parsed.data.targetId;
          modeData.votes.set(player.id, parsed.data.targetId);
          break;
        }
        case 'evolution': {
          const modeData = gameState.modeData as EvolutionData;
          // Validate target has submitted a name
          if (!modeData.nameSubmissions.has(parsed.data.targetId)) {
            socket.emit('error', { message: 'Invalid vote target' });
            return;
          }
          // Can't vote for your own name
          if (parsed.data.targetId === player.id) {
            socket.emit('error', { message: 'Cannot vote for your own name' });
            return;
          }
          playerData.votedFor = parsed.data.targetId;
          modeData.votes.bestName.set(player.id, parsed.data.targetId);
          break;
        }
      }

      helpers.sendToRoom(room.code, 'vote:received', { playerName: player.name });

      if (this.checkAllVoted(room)) {
        this.clearRoomTimers(room.code);
        await this.transitionToNextPhase(room);
      }

      this.broadcastRoomState(room);
    },

    // -------------------------------------------------------------------------
    // EVOLUTION-SPECIFIC
    // -------------------------------------------------------------------------

    'evolution:submitName': async (socket: Socket, data: any, room: Room, helpers: GameHelpers) => {
      const player = this.getPlayer(room, socket.id);
      if (!player) return;

      const gameState = room.gameState.data as CanvasChaosGameState;
      if (gameState.mode !== 'evolution') return;
      if (gameState.phase !== 'naming') return; // Only accept during naming phase

      const parsed = submitNameSchema.safeParse(data);
      if (!parsed.success) {
        socket.emit('error', { message: 'Invalid name' });
        return;
      }

      const modeData = gameState.modeData as EvolutionData;

      // Don't allow resubmission
      if (modeData.nameSubmissions.has(player.id)) {
        return;
      }

      modeData.nameSubmissions.set(player.id, parsed.data.name);

      helpers.sendToRoom(room.code, 'name:submitted', { playerName: player.name });

      // Check if all connected players have submitted names
      const connectedPlayers = Array.from(room.players.values()).filter(p => p.connected);
      const allNamesSubmitted = connectedPlayers.every(p => modeData.nameSubmissions.has(p.id));

      if (allNamesSubmitted) {
        this.clearRoomTimers(room.code);
        await this.transitionToNextPhase(room);
      }

      this.broadcastRoomState(room);
    },

    'evolution:voteMutation': async (socket: Socket, data: any, room: Room, helpers: GameHelpers) => {
      const player = this.getPlayer(room, socket.id);
      if (!player) return;

      const gameState = room.gameState.data as CanvasChaosGameState;
      if (gameState.mode !== 'evolution') return;

      const parsed = voteMutationSchema.safeParse(data);
      if (!parsed.success) {
        socket.emit('error', { message: 'Invalid vote' });
        return;
      }

      const modeData = gameState.modeData as EvolutionData;
      modeData.votes.bestMutation.set(player.id, parsed.data.stageNumber);

      this.broadcastRoomState(room);
    },

    // -------------------------------------------------------------------------
    // GAME CONTROL
    // -------------------------------------------------------------------------

    'game:end': async (socket: Socket, data: any, room: Room, helpers: GameHelpers) => {
      const player = this.getPlayer(room, socket.id);
      if (!player?.isHost) {
        socket.emit('error', { message: 'Only the host can end the game' });
        return;
      }

      this.endGame(room, 'Host ended the game');
    },

    'game:restart': async (socket: Socket, data: any, room: Room, helpers: GameHelpers) => {
      const player = this.getPlayer(room, socket.id);
      if (!player?.isHost) {
        socket.emit('error', { message: 'Only the host can restart the game' });
        return;
      }

      room.gameState.phase = 'lobby';
      room.gameState.data = createInitialGameState();

      room.players.forEach(p => {
        p.gameData = createInitialPlayerData();
      });

      this.clearRoomTimers(room.code);

      helpers.sendToRoom(room.code, 'game:restarted', {});
      this.broadcastRoomState(room);
    },

    'settings:update': async (socket: Socket, data: any, room: Room, helpers: GameHelpers) => {
      const player = this.getPlayer(room, socket.id);
      if (!player?.isHost) {
        socket.emit('error', { message: 'Only the host can update settings' });
        return;
      }

      const parsed = updateSettingsSchema.safeParse(data.settings);
      if (!parsed.success) {
        socket.emit('error', { message: 'Invalid settings' });
        return;
      }

      room.settings.gameSpecific = {
        ...room.settings.gameSpecific,
        ...parsed.data,
      };

      helpers.sendToRoom(room.code, 'settings:updated', { settings: room.settings.gameSpecific });
      this.broadcastRoomState(room);
    },

    // -------------------------------------------------------------------------
    // ROUND PROGRESSION (Host-controlled)
    // -------------------------------------------------------------------------

    'round:next': async (socket: Socket, _data: any, room: Room, _helpers: GameHelpers) => {
      const player = this.getPlayer(room, socket.id);
      if (!player?.isHost) {
        socket.emit('error', { message: 'Only the host can start the next round' });
        return;
      }

      const gameState = room.gameState.data as CanvasChaosGameState;

      // Only allow when awaiting next round in reveal phase
      if (gameState.phase !== 'reveal' || !gameState.awaitingNextRound) {
        socket.emit('error', { message: 'Cannot start next round at this time' });
        return;
      }

      console.log(`[${this.name}] Host starting round ${gameState.round + 1}`);

      // Clear the awaiting flag
      gameState.awaitingNextRound = false;

      // Advance to next round
      gameState.round++;
      this.initializeModeData(room, gameState);
      await this.startRound(room);
    },
  };

  // ============================================================================
  // GAME LOGIC HELPERS
  // ============================================================================

  private getPlayer(room: Room, socketId: string): Player | undefined {
    return Array.from(room.players.values()).find(p => p.socketId === socketId);
  }

  private initializeModeData(room: Room, gameState: CanvasChaosGameState): void {
    switch (gameState.mode) {
      case 'freeze-frame':
        gameState.modeData = createFreezeFrameData();
        break;
      case 'artistic-diff':
        gameState.modeData = createArtisticDiffData();
        break;
      case 'evolution':
        gameState.modeData = createEvolutionData();
        break;
    }
  }

  private async startRound(room: Room): Promise<void> {
    const gameState = room.gameState.data as CanvasChaosGameState;
    const settings = room.settings.gameSpecific as CanvasChaosSettings;

    // Reset player submission states (ensure gameData exists)
    room.players.forEach(p => {
      const playerData = this.ensurePlayerData(p);
      playerData.hasSubmitted = false;
      playerData.currentDrawing = null;
      playerData.votedFor = null;
    });

    switch (gameState.mode) {
      case 'freeze-frame': {
        // Auto-select a random target player for freeze frame
        const modeData = gameState.modeData as FreezeFrameData;
        const connectedPlayers = Array.from(room.players.values()).filter(p => p.connected);

        // Prefer players who haven't been frozen yet
        const eligiblePlayers = connectedPlayers.filter(p => !modeData.subjectHistory.includes(p.id));
        const target = eligiblePlayers.length > 0
          ? eligiblePlayers[Math.floor(Math.random() * eligiblePlayers.length)]
          : connectedPlayers[Math.floor(Math.random() * connectedPlayers.length)];

        modeData.subjectPlayerId = target.id;
        modeData.subjectPlayerName = target.name;

        // Set phase to 'playing' (countdown phase on client)
        gameState.phase = 'playing';
        room.gameState.phase = 'playing';
        gameState.timeRemaining = 5; // 5 second countdown

        this.broadcastRoomState(room);

        // Start countdown, then request frame capture
        this.runFreezeCountdown(room, 5);
        break;
      }

      case 'artistic-diff':
        await this.setupArtisticDiffRound(room, gameState);
        room.gameState.phase = 'playing';
        break;

      case 'evolution':
        await this.setupEvolutionRound(room, gameState);
        room.gameState.phase = 'playing';
        break;
    }

    this.broadcastRoomState(room);
  }

  private async setupArtisticDiffRound(room: Room, gameState: CanvasChaosGameState): Promise<void> {
    const modeData = gameState.modeData as ArtisticDiffData;
    const settings = room.settings.gameSpecific as CanvasChaosSettings;
    const connectedPlayers = Array.from(room.players.values()).filter(p => p.connected);

    // Select ONE player to have the modifier (who hasn't been the modifier yet)
    let availablePlayers = connectedPlayers.filter(p => !modeData.usedModifierPlayers.includes(p.id));

    // FIX #13: When all players have been used, reset but exclude last modifier to prevent repeats
    if (availablePlayers.length === 0) {
      const lastModifier = modeData.usedModifierPlayers[modeData.usedModifierPlayers.length - 1];
      modeData.usedModifierPlayers = lastModifier ? [lastModifier] : [];
      availablePlayers = connectedPlayers.filter(p => !modeData.usedModifierPlayers.includes(p.id));
    }

    const modifierPlayer = availablePlayers.length > 0
      ? availablePlayers[Math.floor(Math.random() * availablePlayers.length)]
      : connectedPlayers[Math.floor(Math.random() * connectedPlayers.length)];

    // Use player-submitted prompts if available, otherwise fallback to DB
    const promptSubmissions = gameState.promptSubmissions;
    const unusedPrompts = Array.from(promptSubmissions.values()).filter(sub => !sub.used);

    // For Artistic Diff: modifier player gets their OWN twist, but someone else's prompt
    // So we prefer prompts NOT from the modifier player
    const promptsNotFromModifier = unusedPrompts.filter(sub => sub.playerId !== modifierPlayer.id);
    const promptPool = promptsNotFromModifier.length > 0 ? promptsNotFromModifier : unusedPrompts;

    if (promptPool.length > 0) {
      // Select random prompt from pool
      const selectedPromptSub = promptPool[Math.floor(Math.random() * promptPool.length)];
      modeData.prompt = selectedPromptSub.prompt;
      selectedPromptSub.used = true;

      // Modifier player uses their OWN submitted modifier
      const modifierPlayerSub = promptSubmissions.get(modifierPlayer.id);
      if (modifierPlayerSub && modifierPlayerSub.modifier) {
        modeData.modifier = modifierPlayerSub.modifier;
      } else {
        // Fallback to DB modifier if player didn't submit one
        modeData.modifier = await contentService.getRandomModifier(settings.modifierDifficulty, room.settings.language || 'en');
      }

      console.log(`[${this.name}] Using player prompt: "${modeData.prompt}" with modifier: "${modeData.modifier}"`);
    } else {
      // No player prompts available - use database
      modeData.prompt = await contentService.getRandomArtisticDiffPrompt(room.settings.language || 'en');
      modeData.modifier = await contentService.getRandomModifier(settings.modifierDifficulty, room.settings.language || 'en');
      console.log(`[${this.name}] Using DB prompt (no player prompts available)`);
    }

    // Assign modifier to one player
    modeData.modifierPlayerId = modifierPlayer.id;
    modeData.modifierPlayerName = modifierPlayer.name;
    modeData.usedModifierPlayers.push(modifierPlayer.id);

    // Reset all players' submission status
    connectedPlayers.forEach(p => {
      const playerData = this.ensurePlayerData(p);
      playerData.hasSubmitted = false;
    });

    // Clear previous round data
    modeData.submissions.clear();
    modeData.votes.clear();

    gameState.phase = 'drawing';
    gameState.timeRemaining = settings.drawingTime;

    this.startTimer(room);
  }

  private async setupEvolutionRound(room: Room, gameState: CanvasChaosGameState): Promise<void> {
    const modeData = gameState.modeData as EvolutionData;
    const settings = room.settings.gameSpecific as CanvasChaosSettings;
    const connectedPlayers = Array.from(room.players.values()).filter(p => p.connected);

    // Create mutation order
    modeData.chain.mutationOrder = this.shuffleArray(connectedPlayers).map(p => p.id);
    modeData.stageNumber = 1; // Start at 1 for origin stage

    // First player draws the origin
    const firstArtist = connectedPlayers.find(p => p.id === modeData.chain.mutationOrder[0]);
    modeData.currentArtistId = firstArtist?.id || null;
    modeData.currentArtistName = firstArtist?.name || null;

    // Clear previous chain
    modeData.chain.layers = [];
    modeData.chain.finalName = null;
    modeData.nameSubmissions.clear();
    modeData.votes.bestMutation.clear();
    modeData.votes.bestName.clear();

    gameState.phase = 'drawing';
    gameState.timeRemaining = settings.originTime;

    this.startTimer(room);
  }

  private checkAllSubmitted(room: Room): boolean {
    const gameState = room.gameState.data as CanvasChaosGameState;
    const connectedPlayers = Array.from(room.players.values()).filter(p => p.connected);

    // FIX #20: Prevent .every() returning true on empty array
    if (connectedPlayers.length === 0) return false;

    switch (gameState.mode) {
      case 'freeze-frame': {
        const modeData = gameState.modeData as FreezeFrameData;
        // Subject doesn't submit, everyone else does
        const eligiblePlayers = connectedPlayers.filter(p => p.id !== modeData.subjectPlayerId);
        return eligiblePlayers.every(p => (p.gameData as CanvasChaosPlayerData)?.hasSubmitted === true);
      }

      case 'artistic-diff': {
        // Everyone draws - all connected players must submit
        return connectedPlayers.every(p => (p.gameData as CanvasChaosPlayerData)?.hasSubmitted === true);
      }

      case 'evolution': {
        const modeData = gameState.modeData as EvolutionData;
        // Only current artist submits
        const currentArtist = connectedPlayers.find(p => p.id === modeData.currentArtistId);
        return currentArtist ? (currentArtist.gameData as CanvasChaosPlayerData)?.hasSubmitted === true : false;
      }

      default:
        return false;
    }
  }

  private checkAllVoted(room: Room): boolean {
    const gameState = room.gameState.data as CanvasChaosGameState;
    const connectedPlayers = Array.from(room.players.values()).filter(p => p.connected);

    // FIX #20: Prevent .every() returning true on empty array
    if (connectedPlayers.length === 0) return false;

    switch (gameState.mode) {
      case 'freeze-frame': {
        // Subject CAN vote - everyone votes including the subject
        return connectedPlayers.every(p => (p.gameData as CanvasChaosPlayerData)?.votedFor !== null);
      }

      case 'artistic-diff': {
        // Everyone votes, including the modifier player
        return connectedPlayers.every(p => (p.gameData as CanvasChaosPlayerData)?.votedFor !== null);
      }

      case 'evolution': {
        return connectedPlayers.every(p => (p.gameData as CanvasChaosPlayerData)?.votedFor !== null);
      }

      default:
        return false;
    }
  }

  private async transitionToNextPhase(room: Room): Promise<void> {
    const gameState = room.gameState.data as CanvasChaosGameState;
    const settings = room.settings.gameSpecific as CanvasChaosSettings;

    // FIX #14: Clear any active timer before transition to prevent timer overlap
    const timerKey = `${room.code}:timer`;
    this.clearTimer(timerKey);

    // FIX #6: Prevent double transitions with lock
    const lockKey = `${room.code}:${gameState.phase}`;
    if (this.transitionLock.get(lockKey)) {
      console.log(`[${this.name}] Transition already in progress for ${lockKey}, skipping`);
      return;
    }
    this.transitionLock.set(lockKey, true);

    // Clear lock after transition completes (using setTimeout to ensure it happens after sync code)
    setTimeout(() => this.transitionLock.delete(lockKey), 100);

    switch (gameState.phase) {

      case 'prompt-submission':
        // Fill missing submissions with DB prompts
        const connectedForPrompts = Array.from(room.players.values()).filter(p => p.connected);
        for (const player of connectedForPrompts) {
          if (!gameState.promptSubmissions.has(player.id)) {
            // Get random DB prompt as fallback
            let fallbackPrompt = 'Draw something creative!';
            let fallbackModifier = 'but make it funny';
            try {
              const dbPrompt = await contentService.getRandomArtisticDiffPrompt(room.settings.language || 'en');
              if (dbPrompt) fallbackPrompt = dbPrompt;
              const dbModifier = await contentService.getRandomModifier(settings.modifierDifficulty || 'medium', room.settings.language || 'en');
              if (dbModifier) fallbackModifier = dbModifier;
            } catch (e) {
              console.log(`[${this.name}] Failed to get DB fallback prompt`);
            }
            gameState.promptSubmissions.set(player.id, {
              playerId: player.id,
              playerName: player.name,
              prompt: fallbackPrompt,
              modifier: fallbackModifier,
              used: false,
            });
          }
        }
        console.log(`[${this.name}] Prompt submission complete: ${gameState.promptSubmissions.size} prompts collected`);
        // Now start the actual round
        await this.startRound(room);
        return;

      case 'drawing':
        // EDGE CASE: Check for no/insufficient submissions before voting
        if (gameState.mode === 'freeze-frame' || gameState.mode === 'artistic-diff') {
          const modeData = gameState.modeData as FreezeFrameData | ArtisticDiffData;
          const submissionCount = modeData.submissions.size;

          if (submissionCount === 0) {
            // No drawings submitted - skip to reveal
            console.log(`[${this.name}] No submissions - skipping voting`);
            modeData.skippedRound = true;
            modeData.skipReason = 'No drawings were submitted';
            gameState.phase = 'reveal';
            room.gameState.phase = 'playing';
            gameState.timeRemaining = 5; // Brief reveal
            this.startTimer(room);
            this.broadcastRoomState(room);
            return;
          }

          if (submissionCount < 2) {
            // Only 1 submission - can't vote meaningfully
            console.log(`[${this.name}] Only 1 submission - skipping voting`);
            modeData.skippedRound = true;
            modeData.skipReason = 'Not enough drawings to vote (need at least 2)';
            // Award participation points to the one who submitted
            modeData.submissions.forEach((sub, playerId) => {
              const player = Array.from(room.players.values()).find(p => p.id === playerId);
              if (player) {
                this.ensurePlayerData(player).score += 50; // Bonus for being the only one
              }
            });
            gameState.phase = 'reveal';
            room.gameState.phase = 'playing';
            gameState.timeRemaining = 5;
            this.startTimer(room);
            this.broadcastRoomState(room);
            return;
          }
        }

        // Handle Evolution's chain progression
        if (gameState.mode === 'evolution') {
          const modeData = gameState.modeData as EvolutionData;
          modeData.stageNumber++;

          // FIX #2: Add bounds check and connected artist validation
          const connectedPlayers = Array.from(room.players.values()).filter(p => p.connected);

          // Check if more artists in chain AND the chain is valid
          // stageNumber is 1-indexed, so use stageNumber - 1 for array access
          // After incrementing stageNumber, we need to check if stageNumber <= length
          // because stageNumber 2 means we want index 1, stageNumber 3 means index 2, etc.
          if (modeData.chain.mutationOrder.length > 0 &&
              modeData.stageNumber <= modeData.chain.mutationOrder.length) {

            // Find next CONNECTED artist (skip disconnected ones)
            let nextArtistId: string | null = null;
            let nextArtist: Player | undefined;

            while (modeData.stageNumber <= modeData.chain.mutationOrder.length) {
              // stageNumber is 1-indexed, array is 0-indexed
              const candidateId = modeData.chain.mutationOrder[modeData.stageNumber - 1];
              const candidate = connectedPlayers.find(p => p.id === candidateId);
              if (candidate) {
                nextArtistId = candidateId;
                nextArtist = candidate;
                break;
              }
              // Skip disconnected players
              modeData.stageNumber++;
            }

            // If we found a connected artist, continue the chain
            if (nextArtistId && nextArtist) {
              modeData.currentArtistId = nextArtistId;
              modeData.currentArtistName = nextArtist.name;

              // Select mutation prompt
              if (settings.useMutationPrompts) {
                // Use player-submitted prompts if available
                const promptSubmissions = gameState.promptSubmissions;
                const unusedPrompts = Array.from(promptSubmissions.values()).filter(sub => !sub.used);
              
                if (unusedPrompts.length > 0) {
                  const selectedPromptSub = unusedPrompts[Math.floor(Math.random() * unusedPrompts.length)];
                  modeData.mutationPrompt = selectedPromptSub.prompt;
                  selectedPromptSub.used = true;
                  console.log(`[${this.name}] Evolution using player mutation prompt: "${modeData.mutationPrompt}"`);
                } else {
                  modeData.mutationPrompt = await contentService.getRandomEvolutionPrompt(room.settings.language || 'en');
                }
              }

              // Reset submission state
              room.players.forEach(p => {
                this.ensurePlayerData(p).hasSubmitted = false;
              });

              gameState.timeRemaining = settings.mutationTime;
              this.startTimer(room);
              this.broadcastRoomState(room);
              return;
            }
            // If no connected artist found, fall through to voting phase
          }
          // If chain is empty or complete, fall through to naming/voting phase
        }

        // For Evolution mode, transition to naming phase first
        if (gameState.mode === 'evolution') {
          gameState.phase = 'naming';
          room.gameState.phase = 'playing'; // Keep as 'playing' for client routing
          gameState.timeRemaining = 20; // 20 seconds to submit creature names

          // Reset submission tracking for naming phase
          room.players.forEach(p => {
            this.ensurePlayerData(p).hasSubmitted = false;
          });

          this.startTimer(room);
          break;
        }

        // For other modes, go directly to voting
        gameState.phase = 'voting';
        room.gameState.phase = 'playing'; // Keep as 'playing' for client routing
        gameState.timeRemaining = settings.votingTime;
        this.startTimer(room);
        break;

      case 'naming':
        // Evolution: transition from naming to voting
        {
          const modeData = gameState.modeData as EvolutionData;

          // Auto-generate names for players who didn't submit
          // This ensures everyone can vote (you can't vote for yourself, so need others' names)
          const connectedPlayers = Array.from(room.players.values()).filter(p => p.connected);
          for (const player of connectedPlayers) {
            if (!modeData.nameSubmissions.has(player.id)) {
              modeData.nameSubmissions.set(player.id, `${player.name}'s Creature`);
              console.log(`[${this.name}] Auto-generated name for ${player.name}`);
            }
          }

          // EDGE CASE: No name submissions
          if (modeData.nameSubmissions.size === 0) {
            console.log(`[${this.name}] No name submissions - skipping voting`);
            modeData.skippedRound = true;
            modeData.skipReason = 'No creature names were submitted';
            gameState.phase = 'reveal';
            room.gameState.phase = 'playing';
            gameState.timeRemaining = 5;
            this.startTimer(room);
            this.broadcastRoomState(room);
            return;
          }

          // EDGE CASE: Only 1 name submission
          if (modeData.nameSubmissions.size < 2) {
            console.log(`[${this.name}] Only 1 name submission - auto-selecting`);
            // Use the single submitted name as the winner
            const [winnerId, winnerName] = Array.from(modeData.nameSubmissions.entries())[0];
            modeData.chain.finalName = winnerName;
            const player = Array.from(room.players.values()).find(p => p.id === winnerId);
            if (player) {
              this.ensurePlayerData(player).score += 50;
            }
            modeData.skippedRound = true;
            modeData.skipReason = 'Only one name was submitted - auto-selected';
            gameState.phase = 'reveal';
            room.gameState.phase = 'playing';
            gameState.timeRemaining = 5;
            this.startTimer(room);
            this.broadcastRoomState(room);
            return;
          }

          gameState.phase = 'voting';
          room.gameState.phase = 'playing';
          gameState.timeRemaining = 20; // 20 seconds to vote for best name

          // Reset vote tracking
          room.players.forEach(p => {
            this.ensurePlayerData(p).votedFor = null;
          });

          this.startTimer(room);
        }
        break;

      case 'voting':
        // EDGE CASE: Check for no votes before scoring
        if (gameState.mode === 'freeze-frame' || gameState.mode === 'artistic-diff') {
          const modeData = gameState.modeData as FreezeFrameData | ArtisticDiffData;
          if (modeData.votes.size === 0) {
            console.log(`[${this.name}] No votes cast - marking round as skipped`);
            modeData.skippedRound = true;
            modeData.skipReason = 'No votes were cast';
            // Still award participation points to those who submitted
            modeData.submissions.forEach((sub, playerId) => {
              const player = Array.from(room.players.values()).find(p => p.id === playerId);
              if (player) {
                this.ensurePlayerData(player).score += 25;
              }
            });
          }
        } else if (gameState.mode === 'evolution') {
          const modeData = gameState.modeData as EvolutionData;
          if (modeData.votes.bestName.size === 0) {
            console.log(`[${this.name}] No name votes cast - marking as skipped`);
            modeData.skippedRound = true;
            modeData.skipReason = 'No name votes were cast';
          }
        }

        // Calculate scores and show results
        this.calculateScores(room);
        gameState.phase = 'reveal';
        room.gameState.phase = 'playing'; // Keep as 'playing' for client routing
        gameState.timeRemaining = 10; // 10 seconds to view results
        this.startTimer(room);
        break;

      case 'reveal':
        // Check if more rounds
        if (gameState.round < gameState.totalRounds) {
          // DON'T auto-start next round - wait for host to trigger
          gameState.awaitingNextRound = true;
          gameState.timeRemaining = 0; // No timer - wait indefinitely
          // Keep phase as 'reveal' so players see results
          // Host will click "Next Round" button to continue
          console.log(`[${this.name}] Round ${gameState.round} complete, awaiting host to start round ${gameState.round + 1}`);
        } else {
          this.endGame(room, 'All rounds completed');
        }
        break;
    }

    this.broadcastRoomState(room);
  }

  private calculateScores(room: Room): void {
    const gameState = room.gameState.data as CanvasChaosGameState;

    switch (gameState.mode) {
      case 'freeze-frame':
        this.calculateFreezeFrameScores(room);
        break;
      case 'artistic-diff':
        this.calculateArtisticDiffScores(room);
        break;
      case 'evolution':
        this.calculateEvolutionScores(room);
        break;
    }
  }

  private calculateFreezeFrameScores(room: Room): void {
    const gameState = room.gameState.data as CanvasChaosGameState;
    const modeData = gameState.modeData as FreezeFrameData;

    // Count votes for each submission
    const voteCounts = new Map<string, number>();
    modeData.votes.forEach((targetId) => {
      voteCounts.set(targetId, (voteCounts.get(targetId) || 0) + 1);
    });

    // Award points: 100 for most votes, 50 for second
    const sortedByVotes = Array.from(voteCounts.entries())
      .sort((a, b) => b[1] - a[1]);

    if (sortedByVotes[0]) {
      const winner = Array.from(room.players.values()).find(p => p.id === sortedByVotes[0][0]);
      if (winner) {
        this.ensurePlayerData(winner).score += 100;
      }
    }

    if (sortedByVotes[1]) {
      const runnerUp = Array.from(room.players.values()).find(p => p.id === sortedByVotes[1][0]);
      if (runnerUp) {
        this.ensurePlayerData(runnerUp).score += 50;
      }
    }

    // Everyone who submitted gets participation points
    modeData.submissions.forEach((sub, playerId) => {
      const player = Array.from(room.players.values()).find(p => p.id === playerId);
      if (player) {
        this.ensurePlayerData(player).score += 25;
      }
    });
  }

  private calculateArtisticDiffScores(room: Room): void {
    const gameState = room.gameState.data as CanvasChaosGameState;
    const modeData = gameState.modeData as ArtisticDiffData;

    // Count correct vs incorrect guesses
    let correctGuesses = 0;
    let wrongGuesses = 0;

    modeData.votes.forEach((votedPlayerId, voterId) => {
      if (votedPlayerId === modeData.modifierPlayerId) {
        correctGuesses++;
      } else {
        wrongGuesses++;
      }
    });

    // Modifier player gets points for each person they fooled
    const modifierPlayer = Array.from(room.players.values()).find(p => p.id === modeData.modifierPlayerId);
    if (modifierPlayer) {
      this.ensurePlayerData(modifierPlayer).score += wrongGuesses * 50;
    }

    // Voters get points for correct guesses
    modeData.votes.forEach((votedPlayerId, voterId) => {
      if (votedPlayerId === modeData.modifierPlayerId) {
        const voter = Array.from(room.players.values()).find(p => p.id === voterId);
        if (voter) {
          this.ensurePlayerData(voter).score += 75;
        }
      }
    });

    // Everyone who submitted gets participation points
    modeData.submissions.forEach((sub, playerId) => {
      const player = Array.from(room.players.values()).find(p => p.id === playerId);
      if (player) {
        this.ensurePlayerData(player).score += 25;
      }
    });
  }

  private calculateEvolutionScores(room: Room): void {
    const gameState = room.gameState.data as CanvasChaosGameState;
    const modeData = gameState.modeData as EvolutionData;

    // Count votes for best mutation
    const mutationVotes = new Map<number, number>();
    modeData.votes.bestMutation.forEach((stageNumber) => {
      mutationVotes.set(stageNumber, (mutationVotes.get(stageNumber) || 0) + 1);
    });

    // Find winning mutation
    let bestStage = -1;
    let bestVotes = 0;
    mutationVotes.forEach((votes, stage) => {
      if (votes > bestVotes) {
        bestVotes = votes;
        bestStage = stage;
      }
    });

    // Award points for best mutation
    if (bestStage >= 0) {
      const winningLayer = modeData.chain.layers.find(l => l.stageNumber === bestStage);
      if (winningLayer) {
        const winner = Array.from(room.players.values()).find(p => p.id === winningLayer.artistId);
        if (winner) {
          this.ensurePlayerData(winner).score += 150;
        }
      }
    }

    // Count votes for best name
    const nameVotes = new Map<string, number>();
    modeData.votes.bestName.forEach((submitterId) => {
      nameVotes.set(submitterId, (nameVotes.get(submitterId) || 0) + 1);
    });

    // Find winning name
    let bestNameSubmitter = '';
    let bestNameVotes = 0;
    nameVotes.forEach((votes, submitterId) => {
      if (votes > bestNameVotes) {
        bestNameVotes = votes;
        bestNameSubmitter = submitterId;
      }
    });

    // Award points for best name
    if (bestNameSubmitter) {
      const winner = Array.from(room.players.values()).find(p => p.id === bestNameSubmitter);
      if (winner) {
        this.ensurePlayerData(winner).score += 100;
      }
      // Set the winning name
      modeData.chain.finalName = modeData.nameSubmissions.get(bestNameSubmitter) || 'Unnamed Creature';
    }

    // Everyone who contributed gets participation points
    modeData.chain.layers.forEach(layer => {
      const player = Array.from(room.players.values()).find(p => p.id === layer.artistId);
      if (player) {
        this.ensurePlayerData(player).score += 25;
      }
    });
  }

  private endGame(room: Room, reason?: string): void {
    this.clearRoomTimers(room.code);

    room.gameState.phase = 'ended';
    const gameState = room.gameState.data as CanvasChaosGameState;
    gameState.phase = 'ended';

    const finalScores = Array.from(room.players.values())
      .map(p => ({
        playerId: p.id,
        playerName: p.name,
        score: (p.gameData as CanvasChaosPlayerData)?.score || 0
      }))
      .sort((a, b) => b.score - a.score);

    const winner = finalScores[0];

    if (this.io) {
      const namespace = this.io.of(this.namespace);
      namespace.to(room.code).emit('game:ended', {
        reason: reason || 'Game completed',
        winner,
        finalScores
      });
    }

    this.broadcastRoomState(room);
    console.log(`[${this.name}] Game ended in room ${room.code}. Winner: ${winner?.playerName}`);
  }

  // ============================================================================
  // TIMER HELPERS
  // ============================================================================

  private runFreezeCountdown(room: Room, seconds: number): void {
    const gameState = room.gameState.data as CanvasChaosGameState;
    const timerKey = `${room.code}:freezeCountdown`;

    if (seconds > 0) {
      gameState.timeRemaining = seconds;

      if (this.io) {
        const namespace = this.io.of(this.namespace);
        namespace.to(room.code).emit('freezeframe:countdown', { seconds });
      }

      this.broadcastRoomState(room);

      // Schedule next countdown tick
      const timeout = setTimeout(() => this.runFreezeCountdown(room, seconds - 1), 1000);
      this.timers.set(timerKey, timeout);
    } else {
      // FREEZE! Time's up - request capture from target player
      gameState.timeRemaining = 0;
      const modeData = gameState.modeData as FreezeFrameData;

      if (this.io) {
        const namespace = this.io.of(this.namespace);

        // Notify all clients that freeze is happening
        namespace.to(room.code).emit('freezeframe:freeze', {
          targetId: modeData.subjectPlayerId
        });

        // Request the target player to capture their video frame
        const targetPlayer = Array.from(room.players.values())
          .find(p => p.id === modeData.subjectPlayerId);

        if (targetPlayer) {
          namespace.to(targetPlayer.socketId).emit('freezeframe:captureNow');
          console.log(`[${this.name}] Requested frame capture from ${targetPlayer.name}`);
        }

        // Set a timeout - if no capture received in 5 seconds, use fallback
        const captureTimeoutKey = `${room.code}:captureTimeout`;
        const captureTimeout = setTimeout(() => {
          // Check if still waiting for capture
          const currentGameState = room.gameState.data as CanvasChaosGameState;
          if (currentGameState.phase !== 'drawing') {
            console.log(`[${this.name}] Capture timeout - using fallback`);
            this.handleCaptureFallback(room);
          }
        }, 5000);
        this.timers.set(captureTimeoutKey, captureTimeout);
      }

      this.broadcastRoomState(room);
    }
  }

  private async handleCaptureFallback(room: Room): Promise<void> {
    const gameState = room.gameState.data as CanvasChaosGameState;
    if (gameState.phase === 'drawing') return; // Already transitioned

    const modeData = gameState.modeData as FreezeFrameData;
    const settings = room.settings.gameSpecific as CanvasChaosSettings;

    // Use placeholder image
    modeData.frozenFrame = 'data:image/svg+xml;base64,' + Buffer.from(`
      <svg xmlns="http://www.w3.org/2000/svg" width="640" height="480">
        <rect width="100%" height="100%" fill="#1a1a2e"/>
        <text x="50%" y="50%" text-anchor="middle" fill="#00f5ff" font-size="24" font-family="sans-serif">Video unavailable</text>
      </svg>
    `).toString('base64');

    // Add to history
    if (modeData.subjectPlayerId && !modeData.subjectHistory.includes(modeData.subjectPlayerId)) {
      modeData.subjectHistory.push(modeData.subjectPlayerId);
    }

    if (settings.freezeFramePrompts) {
      modeData.prompt = await contentService.getRandomFreezeFramePrompt(room.settings.language || 'en');
    }

    gameState.phase = 'drawing';
    gameState.timeRemaining = settings.drawingTime;

    this.startTimer(room);

    if (this.io) {
      const namespace = this.io.of(this.namespace);
      namespace.to(room.code).emit('freezeframe:captured', {
        subjectName: modeData.subjectPlayerName,
        frozenFrame: modeData.frozenFrame,
        prompt: modeData.prompt,
      });
    }

    this.broadcastRoomState(room);
    console.log(`[${this.name}] Fallback triggered, transitioning to drawing phase`);
  }

  private startTimer(room: Room): void {
    const gameState = room.gameState.data as CanvasChaosGameState;
    const timerKey = `${room.code}:timer`;

    this.clearTimer(timerKey);

    const interval = setInterval(async () => {
      gameState.timeRemaining--;

      if (this.io) {
        const namespace = this.io.of(this.namespace);
        namespace.to(room.code).emit('timer:update', { timeRemaining: gameState.timeRemaining });
      }

      if (gameState.timeRemaining <= 0) {
        clearInterval(interval);
        this.intervals.delete(timerKey);
        // Grace period for auto-submit network latency
        setTimeout(async () => {
          await this.transitionToNextPhase(room);
        }, 1500);
      }
    }, 1000);

    this.intervals.set(timerKey, interval);
  }

  private clearTimer(key: string): void {
    if (this.timers.has(key)) {
      clearTimeout(this.timers.get(key)!);
      this.timers.delete(key);
    }
    if (this.intervals.has(key)) {
      clearInterval(this.intervals.get(key)!);
      this.intervals.delete(key);
    }
  }

  private clearRoomTimers(roomCode: string): void {
    this.timers.forEach((timer, key) => {
      if (key.startsWith(roomCode)) {
        clearTimeout(timer);
        this.timers.delete(key);
      }
    });
    this.intervals.forEach((interval, key) => {
      if (key.startsWith(roomCode)) {
        clearInterval(interval);
        this.intervals.delete(key);
      }
    });
  }

  // ============================================================================
  // UTILITY HELPERS
  // ============================================================================

  private shuffleArray<T>(array: T[]): T[] {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  private broadcastRoomState(room: Room): void {
    if (!this.io) return;

    const namespace = this.io.of(this.namespace);

    room.players.forEach(player => {
      const serialized = this.serializeRoom(room, player.socketId);
      namespace.to(player.socketId).emit('roomStateUpdated', serialized);
    });
  }

  // ============================================================================
  // DISCONNECTION RECOVERY HELPERS (FIX #1)
  // ============================================================================

  private async advanceEvolutionAfterDisconnect(room: Room): Promise<void> {
    const gameState = room.gameState.data as CanvasChaosGameState;
    const modeData = gameState.modeData as EvolutionData;
    const settings = room.settings.gameSpecific as CanvasChaosSettings;
    const connectedPlayers = Array.from(room.players.values()).filter(p => p.connected);

    // Move to next stage
    modeData.stageNumber++;

    // Find next connected artist in the mutation order
    let nextArtistId: string | null = null;
    let nextArtist: Player | undefined;

    while (modeData.stageNumber < modeData.chain.mutationOrder.length) {
      const candidateId = modeData.chain.mutationOrder[modeData.stageNumber];
      const candidate = connectedPlayers.find(p => p.id === candidateId);
      if (candidate) {
        nextArtistId = candidateId;
        nextArtist = candidate;
        break;
      }
      // Skip disconnected players
      modeData.stageNumber++;
    }

    if (nextArtistId && nextArtist) {
      // Continue chain with next connected artist
      modeData.currentArtistId = nextArtistId;
      modeData.currentArtistName = nextArtist.name;

      if (settings.useMutationPrompts) {
        // Use player-submitted prompts if available
        const promptSubmissions = gameState.promptSubmissions;
        const unusedPrompts = Array.from(promptSubmissions.values()).filter(sub => !sub.used);
      
        if (unusedPrompts.length > 0) {
          const selectedPromptSub = unusedPrompts[Math.floor(Math.random() * unusedPrompts.length)];
          modeData.mutationPrompt = selectedPromptSub.prompt;
          selectedPromptSub.used = true;
          console.log(`[${this.name}] Evolution using player mutation prompt: "${modeData.mutationPrompt}"`);
        } else {
          modeData.mutationPrompt = await contentService.getRandomEvolutionPrompt(room.settings.language || 'en');
        }
      }

      // Reset submission state
      room.players.forEach(p => {
        this.ensurePlayerData(p).hasSubmitted = false;
      });

      gameState.timeRemaining = settings.mutationTime;
      this.startTimer(room);
    } else {
      // No more connected artists - transition to naming/voting
      console.log(`[${this.name}] No more connected artists in Evolution chain, transitioning to voting`);
      this.clearRoomTimers(room.code);
      gameState.phase = 'voting';
      room.gameState.phase = 'playing';
      gameState.timeRemaining = settings.votingTime;
      this.startTimer(room);
    }

    this.broadcastRoomState(room);
  }

  private checkMinimumPlayersForMode(room: Room): void {
    const gameState = room.gameState.data as CanvasChaosGameState;
    const connectedPlayers = Array.from(room.players.values()).filter(p => p.connected);

    // Mode-specific minimum player requirements
    const modeMinPlayers: Record<string, number> = {
      'freeze-frame': 2,  // Subject + at least 1 drawer
      'artistic-diff': 3, // Need enough for hidden modifier to be meaningful
      'evolution': 2,     // At least 2-person chain
    };

    const minRequired = modeMinPlayers[gameState.mode || ''] || room.settings.minPlayers;

    if (connectedPlayers.length < minRequired) {
      console.log(`[${this.name}] Not enough players for ${gameState.mode} (${connectedPlayers.length}/${minRequired}), ending game`);
      this.endGame(room, 'Not enough players to continue');
    }
  }
}

// ============================================================================
// EXPORT
// ============================================================================

export default new CanvasChaosPlugin();
