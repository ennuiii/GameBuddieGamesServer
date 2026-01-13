/**
 * BossManager - Handles boss encounters with unique attack patterns
 *
 * Two bosses:
 * - Floor 3: Bomb King - Master of explosions, summons minions
 * - Floor 5: Inferno Lord - Fire-based attacks, arena hazards
 */

import { GAME_CONFIG, TILE } from '../shared/constants.js';
import {
  ENEMY_TYPE,
  ENEMIES,
  type EnemyState,
  type EnemyTypeId,
} from '../shared/dungeon.js';

// Boss attack types
export type BossAttackType =
  | 'bomb_barrage'     // Multiple bombs placed quickly
  | 'cross_explosion'  // Explosion pattern across arena
  | 'summon_minions'   // Spawn helper enemies
  | 'charge_attack'    // Rush toward player
  | 'arena_hazard'     // Create dangerous zones
  | 'mega_bomb'        // Massive explosion
  | 'fire_trail'       // Leave fire behind when moving
  | 'enrage';          // Stat boost, faster attacks

export interface BossAttack {
  type: BossAttackType;
  duration: number;      // ms
  cooldown: number;      // ms after attack ends
  damage: number;        // Hits dealt
  description: string;
}

export interface BossPhase {
  healthThreshold: number;  // Activate when health <= this %
  attacks: BossAttack[];
  speedMultiplier: number;
  aggressionMultiplier: number;
}

export interface BossDefinition {
  id: EnemyTypeId;
  name: string;
  phases: BossPhase[];
  specialMechanic: string;
  entranceDelay: number;  // ms before boss becomes active
  enrageTimer: number;    // ms until boss enrages (0 = no enrage)
}

// Boss definitions
export const BOSS_DEFINITIONS: Record<string, BossDefinition> = {
  [ENEMY_TYPE.BOSS_KING]: {
    id: ENEMY_TYPE.BOSS_KING,
    name: 'Bomb King',
    entranceDelay: 3000,
    enrageTimer: 180000, // 3 minutes
    specialMechanic: 'Summons Wanderer minions when damaged',
    phases: [
      // Phase 1: 100-70% health - Methodical bombing
      {
        healthThreshold: 100,
        speedMultiplier: 1.0,
        aggressionMultiplier: 1.0,
        attacks: [
          {
            type: 'bomb_barrage',
            duration: 3000,
            cooldown: 5000,
            damage: 1,
            description: 'Places 3 bombs in quick succession',
          },
          {
            type: 'cross_explosion',
            duration: 2000,
            cooldown: 8000,
            damage: 1,
            description: 'Creates cross-shaped explosion pattern',
          },
        ],
      },
      // Phase 2: 70-40% health - Adds minions
      {
        healthThreshold: 70,
        speedMultiplier: 1.2,
        aggressionMultiplier: 1.3,
        attacks: [
          {
            type: 'bomb_barrage',
            duration: 2500,
            cooldown: 4000,
            damage: 1,
            description: 'Places 4 bombs rapidly',
          },
          {
            type: 'summon_minions',
            duration: 1000,
            cooldown: 15000,
            damage: 0,
            description: 'Summons 2 Wanderer minions',
          },
          {
            type: 'mega_bomb',
            duration: 3000,
            cooldown: 12000,
            damage: 2,
            description: 'Places a large bomb with extended range',
          },
        ],
      },
      // Phase 3: Below 40% health - Enraged
      {
        healthThreshold: 40,
        speedMultiplier: 1.5,
        aggressionMultiplier: 1.8,
        attacks: [
          {
            type: 'bomb_barrage',
            duration: 2000,
            cooldown: 3000,
            damage: 1,
            description: 'Places 5 bombs very rapidly',
          },
          {
            type: 'summon_minions',
            duration: 1000,
            cooldown: 10000,
            damage: 0,
            description: 'Summons 3 Chaser minions',
          },
          {
            type: 'charge_attack',
            duration: 1500,
            cooldown: 6000,
            damage: 1,
            description: 'Charges at nearest player',
          },
        ],
      },
    ],
  },
  [ENEMY_TYPE.BOSS_INFERNO]: {
    id: ENEMY_TYPE.BOSS_INFERNO,
    name: 'Inferno Lord',
    entranceDelay: 4000,
    enrageTimer: 240000, // 4 minutes
    specialMechanic: 'Leaves fire trails when moving, arena heats up over time',
    phases: [
      // Phase 1: 100-60% health - Fire control
      {
        healthThreshold: 100,
        speedMultiplier: 1.0,
        aggressionMultiplier: 1.0,
        attacks: [
          {
            type: 'fire_trail',
            duration: 4000,
            cooldown: 6000,
            damage: 1,
            description: 'Moves while leaving fire behind',
          },
          {
            type: 'cross_explosion',
            duration: 2500,
            cooldown: 7000,
            damage: 1,
            description: 'Fire cross pattern',
          },
        ],
      },
      // Phase 2: 60-30% health - Arena hazards
      {
        healthThreshold: 60,
        speedMultiplier: 1.3,
        aggressionMultiplier: 1.5,
        attacks: [
          {
            type: 'fire_trail',
            duration: 3000,
            cooldown: 4000,
            damage: 1,
            description: 'Faster fire trail',
          },
          {
            type: 'arena_hazard',
            duration: 5000,
            cooldown: 15000,
            damage: 1,
            description: 'Sets sections of arena on fire',
          },
          {
            type: 'mega_bomb',
            duration: 2500,
            cooldown: 10000,
            damage: 2,
            description: 'Massive fire explosion',
          },
        ],
      },
      // Phase 3: Below 30% health - Full inferno
      {
        healthThreshold: 30,
        speedMultiplier: 1.6,
        aggressionMultiplier: 2.0,
        attacks: [
          {
            type: 'fire_trail',
            duration: 2000,
            cooldown: 2000,
            damage: 1,
            description: 'Constant fire trail',
          },
          {
            type: 'arena_hazard',
            duration: 4000,
            cooldown: 10000,
            damage: 1,
            description: 'Larger arena sections on fire',
          },
          {
            type: 'enrage',
            duration: 1000,
            cooldown: 30000,
            damage: 0,
            description: 'Temporary speed and damage boost',
          },
          {
            type: 'charge_attack',
            duration: 1000,
            cooldown: 5000,
            damage: 2,
            description: 'Flaming charge attack',
          },
        ],
      },
    ],
  },
};

