import { WordPair } from '../types/types.js';

export class WordManager {
  private wordPairs: WordPair[] = [];
  private classicWords: string[] = [];

  loadWords(wordPairs: WordPair[], classicWords: string[]) {
    this.wordPairs = wordPairs;
    this.classicWords = classicWords;
    console.log(`[WordManager] Loaded ${wordPairs.length} word pairs and ${classicWords.length} classic words`);
  }

  getRandomClassicWord(usedWords: Set<string>): string {
    const availableWords = this.classicWords.filter(word => !usedWords.has(word));
    
    if (availableWords.length === 0) {
      // If all words have been used, reset the pool
      console.log('[WordManager] All classic words used, resetting pool');
      return this.classicWords[Math.floor(Math.random() * this.classicWords.length)];
    }
    
    return availableWords[Math.floor(Math.random() * availableWords.length)];
  }

  getRandomWordPair(usedWords: Set<string>): WordPair {
    const availablePairs = this.wordPairs.filter(pair => 
      !usedWords.has(pair.normal) && !usedWords.has(pair.similar)
    );
    
    if (availablePairs.length === 0) {
      // If all word pairs have been used, reset the pool
      console.log('[WordManager] All word pairs used, resetting pool');
      return this.wordPairs[Math.floor(Math.random() * this.wordPairs.length)];
    }
    
    return availablePairs[Math.floor(Math.random() * availablePairs.length)];
  }

  getWordForPlayer(isImposter: boolean, gameMode: 'classic' | 'hidden', currentWord: string, wordPair?: WordPair): string | null {
    if (gameMode === 'classic') {
      // In classic mode, imposter gets no word
      return isImposter ? null : currentWord;
    } else {
      // In hidden mode, imposter gets the similar word
      if (!wordPair) {
        console.error('[WordManager] No word pair provided for hidden mode');
        return currentWord;
      }
      return isImposter ? wordPair.similar : wordPair.normal;
    }
  }

  getAvailableClassicWordsCount(usedWords: Set<string>): number {
    return this.classicWords.filter(word => !usedWords.has(word)).length;
  }

  getAvailableWordPairsCount(usedWords: Set<string>): number {
    return this.wordPairs.filter(pair => 
      !usedWords.has(pair.normal) && !usedWords.has(pair.similar)
    ).length;
  }

  getAllClassicWords(): string[] {
    return [...this.classicWords];
  }

  getAllWordPairs(): WordPair[] {
    return [...this.wordPairs];
  }
} 