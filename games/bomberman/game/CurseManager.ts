import { GAME_CONFIG, CURSE_TYPE, DIRECTION, CurseType } from '../shared/constants.js';
import { BombermanGameState, BombermanPlayerData } from '../types.js';
import { BombManager } from './BombManager.js';
import type { Room, Player } from '../../../core/types/core.js';

/**
 * Manages the Skull/Curse system
 * When a player picks up a skull, they receive a random curse for 15 seconds
 * Curses can be passed to other players by touching them
 */
export class CurseManager {
  /**
   * Apply a random curse to a player
   */
  static applyCurse(player: Player, room: Room, gameState: BombermanGameState): void {
    const playerData = player.gameData as BombermanPlayerData;

    // Don't stack curses - if already cursed, do nothing
    if (playerData.curseType !== null) return;

    // Pick a random curse
    const curseTypes = Object.values(CURSE_TYPE).filter(v => typeof v === 'number') as number[];
    const randomCurse = curseTypes[Math.floor(Math.random() * curseTypes.length)] as CurseType;

    // Handle immediate effects (SWAP is instant)
    if (randomCurse === CURSE_TYPE.SWAP) {
      this.swapWithRandomPlayer(player, room);
      return; // SWAP is one-time, no ongoing curse
    }

    // Apply curse
    playerData.curseType = randomCurse;
    playerData.curseEndTime = Date.now() + GAME_CONFIG.CURSE_DURATION;

    // Store original speed for restoration later
    if (randomCurse === CURSE_TYPE.SLOW || randomCurse === CURSE_TYPE.FAST) {
      playerData.originalSpeed = playerData.speed;
    }

    console.log(`[Bomberman] Player ${player.name} cursed with: ${this.getCurseName(randomCurse)}`);
  }

  /**
   * Update curse effects for a player (called each game tick)
   */
  static updateCurse(player: Player, room: Room, gameState: BombermanGameState): void {
    const playerData = player.gameData as BombermanPlayerData;

    // No curse? Nothing to do
    if (playerData.curseType === null) return;

    // Check if curse expired
    if (Date.now() > playerData.curseEndTime) {
      this.removeCurse(player);
      return;
    }

    // Apply continuous curse effects
    switch (playerData.curseType) {
      case CURSE_TYPE.SLOW:
        playerData.speed = 300; // Very slow movement
        break;

      case CURSE_TYPE.FAST:
        playerData.speed = 40; // Uncontrollably fast
        break;

      // Other curses are handled in their respective systems:
      // - DIARRHEA: handled in PlayerManager.handleMove()
      // - NO_BOMBS: handled in BombManager.placeBomb()
      // - SHORT_FUSE: handled in BombManager.placeBomb()
      // - REVERSE: handled in PlayerManager.handleMove()
    }
  }

  /**
   * Remove curse from a player
   */
  static removeCurse(player: Player): void {
    const playerData = player.gameData as BombermanPlayerData;

    // Restore original speed if it was modified
    if (playerData.curseType === CURSE_TYPE.SLOW || playerData.curseType === CURSE_TYPE.FAST) {
      playerData.speed = playerData.originalSpeed;
    }

    playerData.curseType = null;
    playerData.curseEndTime = 0;

    console.log(`[Bomberman] Player ${player.name} curse removed`);
  }

  /**
   * Transfer curse from one player to another (on collision)
   */
  static transferCurse(from: Player, to: Player): boolean {
    const fromData = from.gameData as BombermanPlayerData;
    const toData = to.gameData as BombermanPlayerData;

    // Can only transfer if 'from' has curse and 'to' doesn't
    if (fromData.curseType === null || toData.curseType !== null) {
      return false;
    }

    // Transfer curse
    toData.curseType = fromData.curseType;
    toData.curseEndTime = fromData.curseEndTime;
    toData.originalSpeed = toData.speed;

    // Apply immediate speed effects
    if (toData.curseType === CURSE_TYPE.SLOW) {
      toData.speed = 300;
    } else if (toData.curseType === CURSE_TYPE.FAST) {
      toData.speed = 40;
    }

    // Remove curse from original player
    fromData.curseType = null;
    fromData.curseEndTime = 0;
    if (fromData.curseType === CURSE_TYPE.SLOW || fromData.curseType === CURSE_TYPE.FAST) {
      fromData.speed = fromData.originalSpeed;
    }

    console.log(`[Bomberman] Curse transferred from ${from.name} to ${to.name}`);
    return true;
  }

