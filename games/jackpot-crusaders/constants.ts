/**
 * Jackpot Crusaders - Game Constants
 *
 * All game balance values, symbol effects, bosses, and shop items.
 */

import type {
  SymbolType,
  Symbol,
  BossData,
  BossAbility,
  ShopItem,
  SpinEffect,
  JackpotGameSettings
} from './types.js';

// ============================================================================
// DEFAULT SETTINGS
// ============================================================================

export const DEFAULT_SETTINGS: JackpotGameSettings = {
  shopDuration: 30,           // 30 seconds for shop phase
  spinInterval: 5000,         // 5 seconds between auto-spins
  startingGold: 50,           // Starting gold per player
  startingHealth: 100,        // Starting HP per player
  bossCount: 3                // 3 bosses to defeat
};

// ============================================================================
// SYMBOL EFFECTS
// ============================================================================

/**
 * Effects for each symbol type when matched 3x or 4x
 * Base values are for tier 1; multiply by tier for higher tiers
 */
export const SYMBOL_EFFECTS: Record<SymbolType, {
  match3: SpinEffect;
  match4: SpinEffect;
  description: string;
}> = {
  cherry: {
    match3: { type: 'heal', target: 'party', value: 15 },
    match4: { type: 'heal', target: 'party', value: 30, bonus: 'cleanse' },
    description: 'Heals the party'
  },
  sword: {
    match3: { type: 'damage', target: 'boss', value: 25 },
    match4: { type: 'damage', target: 'boss', value: 50, bonus: 'critical' },
    description: 'Attacks the boss'
  },
  skull: {
    match3: { type: 'self_damage', target: 'self', value: 15 },
    match4: { type: 'self_damage', target: 'self', value: 30, bonus: 'curse' },
    description: 'Damages yourself!'
  },
  shield: {
    match3: { type: 'buff', target: 'self', value: 1 },
    match4: { type: 'buff', target: 'party', value: 2 },
    description: 'Grants defense buff'
  },
  coin: {
    match3: { type: 'gold', target: 'self', value: 10 },
    match4: { type: 'gold', target: 'self', value: 25 },
    description: 'Earn gold'
  },
  star: {
    match3: { type: 'buff', target: 'self', value: 1 },
    match4: { type: 'buff', target: 'self', value: 3 },
    description: 'Grants critical buff'
  },
  wild: {
    match3: { type: 'damage', target: 'boss', value: 0 },  // Wilds just help match
    match4: { type: 'damage', target: 'boss', value: 0 },
    description: 'Matches any symbol'
  },
  bomb: {
    match3: { type: 'damage', target: 'boss', value: 35 },
    match4: { type: 'damage', target: 'boss', value: 70 },
    description: 'Explosive damage!'
  }
};

// ============================================================================
// STARTING SYMBOLS
// ============================================================================

/**
 * Each player starts with these symbols in their slot machine
 */
export const STARTING_SYMBOLS: Symbol[] = [
  { type: 'cherry', tier: 1 },
  { type: 'cherry', tier: 1 },
  { type: 'sword', tier: 1 },
  { type: 'sword', tier: 1 },
  { type: 'sword', tier: 1 },
  { type: 'skull', tier: 1 },
  { type: 'coin', tier: 1 },
  { type: 'shield', tier: 1 }
];

// ============================================================================
// BOSSES
// ============================================================================

export const BOSSES: Omit<BossData, 'currentHealth' | 'enraged' | 'bossIndex'>[] = [
  {
    id: 'goblin_king',
    name: 'Goblin King',
    maxHealth: 300,            // Easier first boss
    attack: 8,
    defense: 0,
    spriteKey: 'boss_goblin',
    abilities: [
      {
        id: 'steal',
        name: 'Pickpocket',
        chance: 0.12,
        effect: 'steal',
        value: 8  // Steals 8 gold
      }
    ]
  },
  {
    id: 'dark_knight',
    name: 'Dark Knight',
    maxHealth: 500,            // Medium difficulty
    attack: 12,
    defense: 15,  // 15% damage reduction
    spriteKey: 'boss_knight',
    abilities: [
      {
        id: 'cleave',
        name: 'Cleave',
        chance: 0.18,
        effect: 'aoe',
        value: 12  // Extra 12 damage to all
      },
      {
        id: 'shield_bash',
        name: 'Shield Bash',
        chance: 0.10,
        effect: 'curse',
        value: 2  // 2 rounds of curse
      }
    ]
  },
  {
    id: 'ancient_dragon',
    name: 'Ancient Dragon',
    maxHealth: 800,            // Hard but beatable
    attack: 18,
    defense: 25,  // 25% damage reduction
    spriteKey: 'boss_dragon',
    abilities: [
      {
        id: 'fire_breath',
        name: 'Fire Breath',
        chance: 0.22,
        effect: 'aoe',
        value: 18  // Extra 18 damage to all
      },
      {
        id: 'terrify',
        name: 'Terrifying Roar',
        chance: 0.12,
        effect: 'curse',
        value: 3  // 3 rounds of curse
      }
    ]
  }
];

// ============================================================================
// SHOP ITEMS
// ============================================================================

/**
 * Shop items organized by tier (unlocked after each boss)
 */
