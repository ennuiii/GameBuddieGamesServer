import axios from 'axios';
import type { GameBuddiesStatusUpdate, GameBuddiesReturnResult } from '../types/core.js';

export interface ReturnToLobbyOptions {
  playerId?: string;
  initiatedBy?: string;
  reason?: string;
  returnAll?: boolean;
  metadata?: Record<string, any>;
}

export interface ReturnToLobbyResponse {
  success: boolean;
  data?: {
    returnUrl: string;
    sessionToken?: string;
    playersReturned?: number;
    roomCode: string;
    pendingReturn: boolean;
    pollEndpoint: string;
  };
  error?: string;
  status?: number;
}

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
   * Uses GAMEBUDDIES_API_KEY as the default for all games,
   * with game-specific overrides if needed.
   */
  private loadApiKeys(): void {
    // Single shared API key for all games (preferred)
    const sharedKey = process.env.GAMEBUDDIES_API_KEY || '';

    // Game-specific overrides (optional, falls back to shared key)
    const keyMappings: Record<string, string> = {
      'bingo-buddies': process.env.BINGO_API_KEY || sharedKey,
      'clue-scale': process.env.CLUE_API_KEY || sharedKey,
      'ddf': process.env.DDF_API_KEY || sharedKey,
      'susd': process.env.SUSD_API_KEY || sharedKey,
      'school-quiz': process.env.QUIZ_API_KEY || sharedKey,
      'thinkalike': sharedKey,
      'template': sharedKey,
    };

    for (const [gameId, apiKey] of Object.entries(keyMappings)) {
      if (apiKey) {
        this.gameApiKeys.set(gameId, apiKey);
        console.log(`   ✅ ${gameId}: API key loaded`);
      } else {
        console.log(`   ⚠️  ${gameId}: No API key (status updates disabled)`);
      }
    }

    if (sharedKey) {
      console.log(`   🔑 Using shared GAMEBUDDIES_API_KEY for all games`);
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
   * Request return to GameBuddies lobby via API v2
   *
   * Calls POST https://gamebuddies.io/api/v2/external/return
   * to get the proper room-specific return URL and session token
   */
  async requestReturnToLobby(
    gameId: string,
    roomCode: string,
    options: ReturnToLobbyOptions = {}
  ): Promise<ReturnToLobbyResponse> {
    const apiKey = this.gameApiKeys.get(gameId);

    if (!apiKey) {
      console.warn(`[GameBuddies] No API key for ${gameId}, cannot call return API`);
      return {
        success: false,
        error: 'NO_API_KEY',
      };
    }

    const {
      playerId,
      initiatedBy,
      reason = 'external_return',
      returnAll = true,
      metadata = {},
    } = options;

    const payload = {
      roomCode,
      returnAll,
      reason,
      metadata,
      ...(playerId && { playerId }),
      ...(initiatedBy && { initiatedBy }),
    };

    const url = `${this.centralServerUrl}/api/v2/game/external/return`;

    console.log(`[GameBuddies] Requesting return-to-lobby for room ${roomCode}`, {
      game: gameId,
      returnAll,
      hasPlayerId: !!playerId,
      initiatedBy: initiatedBy || 'unknown',
    });

    try {
      const response = await axios.post(url, payload, {
        timeout: this.apiTimeout,
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': apiKey,
        },
      });

      console.log(`[GameBuddies] ✅ Return request succeeded:`, {
        returnUrl: response.data.returnUrl,
        hasSessionToken: !!response.data.sessionToken,
        playersReturned: response.data.playersReturned,
      });

      return {
        success: true,
        data: response.data,
      };
    } catch (error: any) {
      console.error(`[GameBuddies] ❌ Return request failed:`, {
        message: error.message,
        status: error.response?.status,
        data: error.response?.data,
      });

      return {
        success: false,
        error: error.message,
        status: error.response?.status,
      };
    }
  }

  /**
   * Get fallback return URL for when API is unavailable
   * This ensures even if API fails, players return to correct room (not homepage)
   */
  getFallbackReturnUrl(roomCode: string): string {
    return `${this.centralServerUrl}/lobby/${roomCode}`;
  }

  /**
   * Mark room as abandoned in Gamebuddies.io
   * Called when game server room is deleted or becomes empty
   *
   * This updates:
   * - Room status to 'abandoned'
   * - All players to in_game=false, current_location='lobby'
   *
   * @param gameId - Which game (e.g., 'clue-scale')
   * @param roomCode - GameBuddies room code
   * @param reason - Reason for abandonment (e.g., 'host_disconnected', 'room_empty', 'all_players_left')
   */
  async markRoomAbandoned(
    gameId: string,
    roomCode: string,
    reason: string = 'game_room_deleted'
  ): Promise<boolean> {
    const apiKey = this.gameApiKeys.get(gameId);

    if (!apiKey) {
      console.warn(`[GameBuddies] No API key for ${gameId}, skipping room abandon notification`);
      return false;
    }

    const url = `${this.centralServerUrl}/api/v2/game/rooms/${roomCode}/abandon`;

    try {
      console.log(`[GameBuddies] 🚪 Marking room ${roomCode} as abandoned (${reason})`);

      await axios.post(url, { reason }, {
        timeout: this.apiTimeout,
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': apiKey,
        },
      });

      console.log(`[GameBuddies] ✅ Room ${roomCode} marked as abandoned`);
      return true;
    } catch (error: any) {
      if (error.code === 'ECONNABORTED') {
        console.error(`[GameBuddies] ❌ Timeout marking room abandoned (${this.apiTimeout}ms)`);
      } else if (error.response?.status === 404) {
        // Room not found in gamebuddies.io - might already be deleted, that's fine
        console.log(`[GameBuddies] Room ${roomCode} not found in central server (may already be deleted)`);
        return true;
      } else if (error.response) {
        console.error(`[GameBuddies] ❌ API error marking room abandoned:`, {
          status: error.response.status,
          data: error.response.data,
        });
      } else {
        console.error(`[GameBuddies] ❌ Network error marking room abandoned:`, error.message);
      }
      return false;
    }
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
  
  /**
   * SECURITY: Validate premium status server-side
   *
   * Calls the GameBuddies.io API to get the REAL premium tier for a session.
   * This prevents clients from spoofing their premium status via DevTools.
   *
   * @param sessionToken - The session token from Gamebuddies.io
   * @returns The validated premium tier ('free', 'monthly', 'yearly', 'lifetime')
   */
  async validatePremiumStatus(sessionToken: string): Promise<string> {
    if (!sessionToken) {
      console.log('[GameBuddies] No session token provided, defaulting to free');
      return 'free';
    }

    const url = `${this.centralServerUrl}/api/game-sessions/${sessionToken}`;

    try {
      console.log(`[GameBuddies] 💎 Validating premium status for session ${sessionToken.substring(0, 8)}...`);

      const response = await axios.get(url, {
        timeout: this.apiTimeout,
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (response.data?.success && response.data?.session) {
        const validatedTier = response.data.session.premiumTier || 'free';
        console.log(`[GameBuddies] 💎 Premium validation result: ${validatedTier}`);
        return validatedTier;
      }

      console.log('[GameBuddies] ⚠️ Invalid API response, defaulting to free');
      return 'free';

    } catch (error: any) {
      if (error.code === 'ECONNABORTED') {
        console.error(`[GameBuddies] ❌ Premium validation timeout (${this.apiTimeout}ms)`);
      } else if (error.response?.status === 404) {
        console.log('[GameBuddies] ⚠️ Session not found or expired, defaulting to free');
      } else if (error.response) {
        console.error(`[GameBuddies] ❌ Premium validation API error:`, {
          status: error.response.status,
          data: error.response.data,
        });
      } else {
        console.error(`[GameBuddies] ❌ Premium validation network error:`, error.message);
      }

      // On error, default to free for security (fail closed)
      return 'free';
    }
  }

  /**
   * Grant XP reward to a player
   */
  async grantReward(
    gameId: string,
    userId: string,
    data: {
      won: boolean;
      durationSeconds: number;
      score?: number;
      winStreak?: number;
      metadata?: Record<string, any>;
    }
  ): Promise<any> {
    const apiKey = this.gameApiKeys.get(gameId);

    if (!apiKey) {
      console.warn(`[GameBuddies] No API key for ${gameId}, cannot grant reward`);
      return null;
    }

    const url = `${this.centralServerUrl}/api/v2/game/reward`;

    try {
      console.log(`[GameBuddies] 🎁 Granting reward for ${userId} in ${gameId}`);

      const response = await axios.post(url, { userId, gameId, ...data }, {
        timeout: this.apiTimeout,
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': apiKey,
        },
      });

      return response.data;
    } catch (error: any) {
      console.error(`[GameBuddies] ❌ Grant reward failed:`, error.message);
      return null;
    }
  }
}

// Singleton instance
export const gameBuddiesService = new GameBuddiesService();
