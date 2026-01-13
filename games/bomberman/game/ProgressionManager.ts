/**
 * ProgressionManager - Handles player profiles, XP, levels, and match rewards
 *
 * For now, profiles are stored in-memory and synced to clients who store them in localStorage.
 * Future: Integrate with GameBuddies platform API for cloud persistence.
 */

import type { Room, Player } from '../../../../core/types/core.js';
import type { BombermanPlayerData, BombermanGameState } from '../types.js';
import {
  type BomberClassId,
  type RuneId,
  type PlayerProfile,
  type MatchResult,
  type MatchRewards,
  BOMBER_CLASSES,
  RUNES,
  BOMBER_CLASS,
  PROGRESSION_CONFIG,
  createDefaultPlayerProfile,
  calculateMatchRewards,
  applyMatchRewards,
  getRuneSlotsForLevel,
  isBomberUnlocked,
  isRuneUnlocked,
} from '../shared/progression.js';
import { GAME_CONFIG } from '../shared/constants.js';

// In-memory profile cache (temporary until DB integration)
const profileCache = new Map<string, PlayerProfile>();

export class ProgressionManager {
  /**
   * Get or create a player profile
   */
  static getProfile(playerId: string): PlayerProfile {
    let profile = profileCache.get(playerId);
    if (!profile) {
      profile = createDefaultPlayerProfile(playerId);
      profileCache.set(playerId, profile);
    }
    return profile;
  }

  /**
   * Update a player profile (from client sync)
   */
  static syncProfile(playerId: string, clientProfile: Partial<PlayerProfile>): PlayerProfile {
    const existing = this.getProfile(playerId);

    // Merge client profile with existing (client is source of truth for now)
    // In production, server would validate and merge carefully
    const merged: PlayerProfile = {
      ...existing,
      ...clientProfile,
      odId: playerId, // Ensure ID matches
      // Don't let client override sensitive fields directly
      stats: {
        ...existing.stats,
        ...(clientProfile.stats || {}),
      },
    };

    profileCache.set(playerId, merged);
    return merged;
  }

  /**
   * Validate and apply player loadout before match
   * Returns validated loadout (class + runes)
   */
  static validateLoadout(
    profile: PlayerProfile,
    requestedClass: BomberClassId,
    requestedRunes: RuneId[]
  ): { bomberClass: BomberClassId; runes: RuneId[] } {
    // Validate bomber class
    const classUnlocked = isBomberUnlocked(
      requestedClass,
      profile.level,
      profile.stats.totalWins
    );
    const bomberClass = classUnlocked ? requestedClass : BOMBER_CLASS.CLASSIC;

    // Validate runes
    const maxSlots = getRuneSlotsForLevel(profile.level);
    const validRunes: RuneId[] = [];

    for (let i = 0; i < Math.min(requestedRunes.length, maxSlots); i++) {
      const runeId = requestedRunes[i];
      if (runeId && isRuneUnlocked(runeId, profile.level)) {
        // Check for duplicates
        if (!validRunes.includes(runeId)) {
          validRunes.push(runeId);
        }
      }
    }

    return { bomberClass, runes: validRunes };
  }

  /**
   * Apply class passive effects to player stats at match start
   */
  static applyClassPassive(
    playerData: BombermanPlayerData,
    bomberClass: BomberClassId
  ): void {
    const classDef = BOMBER_CLASSES[bomberClass];
    if (!classDef) return;

    const effect = classDef.passive.effect;

    switch (effect.type) {
      case 'speed_bonus':
        // Reduce speed value (lower = faster)
        const speedReduction = playerData.speed * (effect.value / 100);
        playerData.speed = Math.max(50, playerData.speed - speedReduction);
        playerData.originalSpeed = playerData.speed;
        break;

      case 'extra_life':
        playerData.runeState.extraLivesRemaining = effect.value;
        break;

      case 'fire_range_bonus':
        playerData.fireRange += effect.value;
        break;

      case 'soul_collector':
        // Necromancer - handled during kill events
        break;

      case 'decoy_bombs':
        // Trickster - handled during bomb placement
        break;
    }
  }

