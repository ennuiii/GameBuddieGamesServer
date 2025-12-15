import type { GamePlugin, Room, Player, GameHelpers } from '../../core/types/core.js';
import type { Socket } from 'socket.io';
import {
  BingoGameState,
  BingoPlayerData,
  BingoSettings,
  BingoCard,
  DEFAULT_BINGO_SETTINGS,
  createInitialGameState,
  createInitialPlayerData,
  checkBingoWin,
} from './types/index.js';
import { randomUUID } from 'crypto';

/**
 * Serialize Room to client format
 *
 * ⚠️ CRITICAL: This function is MANDATORY for all game plugins!
 * The unified server's Room structure doesn't match legacy client expectations.
 */
function serializeRoomToClient(room: Room, socketId: string) {
  const gameState = room.gameState.data as BingoGameState;
  const gameSettings = room.settings.gameSpecific as BingoSettings;

  // Map server phase to client GamePhase enum
  let clientPhase: 'lobby' | 'input' | 'review' | 'playing' | 'finished';
  switch (room.gameState.phase) {
    case 'lobby':
      clientPhase = 'lobby';
      break;
    case 'input':
      clientPhase = 'input';
      break;
    case 'review':
      clientPhase = 'review';
      break;
    case 'playing':
      clientPhase = 'playing';
      break;
    case 'finished':
      clientPhase = 'finished';
      break;
    default:
      clientPhase = 'lobby';
  }

  // Convert players Map to Array with client-expected format
  const players = Array.from(room.players.values()).map((p) => {
    const playerData = p.gameData as BingoPlayerData;
    return {
      id: p.id,
      name: p.name,
      isHost: p.isHost,
      isConnected: p.connected,
      connected: p.connected,
      disconnectedAt: p.disconnectedAt ?? null,
      joinedAt: Date.now(), // Could store this in playerData if needed
      sessionToken: undefined, // Client manages this separately
      premiumTier: p.premiumTier,
      avatarUrl: p.avatarUrl,
    };
  });

  // Extract and flatten settings
  const settings = {
    maxPlayers: room.settings.maxPlayers,
    cardSize: gameSettings.cardSize,
    allowSpectators: gameSettings.allowSpectators,
    autoStart: gameSettings.autoStart,
  };

  if (room.isStreamerMode || room.hideRoomCode) {
    console.log(
      `[BingoBuddies] serializeRoom flags -> ${room.code}: streamerMode=${room.isStreamerMode} hideRoomCode=${room.hideRoomCode}`
    );
  }

  // Return complete Room object in client format
  return {
    id: room.code, // Client uses 'id' field
    code: room.code,
    hostId: room.hostId,
    players,
    gameState: {
      phase: clientPhase,
      bingoCards: gameState.bingoCards,
      currentDrawnItems: gameState.currentDrawnItems,
      winners: gameState.winners,
      startedAt: gameState.startedAt,
      inputPhaseClosedAt: gameState.inputPhaseClosedAt,
    },
    settings,
    createdAt: Date.now(), // Room creation time
    lastActivity: Date.now(),
    isStreamerMode: room.isStreamerMode || false,
    hideRoomCode: room.hideRoomCode || false,
  };
}

/**
 * BingoBuddies Game Plugin
 *
 * A custom bingo game where players create their own bingo cards with personalized content,
 * then mark items off during gameplay to achieve bingo patterns.
 */
class BingoPlugin implements GamePlugin {
  // Metadata
  id = 'bingo-buddies';
  name = 'BingoBuddies';
  version = '1.0.0';
  namespace = '/bingo';
  basePath = '/bingo';

  // Configuration
  defaultSettings = {
    minPlayers: 2,
    maxPlayers: 20,
    gameSpecific: DEFAULT_BINGO_SETTINGS,
  };

  // Socket.IO instance
  private io: any;

