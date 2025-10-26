import axios from 'axios';

interface ReturnOptions {
  playerId?: string;
  initiatedBy?: string;
  reason?: string;
  returnAll?: boolean;
  metadata?: any;
}

class GameBuddiesService {
  private apiBase: string;
  private apiKey: string | undefined;
  private gameId: string;
  private apiTimeout: number = 5000;

  constructor() {
    this.apiBase = process.env.GAMEBUDDIES_CENTRAL_URL || 'https://gamebuddies.io';
    this.apiKey = process.env.GAMEBUDDIES_API_KEY;
    this.gameId = process.env.GAME_ID || 'susd';

    console.log(`[GameBuddies] Initialized with API base: ${this.apiBase}`);
    console.log(`[GameBuddies] API Key: ${this.apiKey ? '✅ Configured' : '❌ Missing'}`);
  }

  /**
   * Request return to GameBuddies lobby
   */
  async requestReturnToLobby(
    roomCode: string,
    options: ReturnOptions = {}
  ): Promise<{
    success: boolean;
    returnUrl: string;
    sessionToken?: string;
    playersReturned?: number;
    error?: string;
  }> {
    if (!this.apiKey) {
      console.warn('[GameBuddies] No API key - using fallback return URL');
      return {
        success: false,
        returnUrl: `${this.apiBase}/lobby/${roomCode}`,
        error: 'NO_API_KEY',
      };
    }

    const {
      playerId,
      initiatedBy = 'host',
      reason = 'game_ended',
      returnAll = true,
      metadata = {},
    } = options;

    const url = `${this.apiBase}/api/v2/external/return`;
    const payload = {
      roomCode,
      returnAll,
      playerId: returnAll ? undefined : playerId,
      initiatedBy,
      reason,
      metadata: {
        game: this.gameId,
        timestamp: new Date().toISOString(),
        ...metadata,
      },
    };

    try {
      console.log(
        `[GameBuddies] Requesting return to lobby (mode: ${returnAll ? 'group' : 'individual'})`
      );
      console.log(`[GameBuddies] Payload:`, JSON.stringify(payload, null, 2));

      const response = await axios.post(url, payload, {
        timeout: this.apiTimeout,
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
        },
      });

      console.log('[GameBuddies] ✅ Return request successful');
      console.log('[GameBuddies] 📦 Full response:', JSON.stringify(response.data, null, 2));
      console.log('[GameBuddies] 🔗 Return URL from API:', response.data.returnUrl);

      return {
        success: true,
        returnUrl: response.data.returnUrl,
        sessionToken: response.data.sessionToken,
        playersReturned: response.data.playersReturned,
      };
    } catch (error: any) {
      console.error('[GameBuddies] Return request failed:', error.message);
      if (error.response) {
        console.error('[GameBuddies] Status:', error.response.status);
        console.error('[GameBuddies] Data:', error.response.data);
      }

      // Return fallback URL
      return {
        success: false,
        returnUrl: `${this.apiBase}/lobby/${roomCode}`,
        error: error.message,
      };
    }
  }
}

export default new GameBuddiesService();
