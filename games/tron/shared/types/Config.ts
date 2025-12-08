/**
 * Config.ts - Simulation configuration
 *
 * All configurable parameters for the game simulation.
 */

/**
 * SimulationConfig - All game parameters
 */
export interface SimulationConfig {
  /**
   * Arena size in units
   * Arena is square, centered at origin: [-size/2, size/2]
   */
  arenaSize: number;

  /**
   * Base speed in units per second (at speedMultiplier = 1)
   */
  baseSpeed: number;

  /**
   * Speed multiplier (1 = slow, 2 = normal, 3 = fast)
   */
  speedMultiplier: number;

  /**
   * Collision grid cell size
   * Smaller = more precise but more memory/CPU
   * Recommended: 1-3
   */
  gridSize: number;

  /**
   * Minimum time between turns (seconds)
   * Prevents rapid-fire turning exploits
   */
  turnDelay: number;

  /**
   * Enable wrap-around at arena edges?
   * true = teleport to opposite side
   * false = wall collision (death)
   */
  wrapAround: boolean;

  /**
   * Enable self-collision?
   * true = hitting your own trail kills you
   * false = can pass through own trail
   */
  selfCollision: boolean;

  /**
   * Number of rounds to win the match
   */
  roundsToWin: number;

  /**
   * Countdown duration before round starts (seconds)
   */
  countdownDuration: number;

  /**
   * Delay after round ends before next round (seconds)
   */
  roundEndDelay: number;
}

/**
 * Default configuration values
 */
export const DEFAULT_CONFIG: SimulationConfig = {
  arenaSize: 100,
  baseSpeed: 20,
  speedMultiplier: 2,
  gridSize: 2,
  turnDelay: 0.1,
  wrapAround: true,
  selfCollision: true,
  roundsToWin: 3,
  countdownDuration: 3,
  roundEndDelay: 3,
};

/**
 * Speed presets
 */
export const SPEED_PRESETS = {
  slow: 1,
  normal: 2,
  fast: 3,
} as const;

/**
 * Arena size presets
 */
export const ARENA_PRESETS = {
  small: 50,
  medium: 100,
  large: 150,
  huge: 200,
} as const;

/**
 * Calculate actual speed from config
 */
export function getActualSpeed(config: SimulationConfig): number {
  return config.baseSpeed * config.speedMultiplier;
}

/**
 * Validate and clamp config values
 */
export function validateConfig(config: Partial<SimulationConfig>): SimulationConfig {
  const result = { ...DEFAULT_CONFIG, ...config };

  // Clamp values to reasonable ranges
  result.arenaSize = Math.max(20, Math.min(500, result.arenaSize));
  result.baseSpeed = Math.max(5, Math.min(100, result.baseSpeed));
  result.speedMultiplier = Math.max(1, Math.min(5, result.speedMultiplier));
  result.gridSize = Math.max(1, Math.min(10, result.gridSize));
  result.turnDelay = Math.max(0, Math.min(1, result.turnDelay));
  result.roundsToWin = Math.max(1, Math.min(10, result.roundsToWin));
  result.countdownDuration = Math.max(1, Math.min(10, result.countdownDuration));
  result.roundEndDelay = Math.max(1, Math.min(10, result.roundEndDelay));

  return result;
}
