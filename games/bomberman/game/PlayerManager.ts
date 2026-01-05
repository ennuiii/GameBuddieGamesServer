import { GAME_CONFIG, TILE, DIRECTION, GAME_MODE, Direction, CURSE_TYPE } from '../shared/constants.js';
import { BombermanGameState, BombermanPlayerData, ExplosionData } from '../types.js';
import { BombManager } from './BombManager.js';
import { CurseManager } from './CurseManager.js';
import type { Room, Player } from '../../../core/types/core.js';

// Result type for handleMove to communicate what happened
export interface MoveResult {
  moved: boolean;
  walkedIntoExplosion: boolean;
}

export class PlayerManager {
  /**
   * Handle player movement
   * Returns MoveResult indicating if player moved and if they walked into explosion
   */
  static handleMove(
    player: Player,
    direction: Direction,
    room: Room,
    gameState: BombermanGameState
  ): MoveResult {
    const playerData = player.gameData as BombermanPlayerData;

    // Guard against undefined gameData (can happen during reconnection)
    if (!playerData) return { moved: false, walkedIntoExplosion: false };

    if (!playerData.alive) return { moved: false, walkedIntoExplosion: false };

    const now = Date.now();

    // Check if player is stunned
    if (playerData.stunnedUntil > now) return { moved: false, walkedIntoExplosion: false };

    // Check movement cooldown
    if (now - playerData.lastMoveTime < playerData.speed) return { moved: false, walkedIntoExplosion: false };

    // Apply REVERSE curse - invert controls
    let actualDirection = direction;
    if (CurseManager.shouldReverseControls(player)) {
      actualDirection = CurseManager.reverseDirection(direction) as Direction;
    }

    // Update facing direction (for throw) - use actual direction after curse
    playerData.facingDir = actualDirection;

    let newX = playerData.gridX;
    let newY = playerData.gridY;

    switch (actualDirection) {
      case DIRECTION.UP:
        newY -= 1;
        break;
      case DIRECTION.DOWN:
        newY += 1;
        break;
      case DIRECTION.LEFT:
        newX -= 1;
        break;
      case DIRECTION.RIGHT:
        newX += 1;
        break;
      default:
        return { moved: false, walkedIntoExplosion: false };
    }

    // Check for bomb at destination (for kick)
    const bombAtDest = BombManager.findBombAt(gameState, newX, newY);
    if (bombAtDest && playerData.hasKick) {
      // Kick the bomb!
      BombManager.kickBomb(bombAtDest, actualDirection);
      playerData.lastMoveTime = now;
      return { moved: true, walkedIntoExplosion: false };
    }

    // Check if movement is valid (pass playerData for bomb pass ability check)
    if (this.canMoveTo(gameState, newX, newY, playerData)) {
      playerData.gridX = newX;
      playerData.gridY = newY;
      playerData.lastMoveTime = now;

      // Check for power-up pickup (including skull)
      const pickedUpTile = this.checkPowerUpPickup(player, newX, newY, gameState, room);

      // If picked up a skull, apply curse
      if (pickedUpTile === TILE.SKULL) {
        CurseManager.applyCurse(player, room, gameState);
      }

      // DIARRHEA curse: auto-drop bomb on every move
      if (CurseManager.shouldAutoBomb(player)) {
        BombManager.placeBomb(room, player, gameState);
      }

      // Check for curse transfer - if player collides with another player
      room.players.forEach((other) => {
        if (other.id !== player.id) {
          const otherData = other.gameData as BombermanPlayerData;
          if (otherData && otherData.alive && otherData.gridX === newX && otherData.gridY === newY) {
            // Try to transfer curse in both directions
            CurseManager.transferCurse(player, other);
            CurseManager.transferCurse(other, player);
          }
        }
      });

      // Check if player walked into active explosion
      const explosion = this.findExplosionAt(gameState, newX, newY);
      if (explosion) {
        return { moved: true, walkedIntoExplosion: true };
      }

      return { moved: true, walkedIntoExplosion: false };
    }

    return { moved: false, walkedIntoExplosion: false };
  }