// Boss runtime state
export interface BossState extends EnemyState {
  definition: BossDefinition;
  currentPhase: number;
  phaseStartTime: number;
  currentAttack: BossAttack | null;
  attackStartTime: number;
  attackCooldownEnd: number;
  isEntrancing: boolean;
  entranceEndTime: number;
  isEnraged: boolean;
  enrageEndTime: number;
  summonedMinions: string[];
  fireTrailPositions: { x: number; y: number; expiresAt: number }[];
  arenaHazards: { x: number; y: number; expiresAt: number }[];
}

export class BossManager {
  /**
   * Create a boss state from enemy spawn data
   */
  static createBossState(
    id: string,
    type: EnemyTypeId,
    gridX: number,
    gridY: number
  ): BossState | null {
    const definition = BOSS_DEFINITIONS[type];
    if (!definition) return null;

    const enemyDef = ENEMIES[type];
    const now = Date.now();

    return {
      id,
      type,
      gridX,
      gridY,
      health: enemyDef.health,
      maxHealth: enemyDef.health,
      alive: true,
      facingDir: 0,
      bombsPlaced: 0,
      maxBombs: enemyDef.bombCount,
      fireRange: enemyDef.fireRange,
      speed: enemyDef.speed,
      targetPlayerId: null,
      lastMoveTime: now,
      lastBombTime: now,
      aiState: 'idle',
      patrolPath: [],
      patrolIndex: 0,
      bossPhase: 0,
      bossAttackCooldown: now,
      // Boss-specific
      definition,
      currentPhase: 0,
      phaseStartTime: now,
      currentAttack: null,
      attackStartTime: 0,
      attackCooldownEnd: 0,
      isEntrancing: true,
      entranceEndTime: now + definition.entranceDelay,
      isEnraged: false,
      enrageEndTime: 0,
      summonedMinions: [],
      fireTrailPositions: [],
      arenaHazards: [],
    };
  }