  /**
   * Swap positions with a random alive player
   */
  private static swapWithRandomPlayer(player: Player, room: Room): void {
    const playerData = player.gameData as BombermanPlayerData;

    // Get all alive players except this one
    const otherPlayers = Array.from(room.players.values()).filter(p => {
      const pd = p.gameData as BombermanPlayerData;
      return p.id !== player.id && pd.alive;
    });

    if (otherPlayers.length === 0) return; // No one to swap with

    // Pick random player
    const target = otherPlayers[Math.floor(Math.random() * otherPlayers.length)];
    const targetData = target.gameData as BombermanPlayerData;

    // Swap positions
    const tempX = playerData.gridX;
    const tempY = playerData.gridY;
    playerData.gridX = targetData.gridX;
    playerData.gridY = targetData.gridY;
    targetData.gridX = tempX;
    targetData.gridY = tempY;

    console.log(`[Bomberman] ${player.name} swapped positions with ${target.name}`);
  }

  /**
   * Check if player should auto-drop bomb (DIARRHEA curse)
   */
  static shouldAutoBomb(player: Player): boolean {
    const playerData = player.gameData as BombermanPlayerData;
    return playerData.curseType === CURSE_TYPE.DIARRHEA;
  }

  /**
   * Check if player's controls should be reversed (REVERSE curse)
   */
  static shouldReverseControls(player: Player): boolean {
    const playerData = player.gameData as BombermanPlayerData;
    return playerData.curseType === CURSE_TYPE.REVERSE;
  }

  /**
   * Reverse a direction (UP<->DOWN, LEFT<->RIGHT)
   */
  static reverseDirection(direction: number): number {
    switch (direction) {
      case DIRECTION.UP: return DIRECTION.DOWN;
      case DIRECTION.DOWN: return DIRECTION.UP;
      case DIRECTION.LEFT: return DIRECTION.RIGHT;
      case DIRECTION.RIGHT: return DIRECTION.LEFT;
      default: return direction;
    }
  }

  /**
   * Check if player can place bombs (blocked by NO_BOMBS curse)
   */
  static canPlaceBomb(player: Player): boolean {
    const playerData = player.gameData as BombermanPlayerData;
    return playerData.curseType !== CURSE_TYPE.NO_BOMBS;
  }

  /**
   * Get bomb timer (shortened by SHORT_FUSE curse)
   */
  static getBombTimer(player: Player): number {
    const playerData = player.gameData as BombermanPlayerData;
    if (playerData.curseType === CURSE_TYPE.SHORT_FUSE) {
      return GAME_CONFIG.SHORT_FUSE_TIME;
    }
    return GAME_CONFIG.BOMB_TIMER;
  }

  /**
   * Get curse name for debugging/display
   */
  static getCurseName(curseType: CurseType): string {
    switch (curseType) {
      case CURSE_TYPE.DIARRHEA: return 'Diarrhea';
      case CURSE_TYPE.SLOW: return 'Slow';
      case CURSE_TYPE.FAST: return 'Fast';
      case CURSE_TYPE.NO_BOMBS: return 'No Bombs';
      case CURSE_TYPE.SHORT_FUSE: return 'Short Fuse';
      case CURSE_TYPE.REVERSE: return 'Reverse';
      case CURSE_TYPE.SWAP: return 'Swap';
      default: return 'Unknown';
    }
  }
}
