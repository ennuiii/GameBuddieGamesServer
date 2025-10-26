import type { Server as SocketIOServer } from 'socket.io';
import type { GamePlugin, GameConfig } from '../types/core.js';

/**
 * Game Registry
 *
 * Central registry for all game plugins in the unified server.
 * Handles:
 * - Loading game plugins
 * - Validating plugin interfaces
 * - Providing game lookups
 * - Managing game lifecycle
 *
 * Games are loaded dynamically from the games/ directory and registered here.
 */
export class GameRegistry {
  private games: Map<string, GamePlugin>;
  private gameNamespaces: Map<string, string>; // namespace -> gameId
  private gameBasePaths: Map<string, string>; // basePath -> gameId

  constructor() {
    this.games = new Map();
    this.gameNamespaces = new Map();
    this.gameBasePaths = new Map();

    console.log('[GameRegistry] Initialized');
  }

  /**
   * Register a game plugin
   */
  async registerGame(plugin: GamePlugin, io: SocketIOServer): Promise<boolean> {
    try {
      // Validate plugin
      this.validatePlugin(plugin);

      // Check for conflicts
      if (this.games.has(plugin.id)) {
        throw new Error(`Game with ID '${plugin.id}' is already registered`);
      }

      if (this.gameNamespaces.has(plugin.namespace)) {
        throw new Error(`Namespace '${plugin.namespace}' is already in use`);
      }

      if (this.gameBasePaths.has(plugin.basePath)) {
        throw new Error(`Base path '${plugin.basePath}' is already in use`);
      }

      // Initialize plugin if it has onInitialize hook
      if (plugin.onInitialize) {
        await plugin.onInitialize(io);
      }

      // Register plugin
      this.games.set(plugin.id, plugin);
      this.gameNamespaces.set(plugin.namespace, plugin.id);
      this.gameBasePaths.set(plugin.basePath, plugin.id);

      console.log(`[GameRegistry] ✅ Registered game: ${plugin.name} (${plugin.id})`);
      console.log(`   Namespace: ${plugin.namespace}`);
      console.log(`   Base Path: ${plugin.basePath}`);
      console.log(`   Version: ${plugin.version}`);
      console.log(`   Requires DB: ${plugin.requiresDatabase ? 'Yes' : 'No'}`);

      return true;
    } catch (error: any) {
      console.error(`[GameRegistry] ❌ Failed to register game '${plugin.id}':`, error.message);
      return false;
    }
  }

  /**
   * Unregister a game plugin
   */
  async unregisterGame(gameId: string): Promise<boolean> {
    const plugin = this.games.get(gameId);

    if (!plugin) {
      console.warn(`[GameRegistry] Game '${gameId}' not found`);
      return false;
    }

    try {
      // Call cleanup hook if exists
      if (plugin.onCleanup) {
        await plugin.onCleanup();
      }

      // Remove from registries
      this.games.delete(gameId);
      this.gameNamespaces.delete(plugin.namespace);
      this.gameBasePaths.delete(plugin.basePath);

      console.log(`[GameRegistry] Unregistered game: ${plugin.name} (${gameId})`);

      return true;
    } catch (error: any) {
      console.error(`[GameRegistry] Error unregistering game '${gameId}':`, error.message);
      return false;
    }
  }

  /**
   * Get game plugin by ID
   */
  getGame(gameId: string): GamePlugin | undefined {
    return this.games.get(gameId);
  }

  /**
   * Get game plugin by namespace
   */
  getGameByNamespace(namespace: string): GamePlugin | undefined {
    const gameId = this.gameNamespaces.get(namespace);
    return gameId ? this.games.get(gameId) : undefined;
  }

  /**
   * Get game plugin by base path
   */
  getGameByBasePath(basePath: string): GamePlugin | undefined {
    const gameId = this.gameBasePaths.get(basePath);
    return gameId ? this.games.get(gameId) : undefined;
  }

  /**
   * Get all registered games
   */
  getAllGames(): GamePlugin[] {
    return Array.from(this.games.values());
  }

  /**
   * Get all game IDs
   */
  getGameIds(): string[] {
    return Array.from(this.games.keys());
  }

  /**
   * Check if game is registered
   */
  hasGame(gameId: string): boolean {
    return this.games.has(gameId);
  }

  /**
   * Validate plugin interface
   */
  private validatePlugin(plugin: GamePlugin): void {
    // Required fields
    if (!plugin.id || typeof plugin.id !== 'string') {
      throw new Error('Plugin must have a valid id (string)');
    }

    if (!plugin.name || typeof plugin.name !== 'string') {
      throw new Error('Plugin must have a valid name (string)');
    }

    if (!plugin.version || typeof plugin.version !== 'string') {
      throw new Error('Plugin must have a valid version (string)');
    }

    if (!plugin.namespace || typeof plugin.namespace !== 'string') {
      throw new Error('Plugin must have a valid namespace (string)');
    }

    if (!plugin.namespace.startsWith('/')) {
      throw new Error('Plugin namespace must start with "/"');
    }

    if (!plugin.basePath || typeof plugin.basePath !== 'string') {
      throw new Error('Plugin must have a valid basePath (string)');
    }

    if (!plugin.basePath.startsWith('/')) {
      throw new Error('Plugin basePath must start with "/"');
    }

    if (!plugin.defaultSettings || typeof plugin.defaultSettings !== 'object') {
      throw new Error('Plugin must have valid defaultSettings');
    }

    if (!plugin.socketHandlers || typeof plugin.socketHandlers !== 'object') {
      throw new Error('Plugin must have socketHandlers object');
    }

    // Validate default settings
    const { minPlayers, maxPlayers } = plugin.defaultSettings;

    if (typeof minPlayers !== 'number' || minPlayers < 1) {
      throw new Error('defaultSettings.minPlayers must be >= 1');
    }

    if (typeof maxPlayers !== 'number' || maxPlayers < minPlayers) {
      throw new Error('defaultSettings.maxPlayers must be >= minPlayers');
    }

    // Validate socket handlers are functions
    for (const [event, handler] of Object.entries(plugin.socketHandlers)) {
      if (typeof handler !== 'function') {
        throw new Error(`Socket handler '${event}' must be a function`);
      }
    }

    console.log(`[GameRegistry] Plugin '${plugin.id}' passed validation`);
  }

  /**
   * Get statistics
   */
  getStats() {
    return {
      totalGames: this.games.size,
      games: Array.from(this.games.values()).map((game) => ({
        id: game.id,
        name: game.name,
        version: game.version,
        namespace: game.namespace,
        basePath: game.basePath,
        requiresDatabase: game.requiresDatabase || false,
        hasApiKey: Boolean(game.apiKey),
        eventHandlers: Object.keys(game.socketHandlers).length,
        customRoutes: game.httpRoutes?.length || 0,
      })),
    };
  }

  /**
   * Cleanup on shutdown
   */
  async destroy(): Promise<void> {
    console.log('[GameRegistry] Cleaning up all games...');

    const cleanupPromises = Array.from(this.games.keys()).map((gameId) =>
      this.unregisterGame(gameId)
    );

    await Promise.allSettled(cleanupPromises);

    this.games.clear();
    this.gameNamespaces.clear();
    this.gameBasePaths.clear();

    console.log('[GameRegistry] Destroyed');
  }
}