export const SHOP_ITEMS_BY_TIER: Record<number, ShopItem[]> = {
  // Tier 1: Available from start
  1: [
    {
      id: 'sword_t1',
      name: 'Iron Sword',
      description: 'Add a Sword symbol to your reel',
      cost: 15,
      type: 'symbol',
      rarity: 'common',
      symbol: { type: 'sword', tier: 1 }
    },
    {
      id: 'cherry_t1',
      name: 'Fresh Cherry',
      description: 'Add a Cherry symbol to your reel',
      cost: 15,
      type: 'symbol',
      rarity: 'common',
      symbol: { type: 'cherry', tier: 1 }
    },
    {
      id: 'shield_t1',
      name: 'Wooden Shield',
      description: 'Add a Shield symbol to your reel',
      cost: 15,
      type: 'symbol',
      rarity: 'common',
      symbol: { type: 'shield', tier: 1 }
    },
    {
      id: 'coin_t1',
      name: 'Lucky Coin',
      description: 'Add a Coin symbol to your reel',
      cost: 10,
      type: 'symbol',
      rarity: 'common',
      symbol: { type: 'coin', tier: 1 }
    },
    {
      id: 'remove_symbol',
      name: 'Symbol Removal',
      description: 'Remove any symbol from your reel',
      cost: 8,
      type: 'remove',
      rarity: 'common'
    },
    {
      id: 'heal_potion',
      name: 'Healing Potion',
      description: 'Restore 30 HP immediately',
      cost: 20,
      type: 'item',
      rarity: 'common',
      itemEffect: 'heal_potion',
      itemValue: 30
    }
  ],

  // Tier 2: After defeating first boss
  2: [
    {
      id: 'sword_t2',
      name: 'Steel Sword',
      description: 'Add a powerful Sword symbol (Tier 2)',
      cost: 30,
      type: 'symbol',
      rarity: 'uncommon',
      symbol: { type: 'sword', tier: 2 }
    },
    {
      id: 'cherry_t2',
      name: 'Golden Cherry',
      description: 'Add a powerful Cherry symbol (Tier 2)',
      cost: 30,
      type: 'symbol',
      rarity: 'uncommon',
      symbol: { type: 'cherry', tier: 2 }
    },
    {
      id: 'star_t1',
      name: 'Lucky Star',
      description: 'Add a Star symbol for critical hits',
      cost: 25,
      type: 'symbol',
      rarity: 'uncommon',
      symbol: { type: 'star', tier: 1 }
    },
    {
      id: 'bomb_t1',
      name: 'Bomb',
      description: 'Add a Bomb symbol for explosive damage',
      cost: 35,
      type: 'symbol',
      rarity: 'uncommon',
      symbol: { type: 'bomb', tier: 1 }
    },
    {
      id: 'wild_t1',
      name: 'Wild Card',
      description: 'Add a Wild symbol that matches anything',
      cost: 45,
      type: 'symbol',
      rarity: 'rare',
      symbol: { type: 'wild', tier: 1 }
    },
    {
      id: 'weighted_dice',
      name: 'Weighted Dice',
      description: 'Your next 3 spins have better odds',
      cost: 40,
      type: 'item',
      rarity: 'uncommon',
      itemEffect: 'weighted_dice',
      itemValue: 3
    }
  ],

  // Tier 3: After defeating second boss
  3: [
    {
      id: 'sword_t3',
      name: 'Dragon Slayer',
      description: 'Add a legendary Sword symbol (Tier 3)',
      cost: 60,
      type: 'symbol',
      rarity: 'rare',
      symbol: { type: 'sword', tier: 3 }
    },
    {
      id: 'cherry_t3',
      name: 'Phoenix Cherry',
      description: 'Add a legendary Cherry symbol (Tier 3)',
      cost: 60,
      type: 'symbol',
      rarity: 'rare',
      symbol: { type: 'cherry', tier: 3 }
    },
    {
      id: 'bomb_t2',
      name: 'Mega Bomb',
      description: 'Add a powerful Bomb symbol (Tier 2)',
      cost: 55,
      type: 'symbol',
      rarity: 'rare',
      symbol: { type: 'bomb', tier: 2 }
    },
    {
      id: 'wild_t2',
      name: 'Golden Wild',
      description: 'Add a powerful Wild symbol (Tier 2)',
      cost: 75,
      type: 'symbol',
      rarity: 'legendary',
      symbol: { type: 'wild', tier: 2 }
    },
    {
      id: 'skull_removal',
      name: 'Curse Breaker',
      description: 'Remove ALL Skull symbols from your reel',
      cost: 50,
      type: 'remove',
      rarity: 'rare'
    },
    {
      id: 'upgrade_all',
      name: 'Enchantment',
      description: 'Upgrade all your symbols by 1 tier',
      cost: 100,
      type: 'upgrade',
      rarity: 'legendary'
    }
  ]
};

// ============================================================================
// GOLD REWARDS
// ============================================================================

export const GOLD_REWARDS = {
  bossDefeat: [30, 50, 75],     // Gold per player for defeating each boss
  bonusPerDamage: 0.1,          // Gold per damage dealt to boss
  survivalBonus: 10             // Bonus for surviving the boss fight
};

// ============================================================================
// TIMING CONSTANTS
// ============================================================================

export const TIMING = {
  spinAnimationDuration: 2000,  // 2 seconds for spin animation
  effectDelay: 300,             // Delay between applying effects
  phaseTransitionDelay: 3000,   // 3 seconds between phases
  enrageThreshold: 0.25         // Boss enrages below 25% HP
};

// ============================================================================
// UI COLORS (for battle log icons)
// ============================================================================

export const SYMBOL_COLORS: Record<SymbolType, string> = {
  cherry: '#ff6b6b',    // Red
  sword: '#74b9ff',     // Blue
  skull: '#a29bfe',     // Purple
  shield: '#ffeaa7',    // Yellow
  coin: '#fdcb6e',      // Gold
  star: '#fd79a8',      // Pink
  wild: '#00cec9',      // Cyan
  bomb: '#ff7675'       // Orange-red
};

export const LOG_ICONS: Record<string, string> = {
  damage: '???',
  heal: '???',
  gold: '????',
  buff: '????',
  debuff: '????',
  boss: '????',
  victory: '????',
  defeat: '????'
};