  /**
   * Initialize plugin
   */
  async onInitialize(io: any) {
    console.log('[BingoBuddies] Initializing BingoBuddies plugin...');
    this.io = io;
    console.log('[BingoBuddies] Plugin initialized');
  }

  /**
   * Called when a room is created
   */
  onRoomCreate(room: Room): void {
    // Initialize BingoBuddies game state
    room.gameState.data = createInitialGameState();
    room.gameState.phase = 'lobby';

    // Apply BingoBuddies-specific settings
    if (!room.settings.gameSpecific) {
      room.settings.gameSpecific = { ...DEFAULT_BINGO_SETTINGS };
    }

    console.log(`[BingoBuddies] Room ${room.code} created with initial game state`);
  }

  /**
   * Called when a player joins
   */
  onPlayerJoin(room: Room, player: Player, isReconnecting?: boolean): void {
    // Initialize player's game data
    if (!player.gameData) {
      player.gameData = createInitialPlayerData();
    }

    if (!isReconnecting) {
      console.log(`[BingoBuddies] Player ${player.name} joined room ${room.code}`);
    }

    // Send serialized room state to all players in the room
    if (this.io) {
      const namespace = this.io.of('/bingo');

      // Send to each player
      room.players.forEach((p) => {
        const serializedRoom = serializeRoomToClient(room, p.socketId);
        namespace.to(p.socketId).emit('roomStateUpdated', serializedRoom);
      });

      console.log(
        `[BingoBuddies] Sent room update to ${room.players.size} players in room ${room.code}`
      );
    }
  }

  /**
   * Called when a player leaves
   */
  onPlayerLeave(room: Room, player: Player): void {
    const gameState = room.gameState.data as BingoGameState;

    // Remove player's bingo card if they have one
    gameState.bingoCards = gameState.bingoCards.filter((card) => card.playerId !== player.id);

    // Remove from winners if they were a winner
    gameState.winners = gameState.winners.filter((winnerId) => winnerId !== player.id);

    console.log(`[BingoBuddies] Player ${player.name} left room ${room.code}`);
  }

  /**
   * Called when game starts
   */
  onGameStart(room: Room): void {
    console.log(`[BingoBuddies] Game started in room ${room.code}`);
  }

  /**
   * Called when game ends
   */
  onGameEnd(room: Room): void {
    console.log(`[BingoBuddies] Game ended in room ${room.code}`);
  }

  /**
   * Called during cleanup
   */
  async onCleanup(): Promise<void> {
    console.log('[BingoBuddies] Plugin cleanup complete');
  }

  /**
   * Serialize room for client (CRITICAL for room:joined event)
   */
  serializeRoom(room: Room, socketId: string): any {
    return serializeRoomToClient(room, socketId);
  }

