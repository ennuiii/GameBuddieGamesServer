/**
 * Jackpot Crusaders - Type Definitions
 *
 * A multiplayer slot machine RPG where 2-4 players team up against bosses.
 */

// ============================================================================
// GAME PHASES
// ============================================================================

export type GamePhase = 'lobby' | 'shop' | 'battle' | 'victory' | 'defeat';

// ============================================================================
// SYMBOLS & SLOT MACHINE
// ============================================================================

export type SymbolType =
  | 'cherry'    // Heal party
  | 'sword'     // Attack boss
  | 'skull'     // Self damage
  | 'shield'    // Defense buff
  | 'coin'      // Gold bonus
  | 'star'      // Critical multiplier
  | 'wild'      // Matches any
  | 'bomb';     // AOE damage

export interface Symbol {
  type: SymbolType;
  tier: 1 | 2 | 3;  // Higher tier = stronger effect
}

export interface SlotMachine {
  symbols: Symbol[];           // Symbols in the reel (player can customize)
  lastSpinResult: Symbol[];    // 4 symbols from last spin
  isSpinning: boolean;
}

export interface MatchResult {
  symbolType: SymbolType;
  count: number;               // 3 or 4
  tier: number;                // Average tier of matched symbols
}

export interface SpinResult {
  playerId: string;
  symbols: Symbol[];           // The 4 symbols rolled
  matches: MatchResult[];      // Any 3+ matches found
  effects: SpinEffect[];       // Effects to apply
}

export interface SpinEffect {
  type: 'damage' | 'heal' | 'self_damage' | 'gold' | 'buff';
  target: 'boss' | 'party' | 'self';
  value: number;
  bonus?: string;              // 'critical', 'cleanse', etc.
}

// ============================================================================
// BOSS
// ============================================================================

export interface BossData {
  id: string;
  name: string;
  maxHealth: number;
  currentHealth: number;
  attack: number;              // Damage per round to each player
  defense: number;             // Damage reduction (percentage)
  spriteKey: string;           // For client rendering
  abilities: BossAbility[];
  enraged: boolean;            // Below 25% health - increased attack
  bossIndex: number;           // 0, 1, or 2 (which boss in progression)
}

export interface BossAbility {
  id: string;
  name: string;
  chance: number;              // 0-1 probability per round
  effect: 'aoe' | 'curse' | 'shield' | 'steal';
  value: number;               // Damage/effect amount
}

// ============================================================================
// PLAYER DATA
// ============================================================================

export interface JackpotPlayerData {
  // Slot machine
  slotMachine: SlotMachine;

  // Combat stats
  health: number;
  maxHealth: number;

  // Resources
  gold: number;

  // Status effects
  buffs: StatusEffect[];
  debuffs: StatusEffect[];

  // Match stats (for end screen)
  damageDealt: number;
  healingDone: number;
  criticalHits: number;
  selfDamage: number;

  // Ready state (for shop phase)
  isReady: boolean;
}

export interface StatusEffect {
  id: string;
  name: string;
  type: 'buff' | 'debuff';
  stacks: number;
  duration: number;            // Rounds remaining
  effectType: 'defense' | 'attack' | 'critical' | 'curse';
  value: number;               // Effect magnitude
}

// ============================================================================
// GAME STATE
// ============================================================================

export interface JackpotGameState {
  phase: GamePhase;

  // Boss state
  boss: BossData | null;
  bossesDefeated: number;      // 0, 1, 2 (win at 3)

  // Timing
  currentRound: number;        // Battle round counter
  shopTimeRemaining: number;   // Seconds left in shop phase

  // Shop
  shopItems: ShopItem[];       // Available items this shop phase

  // Battle log (for streamer appeal)
  battleLog: BattleLogEntry[];
}

// ============================================================================
// SHOP SYSTEM
// ============================================================================

export type ShopItemType = 'symbol' | 'remove' | 'upgrade' | 'item';
export type ItemRarity = 'common' | 'uncommon' | 'rare' | 'legendary';

export interface ShopItem {
  id: string;
  name: string;
  description: string;
  cost: number;
  type: ShopItemType;
  rarity: ItemRarity;

  // For symbol type
  symbol?: Symbol;

  // For item type
  itemEffect?: 'weighted_dice' | 'extra_spin' | 'reroll' | 'heal_potion';
  itemValue?: number;
}

// ============================================================================
// BATTLE LOG
// ============================================================================

export type LogEntryType = 'spin' | 'damage' | 'heal' | 'effect' | 'boss_attack' | 'phase' | 'victory' | 'defeat';

export interface BattleLogEntry {
  timestamp: number;
  playerId: string | null;     // null for boss/system actions
  playerName?: string;
  type: LogEntryType;
  message: string;
  value?: number;
  icon?: string;               // For UI display
}

// ============================================================================
// SOCKET EVENT DATA
// ============================================================================

export interface ShopBuyData {
  itemId: string;
  reelIndex?: number;          // For adding symbols to specific position
}

export interface ShopRemoveData {
  symbolIndex: number;         // Index in player's slotMachine.symbols
}

export interface SpinResultEvent {
  playerId: string;
  playerName: string;
  result: Symbol[];
  matches: MatchResult[];
  effects: SpinEffect[];
}

export interface BossAttackEvent {
  damage: number;
  ability?: BossAbility;
  playerDamage: { playerId: string; damage: number; newHealth: number }[];
}

export interface PhaseChangeEvent {
  phase: GamePhase;
  shopItems?: ShopItem[];
  shopDuration?: number;
  boss?: BossData;
}

export interface GameEndEvent {
  victory: boolean;
  stats: PlayerStats[];
  bossesDefeated: number;
}

export interface PlayerStats {
  playerId: string;
  playerName: string;
  damageDealt: number;
  healingDone: number;
  criticalHits: number;
  selfDamage: number;
  goldEarned: number;
}

// ============================================================================
// GAME SETTINGS
// ============================================================================

export interface JackpotGameSettings {
  shopDuration: number;        // Seconds for shop phase (default: 30)
  spinInterval: number;        // MS between auto-spins (default: 5000)
  startingGold: number;        // Gold each player starts with (default: 50)
  startingHealth: number;      // HP each player starts with (default: 100)
  bossCount: number;           // Number of bosses to defeat (default: 3)
}
