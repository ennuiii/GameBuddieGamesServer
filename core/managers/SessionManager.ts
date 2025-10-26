import { randomUUID } from 'crypto';
import type { PlayerSession } from '../types/core.js';

/**
 * Session Manager
 *
 * Handles player session tokens and reconnection logic.
 * Allows players to reconnect to their game if they disconnect temporarily.
 *
 * Features:
 * - Generate session tokens on join
 * - Validate session tokens on reconnect
 * - Automatic session expiry
 * - Session cleanup
 */
export class SessionManager {
  private sessions: Map<string, PlayerSession>; // sessionToken -> session
  private playerSessions: Map<string, string>; // playerId -> sessionToken
  private cleanupInterval: NodeJS.Timeout;

  // Session expiry: 30 minutes of inactivity
  private readonly SESSION_EXPIRY_MS = 30 * 60 * 1000;

  constructor() {
    this.sessions = new Map();
    this.playerSessions = new Map();

    // Cleanup expired sessions every 5 minutes
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredSessions();
    }, 5 * 60 * 1000);

    console.log('[SessionManager] Initialized');
  }

  /**
   * Create a new session for a player
   */
  createSession(playerId: string, roomCode: string): string {
    // If player already has a session, reuse token
    const existingToken = this.playerSessions.get(playerId);
    if (existingToken) {
      const existingSession = this.sessions.get(existingToken);
      if (existingSession && existingSession.roomCode === roomCode) {
        // Update last activity
        existingSession.lastActivity = Date.now();
        console.log(`[SessionManager] Reusing session for player ${playerId}`);
        return existingToken;
      }
    }

    // Generate new session token
    const sessionToken = randomUUID();

    const session: PlayerSession = {
      playerId,
      roomCode,
      sessionToken,
      createdAt: Date.now(),
      lastActivity: Date.now(),
    };

    this.sessions.set(sessionToken, session);
    this.playerSessions.set(playerId, sessionToken);

    console.log(`[SessionManager] Created session for player ${playerId} in room ${roomCode}`);

    return sessionToken;
  }

  /**
   * Validate and retrieve session
   */
  validateSession(sessionToken: string): PlayerSession | null {
    const session = this.sessions.get(sessionToken);

    if (!session) {
      console.warn(`[SessionManager] Session not found: ${sessionToken}`);
      return null;
    }

    // Check if session expired
    const age = Date.now() - session.lastActivity;
    if (age > this.SESSION_EXPIRY_MS) {
      console.warn(`[SessionManager] Session expired: ${sessionToken} (age: ${Math.floor(age / 1000)}s)`);
      this.deleteSession(sessionToken);
      return null;
    }

    // Update last activity
    session.lastActivity = Date.now();

    console.log(`[SessionManager] Validated session for player ${session.playerId}`);

    return session;
  }

  /**
   * Refresh session activity timestamp
   */
  refreshSession(sessionToken: string): boolean {
    const session = this.sessions.get(sessionToken);

    if (!session) {
      return false;
    }

    session.lastActivity = Date.now();
    return true;
  }

  /**
   * Get session by player ID
   */
  getSessionByPlayerId(playerId: string): PlayerSession | null {
    const sessionToken = this.playerSessions.get(playerId);
    if (!sessionToken) {
      return null;
    }

    return this.validateSession(sessionToken);
  }

  /**
   * Delete session
   */
  deleteSession(sessionToken: string): boolean {
    const session = this.sessions.get(sessionToken);

    if (!session) {
      return false;
    }

    this.sessions.delete(sessionToken);
    this.playerSessions.delete(session.playerId);

    console.log(`[SessionManager] Deleted session for player ${session.playerId}`);

    return true;
  }

  /**
   * Delete all sessions for a room (when room is destroyed)
   */
  deleteSessionsForRoom(roomCode: string): number {
    let deleted = 0;

    for (const [token, session] of this.sessions.entries()) {
      if (session.roomCode === roomCode) {
        this.deleteSession(token);
        deleted++;
      }
    }

    if (deleted > 0) {
      console.log(`[SessionManager] Deleted ${deleted} session(s) for room ${roomCode}`);
    }

    return deleted;
  }

  /**
   * Cleanup expired sessions
   */
  private cleanupExpiredSessions(): void {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [token, session] of this.sessions.entries()) {
      const age = now - session.lastActivity;
      if (age > this.SESSION_EXPIRY_MS) {
        this.deleteSession(token);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      console.log(`[SessionManager] Cleaned up ${cleanedCount} expired session(s)`);
    }
  }

  /**
   * Get statistics
   */
  getStats() {
    const now = Date.now();
    const sessionsByRoom = new Map<string, number>();

    for (const session of this.sessions.values()) {
      sessionsByRoom.set(session.roomCode, (sessionsByRoom.get(session.roomCode) || 0) + 1);
    }

    return {
      totalSessions: this.sessions.size,
      sessionsByRoom: Object.fromEntries(sessionsByRoom),
      sessions: Array.from(this.sessions.values()).map((session) => ({
        playerId: session.playerId,
        roomCode: session.roomCode,
        ageSeconds: Math.floor((now - session.createdAt) / 1000),
        lastActivitySeconds: Math.floor((now - session.lastActivity) / 1000),
      })),
    };
  }

  /**
   * Cleanup on shutdown
   */
  destroy(): void {
    clearInterval(this.cleanupInterval);
    this.sessions.clear();
    this.playerSessions.clear();
    console.log('[SessionManager] Destroyed');
  }
}