  /**
   * Socket event handlers (game-specific events only)
   */
  socketHandlers = {
    /**
     * Setup BingoBuddies-specific game data (Step 2 of room creation)
     */
    'bingo:setup-game': async (
      socket: Socket,
      data: any,
      room: Room,
      helpers: GameHelpers
    ) => {
      try {
        console.log(`[BingoBuddies] Setting up game for room ${room.code}`);
        const { settings } = data;

        // Update game settings in room.settings.gameSpecific
        if (settings) {
          const currentSettings = room.settings.gameSpecific as BingoSettings;

          if (settings.cardSize !== undefined) {
            currentSettings.cardSize = settings.cardSize;
          }
          if (settings.allowSpectators !== undefined) {
            currentSettings.allowSpectators = settings.allowSpectators;
          }
          if (settings.autoStart !== undefined) {
            currentSettings.autoStart = settings.autoStart;
          }
        }

        // Serialize and send to all players in room
        const serializedRoom = serializeRoomToClient(room, socket.id);
        helpers.sendToRoom(room.code, 'bingo:game-setup', { room: serializedRoom });

        console.log(`[BingoBuddies] Game setup complete for room ${room.code}`);
      } catch (error) {
        console.error('[BingoBuddies] Error in bingo:setup-game:', error);
        socket.emit('error', { message: 'Failed to setup game' });
      }
    },

    /**
     * Start the game (move to INPUT phase)
     */
    'bingo:start-game': async (
      socket: Socket,
      data: any,
      room: Room,
      helpers: GameHelpers
    ) => {
      try {
        const player = Array.from(room.players.values()).find(
          (p) => p.socketId === socket.id
        );

        if (!player) {
          socket.emit('error', { message: 'Player not found' });
          return;
        }

        if (room.hostId !== player.id) {
          socket.emit('error', { message: 'Only the host can start the game' });
          return;
        }

        const connectedPlayers = Array.from(room.players.values()).filter((p) => p.connected);
        if (connectedPlayers.length < room.settings.minPlayers) {
          socket.emit('error', {
            message: `Need at least ${room.settings.minPlayers} players to start`,
          });
          return;
        }

        // Update phase to INPUT
        room.gameState.phase = 'input';
        const gameState = room.gameState.data as BingoGameState;
        gameState.startedAt = Date.now();

        // Notify all players
        helpers.sendToRoom(room.code, 'gamePhaseChanged', 'input');

        // Send updated room state
        const serializedRoom = serializeRoomToClient(room, socket.id);
        helpers.sendToRoom(room.code, 'roomStateUpdated', serializedRoom);

        console.log(`[BingoBuddies] Game started in room ${room.code} - INPUT phase`);
      } catch (error) {
        console.error('[BingoBuddies] Error in bingo:start-game:', error);
        socket.emit('error', { message: 'Failed to start game' });
      }
    },

    /**
     * Reset the game back to lobby
     */
    'bingo:reset-game': async (
      socket: Socket,
      data: any,
      room: Room,
      helpers: GameHelpers
    ) => {
      try {
        const player = Array.from(room.players.values()).find(
          (p) => p.socketId === socket.id
        );

        if (!player) {
          socket.emit('error', { message: 'Player not found' });
          return;
        }

        if (room.hostId !== player.id) {
          socket.emit('error', { message: 'Only the host can reset the game' });
          return;
        }

        // Reset game state
        room.gameState.phase = 'lobby';
        room.gameState.data = createInitialGameState();

        // Notify all players
        helpers.sendToRoom(room.code, 'gamePhaseChanged', 'lobby');

        // Send updated room state
        const serializedRoom = serializeRoomToClient(room, socket.id);
        helpers.sendToRoom(room.code, 'roomStateUpdated', serializedRoom);

        console.log(`[BingoBuddies] Game reset in room ${room.code}`);
      } catch (error) {
        console.error('[BingoBuddies] Error in bingo:reset-game:', error);
        socket.emit('error', { message: 'Failed to reset game' });
      }
    },

    /**
     * Submit a bingo card
     */
    'bingo:submit-card': async (
      socket: Socket,
      cardData: any,
      room: Room,
      helpers: GameHelpers
    ) => {
      try {
        const player = Array.from(room.players.values()).find(
          (p) => p.socketId === socket.id
        );

        if (!player) {
          socket.emit('error', { message: 'Player not found' });
          return;
        }

        if (room.gameState.phase !== 'input') {
          socket.emit('error', { message: 'Not in input phase' });
          return;
        }

        const gameState = room.gameState.data as BingoGameState;

        // Check if player already has a card
        const existingCardIndex = gameState.bingoCards.findIndex(
          (card) => card.playerId === player.id
        );

        // Create new card
        const newCard: BingoCard = {
          id: existingCardIndex >= 0 ? gameState.bingoCards[existingCardIndex].id : randomUUID(),
          playerId: player.id,
          playerName: player.name,
          size: cardData.size,
          items: cardData.items,
          markedItems: cardData.markedItems || new Array(cardData.items.length).fill(false),
          isComplete: false,
        };

        // Update or add card
        if (existingCardIndex >= 0) {
          gameState.bingoCards[existingCardIndex] = newCard;
        } else {
          gameState.bingoCards.push(newCard);
        }

        // Notify all players about the card submission
        helpers.sendToRoom(room.code, 'bingoCardSubmitted', newCard);

        // Check if all connected players have submitted cards
        const connectedPlayers = Array.from(room.players.values()).filter((p) => p.connected);
        if (gameState.bingoCards.length === connectedPlayers.length) {
          // All players have submitted, move to review phase
          room.gameState.phase = 'review';
          gameState.inputPhaseClosedAt = Date.now();

          helpers.sendToRoom(room.code, 'gamePhaseChanged', 'review');

          // Send updated room state
          const serializedRoom = serializeRoomToClient(room, socket.id);
          helpers.sendToRoom(room.code, 'roomStateUpdated', serializedRoom);

          console.log(`[BingoBuddies] All cards submitted, moved to REVIEW in room ${room.code}`);
        }

        console.log(`[BingoBuddies] Card submitted by ${player.name} in room ${room.code}`);
      } catch (error) {
        console.error('[BingoBuddies] Error in bingo:submit-card:', error);
        socket.emit('error', { message: 'Failed to submit card' });
      }
    },

    /**
     * Close input phase manually (host only)
     */
    'bingo:close-input': async (
      socket: Socket,
      data: any,
      room: Room,
      helpers: GameHelpers
    ) => {
      try {
        const player = Array.from(room.players.values()).find(
          (p) => p.socketId === socket.id
        );

        if (!player) {
          socket.emit('error', { message: 'Player not found' });
          return;
        }

        if (room.hostId !== player.id) {
          socket.emit('error', { message: 'Only the host can close input phase' });
          return;
        }

        if (room.gameState.phase !== 'input') {
          socket.emit('error', { message: 'Not in input phase' });
          return;
        }

        // Move to review phase
        room.gameState.phase = 'review';
        const gameState = room.gameState.data as BingoGameState;
        gameState.inputPhaseClosedAt = Date.now();

        helpers.sendToRoom(room.code, 'gamePhaseChanged', 'review');

        // Send updated room state
        const serializedRoom = serializeRoomToClient(room, socket.id);
        helpers.sendToRoom(room.code, 'roomStateUpdated', serializedRoom);

        console.log(`[BingoBuddies] Input phase closed in room ${room.code}`);
      } catch (error) {
        console.error('[BingoBuddies] Error in bingo:close-input:', error);
        socket.emit('error', { message: 'Failed to close input phase' });
      }
    },

    /**
     * Start playing phase (host only)
     */
    'bingo:start-playing': async (
      socket: Socket,
      data: any,
      room: Room,
      helpers: GameHelpers
    ) => {
      try {
        const player = Array.from(room.players.values()).find(
          (p) => p.socketId === socket.id
        );

        if (!player) {
          socket.emit('error', { message: 'Player not found' });
          return;
        }

        if (room.hostId !== player.id) {
          socket.emit('error', { message: 'Only the host can start playing phase' });
          return;
        }

        if (room.gameState.phase !== 'review') {
          socket.emit('error', { message: 'Not in review phase' });
          return;
        }

        // Move to playing phase
        room.gameState.phase = 'playing';

        helpers.sendToRoom(room.code, 'gamePhaseChanged', 'playing');

        // Send updated room state
        const serializedRoom = serializeRoomToClient(room, socket.id);
        helpers.sendToRoom(room.code, 'roomStateUpdated', serializedRoom);

        console.log(`[BingoBuddies] Playing phase started in room ${room.code}`);
      } catch (error) {
        console.error('[BingoBuddies] Error in bingo:start-playing:', error);
        socket.emit('error', { message: 'Failed to start playing phase' });
      }
    },

    /**
     * Mark an item on a bingo card
     */
    'bingo:mark-item': async (
      socket: Socket,
      data: { cardId: string; itemIndex: number },
      room: Room,
      helpers: GameHelpers
    ) => {
      try {
        const player = Array.from(room.players.values()).find(
          (p) => p.socketId === socket.id
        );

        if (!player) {
          socket.emit('error', { message: 'Player not found' });
          return;
        }

        if (room.gameState.phase !== 'playing') {
          socket.emit('error', { message: 'Game is not in playing phase' });
          return;
        }

        const gameState = room.gameState.data as BingoGameState;
        const card = gameState.bingoCards.find((c) => c.id === data.cardId);

        if (!card) {
          socket.emit('error', { message: 'Card not found' });
          return;
        }

        // Verify that this card belongs to the player
        if (card.playerId !== player.id) {
          socket.emit('error', { message: 'Cannot mark another player\'s card' });
          return;
        }

        // Verify valid item index
        if (data.itemIndex < 0 || data.itemIndex >= card.items.length) {
          socket.emit('error', { message: 'Invalid item index' });
          return;
        }

        // Mark the item
        card.markedItems[data.itemIndex] = true;

        // Check for bingo
        const hasBingo = checkBingoWin(card);
        if (hasBingo && !card.isComplete) {
          card.isComplete = true;

          // Add to winners if not already there
          if (!gameState.winners.includes(player.id)) {
            gameState.winners.push(player.id);
          }

          // Notify all players about the winner
          const winningCards = gameState.bingoCards.filter((c) => c.isComplete);
          helpers.sendToRoom(room.code, 'winnerDeclared', {
            winners: gameState.winners,
            winningCards,
          });

          // Move to finished phase if we have a winner
          room.gameState.phase = 'finished';
          helpers.sendToRoom(room.code, 'gamePhaseChanged', 'finished');

          console.log(`[BingoBuddies] BINGO! Winner: ${player.name} in room ${room.code}`);
        }

        // Notify all players about the marked item
        helpers.sendToRoom(room.code, 'itemMarked', {
          cardId: data.cardId,
          itemIndex: data.itemIndex,
          playerId: player.id,
        });

        // Send updated card
        helpers.sendToRoom(room.code, 'bingoCardUpdated', card);

        console.log(
          `[BingoBuddies] Item marked by ${player.name} in room ${room.code}${
            hasBingo ? ' - BINGO!' : ''
          }`
        );
      } catch (error) {
        console.error('[BingoBuddies] Error in bingo:mark-item:', error);
        socket.emit('error', { message: 'Failed to mark item' });
      }
    },

    /**
     * Update room settings (host only)
     */
    'bingo:update-settings': async (
      socket: Socket,
      data: any,
      room: Room,
      helpers: GameHelpers
    ) => {
      try {
        const player = Array.from(room.players.values()).find(
          (p) => p.socketId === socket.id
        );

        if (!player) {
          socket.emit('error', { message: 'Player not found' });
          return;
        }

        if (room.hostId !== player.id) {
          socket.emit('error', { message: 'Only the host can update settings' });
          return;
        }

        const currentSettings = room.settings.gameSpecific as BingoSettings;

        // Update settings
        if (data.cardSize !== undefined) {
          currentSettings.cardSize = data.cardSize;
        }
        if (data.allowSpectators !== undefined) {
          currentSettings.allowSpectators = data.allowSpectators;
        }
        if (data.autoStart !== undefined) {
          currentSettings.autoStart = data.autoStart;
        }

        // Notify all players with updated room state
        const serializedRoom = serializeRoomToClient(room, socket.id);
        helpers.sendToRoom(room.code, 'roomStateUpdated', serializedRoom);
        helpers.sendToRoom(room.code, 'roomSettingsUpdated', currentSettings);

        console.log(`[BingoBuddies] Settings updated in room ${room.code}`);
      } catch (error) {
        console.error('[BingoBuddies] Error in bingo:update-settings:', error);
        socket.emit('error', { message: 'Failed to update settings' });
      }
    },
  };
}

export default new BingoPlugin();
