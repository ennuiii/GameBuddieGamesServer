import { Guess, Round } from '../types/index.js';

/**
 * Calculate points for guessers based on their accuracy
 */
export function calculateGuesserPoints(guesses: Guess[], targetNumber: number): Guess[] {
  const scoredGuesses = guesses.map((guess) => {
    const diff = Math.abs(guess.value - targetNumber);
    let basePoints = 0;

    if (diff === 0) {
      basePoints = 2;
    } else if (diff === 1) {
      basePoints = 1;
    } else {
      basePoints = 0;
    }

    return { ...guess, points: basePoints };
  });

  return scoredGuesses;
}

/**
 * Calculate team bonus (average of all guesser points, rounded)
 */
export function calculateTeamBonus(guesses: Guess[]): number {
  if (guesses.length === 0) return 0;

  const totalPoints = guesses.reduce((sum, g) => sum + g.points, 0);
  const average = totalPoints / guesses.length;

  // Round half up
  return Math.round(average);
}

/**
 * Apply team bonus to all guesses
 */
export function applyTeamBonus(guesses: Guess[], teamBonus: number): Guess[] {
  return guesses.map((guess) => ({
    ...guess,
    points: guess.points + teamBonus,
  }));
}

/**
 * Calculate Clue-Giver points based on best guess accuracy
 */
export function calculateClueGiverPoints(guesses: Guess[], targetNumber: number): number {
  if (guesses.length === 0) return -1; // No guesses means failed clue

  // Find the best accuracy (smallest difference)
  const bestDiff = Math.min(...guesses.map((g) => Math.abs(g.value - targetNumber)));

  if (bestDiff === 0) {
    return 5; // Perfect clue
  } else if (bestDiff === 1) {
    return 2; // Good clue
  } else {
    return -1; // Poor clue
  }
}

/**
 * Complete scoring for a round
 */
export function scoreRound(
  round: Round,
  teamBonusEnabled: boolean
): {
  scoredGuesses: Guess[];
  clueGiverPoints: number;
  teamBonus: number;
} {
  // Step 1: Calculate base points for guessers
  let scoredGuesses = calculateGuesserPoints(round.guesses, round.targetNumber);

  // Step 2: Calculate and apply team bonus
  const teamBonus = teamBonusEnabled ? calculateTeamBonus(scoredGuesses) : 0;
  if (teamBonusEnabled) {
    scoredGuesses = applyTeamBonus(scoredGuesses, teamBonus);
  }

  // Step 3: Calculate Clue-Giver points
  const clueGiverPoints = calculateClueGiverPoints(round.guesses, round.targetNumber);

  return {
    scoredGuesses,
    clueGiverPoints,
    teamBonus,
  };
}
