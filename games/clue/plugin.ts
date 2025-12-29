import type { GamePlugin, Room, Player, GameHelpers } from '../../core/types/core.js';
import type { Socket } from 'socket.io';
import {
  ClueGameState,
  CluePlayerData,
  ClueSettings,
  DEFAULT_CLUE_SETTINGS,
  Guess,
  Team,
  TEAM_PRESETS,
} from './types/index.js';
import {
  startNewRound,
  revealRoundResults,
  initializeGameState,
  initializePlayerData,
} from './game/GameManager.js';

/**
 * Initialize teams for team mode
 * Distributes players evenly across 2 teams
 */
function initializeTeams(players: Player[]): Team[] {
  // Shuffle players for random team assignment
  const shuffled = [...players].sort(() => Math.random() - 0.5);

  // Create 2 teams
  const teams: Team[] = [
    {
      id: 'team-1',
      name: TEAM_PRESETS[0].name,
      color: TEAM_PRESETS[0].color,
      playerIds: [],
      score: 0,
    },
    {
      id: 'team-2',
      name: TEAM_PRESETS[1].name,
      color: TEAM_PRESETS[1].color,
      playerIds: [],
      score: 0,
    },
  ];

  // Distribute players evenly
  shuffled.forEach((player, index) => {
    teams[index % 2].playerIds.push(player.id);
  });

  return teams;
}

/**
 * Shuffle existing teams (redistribute players)
 */
function shuffleTeams(teams: Team[], players: Player[]): Team[] {
  // Get all player IDs currently in teams
  const allPlayerIds = teams.flatMap(t => t.playerIds);

  // Shuffle them
  const shuffled = [...allPlayerIds].sort(() => Math.random() - 0.5);

  // Clear existing assignments
  teams.forEach(team => {
    team.playerIds = [];
  });

  // Redistribute
  shuffled.forEach((playerId, index) => {
    teams[index % teams.length].playerIds.push(playerId);
  });

  return teams;
}

/**
 * Serialize Room to client Lobby format
 */
function serializeRoomToLobby(room: Room, socketId: string) {
  const gameState = room.gameState.data as ClueGameState;

  // Map server phase to client GameState
  let clientState: 'LOBBY_WAITING' | 'ROUND_CLUE' | 'ROUND_GUESS' | 'ROUND_REVEAL' | 'GAME_END';
  switch (room.gameState.phase) {
    case 'lobby':
      clientState = 'LOBBY_WAITING';
      break;
    case 'round_clue':
      clientState = 'ROUND_CLUE';
      break;
    case 'round_guess':
      clientState = 'ROUND_GUESS';
      break;
    case 'round_reveal':
      clientState = 'ROUND_REVEAL';
      break;
    case 'finished':
      clientState = 'GAME_END';
      break;
    default:
      clientState = 'LOBBY_WAITING';
  }

  // Convert players Map to Array with client-expected format
  const players = Array.from(room.players.values()).map((p) => ({
    id: p.id,               // UUID for stable player identification (used for kick, etc.)
    socketId: p.socketId,
    name: p.name,
    score: (p.gameData as CluePlayerData)?.score || 0,
    connected: p.connected,
    isHost: p.isHost,
    disconnectedAt: p.disconnectedAt,
    premiumTier: p.premiumTier,
    avatarUrl: p.avatarUrl,
  }));
  console.log(`💎 [PREMIUM DEBUG] Serialized players with premiumTier:`, players.map(p => ({ name: p.name, premiumTier: p.premiumTier })));

  // Find current player's ID by socketId
  const currentPlayer = Array.from(room.players.values()).find((p) => p.socketId === socketId);
  const myPlayerId = currentPlayer?.id || '';

  // Extract settings from room.settings.gameSpecific (NOT gameState.settings)
  const gameSpecificSettings = room.settings.gameSpecific as ClueSettings;
  const settings = {
    roundDuration: gameSpecificSettings.roundDuration,
    minPlayers: room.settings.minPlayers,
    maxPlayers: room.settings.maxPlayers,
    teamBonusEnabled: gameSpecificSettings.teamBonusEnabled,
    rotationType: gameSpecificSettings.rotationType,
    categories: gameSpecificSettings.categories,
    gameMode: gameSpecificSettings.gameMode || 'classic',
    totalRounds: gameSpecificSettings.totalRounds || 5,
  };

  if (room.isStreamerMode || room.hideRoomCode) {
    console.log(
      `[ClueScale] serializeRoom -> ${room.code}: streamerMode=${room.isStreamerMode} hideRoomCode=${room.hideRoomCode}`
    );
  }

  // Build round data if exists
  let round = null;
  if (gameState.round) {
    // Include guesses array (just playerIds) for clue giver to see progress
    const guessesForClient = gameState.round.guesses.map(g => ({ playerId: g.playerId }));

    round = {
      index: gameState.round.index,
      category: gameState.round.category,
      targetNumber: gameState.round.targetNumber,
      clueWord: gameState.round.clueWord,
      numberPickerId: null, // No number picker in new version
      clueGiverId: gameState.round.clueGiverId,
      guessCount: gameState.round.guesses.length,
      guesses: guessesForClient,
    };
  }

  return {
    code: room.code,
    hostId: room.hostId,
    settings,
    players,
    state: clientState,
    round,
    isGameBuddiesRoom: room.isGameBuddiesRoom,
    mySocketId: socketId,
    myPlayerId,
    messages: room.messages,
    isStreamerMode: room.isStreamerMode || false,
    hideRoomCode: room.hideRoomCode || false,
    // Team mode data
    teams: gameState.teams,
    currentTeamIndex: gameState.currentTeamIndex,
    teamRoundNumber: gameState.teamRoundNumber,
    completedRounds: gameState.completedRounds,
  };
}