  /**
   * Update boss state - returns actions to perform
   */
  static updateBoss(
    boss: BossState,
    players: { id: string; gridX: number; gridY: number; alive: boolean }[],
    tiles: number[],
    deltaTime: number
  ): BossAction[] {
    const now = Date.now();
    const actions: BossAction[] = [];

    // Still entrancing
    if (boss.isEntrancing) {
      if (now >= boss.entranceEndTime) {
        boss.isEntrancing = false;
        boss.aiState = 'attack';
        actions.push({ type: 'entrance_complete', bossId: boss.id });
      }
      return actions;
    }

    // Check for phase transition
    const healthPercent = (boss.health / boss.maxHealth) * 100;
    const newPhase = this.calculatePhase(boss, healthPercent);
    if (newPhase !== boss.currentPhase) {
      boss.currentPhase = newPhase;
      boss.phaseStartTime = now;
      const phase = boss.definition.phases[newPhase];
      boss.speed = ENEMIES[boss.type].speed * phase.speedMultiplier;
      actions.push({
        type: 'phase_change',
        bossId: boss.id,
        phase: newPhase,
      });
    }

    // Clean up expired fire trails and hazards
    boss.fireTrailPositions = boss.fireTrailPositions.filter(
      (f) => f.expiresAt > now
    );
    boss.arenaHazards = boss.arenaHazards.filter((h) => h.expiresAt > now);

    // Check enrage timer
    if (boss.definition.enrageTimer > 0 && !boss.isEnraged) {
      const runTime = now - boss.phaseStartTime;
      if (runTime >= boss.definition.enrageTimer) {
        boss.isEnraged = true;
        boss.speed *= 1.5;
        actions.push({ type: 'permanent_enrage', bossId: boss.id });
      }
    }

    // Handle current attack
    if (boss.currentAttack) {
      const attackElapsed = now - boss.attackStartTime;
      if (attackElapsed >= boss.currentAttack.duration) {
        // Attack finished
        boss.attackCooldownEnd = now + boss.currentAttack.cooldown;
        boss.currentAttack = null;
        boss.aiState = 'chase';
      } else {
        // Execute attack
        const attackActions = this.executeAttack(boss, players, tiles, now);
        actions.push(...attackActions);
        return actions;
      }
    }

    // Find target
    const alivePlayers = players.filter((p) => p.alive);
    if (alivePlayers.length === 0) return actions;

    const target = this.findNearestPlayer(boss, alivePlayers);
    if (target) {
      boss.targetPlayerId = target.id;
    }

    // Check if can start new attack
    if (now >= boss.attackCooldownEnd && target) {
      const phase = boss.definition.phases[boss.currentPhase];
      const attack = this.selectAttack(boss, phase, target);
      if (attack) {
        boss.currentAttack = attack;
        boss.attackStartTime = now;
        boss.aiState = 'attack';
        actions.push({
          type: 'attack_start',
          bossId: boss.id,
          attack: attack.type,
        });
        return actions;
      }
    }

    // Movement toward target
    if (target && boss.aiState === 'chase') {
      const moveAction = this.moveBossToward(boss, target, tiles, now);
      if (moveAction) {
        actions.push(moveAction);

        // Fire trail mechanic for Inferno Lord
        if (boss.type === ENEMY_TYPE.BOSS_INFERNO && boss.currentPhase >= 1) {
          boss.fireTrailPositions.push({
            x: boss.gridX,
            y: boss.gridY,
            expiresAt: now + 5000,
          });
          actions.push({
            type: 'fire_trail',
            bossId: boss.id,
            x: boss.gridX,
            y: boss.gridY,
          });
        }
      }
    }

    return actions;
  }

  /**
   * Calculate current phase based on health
   */
  private static calculatePhase(boss: BossState, healthPercent: number): number {
    const phases = boss.definition.phases;
    for (let i = phases.length - 1; i >= 0; i--) {
      if (healthPercent <= phases[i].healthThreshold) {
        return i;
      }
    }
    return 0;
  }

  /**
   * Select an attack from the current phase
   */
  private static selectAttack(
    boss: BossState,
    phase: BossPhase,
    target: { gridX: number; gridY: number }
  ): BossAttack | null {
    const availableAttacks = phase.attacks;
    if (availableAttacks.length === 0) return null;

    // Weight attacks based on situation
    const distance =
      Math.abs(boss.gridX - target.gridX) + Math.abs(boss.gridY - target.gridY);

    // Prefer charge attack when far
    if (distance > 6) {
      const chargeAttack = availableAttacks.find(
        (a) => a.type === 'charge_attack'
      );
      if (chargeAttack && Math.random() < 0.5) return chargeAttack;
    }

    // Prefer summon if no minions
    if (boss.summonedMinions.length === 0) {
      const summonAttack = availableAttacks.find(
        (a) => a.type === 'summon_minions'
      );
      if (summonAttack && Math.random() < 0.3) return summonAttack;
    }

    // Random attack
    return availableAttacks[Math.floor(Math.random() * availableAttacks.length)];
  }

