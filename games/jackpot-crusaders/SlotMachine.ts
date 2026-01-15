/**
 * Jackpot Crusaders - Slot Machine Logic
 *
 * Handles spinning, match detection, and effect calculation.
 */

import type {
  Symbol,
  SymbolType,
  SlotMachine,
  MatchResult,
  SpinResult,
  SpinEffect,
  JackpotPlayerData
} from './types.js';
import { SYMBOL_EFFECTS, STARTING_SYMBOLS } from './constants.js';

// ============================================================================
// SLOT MACHINE CREATION
// ============================================================================

/**
 * Create a new slot machine with starting symbols
 */
export function createSlotMachine(): SlotMachine {
  return {
    symbols: [...STARTING_SYMBOLS],  // Copy starting symbols
    lastSpinResult: [],
    isSpinning: false
  };
}

// ============================================================================
// SPINNING
// ============================================================================

/**
 * Execute a spin on a player's slot machine
 * Returns 4 random symbols from their reel
 */
export function executeSpin(slotMachine: SlotMachine): Symbol[] {
  const { symbols } = slotMachine;

  if (symbols.length === 0) {
    // Failsafe: if somehow empty, return skulls
    return [
      { type: 'skull', tier: 1 },
      { type: 'skull', tier: 1 },
      { type: 'skull', tier: 1 },
      { type: 'skull', tier: 1 }
    ];
  }

  // Pick 4 random symbols from the reel (with replacement)
  const result: Symbol[] = [];
  for (let i = 0; i < 4; i++) {
    const randomIndex = Math.floor(Math.random() * symbols.length);
    result.push({ ...symbols[randomIndex] });  // Clone to avoid mutations
  }

  return result;
}

// ============================================================================
// MATCH DETECTION
// ============================================================================

/**
 * Detect matches in a spin result
 * Returns all 3+ matches found
 */
export function detectMatches(spinResult: Symbol[]): MatchResult[] {
  const matches: MatchResult[] = [];

  // Count each symbol type
  const counts = new Map<SymbolType, { count: number; totalTier: number }>();

  for (const symbol of spinResult) {
    if (symbol.type === 'wild') continue;  // Count wilds separately

    const existing = counts.get(symbol.type) || { count: 0, totalTier: 0 };
    counts.set(symbol.type, {
      count: existing.count + 1,
      totalTier: existing.totalTier + symbol.tier
    });
  }

  // Count wild symbols
  const wildCount = spinResult.filter(s => s.type === 'wild').length;
  const wildTier = spinResult
    .filter(s => s.type === 'wild')
    .reduce((sum, s) => sum + s.tier, 0);

  // Find the highest count to apply wilds to
  let highestType: SymbolType | null = null;
  let highestCount = 0;

  counts.forEach((data, type) => {
    if (data.count > highestCount) {
      highestCount = data.count;
      highestType = type;
    }
  });

  // Apply wilds to highest count (if any non-wild symbols exist)
  if (highestType && wildCount > 0) {
    const existing = counts.get(highestType)!;
    counts.set(highestType, {
      count: existing.count + wildCount,
      totalTier: existing.totalTier + wildTier
    });
  }

  // Find all 3+ matches
  counts.forEach((data, type) => {
    if (data.count >= 3) {
      matches.push({
        symbolType: type,
        count: Math.min(data.count, 4),  // Cap at 4
        tier: Math.round(data.totalTier / data.count)  // Average tier
      });
    }
  });

  return matches;
}

// ============================================================================
// EFFECT CALCULATION
// ============================================================================

/**
 * Calculate effects from matches
 */
export function calculateEffects(matches: MatchResult[]): SpinEffect[] {
  const effects: SpinEffect[] = [];

  for (const match of matches) {
    const symbolEffect = SYMBOL_EFFECTS[match.symbolType];
    if (!symbolEffect) continue;

    // Get base effect (3 or 4 match)
    const baseEffect = match.count >= 4 ? symbolEffect.match4 : symbolEffect.match3;

    // Scale value by tier
    const scaledValue = Math.round(baseEffect.value * match.tier);

    effects.push({
      type: baseEffect.type,
      target: baseEffect.target,
      value: scaledValue,
      bonus: baseEffect.bonus
    });
  }

  return effects;
}

// ============================================================================
// FULL SPIN PROCESSING
// ============================================================================

/**
 * Process a complete spin for a player
 */
export function processPlayerSpin(
  playerId: string,
  playerData: JackpotPlayerData
): SpinResult {
  // Execute spin
  const symbols = executeSpin(playerData.slotMachine);

  // Update slot machine state
  playerData.slotMachine.lastSpinResult = symbols;

  // Detect matches
  const matches = detectMatches(symbols);

  // Calculate effects
  const effects = calculateEffects(matches);

  return {
    playerId,
    symbols,
    matches,
    effects
  };
}

// ============================================================================
// SYMBOL MANAGEMENT
// ============================================================================

/**
 * Add a symbol to a player's slot machine
 */
export function addSymbol(slotMachine: SlotMachine, symbol: Symbol): void {
  slotMachine.symbols.push({ ...symbol });
}

/**
 * Remove a symbol from a player's slot machine by index
 */
export function removeSymbol(slotMachine: SlotMachine, index: number): boolean {
  if (index < 0 || index >= slotMachine.symbols.length) {
    return false;
  }

  // Don't allow removing if only 4 symbols left (minimum for spinning)
  if (slotMachine.symbols.length <= 4) {
    return false;
  }

  slotMachine.symbols.splice(index, 1);
  return true;
}

/**
 * Remove all symbols of a specific type
 */
export function removeAllOfType(slotMachine: SlotMachine, type: SymbolType): number {
  const initialLength = slotMachine.symbols.length;
  slotMachine.symbols = slotMachine.symbols.filter(s => s.type !== type);

  // Ensure minimum 4 symbols
  if (slotMachine.symbols.length < 4) {
    // Add back some generic symbols
    while (slotMachine.symbols.length < 4) {
      slotMachine.symbols.push({ type: 'sword', tier: 1 });
    }
  }

  return initialLength - slotMachine.symbols.length;
}

/**
 * Upgrade all symbols by 1 tier (max tier 3)
 */
export function upgradeAllSymbols(slotMachine: SlotMachine): void {
  for (const symbol of slotMachine.symbols) {
    if (symbol.tier < 3) {
      symbol.tier = (symbol.tier + 1) as 1 | 2 | 3;
    }
  }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Get symbol counts for display
 */
export function getSymbolCounts(slotMachine: SlotMachine): Map<SymbolType, number> {
  const counts = new Map<SymbolType, number>();

  for (const symbol of slotMachine.symbols) {
    counts.set(symbol.type, (counts.get(symbol.type) || 0) + 1);
  }

  return counts;
}

/**
 * Calculate probability of getting 3+ of a symbol type
 */
export function calculateMatchProbability(
  slotMachine: SlotMachine,
  symbolType: SymbolType
): number {
  const total = slotMachine.symbols.length;
  const count = slotMachine.symbols.filter(s => s.type === symbolType).length;
  const wildCount = slotMachine.symbols.filter(s => s.type === 'wild').length;

  if (total === 0) return 0;

  // Simplified probability calculation
  // P(3+ of type) when drawing 4 with replacement
  const p = (count + wildCount) / total;

  // Binomial probability for k >= 3 out of 4
  // P(X >= 3) = P(X=3) + P(X=4)
  const p3 = 4 * Math.pow(p, 3) * (1 - p);
  const p4 = Math.pow(p, 4);

  return Math.min(p3 + p4, 1);
}