/**
 * ClueScale Game Plugin
 *
 * A guessing game where players take turns being the clue giver.
 * The clue giver sees a number (1-10) and a category, then provides a one-word clue.
 * Other players guess the number based on the clue.
 */

class CluePlugin implements GamePlugin {
  // Metadata
  id = 'clue-scale';
  name = 'ClueScale';
  version = '1.0.0';
  namespace = '/cluescale';
  basePath = '/cluescale';

  // Configuration
  defaultSettings = {
    minPlayers: 3,
    maxPlayers: 12,
    gameSpecific: DEFAULT_CLUE_SETTINGS,
  };

  // Socket.IO instance
  private io: any;

  /**
   * Initialize plugin
   */
  async onInitialize(io: any) {
    console.log('[ClueScale] Initializing ClueScale plugin...');
    this.io = io;
    console.log('[ClueScale] Plugin initialized');
  }

  /**
   * Called when a room is created
   */
  onRoomCreate(room: Room): void {
    // Initialize ClueScale game state
    room.gameState.data = initializeGameState();
    room.gameState.phase = 'lobby';

    // Apply ClueScale-specific settings
    if (!room.settings.gameSpecific) {
      room.settings.gameSpecific = { ...DEFAULT_CLUE_SETTINGS };
    }

    // Initialize teams if settings already have teams mode
    const settings = room.settings.gameSpecific as ClueSettings;
    const gameState = room.gameState.data as ClueGameState;
    if (settings.gameMode === 'teams') {
      const connectedPlayers = Array.from(room.players.values()).filter(p => p.connected);
      gameState.teams = initializeTeams(connectedPlayers);
      gameState.currentTeamIndex = 0;
      gameState.teamRoundNumber = 1;
      gameState.completedRounds = 0;
      console.log(`[ClueScale] Room ${room.code} - Initialized teams on create:`, gameState.teams?.map(t => ({ name: t.name, players: t.playerIds.length })));
    }

    console.log(`[ClueScale] Room ${room.code} created with initial game state`);
  }

  /**
   * Called when a player joins
   */
  /**
   * Helper: Send lobby update to all players in room
   * Used when player scores or other lobby data changes
   */
  private sendLobbyUpdate(room: Room): void {
    if (this.io) {
      const namespace = this.io.of('/cluescale');

      // Send to each player with their personalized socketId
      room.players.forEach((p) => {
        const serializedLobby = serializeRoomToLobby(room, p.socketId);
        namespace.to(p.socketId).emit('clue:lobby-update', { room: serializedLobby });
      });

      console.log(`[ClueScale] Sent lobby update to ${room.players.size} players in room ${room.code}`);
      console.log(`[ClueScale] Lobby update scores:`, Array.from(room.players.values()).map(p => ({ name: p.name, score: (p.gameData as any)?.score })));
    }
  }