  /**
   * Execute the current attack
   */
  private static executeAttack(
    boss: BossState,
    players: { id: string; gridX: number; gridY: number; alive: boolean }[],
    tiles: number[],
    now: number
  ): BossAction[] {
    if (!boss.currentAttack) return [];

    const actions: BossAction[] = [];
    const attackProgress =
      (now - boss.attackStartTime) / boss.currentAttack.duration;

    switch (boss.currentAttack.type) {
      case 'bomb_barrage':
        actions.push(...this.executeBombBarrage(boss, attackProgress));
        break;

      case 'cross_explosion':
        actions.push(...this.executeCrossExplosion(boss, attackProgress));
        break;

      case 'summon_minions':
        if (attackProgress >= 0.5 && boss.summonedMinions.length === 0) {
          actions.push(...this.executeSummonMinions(boss));
        }
        break;

      case 'charge_attack':
        actions.push(...this.executeChargeAttack(boss, players, attackProgress));
        break;

      case 'arena_hazard':
        actions.push(...this.executeArenaHazard(boss, tiles, attackProgress, now));
        break;

      case 'mega_bomb':
        if (attackProgress >= 0.3 && attackProgress < 0.35) {
          actions.push({
            type: 'place_bomb',
            bossId: boss.id,
            x: boss.gridX,
            y: boss.gridY,
            range: boss.fireRange + 3,
            isMega: true,
          });
        }
        break;

      case 'fire_trail':
        // Handled in movement
        break;

      case 'enrage':
        if (attackProgress >= 0.5 && !boss.isEnraged) {
          boss.isEnraged = true;
          boss.enrageEndTime = now + 10000;
          boss.speed *= 1.5;
          actions.push({ type: 'temporary_enrage', bossId: boss.id });
        }
        break;
    }

    return actions;
  }

  /**
   * Bomb Barrage - Place multiple bombs quickly
   */
  private static executeBombBarrage(
    boss: BossState,
    progress: number
  ): BossAction[] {
    const bombCount = boss.currentPhase >= 2 ? 5 : boss.currentPhase >= 1 ? 4 : 3;
    const bombInterval = 1.0 / bombCount;
    const currentBomb = Math.floor(progress / bombInterval);

    if (currentBomb > boss.bombsPlaced && boss.bombsPlaced < bombCount) {
      boss.bombsPlaced++;

      // Offset bombs in different directions
      const offsets = [
        { dx: 0, dy: 0 },
        { dx: 1, dy: 0 },
        { dx: -1, dy: 0 },
        { dx: 0, dy: 1 },
        { dx: 0, dy: -1 },
      ];
      const offset = offsets[boss.bombsPlaced % offsets.length];

      return [
        {
          type: 'place_bomb',
          bossId: boss.id,
          x: boss.gridX + offset.dx,
          y: boss.gridY + offset.dy,
          range: boss.fireRange,
          isMega: false,
        },
      ];
    }

    // Reset bomb counter at end
    if (progress >= 0.95) {
      boss.bombsPlaced = 0;
    }

    return [];
  }

  /**
   * Cross Explosion - Create explosion pattern
   */
  private static executeCrossExplosion(
    boss: BossState,
    progress: number
  ): BossAction[] {
    // Place bombs at 25%, 50%, 75% progress
    const checkpoints = [0.25, 0.5, 0.75];
    const tolerance = 0.05;

    for (let i = 0; i < checkpoints.length; i++) {
      const checkpoint = checkpoints[i];
      if (
        progress >= checkpoint - tolerance &&
        progress < checkpoint + tolerance
      ) {
        // Already placed this checkpoint's bomb
        if (boss.bombsPlaced > i) continue;
        boss.bombsPlaced = i + 1;

        // Cross pattern positions
        const patterns = [
          [{ dx: 0, dy: 0 }],
          [
            { dx: -3, dy: 0 },
            { dx: 3, dy: 0 },
          ],
          [
            { dx: 0, dy: -3 },
            { dx: 0, dy: 3 },
          ],
        ];

        const actions: BossAction[] = [];
        for (const pos of patterns[i]) {
          actions.push({
            type: 'place_bomb',
            bossId: boss.id,
            x: boss.gridX + pos.dx,
            y: boss.gridY + pos.dy,
            range: boss.fireRange,
            isMega: false,
          });
        }
        return actions;
      }
    }

    if (progress >= 0.95) {
      boss.bombsPlaced = 0;
    }

    return [];
  }