  /**
   * Check if a player can move to a position
   * @param playerData - Optional player data for checking abilities like bomb pass
   */
  static canMoveTo(
    gameState: BombermanGameState,
    x: number,
    y: number,
    playerData?: BombermanPlayerData
  ): boolean {
    // Check bounds
    if (x < 0 || x >= GAME_CONFIG.GRID_WIDTH || y < 0 || y >= GAME_CONFIG.GRID_HEIGHT) {
      return false;
    }

    const tile = this.getTile(gameState, x, y);

    // Can't move through walls or soft blocks
    if (tile === TILE.HARD_WALL || tile === TILE.SOFT_BLOCK) {
      return false;
    }

    // Check for bombs - can pass through if player has bomb pass ability
    const bomb = BombManager.findBombAt(gameState, x, y);
    if (bomb) {
      if (!playerData?.hasBombPass) {
        return false;
      }
      // Player has bomb pass - allow movement through bombs
    }

    return true;
  }

  /**
   * Check and handle power-up pickup
   * Returns the tile type that was picked up, or null if nothing
   */
  static checkPowerUpPickup(
    player: Player,
    x: number,
    y: number,
    gameState: BombermanGameState,
    room?: Room
  ): number | null {
    const playerData = player.gameData as BombermanPlayerData;
    const tile = this.getTile(gameState, x, y);

    switch (tile) {
      case TILE.POWERUP_BOMB:
        if (playerData.maxBombs < GAME_CONFIG.MAX_BOMBS) {
          playerData.maxBombs += 1;
        }
        this.setTile(gameState, x, y, TILE.EMPTY);
        return tile;

      case TILE.POWERUP_FIRE:
        if (playerData.fireRange < GAME_CONFIG.MAX_RANGE) {
          playerData.fireRange += 1;
        }
        this.setTile(gameState, x, y, TILE.EMPTY);
        return tile;

      case TILE.POWERUP_SPEED:
        playerData.speed = Math.max(50, playerData.speed - 20);
        this.setTile(gameState, x, y, TILE.EMPTY);
        return tile;

      case TILE.POWERUP_KICK:
        playerData.hasKick = true;
        this.setTile(gameState, x, y, TILE.EMPTY);
        return tile;

      case TILE.POWERUP_THROW:
        playerData.hasThrow = true;
        this.setTile(gameState, x, y, TILE.EMPTY);
        return tile;

      case TILE.POWERUP_PUNCH:
        playerData.hasPunch = true;
        this.setTile(gameState, x, y, TILE.EMPTY);
        return tile;

      case TILE.POWERUP_PIERCE:
        playerData.hasPierce = true;
        this.setTile(gameState, x, y, TILE.EMPTY);
        return tile;

      case TILE.POWERUP_BOMBPASS:
        playerData.hasBombPass = true;
        this.setTile(gameState, x, y, TILE.EMPTY);
        return tile;

      case TILE.SKULL:
        // Skull applies a random curse via CurseManager
        this.setTile(gameState, x, y, TILE.EMPTY);
        // Apply curse immediately if room is available
        // Note: room is passed from handleMove for curse application
        return tile;

      default:
        return null;
    }
  }

  /**
   * Stun a player
   */
  static stunPlayer(player: Player): void {
    const playerData = player.gameData as BombermanPlayerData;
    if (!playerData) return;
    playerData.stunnedUntil = Date.now() + GAME_CONFIG.STUN_DURATION;
  }

  /**
   * Kill a player
   */
  static killPlayer(
    player: Player,
    killerId: string,
    room: Room,
    gameState: BombermanGameState
  ): void {
    const playerData = player.gameData as BombermanPlayerData;
    if (!playerData) return;

    playerData.alive = false;
    playerData.deaths += 1;

    // Award kill to bomb owner
    if (killerId !== player.id) {
      const killer = room.players.get(killerId);
      if (killer) {
        const killerData = killer.gameData as BombermanPlayerData;
        if (killerData) {
          killerData.kills += 1;
        }
      }
    }

    console.log(`[Bomberman] Player ${player.name} was killed!`);
  }