  onPlayerJoin(room: Room, player: Player, isReconnecting?: boolean): void {
    // Initialize player's game data
    if (!player.gameData) {
      player.gameData = initializePlayerData();
    }

    // If teams mode is active, add late-joining players to the team with fewer members
    const settings = room.settings.gameSpecific as ClueSettings;
    const gameState = room.gameState.data as ClueGameState;
    if (settings.gameMode === 'teams' && gameState.teams && gameState.teams.length > 0) {
      // Check if player is already on a team
      const alreadyOnTeam = gameState.teams.some(t => t.playerIds.includes(player.id));
      if (!alreadyOnTeam) {
        // Find team with fewer players
        const teamWithFewerPlayers = gameState.teams.reduce((min, team) =>
          team.playerIds.length < min.playerIds.length ? team : min
        );
        teamWithFewerPlayers.playerIds.push(player.id);
        console.log(`[ClueScale] Added late-joiner ${player.name} to ${teamWithFewerPlayers.name}`);
      }
    }

    if (isReconnecting) {
      console.log(`[ClueScale] Player ${player.name} reconnected to room ${room.code}`);

      // If reconnecting player is the clue giver during clue phase, re-send their secret data
      const gameState = room.gameState.data as ClueGameState;
      if (
        gameState.round &&
        room.gameState.phase === 'round_clue' &&
        gameState.round.clueGiverId === player.id &&
        !gameState.round.clueWord // Clue not yet submitted
      ) {
        // Re-send target number to reconnecting clue giver
        if (this.io) {
          const namespace = this.io.of('/cluescale');
          namespace.to(player.socketId).emit('round:giver-data', {
            targetNumber: gameState.round.targetNumber,
            category: gameState.round.category,
          });
          console.log(`[ClueScale] Re-sent giver data to reconnected clue giver ${player.name}`);
        }
      }
    } else {
      console.log(`[ClueScale] Player ${player.name} joined room ${room.code}`);
    }

    // Send properly serialized lobby data to ALL players in the room
    // This ensures everyone has the correct state, mySocketId, and player list
    if (this.io) {
      const namespace = this.io.of('/cluescale');

      // Send to each player with their personalized socketId
      room.players.forEach((p) => {
        const serializedLobby = serializeRoomToLobby(room, p.socketId);
        namespace.to(p.socketId).emit('clue:lobby-update', { room: serializedLobby });
      });

      console.log(`[ClueScale] Sent lobby update to ${room.players.size} players in room ${room.code}`);
    }
  }

  /**
   * Called when a player disconnects (before 60-second grace period)
   * Broadcasts updated game state with disconnectedAt timestamp for countdown timer
   */
  onPlayerDisconnected(room: Room, player: Player): void {
    console.log(`[ClueScale] Player ${player.name} disconnected from room ${room.code} - broadcasting state update`);

    // Send lobby update to all players so they see the disconnected status with countdown
    this.sendLobbyUpdate(room);
  }

  /**
   * Called when a player leaves
   * Broadcasts updated game state to all remaining players so UI reflects removal
   */
  onPlayerLeave(room: Room, player: Player): void {
    const gameState = room.gameState.data as ClueGameState;

    // Remove player from role queue
    gameState.roleQueue = gameState.roleQueue.filter((id) => id !== player.id);

    // Clear any round timers if this was the clue giver
    if (gameState.round && gameState.round.clueGiverId === player.id) {
      if (gameState.roundTimer) {
        clearTimeout(gameState.roundTimer);
        gameState.roundTimer = undefined;
      }

      console.log(`[ClueScale] Player ${player.name} (clue giver) left room ${room.code} - round disrupted`);

      // If game is active, we may need to skip to next round or return to lobby
      // This is handled by the core server's onPlayerLeave calling our hook
      // We just clean up the timer here
    } else {
      console.log(`[ClueScale] Player ${player.name} left room ${room.code}`);
    }

    // ✅ Broadcast updated state to all clients so they update their player lists
    this.sendLobbyUpdate(room);
    console.log(`[ClueScale] Broadcast player removal for ${player.name} to room ${room.code}`);
  }