  /**
   * Apply rune effects to player stats at match start
   */
  static applyRuneEffects(
    playerData: BombermanPlayerData,
    runes: RuneId[]
  ): void {
    for (const runeId of runes) {
      const rune = RUNES[runeId];
      if (!rune) continue;

      switch (rune.effect.type) {
        case 'starting_power':
          playerData.maxBombs += rune.effect.bombs;
          playerData.fireRange += rune.effect.range;
          break;

        case 'extra_bomb_capacity':
          playerData.maxBombs = Math.min(
            GAME_CONFIG.MAX_BOMBS + rune.effect.value,
            GAME_CONFIG.MAX_BOMBS + 2
          );
          break;

        case 'phase_through_bomb':
          playerData.runeState.ghostWalkUsesLeft = rune.effect.uses;
          break;

        // Other rune effects are handled dynamically during gameplay
        default:
          break;
      }
    }
  }

  /**
   * Check if player should be killed (handles Tank passive and Second Wind rune)
   * Returns true if player actually dies, false if saved
   */
  static handleDeath(
    playerData: BombermanPlayerData,
    room: Room
  ): boolean {
    // Check Tank passive (extra lives)
    if (playerData.runeState.extraLivesRemaining > 0) {
      playerData.runeState.extraLivesRemaining--;
      // Brief invulnerability
      playerData.stunnedUntil = Date.now() + 1000;
      return false; // Saved!
    }

    // Check Second Wind rune
    if (
      playerData.equippedRunes.includes('second_wind' as RuneId) &&
      !playerData.runeState.hasRevivedOnce
    ) {
      playerData.runeState.hasRevivedOnce = true;
      // Revive with 50% power-ups
      playerData.maxBombs = Math.max(1, Math.floor(playerData.maxBombs / 2));
      playerData.fireRange = Math.max(2, Math.floor(playerData.fireRange / 2));
      // Brief invulnerability
      playerData.stunnedUntil = Date.now() + 1500;
      return false; // Saved!
    }

    // Actually dead
    playerData.alive = false;
    playerData.deaths++;
    return true;
  }

  /**
   * Handle player getting a kill (updates charge, souls, momentum)
   */
  static handleKill(
    killerData: BombermanPlayerData,
    victimData: BombermanPlayerData
  ): void {
    killerData.kills++;

    // Charge ultimate
    killerData.ultimateCharge++;

    // Necromancer soul collection
    if (killerData.bomberClass === BOMBER_CLASS.NECROMANCER) {
      killerData.soulsCollected++;
      // Souls give bonus ultimate charge
      killerData.ultimateCharge += 0.5;
    }

    // Momentum rune - speed boost per kill
    if (killerData.equippedRunes.includes('momentum' as RuneId)) {
      killerData.runeState.momentumKills++;
      const speedBonus = Math.min(killerData.runeState.momentumKills * 5, 25);
      const speedReduction = killerData.originalSpeed * (speedBonus / 100);
      killerData.speed = Math.max(50, killerData.originalSpeed - speedReduction);
    }

    // Soul Siphon rune (handled in power-up pickup, but check here too)
    if (killerData.equippedRunes.includes('soul_siphon' as RuneId)) {
      killerData.soulsCollected++;
    }
  }

  /**
   * Check if ultimate is ready
   */
  static isUltimateReady(playerData: BombermanPlayerData): boolean {
    const classDef = BOMBER_CLASSES[playerData.bomberClass];
    if (!classDef) return false;
    return playerData.ultimateCharge >= classDef.ultimate.chargeRequired;
  }

  /**
   * Activate ultimate ability
   * Returns true if activated successfully
   */
  static activateUltimate(
    playerData: BombermanPlayerData,
    gameState: BombermanGameState
  ): boolean {
    if (!this.isUltimateReady(playerData)) return false;
    if (playerData.ultimateActive) return false;

    const classDef = BOMBER_CLASSES[playerData.bomberClass];
    if (!classDef) return false;

    // Consume charge
    playerData.ultimateCharge = 0;

    // Apply ultimate effect
    const duration = classDef.ultimate.duration;
    if (duration > 0) {
      playerData.ultimateActive = true;
      playerData.ultimateEndTime = Date.now() + duration;
    }

    // Instant ultimates are handled by the caller
    return true;
  }

