import axios from 'axios';

export interface Friend {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string;
}

/**
 * Friend Service for GameBuddieGamesServer
 * 
 * Handles retrieving friend lists from the central GameBuddies.io server
 * to support real-time presence features.
 */
export class FriendService {
  private centralServerUrl: string;
  private apiKey: string;
  private apiTimeout: number;

  constructor() {
    this.centralServerUrl = process.env.GAMEBUDDIES_CENTRAL_URL || 'https://gamebuddies.io';
    // Use the shared server key for internal friend lookups
    this.apiKey = process.env.GAMEBUDDIES_API_KEY || ''; 
    this.apiTimeout = 5000;

    if (!this.apiKey) {
      console.warn('[FriendService] ⚠️ No GAMEBUDDIES_API_KEY found. Friend features may not work.');
    }
  }

  /**
   * Get a user's friend list from the central server
   */
  async getFriends(userId: string): Promise<Friend[]> {
    if (!this.apiKey) {
      console.warn('[FriendService] ⚠️ Missing API Key - cannot fetch friends');
      return [];
    }

    try {
      const url = `${this.centralServerUrl}/api/v2/game/users/${userId}/friends`;
      // console.log(`[FriendService] Fetching friends from: ${url}`);
      
      const response = await axios.get(url, {
        headers: { 'X-API-Key': this.apiKey },
        timeout: this.apiTimeout
      });

      // console.log(`[FriendService] ✅ Fetched ${response.data.friends?.length} friends for ${userId}`);
      return response.data.friends || [];
    } catch (error: any) {
      console.error(`[FriendService] ❌ Failed to fetch friends for ${userId}:`, error.message);
      if (error.response) {
        console.error(`[FriendService] Response: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
      }
      return [];
    }
  }
}

export const friendService = new FriendService();