  /**
   * Summon Minions
   */
  private static executeSummonMinions(boss: BossState): BossAction[] {
    const minionCount = boss.currentPhase >= 2 ? 3 : 2;
    const minionType =
      boss.currentPhase >= 2 ? ENEMY_TYPE.CHASER : ENEMY_TYPE.WANDERER;

    const spawnPositions = this.getSpawnPositionsAround(boss, minionCount);
    const actions: BossAction[] = [];

    for (let i = 0; i < spawnPositions.length; i++) {
      const pos = spawnPositions[i];
      const minionId = `minion_${boss.id}_${Date.now()}_${i}`;
      boss.summonedMinions.push(minionId);

      actions.push({
        type: 'spawn_minion',
        bossId: boss.id,
        minionId,
        minionType,
        x: pos.x,
        y: pos.y,
      });
    }

    return actions;
  }

  /**
   * Charge Attack - Rush toward player
   */
  private static executeChargeAttack(
    boss: BossState,
    players: { id: string; gridX: number; gridY: number; alive: boolean }[],
    progress: number
  ): BossAction[] {
    const target = players.find((p) => p.id === boss.targetPlayerId && p.alive);
    if (!target) return [];

    // Wind up (0-30%), charge (30-80%), recovery (80-100%)
    if (progress < 0.3) {
      return [{ type: 'charge_windup', bossId: boss.id }];
    } else if (progress < 0.8) {
      // Move rapidly toward target
      const dx = Math.sign(target.gridX - boss.gridX);
      const dy = Math.sign(target.gridY - boss.gridY);

      if (dx !== 0 || dy !== 0) {
        boss.gridX += dx;
        boss.gridY += dy;

        return [
          {
            type: 'boss_move',
            bossId: boss.id,
            x: boss.gridX,
            y: boss.gridY,
            isCharging: true,
          },
        ];
      }
    }

    return [];
  }

  /**
   * Arena Hazard - Create dangerous zones
   */
  private static executeArenaHazard(
    boss: BossState,
    tiles: number[],
    progress: number,
    now: number
  ): BossAction[] {
    if (progress < 0.2 || progress > 0.25) return [];

    const { GRID_WIDTH, GRID_HEIGHT } = GAME_CONFIG;
    const hazardCount = boss.currentPhase >= 2 ? 6 : 4;
    const hazardDuration = 8000;

    const actions: BossAction[] = [];
    const usedPositions = new Set<string>();

    for (let i = 0; i < hazardCount; i++) {
      // Random position avoiding walls
      let attempts = 0;
      while (attempts < 20) {
        const x = 3 + Math.floor(Math.random() * (GRID_WIDTH - 6));
        const y = 3 + Math.floor(Math.random() * (GRID_HEIGHT - 6));
        const key = `${x},${y}`;

        if (!usedPositions.has(key) && tiles[y * GRID_WIDTH + x] !== TILE.HARD_WALL) {
          usedPositions.add(key);
          boss.arenaHazards.push({
            x,
            y,
            expiresAt: now + hazardDuration,
          });
          actions.push({
            type: 'arena_hazard',
            bossId: boss.id,
            x,
            y,
            duration: hazardDuration,
          });
          break;
        }
        attempts++;
      }
    }

    return actions;
  }