  /**
   * Calculate and apply end-of-match rewards
   */
  static processMatchEnd(
    room: Room,
    gameState: BombermanGameState
  ): Map<string, MatchRewards> {
    const results = new Map<string, MatchRewards>();
    const players = Array.from(room.players.values());

    // Calculate placements
    const placements = this.calculatePlacements(players, gameState);

    for (const player of players) {
      const playerData = player.gameData as BombermanPlayerData;
      if (!playerData) continue;

      const profile = this.getProfile(player.id);
      const placement = placements.get(player.id) || players.length;

      const matchResult: MatchResult = {
        odId: player.id,
        placement,
        kills: playerData.kills,
        deaths: playerData.deaths,
        bomberClass: playerData.bomberClass,
        matchDuration: gameState.timeRemaining,
        gameMode: 'pvp',
      };

      const rewards = calculateMatchRewards(profile, matchResult);
      applyMatchRewards(profile, matchResult, rewards);
      profileCache.set(player.id, profile);

      results.set(player.id, rewards);
    }

    return results;
  }

  /**
   * Calculate player placements based on game state
   */
  private static calculatePlacements(
    players: Player[],
    gameState: BombermanGameState
  ): Map<string, number> {
    const placements = new Map<string, number>();

    // Sort by: alive status, then kills, then deaths (fewer is better)
    const sorted = [...players].sort((a, b) => {
      const aData = a.gameData as BombermanPlayerData;
      const bData = b.gameData as BombermanPlayerData;

      // Alive players rank higher
      if (aData?.alive !== bData?.alive) {
        return aData?.alive ? -1 : 1;
      }

      // More kills is better
      if ((aData?.kills || 0) !== (bData?.kills || 0)) {
        return (bData?.kills || 0) - (aData?.kills || 0);
      }

      // Fewer deaths is better
      return (aData?.deaths || 0) - (bData?.deaths || 0);
    });

    sorted.forEach((player, index) => {
      placements.set(player.id, index + 1);
    });

    return placements;
  }

  /**
   * Get bomb timer modifier for Quick Fuse rune
   */
  static getBombTimerModifier(playerData: BombermanPlayerData): number {
    if (playerData.equippedRunes.includes('quick_fuse' as RuneId)) {
      return 500; // 0.5s faster detonation
    }
    return 0;
  }

  /**
   * Check if player should be immune to curse (Iron Boots / full immunity)
   */
  static shouldBlockCurse(playerData: BombermanPlayerData): boolean {
    // Full curse immunity rune
    if (playerData.equippedRunes.includes('curse_immunity' as RuneId)) {
      return true;
    }

    // Iron Boots - first curse only
    if (
      playerData.equippedRunes.includes('iron_boots' as RuneId) &&
      !playerData.runeState.curseImmunityUsed
    ) {
      playerData.runeState.curseImmunityUsed = true;
      return true;
    }

    return false;
  }

  /**
   * Check if player has brief explosion immunity (Fire Walker)
   */
  static hasExplosionImmunity(playerData: BombermanPlayerData): boolean {
    if (playerData.runeState.explosionImmunityUntil > Date.now()) {
      return true;
    }
    return false;
  }

  /**
   * Apply Fire Walker immunity after placing bomb
   */
  static applyFireWalkerImmunity(playerData: BombermanPlayerData): void {
    if (playerData.equippedRunes.includes('fire_walker' as RuneId)) {
      playerData.runeState.explosionImmunityUntil = Date.now() + 500;
    }
  }

  /**
   * Check if player can phase through bomb (Ghost Walk)
   */
  static canPhaseThroughBomb(playerData: BombermanPlayerData): boolean {
    return playerData.runeState.ghostWalkUsesLeft > 0;
  }

  /**
   * Consume a Ghost Walk use
   */
  static useGhostWalk(playerData: BombermanPlayerData): void {
    if (playerData.runeState.ghostWalkUsesLeft > 0) {
      playerData.runeState.ghostWalkUsesLeft--;
    }
  }

  /**
   * Serialize profile for sending to client
   */
  static serializeProfile(profile: PlayerProfile): PlayerProfile {
    return { ...profile };
  }

  /**
   * Clear profile cache (for testing)
   */
  static clearCache(): void {
    profileCache.clear();
  }
}
