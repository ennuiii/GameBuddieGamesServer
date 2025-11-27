import axios from 'axios';

/**
 * Friend Service
 *
 * Fetches friend data from Gamebuddies.io API for friend system features.
 */

interface Friend {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
}

class FriendService {
  private centralServerUrl: string;
  private apiTimeout: number;
  private apiKey: string;

  constructor() {
    this.centralServerUrl = process.env.GAMEBUDDIES_CENTRAL_URL || 'https://gamebuddies.io';
    this.apiTimeout = 5000;
    // Use the general API key for friend lookups
    this.apiKey = process.env.GAMEBUDDIES_API_KEY || process.env.CLUE_API_KEY || '';

    if (!this.apiKey) {
      console.warn('[FriendService] No API key configured - friend features will be limited');
    }
  }

  /**
   * Get friends for a user from Gamebuddies.io API
   */
  async getFriends(userId: string): Promise<Friend[]> {
    if (!this.apiKey) {
      console.warn('[FriendService] No API key, returning empty friends list');
      return [];
    }

    const url = `${this.centralServerUrl}/api/v2/game/users/${userId}/friends`;

    try {
      const response = await axios.get(url, {
        timeout: this.apiTimeout,
        headers: {
          'X-API-Key': this.apiKey,
        },
      });

      if (response.data.success && Array.isArray(response.data.friends)) {
        return response.data.friends;
      }

      return [];
    } catch (error: any) {
      if (error.response?.status === 404) {
        // User not found or no friends - not an error
        return [];
      }
      console.error('[FriendService] Error fetching friends:', error.message);
      return [];
    }
  }
}

// Singleton instance
export const friendService = new FriendService();
