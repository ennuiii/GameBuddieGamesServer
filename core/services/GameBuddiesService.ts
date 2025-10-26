import axios from 'axios';
import type { GameBuddiesStatusUpdate, GameBuddiesReturnResult } from '../types/core.js';

/**
 * Unified GameBuddies Platform Integration Service
 *
 * Handles communication with the GameBuddies.io central platform for:
 * - Player status updates (via External Game Status API)
 * - Return-to-lobby functionality
 * - Game registration/keep-alive
 *
 * This service is shared across ALL games in the unified server.
 */
export class GameBuddiesService {
  private centralServerUrl: string;
  private apiTimeout: number;
  private gameApiKeys: Map<string, string>; // gameId -> API key

  constructor() {
    this.centralServerUrl = process.env.GAMEBUDDIES_CENTRAL_URL || 'https://gamebuddies.io';
    this.apiTimeout = 5000; // 5 second timeout
    this.gameApiKeys = new Map();

    // Load API keys from environment
    this.loadApiKeys();

    console.log(`🎯 [GameBuddies] Service initialized:`);
    console.log(`   Central Server: ${this.centralServerUrl}`);
    console.log(`   API Timeout: ${this.apiTimeout}ms`);
    console.log(`   Loaded API Keys: ${this.gameApiKeys.size} game(s)`);
  }

  /**
   * Load API keys for all games from environment variables
   */
  private loadApiKeys(): void {
    const keyMappings: Record<string, string> = {
      'bingo-buddies': process.env.BINGO_API_KEY || '',
      'clue-scale': process.env.CLUE_API_KEY || '',
      'ddf': process.env.DDF_API_KEY || '',
      'susd': process.env.SUSD_API_KEY || '',
      'school-quiz': process.env.QUIZ_API_KEY || '',
    };

    for (const [gameId, apiKey] of Object.entries(keyMappings)) {
      if (apiKey) {
        this.gameApiKeys.set(gameId, apiKey);
        console.log(`   ✅ ${gameId}: API key loaded`);
      } else {
        console.log(`   ⚠️  ${gameId}: No API key (status updates disabled)`);
      }
    }
  }

  /**
   * Get API key for a specific game
   */
  getApiKey(gameId: string): string | undefined {
    return this.gameApiKeys.get(gameId);
  }

  /**
   * Update player status using External Game Status API
   *
   * @param gameId - Which game (e.g., 'bingo-buddies')
   * @param roomCode - GameBuddies room code
   * @param playerId - GameBuddies player ID
   * @param status - Player status (e.g., 'in-game', 'waiting', 'eliminated')
   * @param reason - Human-readable reason for status change
   * @param gameData - Optional game-specific data
   */
  async updatePlayerStatus(
    gameId: string,
    roomCode: string,
    playerId: string,
    status: string,
    reason: string,
    gameData: any = null
  ): Promise<boolean> {
    const apiKey = this.gameApiKeys.get(gameId);

    if (!apiKey) {
      console.warn(`[GameBuddies] No API key for ${gameId}, skipping status update`);
      return false;
    }

    const requestPayload = {
      status,
      location: this.getLocationFromStatus(status),
      reason,
      gameData,
    };

    const requestConfig = {
      timeout: this.apiTimeout,
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
      },
    };

    const url = `${this.centralServerUrl}/api/v2/game/rooms/${roomCode}/players/${playerId}/status`;