  /**
   * Called when game starts
   */
  onGameStart(room: Room): void {
    console.log(`[ClueScale] Game started in room ${room.code}`);
    // Nothing special needed - game start logic is in game:start handler
  }

  /**
   * Called when game ends
   */
  onGameEnd(room: Room): void {
    const gameState = room.gameState.data as ClueGameState;

    // Clean up any active timers
    if (gameState.roundTimer) {
      clearTimeout(gameState.roundTimer);
      gameState.roundTimer = undefined;
    }

    console.log(`[ClueScale] Game ended in room ${room.code}`);
  }

  /**
   * Called during cleanup
   */
  async onCleanup(): Promise<void> {
    console.log('[ClueScale] Plugin cleanup complete');
  }

  /**
   * Serialize room to client-expected format
   * Required for proper client-server communication
   */
  serializeRoom(room: Room, socketId: string): any {
    return serializeRoomToLobby(room, socketId);
  }

  /**
   * Socket event handlers (game-specific events only)
   */
  socketHandlers = {
    /**
     * Setup ClueScale-specific game data (Step 2 of room creation)
     */
    'clue:setup-game': async (socket: Socket, data: any, room: Room, helpers: GameHelpers) => {
      try {
        console.log(`[ClueScale] Setting up game for room ${room.code}`);
        const { settings } = data;

        // Update game settings in room.settings.gameSpecific (NOT gameState)
        if (settings) {
          const currentSettings = room.settings.gameSpecific as ClueSettings;

          // Update only provided settings
          if (settings.roundDuration !== undefined) {
            currentSettings.roundDuration = settings.roundDuration;
          }
          if (settings.teamBonusEnabled !== undefined) {
            currentSettings.teamBonusEnabled = settings.teamBonusEnabled;
          }
          if (settings.rotationType !== undefined) {
            currentSettings.rotationType = settings.rotationType;
          }
          if (settings.categories !== undefined && Array.isArray(settings.categories)) {
            currentSettings.categories = settings.categories;
            console.log(`[ClueScale] Room ${room.code} - Categories set to:`, currentSettings.categories);
          }
        }

        // Serialize room to client Lobby format
        const lobby = serializeRoomToLobby(room, socket.id);

        // Emit setup complete
        helpers.sendToRoom(room.code, 'clue:game-setup', { room: lobby });
        console.log(`[ClueScale] Game setup complete for room ${room.code}`);
      } catch (error) {
        console.error('[ClueScale] Error in clue:setup-game:', error);
        socket.emit('error', { message: 'Failed to setup game' });
      }
    },

    /**
     * Start the game
     */
    'game:start': async (socket: Socket, data: any, room: Room, helpers: GameHelpers) => {
      try {
        // Check if host (lookup by socketId since Map is keyed by player.id)
        const currentPlayer = Array.from(room.players.values()).find((p) => p.socketId === socket.id);
        if (!currentPlayer || !currentPlayer.isHost) {
          socket.emit('error', { message: 'Only host can start game' });
          return;
        }

        // Check min players
        const connectedPlayers = Array.from(room.players.values()).filter((p) => p.connected);
        if (connectedPlayers.length < room.settings.minPlayers) {
          socket.emit('error', {
            message: `Need at least ${room.settings.minPlayers} players`,
          });
          return;
        }

        console.log(`[ClueScale] Room ${room.code} - Game starting`);

        // Update GameBuddies player statuses if applicable
        if (room.isGameBuddiesRoom) {
          for (const player of room.players.values()) {
            await helpers.updatePlayerStatus(
              room.code,
              player.id,
              'in_game',
              { reason: 'game_started', playerName: player.name }
            );
          }
        }

        // Start first round
        const success = startNewRound(room, helpers);
        if (!success) {
          socket.emit('error', { message: 'Not enough players to start game' });
        }
      } catch (error: any) {
        console.error('[ClueScale] game:start error:', error);
        socket.emit('error', { message: 'Failed to start game' });
      }
    },

    /**
     * Submit clue word
     */
    'round:submit-clue': async (socket: Socket, data: any, room: Room, helpers: GameHelpers) => {
      try {
        const { clueWord } = data;
        const gameState = room.gameState.data as ClueGameState;
        const settings = room.settings.gameSpecific as ClueSettings;

        if (!gameState.round) {
          socket.emit('error', { message: 'No active round' });
          return;
        }

        // Verify this is the clue giver
        const currentPlayer = Array.from(room.players.values()).find((p) => p.socketId === socket.id);
        if (!currentPlayer || gameState.round.clueGiverId !== currentPlayer.id) {
          socket.emit('error', { message: 'You are not the clue giver' });
          return;
        }

        // Check if already submitted
        if (gameState.round.clueWord) {
          socket.emit('error', { message: 'Clue already submitted' });
          return;
        }

        // Validate clue (single word, no numbers)
        const trimmedClue = clueWord.trim();
        if (!trimmedClue || trimmedClue.length === 0) {
          socket.emit('error', { message: 'Clue cannot be empty' });
          return;
        }
        if (trimmedClue.split(/\s+/).length > 1) {
          socket.emit('error', { message: 'Clue must be a single word' });
          return;
        }
        // Save clue
        gameState.round.clueWord = trimmedClue;
        gameState.round.clueSubmittedAt = Date.now();
        room.gameState.phase = 'round_guess';

        console.log(`[ClueScale] Room ${room.code} - Clue submitted by ${currentPlayer.name}: ${trimmedClue}`);

        // Emit clue to all players
        helpers.sendToRoom(room.code, 'round:clue-submitted', {
          clueWord: trimmedClue,
          clueGiverId: currentPlayer.id,
          clueGiverName: currentPlayer.name,
        });

        // Restart timer for guess phase
        if (gameState.roundTimer) {
          clearTimeout(gameState.roundTimer);
        }

        gameState.roundTimer = setTimeout(() => {
          if (room.gameState.phase === 'round_guess') {
            console.log(`[ClueScale] Room ${room.code} - Guess timeout`);
            revealRoundResults(room, helpers);
            
            // Broadcast updated player scores via lobby update
            this.sendLobbyUpdate(room);
          }
        }, settings.roundDuration * 1000);
      } catch (error: any) {
        console.error('[ClueScale] round:submit-clue error:', error);
        socket.emit('error', { message: 'Failed to submit clue' });
      }
    },

    /**
     * Submit guess
     */
    'round:submit-guess': async (socket: Socket, data: any, room: Room, helpers: GameHelpers) => {
      try {
        const { guess } = data;
        const gameState = room.gameState.data as ClueGameState;

        if (!gameState.round) {
          socket.emit('error', { message: 'No active round' });
          return;
        }

        if (room.gameState.phase !== 'round_guess') {
          socket.emit('error', { message: 'Not in guess phase' });
          return;
        }

        const currentPlayer = Array.from(room.players.values()).find((p) => p.socketId === socket.id);
        if (!currentPlayer) {
          socket.emit('error', { message: 'Player not found' });
          return;
        }

        // Can't guess if you're the clue giver
        if (currentPlayer.id === gameState.round.clueGiverId) {
          socket.emit('error', { message: 'Clue giver cannot submit a guess' });
          return;
        }

        // In teams mode, only teammates of the clue giver can guess
        const settings = room.settings.gameSpecific as ClueSettings;
        if (settings.gameMode === 'teams' && gameState.teams && gameState.round) {
          // Find which team the clue giver belongs to
          const clueGiverTeam = gameState.teams.find(t =>
            t.playerIds.includes(gameState.round!.clueGiverId)
          );

          // Only allow guessing if player is on the same team as the clue giver
          if (!clueGiverTeam || !clueGiverTeam.playerIds.includes(currentPlayer.id)) {
            socket.emit('error', { message: 'Only the clue giver\'s teammates can guess' });
            return;
          }
        }

        // Validate guess (1-10)
        const guessNum = parseInt(guess);
        if (isNaN(guessNum) || guessNum < 1 || guessNum > 10) {
          socket.emit('error', { message: 'Guess must be between 1 and 10' });
          return;
        }

        // Check if already guessed
        const existingGuess = gameState.round.guesses.find((g) => g.playerId === currentPlayer.id);
        if (existingGuess) {
          socket.emit('error', { message: 'You have already submitted a guess' });
          return;
        }

        // Save guess
        const newGuess: Guess = {
          playerId: currentPlayer.id,
          playerName: currentPlayer.name,
          value: guessNum,
          submittedAt: Date.now(),
          points: 0, // Will be calculated during reveal
        };

        gameState.round.guesses.push(newGuess);

        console.log(`[ClueScale] Room ${room.code} - ${currentPlayer.name} guessed ${guessNum}`);

        // Emit to all players
        helpers.sendToRoom(room.code, 'round:guess-submitted', {
          playerId: currentPlayer.id,
          playerName: currentPlayer.name,
        });

        // Check if all expected players have guessed BEFORE sending lobby update
        // This prevents a race condition where lobby update with ROUND_GUESS state
        // arrives after round:reveal and overwrites the ROUND_REVEAL state

        // Get players who should be guessing
        let expectedGuessers: Player[];
        const revealSettings = room.settings.gameSpecific as ClueSettings;

        if (revealSettings.gameMode === 'teams' && gameState.teams) {
          // In team mode, only teammates of the clue giver should guess
          const clueGiverTeam = gameState.teams.find(t =>
            t.playerIds.includes(gameState.round!.clueGiverId)
          );
          expectedGuessers = Array.from(room.players.values()).filter(
            (p) => p.connected &&
                   p.id !== gameState.round!.clueGiverId &&
                   clueGiverTeam?.playerIds.includes(p.id)
          );
        } else {
          // In classic mode, all non-clue-giver players should guess
          expectedGuessers = Array.from(room.players.values()).filter(
            (p) => p.connected && p.id !== gameState.round!.clueGiverId
          );
        }

        if (gameState.round.guesses.length === expectedGuessers.length) {
          console.log(`[ClueScale] Room ${room.code} - All ${expectedGuessers.length} expected guessers submitted, revealing results`);
          // Clear timer and reveal immediately
          if (gameState.roundTimer) {
            clearTimeout(gameState.roundTimer);
            gameState.roundTimer = undefined;
          }
          revealRoundResults(room, helpers);
          // Note: round:reveal event already contains leaderboard with scores, no lobby update needed
        } else {
          // Only send lobby update for intermediate guesses so clue giver sees progress
          this.sendLobbyUpdate(room);
        }
      } catch (error: any) {
        console.error('[ClueScale] round:submit-guess error:', error);
        socket.emit('error', { message: 'Failed to submit guess' });
      }
    },

    /**
     * Move to next round
     */
    'round:next': async (socket: Socket, data: any, room: Room, helpers: GameHelpers) => {
      try {
        const currentPlayer = Array.from(room.players.values()).find((p) => p.socketId === socket.id);
        if (!currentPlayer || !currentPlayer.isHost) {
          socket.emit('error', { message: 'Only host can advance to next round' });
          return;
        }

        if (room.gameState.phase !== 'round_reveal') {
          socket.emit('error', { message: 'Can only advance from reveal phase' });
          return;
        }

        console.log(`[ClueScale] Room ${room.code} - Host ${currentPlayer.name} starting next round`);
        const success = startNewRound(room, helpers);
        if (!success) {
          socket.emit('error', { message: 'Failed to start next round' });
        }
      } catch (error: any) {
        console.error('[ClueScale] round:next error:', error);
        socket.emit('error', { message: 'Failed to advance round' });
      }
    },

    /**
     * Skip current turn (if clue giver is taking too long)
     */
    'round:skip-turn': async (socket: Socket, data: any, room: Room, helpers: GameHelpers) => {
      try {
        const currentPlayer = Array.from(room.players.values()).find((p) => p.socketId === socket.id);
        if (!currentPlayer || !currentPlayer.isHost) {
          socket.emit('error', { message: 'Only host can skip turn' });
          return;
        }

        const gameState = room.gameState.data as ClueGameState;

        if (!gameState.round) {
          socket.emit('error', { message: 'No active round' });
          return;
        }

        console.log(`[ClueScale] Room ${room.code} - Host ${currentPlayer.name} skipping current turn`);

        // Clear timer
        if (gameState.roundTimer) {
          clearTimeout(gameState.roundTimer);
          gameState.roundTimer = undefined;
        }

        // Deduct point from clue giver
        const clueGiver = Array.from(room.players.values()).find((p) => p.id === gameState.round!.clueGiverId);
        if (clueGiver) {
          const clueGiverData = clueGiver.gameData as CluePlayerData;
          clueGiverData.score = Math.max(0, clueGiverData.score - 1);
        }

        // Notify players
        helpers.sendToRoom(room.code, 'round:turn-skipped', {
          clueGiverId: gameState.round.clueGiverId,
          clueGiverName: clueGiver?.name,
        });

        // Start next round after brief delay
        setTimeout(() => {
          startNewRound(room, helpers);
        }, 2000);
      } catch (error: any) {
        console.error('[ClueScale] round:skip-turn error:', error);
        socket.emit('error', { message: 'Failed to skip turn' });
      }
    },

    /**
     * Update game settings
     */
    'settings:update': async (socket: Socket, data: any, room: Room, helpers: GameHelpers) => {
      try {
        const currentPlayer = Array.from(room.players.values()).find((p) => p.socketId === socket.id);
        if (!currentPlayer || !currentPlayer.isHost) {
          socket.emit('error', { message: 'Only host can update settings' });
          return;
        }

        if (room.gameState.phase !== 'lobby') {
          socket.emit('error', { message: 'Can only update settings in lobby' });
          return;
        }

        const { settings } = data;
        const currentSettings = room.settings.gameSpecific as ClueSettings;
        const gameState = room.gameState.data as ClueGameState;

        // Update settings with validation
        if (settings.roundDuration !== undefined) {
          currentSettings.roundDuration = Math.max(30, Math.min(180, settings.roundDuration));
        }
        if (settings.teamBonusEnabled !== undefined) {
          currentSettings.teamBonusEnabled = settings.teamBonusEnabled;
        }
        if (settings.rotationType !== undefined && ['circular', 'random'].includes(settings.rotationType)) {
          currentSettings.rotationType = settings.rotationType;
        }
        if (settings.categories && Array.isArray(settings.categories)) {
          currentSettings.categories = settings.categories;
        }

        // Team mode settings
        if (settings.gameMode !== undefined && ['classic', 'teams'].includes(settings.gameMode)) {
          const prevMode = currentSettings.gameMode;
          currentSettings.gameMode = settings.gameMode;

          // Initialize teams when switching to teams mode
          if (settings.gameMode === 'teams' && prevMode !== 'teams') {
            const connectedPlayers = Array.from(room.players.values()).filter(p => p.connected);
            gameState.teams = initializeTeams(connectedPlayers);
            gameState.currentTeamIndex = 0;
            gameState.teamRoundNumber = 1;
            gameState.completedRounds = 0;
            console.log(`[ClueScale] Room ${room.code} - Initialized teams:`, gameState.teams.map(t => ({ name: t.name, players: t.playerIds.length })));
          } else if (settings.gameMode === 'classic') {
            // Clear team data when switching back to classic
            gameState.teams = undefined;
            gameState.currentTeamIndex = undefined;
            gameState.teamRoundNumber = undefined;
            gameState.completedRounds = undefined;
          }
        }
        if (settings.totalRounds !== undefined) {
          currentSettings.totalRounds = Math.max(1, Math.min(20, settings.totalRounds));
        }

        console.log(`[ClueScale] Room ${room.code} - Settings updated by ${currentPlayer.name}`);

        // Broadcast lobby update (includes team data)
        this.sendLobbyUpdate(room);
      } catch (error: any) {
        console.error('[ClueScale] settings:update error:', error);
        socket.emit('error', { message: 'Failed to update settings' });
      }
    },

    /**
     * Shuffle teams (redistribute players)
     */
    'game:shuffle-teams': async (socket: Socket, data: any, room: Room, helpers: GameHelpers) => {
      try {
        const currentPlayer = Array.from(room.players.values()).find((p) => p.socketId === socket.id);
        if (!currentPlayer || !currentPlayer.isHost) {
          socket.emit('error', { message: 'Only host can shuffle teams' });
          return;
        }

        if (room.gameState.phase !== 'lobby') {
          socket.emit('error', { message: 'Can only shuffle teams in lobby' });
          return;
        }

        const gameState = room.gameState.data as ClueGameState;
        const settings = room.settings.gameSpecific as ClueSettings;

        if (settings.gameMode !== 'teams' || !gameState.teams) {
          socket.emit('error', { message: 'Not in teams mode' });
          return;
        }

        // Shuffle teams
        const connectedPlayers = Array.from(room.players.values()).filter(p => p.connected);
        gameState.teams = shuffleTeams(gameState.teams, connectedPlayers);

        console.log(`[ClueScale] Room ${room.code} - Teams shuffled by ${currentPlayer.name}`);

        // Broadcast lobby update with new team assignments
        this.sendLobbyUpdate(room);
      } catch (error: any) {
        console.error('[ClueScale] game:shuffle-teams error:', error);
        socket.emit('error', { message: 'Failed to shuffle teams' });
      }
    },

    /**
     * Restart game
     */
    'game:restart': async (socket: Socket, data: any, room: Room, helpers: GameHelpers) => {
      try {
        const currentPlayer = Array.from(room.players.values()).find((p) => p.socketId === socket.id);
        if (!currentPlayer || !currentPlayer.isHost) {
          socket.emit('error', { message: 'Only host can restart game' });
          return;
        }

        console.log(`[ClueScale] Room ${room.code} - Host ${currentPlayer.name} restarting game`);

        const gameState = room.gameState.data as ClueGameState;

        // Clear any timers
        if (gameState.roundTimer) {
          clearTimeout(gameState.roundTimer);
          gameState.roundTimer = undefined;
        }

        // Reset game state
        room.gameState.phase = 'lobby';
        gameState.round = null;
        gameState.roundStartTime = null;
        gameState.roleQueue = [];

        // Reset all player scores
        for (const player of room.players.values()) {
          const playerData = player.gameData as CluePlayerData;
          playerData.score = 0;
        }

        // Reset team scores and round counter (keep teams setup)
        if (gameState.teams) {
          gameState.teams.forEach(team => {
            team.score = 0;
          });
          gameState.currentTeamIndex = 0;
          gameState.teamRoundNumber = 1;
          gameState.completedRounds = 0;
        }

        // Notify players and send updated lobby
        helpers.sendToRoom(room.code, 'game:restarted', {});
        this.sendLobbyUpdate(room);
      } catch (error: any) {
        console.error('[ClueScale] game:restart error:', error);
        socket.emit('error', { message: 'Failed to restart game' });
      }
    },

    /**
     * Kick player (host only)
     */
    'player:kick': async (socket: Socket, data: any, room: Room, helpers: GameHelpers) => {
      try {
        const { playerId } = data;

        const currentPlayer = Array.from(room.players.values()).find((p) => p.socketId === socket.id);
        if (!currentPlayer || !currentPlayer.isHost) {
          socket.emit('error', { message: 'Only host can kick players' });
          return;
        }

        const targetPlayer = Array.from(room.players.values()).find((p) => p.id === playerId);
        if (!targetPlayer) {
          socket.emit('error', { message: 'Player not found' });
          return;
        }

        if (targetPlayer.isHost) {
          socket.emit('error', { message: 'Cannot kick the host' });
          return;
        }

        console.log(`[ClueScale] Room ${room.code} - Host ${currentPlayer.name} kicking player ${targetPlayer.name}`);

        // Remove player from room
        helpers.removePlayerFromRoom(room.code, targetPlayer.socketId);

        // Notify kicked player
        helpers.sendToPlayer(targetPlayer.socketId, 'player:kicked', {
          reason: 'Kicked by host',
        });

        // Notify room
        helpers.sendToRoom(room.code, 'player:left', {
          playerId: targetPlayer.socketId,  // Send socketId for client filtering
          playerName: targetPlayer.name,
          reason: 'kicked',
        });

        // ✅ Broadcast updated state to all remaining players (like onPlayerLeave does)
        this.sendLobbyUpdate(room);
        console.log(`[ClueScale] Broadcast player kick for ${targetPlayer.name} to room ${room.code}`);
      } catch (error: any) {
        console.error('[ClueScale] player:kick error:', error);
        socket.emit('error', { message: 'Failed to kick player' });
      }
    },
  };
}

// Export singleton instance
export const cluePlugin = new CluePlugin();