  /**
   * Move boss toward target
   */
  private static moveBossToward(
    boss: BossState,
    target: { gridX: number; gridY: number },
    tiles: number[],
    now: number
  ): BossAction | null {
    const moveDelay = 150 / boss.speed;
    if (now - boss.lastMoveTime < moveDelay) return null;

    const dx = Math.sign(target.gridX - boss.gridX);
    const dy = Math.sign(target.gridY - boss.gridY);

    // Prefer horizontal or vertical based on distance
    const horizontalFirst = Math.abs(target.gridX - boss.gridX) >
      Math.abs(target.gridY - boss.gridY);

    const moves = horizontalFirst
      ? [
          { dx, dy: 0 },
          { dx: 0, dy },
          { dx: 0, dy: dy !== 0 ? dy : 1 },
          { dx: dx !== 0 ? dx : 1, dy: 0 },
        ]
      : [
          { dx: 0, dy },
          { dx, dy: 0 },
          { dx: dx !== 0 ? dx : 1, dy: 0 },
          { dx: 0, dy: dy !== 0 ? dy : 1 },
        ];

    const { GRID_WIDTH } = GAME_CONFIG;

    for (const move of moves) {
      if (move.dx === 0 && move.dy === 0) continue;

      const newX = boss.gridX + move.dx;
      const newY = boss.gridY + move.dy;
      const tileIdx = newY * GRID_WIDTH + newX;

      if (tiles[tileIdx] !== TILE.HARD_WALL && tiles[tileIdx] !== TILE.SOFT_BLOCK) {
        boss.gridX = newX;
        boss.gridY = newY;
        boss.lastMoveTime = now;
        boss.facingDir = move.dx !== 0 ? (move.dx > 0 ? 1 : 3) : move.dy > 0 ? 2 : 0;

        return {
          type: 'boss_move',
          bossId: boss.id,
          x: newX,
          y: newY,
          isCharging: false,
        };
      }
    }

    return null;
  }

  /**
   * Find nearest player to boss
   */
  private static findNearestPlayer(
    boss: BossState,
    players: { id: string; gridX: number; gridY: number }[]
  ): { id: string; gridX: number; gridY: number } | null {
    let nearest = null;
    let nearestDist = Infinity;

    for (const player of players) {
      const dist =
        Math.abs(player.gridX - boss.gridX) +
        Math.abs(player.gridY - boss.gridY);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = player;
      }
    }

    return nearest;
  }

  /**
   * Get spawn positions around boss for minions
   */
  private static getSpawnPositionsAround(
    boss: BossState,
    count: number
  ): { x: number; y: number }[] {
    const positions: { x: number; y: number }[] = [];
    const offsets = [
      { x: -2, y: 0 },
      { x: 2, y: 0 },
      { x: 0, y: -2 },
      { x: 0, y: 2 },
      { x: -2, y: -2 },
      { x: 2, y: 2 },
    ];

    for (let i = 0; i < Math.min(count, offsets.length); i++) {
      positions.push({
        x: boss.gridX + offsets[i].x,
        y: boss.gridY + offsets[i].y,
      });
    }

    return positions;
  }

  /**
   * Handle boss taking damage
   */
  static handleDamage(boss: BossState, damage: number): BossAction[] {
    boss.health = Math.max(0, boss.health - damage);

    const actions: BossAction[] = [
      {
        type: 'boss_damaged',
        bossId: boss.id,
        health: boss.health,
        maxHealth: boss.maxHealth,
      },
    ];

    if (boss.health <= 0) {
      boss.alive = false;
      actions.push({
        type: 'boss_defeated',
        bossId: boss.id,
      });
    }

    return actions;
  }

  /**
   * Remove a minion from tracking
   */
  static removeMinion(boss: BossState, minionId: string): void {
    const idx = boss.summonedMinions.indexOf(minionId);
    if (idx !== -1) {
      boss.summonedMinions.splice(idx, 1);
    }
  }
}

// Boss action types for game integration
export type BossAction =
  | { type: 'entrance_complete'; bossId: string }
  | { type: 'phase_change'; bossId: string; phase: number }
  | { type: 'attack_start'; bossId: string; attack: BossAttackType }
  | {
      type: 'place_bomb';
      bossId: string;
      x: number;
      y: number;
      range: number;
      isMega: boolean;
    }
  | {
      type: 'spawn_minion';
      bossId: string;
      minionId: string;
      minionType: EnemyTypeId;
      x: number;
      y: number;
    }
  | { type: 'boss_move'; bossId: string; x: number; y: number; isCharging: boolean }
  | { type: 'charge_windup'; bossId: string }
  | {
      type: 'arena_hazard';
      bossId: string;
      x: number;
      y: number;
      duration: number;
    }
  | { type: 'fire_trail'; bossId: string; x: number; y: number }
  | { type: 'temporary_enrage'; bossId: string }
  | { type: 'permanent_enrage'; bossId: string }
  | {
      type: 'boss_damaged';
      bossId: string;
      health: number;
      maxHealth: number;
    }
  | { type: 'boss_defeated'; bossId: string };