    try {
      console.log(`[GameBuddies] Updating player status:`, {
        game: gameId,
        room: roomCode,
        player: playerId,
        status,
        reason,
      });

      const response = await axios.post(url, requestPayload, requestConfig);

      console.log(`[GameBuddies] ✅ Status updated successfully`);
      return true;
    } catch (error: any) {
      if (error.code === 'ECONNABORTED') {
        console.error(`[GameBuddies] ❌ Timeout updating status (${this.apiTimeout}ms)`);
      } else if (error.response) {
        console.error(`[GameBuddies] ❌ API error:`, {
          status: error.response.status,
          data: error.response.data,
        });
      } else {
        console.error(`[GameBuddies] ❌ Network error:`, error.message);
      }
      return false;
    }
  }

  /**
   * Update multiple players' status at once (batch operation)
   */
  async updateMultiplePlayerStatus(
    gameId: string,
    roomCode: string,
    updates: Array<{ playerId: string; status: string; reason: string; gameData?: any }>
  ): Promise<{ success: number; failed: number }> {
    console.log(`[GameBuddies] Batch updating ${updates.length} player(s)`);

    const results = await Promise.allSettled(
      updates.map(({ playerId, status, reason, gameData }) =>
        this.updatePlayerStatus(gameId, roomCode, playerId, status, reason, gameData)
      )
    );

    const success = results.filter((r) => r.status === 'fulfilled' && r.value).length;
    const failed = results.length - success;

    console.log(`[GameBuddies] Batch complete: ${success} success, ${failed} failed`);
    return { success, failed };
  }

  /**
   * Return players to GameBuddies lobby
   *
   * @param gameId - Which game
   * @param roomCode - GameBuddies room code
   * @param playerIds - Array of player IDs to return
   * @param reason - Reason for return (e.g., 'Game ended', 'Host left')
   */
  async returnPlayersToLobby(
    gameId: string,
    roomCode: string,
    playerIds: string[],
    reason: string
  ): Promise<GameBuddiesReturnResult> {
    console.log(`[GameBuddies] Returning ${playerIds.length} player(s) to lobby:`, {
      game: gameId,
      room: roomCode,
      reason,
    });

    // Update all players to 'returned-to-lobby' status
    const updates = playerIds.map((playerId) => ({
      playerId,
      status: 'returned-to-lobby',
      reason,
    }));

    const result = await this.updateMultiplePlayerStatus(gameId, roomCode, updates);

    return {
      success: result.success > 0,
      playersTargeted: playerIds.length,
      apiResponse: result,
    };
  }

  /**
   * Map status to location for GameBuddies platform
   */
  private getLocationFromStatus(status: string): string {
    const locationMap: Record<string, string> = {
      'in-game': 'game',
      'in-lobby': 'lobby',
      'waiting': 'game',
      'playing': 'game',
      'eliminated': 'game',
      'finished': 'game',
      'returned-to-lobby': 'lobby',
      'disconnected': 'disconnected',
    };

    return locationMap[status] || 'game';
  }

  /**
   * Notify GameBuddies that game is starting
   */
  async notifyGameStart(gameId: string, roomCode: string, playerIds: string[]): Promise<void> {
    console.log(`[GameBuddies] Notifying game start for ${playerIds.length} player(s)`);

    const updates = playerIds.map((playerId) => ({
      playerId,
      status: 'in-game',
      reason: 'Game started',
    }));

    await this.updateMultiplePlayerStatus(gameId, roomCode, updates);
  }

  /**
   * Notify GameBuddies that game has ended
   */
  async notifyGameEnd(
    gameId: string,
    roomCode: string,
    playerIds: string[],
    winners: string[] = []
  ): Promise<void> {
    console.log(`[GameBuddies] Notifying game end`);

    const updates = playerIds.map((playerId) => ({
      playerId,
      status: 'finished',
      reason: winners.includes(playerId) ? 'Winner!' : 'Game finished',
      gameData: { isWinner: winners.includes(playerId) },
    }));

    await this.updateMultiplePlayerStatus(gameId, roomCode, updates);
  }

  /**
   * Health check: Test connection to GameBuddies platform
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await axios.get(`${this.centralServerUrl}/health`, {
        timeout: 3000,
      });
      return response.status === 200;
    } catch (error) {
      console.error('[GameBuddies] Health check failed:', error);
      return false;
    }
  }
}

// Singleton instance
export const gameBuddiesService = new GameBuddiesService();