  /**
   * Respawn a player at their spawn point
   */
  static respawnPlayer(player: Player): void {
    const playerData = player.gameData as BombermanPlayerData;
    if (!playerData) return;
    const spawn = GAME_CONFIG.SPAWN_POSITIONS[playerData.spawnIndex];

    playerData.gridX = spawn.x;
    playerData.gridY = spawn.y;
    playerData.alive = true;
    playerData.bombsPlaced = 0;
  }

  /**
   * Check for explosion kills
   */
  static checkExplosionKills(
    bombOwnerId: string,
    room: Room,
    gameState: BombermanGameState,
    onPlayerKilled: (player: Player, killerId: string) => void
  ): void {
    gameState.explosions.forEach((explosion) => {
      room.players.forEach((player) => {
        const playerData = player.gameData as BombermanPlayerData;
        if (!playerData || !playerData.alive) return;

        if (playerData.gridX === explosion.gridX && playerData.gridY === explosion.gridY) {
          onPlayerKilled(player, bombOwnerId);
        }
      });
    });
  }

  /**
   * Check win condition for Last Man Standing
   */
  static checkWinCondition(room: Room, gameState: BombermanGameState): string | null {
    const alivePlayers: string[] = [];

    room.players.forEach((player) => {
      const playerData = player.gameData as BombermanPlayerData;
      if (playerData && playerData.alive) {
        alivePlayers.push(player.id);
      }
    });

    if (gameState.gameMode === GAME_MODE.LAST_MAN_STANDING) {
      if (alivePlayers.length <= 1) {
        return alivePlayers[0] || null;
      }
    }

    return null;
  }

  /**
   * Get deathmatch winner (player with most kills)
   */
  static getDeathmatchWinner(room: Room): string {
    let maxKills = -1;
    let winnerId = '';

    room.players.forEach((player) => {
      const playerData = player.gameData as BombermanPlayerData;
      if (playerData && playerData.kills > maxKills) {
        maxKills = playerData.kills;
        winnerId = player.id;
      }
    });

    return winnerId;
  }

  /**
   * Reset a player for a new game
   */
  static resetPlayer(player: Player): void {
    const playerData = player.gameData as BombermanPlayerData;
    if (!playerData) return;
    const spawn = GAME_CONFIG.SPAWN_POSITIONS[playerData.spawnIndex];

    playerData.gridX = spawn.x;
    playerData.gridY = spawn.y;
    playerData.alive = true;
    playerData.bombsPlaced = 0;
    playerData.maxBombs = GAME_CONFIG.PLAYER_START_BOMBS;
    playerData.fireRange = GAME_CONFIG.PLAYER_START_RANGE;
    playerData.speed = GAME_CONFIG.PLAYER_MOVE_SPEED;
    playerData.kills = 0;
    playerData.deaths = 0;
    playerData.hasKick = false;
    playerData.hasThrow = false;
    playerData.stunnedUntil = 0;
    playerData.facingDir = DIRECTION.DOWN;
    // New power-up flags
    playerData.hasPunch = false;
    playerData.hasPierce = false;
    playerData.hasBombPass = false;
    // Curse state
    playerData.curseType = null;
    playerData.curseEndTime = 0;
    playerData.originalSpeed = GAME_CONFIG.PLAYER_MOVE_SPEED;
  }

  // Helper methods for tile access
  private static getTile(gameState: BombermanGameState, x: number, y: number): number {
    if (x < 0 || x >= GAME_CONFIG.GRID_WIDTH || y < 0 || y >= GAME_CONFIG.GRID_HEIGHT) {
      return TILE.HARD_WALL;
    }
    return gameState.tiles[y * GAME_CONFIG.GRID_WIDTH + x];
  }

  private static setTile(gameState: BombermanGameState, x: number, y: number, value: number): void {
    if (x >= 0 && x < GAME_CONFIG.GRID_WIDTH && y >= 0 && y < GAME_CONFIG.GRID_HEIGHT) {
      gameState.tiles[y * GAME_CONFIG.GRID_WIDTH + x] = value;
    }
  }

  /**
   * Find an active explosion at the given position
   */
  static findExplosionAt(gameState: BombermanGameState, x: number, y: number): ExplosionData | null {
    for (const explosion of gameState.explosions.values()) {
      if (explosion.gridX === x && explosion.gridY === y) {
        return explosion;
      }
    }
    return null;
  }
}
