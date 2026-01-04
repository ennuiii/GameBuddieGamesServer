import { createClient, SupabaseClient } from '@supabase/supabase-js';

/**
 * ContentService - Database integration for Canvas Chaos
 *
 * Fetches prompts and modifiers from the unified game_content table.
 * Supports caching per language for performance.
 * Falls back gracefully to local arrays if Supabase not available.
 */

// Game content row interface
interface GameContentRow {
  id: string;
  game_ids: string[];
  text_content: string;
  media_url?: string;
  language: string;
  difficulty_level: string;
  is_premium: boolean;
  is_verified: boolean;
  tags: string[];
  data: {
    type?: string;
    difficulty?: string;
    category?: string;
    keyword?: string;
    [key: string]: unknown;
  };
  created_at: string;
  updated_at: string;
}

// Cached content structure
interface CanvasChaosContent {
  freezeFramePrompts: string[];
  artisticDiffPrompts: string[];
  artisticDiffModifiers: {
    easy: string[];
    medium: string[];
    hard: string[];
  };
  evolutionPrompts: string[];
  loadedAt: number;
}

// Fallback content (original hardcoded values)
const FALLBACK_CONTENT: CanvasChaosContent = {
  freezeFramePrompts: [
    "Turn them into a superhero",
    "Add a fancy hat",
    "Put them in space",
    "Make them a wizard",
    "Add speech bubbles",
    "Turn them into a meme",
    "Give them a pet",
    "Add a dramatic background",
  ],
  artisticDiffPrompts: [
    "Draw a cat",
    "Draw a house",
    "Draw a car",
    "Draw a tree",
    "Draw a robot",
    "Draw a pizza",
    "Draw a dragon",
    "Draw a spaceship",
  ],
  artisticDiffModifiers: {
    easy: [
      "but it's on fire",
      "but it's tiny",
      "but it's giant",
      "but it's happy",
      "but it's sad",
    ],
    medium: [
      "but it's evil",
      "but it's in space",
      "but it's underwater",
      "but it's made of cheese",
      "but it's a ghost",
    ],
    hard: [
      "but it's slightly nervous",
      "but it's from the future",
      "but it's been awake for 3 days",
      "but it's pretending to be normal",
      "but it's secretly a spy",
    ],
  },
  evolutionPrompts: [
    "Add something that helps it FLY",
    "Add something that helps it SWIM",
    "Add a DEFENSE mechanism",
    "Make it look EVIL",
    "Add something from a KITCHEN",
    "Add TOO MANY of something",
    "Give it a piece of CLOTHING",
    "Add a MUSICAL instrument",
  ],
  loadedAt: 0,
};

// German fallback content
const FALLBACK_CONTENT_DE: CanvasChaosContent = {
  freezeFramePrompts: [
    "Verwandle sie in einen Superhelden",
    "Füge einen schicken Hut hinzu",
    "Setze sie ins Weltall",
    "Mach sie zu einem Zauberer",
    "Füge Sprechblasen hinzu",
    "Verwandle sie in ein Meme",
    "Gib ihnen ein Haustier",
    "Füge einen dramatischen Hintergrund hinzu",
  ],
  artisticDiffPrompts: [
    "Zeichne eine Katze",
    "Zeichne ein Haus",
    "Zeichne ein Auto",
    "Zeichne einen Baum",
    "Zeichne einen Roboter",
    "Zeichne eine Pizza",
    "Zeichne einen Drachen",
    "Zeichne ein Raumschiff",
  ],
  artisticDiffModifiers: {
    easy: [
      "aber es brennt",
      "aber es ist winzig",
      "aber es ist riesig",
      "aber es ist glücklich",
      "aber es ist traurig",
    ],
    medium: [
      "aber es ist böse",
      "aber es ist im Weltraum",
      "aber es ist unter Wasser",
      "aber es ist aus Käse",
      "aber es ist ein Geist",
    ],
    hard: [
      "aber es ist leicht nervös",
      "aber es ist aus der Zukunft",
      "aber es ist seit 3 Tagen wach",
      "aber es tut so als wäre es normal",
      "aber es ist heimlich ein Spion",
    ],
  },
  evolutionPrompts: [
    "Füge etwas hinzu das ihm beim FLIEGEN hilft",
    "Füge etwas hinzu das ihm beim SCHWIMMEN hilft",
    "Füge einen VERTEIDIGUNGSMECHANISMUS hinzu",
    "Lass es BÖSE aussehen",
    "Füge etwas aus einer KÜCHE hinzu",
    "Füge ZU VIEL von etwas hinzu",
    "Gib ihm ein KLEIDUNGSSTÜCK",
    "Füge ein MUSIKINSTRUMENT hinzu",
  ],
  loadedAt: 0,
};

// Cache duration in milliseconds (5 minutes)
const CACHE_DURATION = 5 * 60 * 1000;

export class ContentService {
  private supabase: SupabaseClient | null = null;
  private isAvailable: boolean = false;
  private cache: Map<string, CanvasChaosContent> = new Map();

  constructor() {
    // Initialize Supabase client if credentials provided
    if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
      try {
        this.supabase = createClient(
          process.env.SUPABASE_URL,
          process.env.SUPABASE_SERVICE_ROLE_KEY
        );
        this.isAvailable = true;
        console.log('[Canvas-Chaos Content] ✅ Connected to Supabase');
      } catch (error) {
        console.log('[Canvas-Chaos Content] ⚠️ Failed to initialize Supabase:', error);
        this.isAvailable = false;
      }
    } else {
      console.log('[Canvas-Chaos Content] ℹ️ Supabase credentials not provided - using fallback content');
    }
  }

  /**
   * Check if Supabase is available
   */
  public isSupabaseAvailable(): boolean {
    return this.isAvailable;
  }

  /**
   * Get fallback content for a language
   */
  private getFallbackContent(language: 'en' | 'de'): CanvasChaosContent {
    return language === 'de' ? { ...FALLBACK_CONTENT_DE } : { ...FALLBACK_CONTENT };
  }

  /**
   * Check if cache is valid
   */
  private isCacheValid(language: string): boolean {
    const cached = this.cache.get(language);
    if (!cached) return false;
    return Date.now() - cached.loadedAt < CACHE_DURATION;
  }

  /**
   * Fetch all content from database for a language
   */
  async getContent(language: 'en' | 'de' = 'en'): Promise<CanvasChaosContent> {
    // Return cached content if valid
    if (this.isCacheValid(language)) {
      return this.cache.get(language)!;
    }

    // If Supabase not available, return fallback
    if (!this.isAvailable || !this.supabase) {
      console.log(`[Canvas-Chaos Content] Using fallback content for ${language}`);
      return this.getFallbackContent(language);
    }

    try {
      // Fetch all canvas-chaos content for the language
      const { data, error } = await this.supabase
        .from('game_content')
        .select('*')
        .contains('game_ids', ['canvas-chaos'])
        .eq('is_verified', true)
        .eq('language', language);

      if (error) {
        console.error('[Canvas-Chaos Content] Error fetching content:', error);
        return this.getFallbackContent(language);
      }

      if (!data || data.length === 0) {
        console.log(`[Canvas-Chaos Content] No content found for ${language}, using fallback`);
        return this.getFallbackContent(language);
      }

      // Parse content into categories
      const content: CanvasChaosContent = {
        freezeFramePrompts: [],
        artisticDiffPrompts: [],
        artisticDiffModifiers: { easy: [], medium: [], hard: [] },
        evolutionPrompts: [],
        loadedAt: Date.now(),
      };

      const rows = data as GameContentRow[];

      for (const row of rows) {
        const tags = row.tags || [];

        // Freeze Frame Prompts
        if (tags.includes('freeze_frame') && tags.includes('prompt')) {
          content.freezeFramePrompts.push(row.text_content);
        }
        // Artistic Diff Base Prompts
        else if (tags.includes('artistic_diff') && tags.includes('base_prompt')) {
          content.artisticDiffPrompts.push(row.text_content);
        }
        // Artistic Diff Modifiers
        else if (tags.includes('artistic_diff') && tags.includes('modifier')) {
          const difficulty = row.data?.difficulty || this.getDifficultyFromLevel(row.difficulty_level);
          if (difficulty === 'easy') {
            content.artisticDiffModifiers.easy.push(row.text_content);
          } else if (difficulty === 'medium') {
            content.artisticDiffModifiers.medium.push(row.text_content);
          } else if (difficulty === 'hard') {
            content.artisticDiffModifiers.hard.push(row.text_content);
          }
        }
        // Evolution Prompts
        else if (tags.includes('evolution') && tags.includes('mutation_prompt')) {
          content.evolutionPrompts.push(row.text_content);
        }
      }

      // If any category is empty, merge with fallback
      const fallback = this.getFallbackContent(language);
      if (content.freezeFramePrompts.length === 0) {
        content.freezeFramePrompts = fallback.freezeFramePrompts;
      }
      if (content.artisticDiffPrompts.length === 0) {
        content.artisticDiffPrompts = fallback.artisticDiffPrompts;
      }
      if (content.artisticDiffModifiers.easy.length === 0) {
        content.artisticDiffModifiers.easy = fallback.artisticDiffModifiers.easy;
      }
      if (content.artisticDiffModifiers.medium.length === 0) {
        content.artisticDiffModifiers.medium = fallback.artisticDiffModifiers.medium;
      }
      if (content.artisticDiffModifiers.hard.length === 0) {
        content.artisticDiffModifiers.hard = fallback.artisticDiffModifiers.hard;
      }
      if (content.evolutionPrompts.length === 0) {
        content.evolutionPrompts = fallback.evolutionPrompts;
      }

      // Cache the content
      this.cache.set(language, content);

      console.log(`[Canvas-Chaos Content] Loaded content for ${language}:`, {
        freezeFrame: content.freezeFramePrompts.length,
        artisticDiffBase: content.artisticDiffPrompts.length,
        modifiersEasy: content.artisticDiffModifiers.easy.length,
        modifiersMedium: content.artisticDiffModifiers.medium.length,
        modifiersHard: content.artisticDiffModifiers.hard.length,
        evolution: content.evolutionPrompts.length,
      });

      return content;
    } catch (error) {
      console.error('[Canvas-Chaos Content] Exception fetching content:', error);
      return this.getFallbackContent(language);
    }
  }

  /**
   * Convert difficulty_level string to difficulty name
   */
  private getDifficultyFromLevel(level: string): 'easy' | 'medium' | 'hard' {
    switch (level) {
      case '1': return 'easy';
      case '2': return 'medium';
      case '3': return 'hard';
      default: return 'medium';
    }
  }

  /**
   * Get a random freeze frame prompt
   */
  async getRandomFreezeFramePrompt(language: 'en' | 'de' = 'en'): Promise<string> {
    const content = await this.getContent(language);
    const prompts = content.freezeFramePrompts;
    return prompts[Math.floor(Math.random() * prompts.length)];
  }

  /**
   * Get a random artistic diff base prompt
   */
  async getRandomArtisticDiffPrompt(language: 'en' | 'de' = 'en'): Promise<string> {
    const content = await this.getContent(language);
    const prompts = content.artisticDiffPrompts;
    return prompts[Math.floor(Math.random() * prompts.length)];
  }

  /**
   * Get a random modifier for a difficulty level
   */
  async getRandomModifier(
    difficulty: 'easy' | 'medium' | 'hard',
    language: 'en' | 'de' = 'en'
  ): Promise<string> {
    const content = await this.getContent(language);
    const modifiers = content.artisticDiffModifiers[difficulty];
    return modifiers[Math.floor(Math.random() * modifiers.length)];
  }

  /**
   * Get a random evolution mutation prompt
   */
  async getRandomEvolutionPrompt(language: 'en' | 'de' = 'en'): Promise<string> {
    const content = await this.getContent(language);
    const prompts = content.evolutionPrompts;
    return prompts[Math.floor(Math.random() * prompts.length)];
  }

  /**
   * Pre-load content for both languages (call on initialization)
   */
  async preloadContent(): Promise<void> {
    console.log('[Canvas-Chaos Content] Pre-loading content...');
    await Promise.all([
      this.getContent('en'),
      this.getContent('de'),
    ]);
    console.log('[Canvas-Chaos Content] Pre-load complete');
  }

  /**
   * Clear cache (useful for testing or forced refresh)
   */
  clearCache(): void {
    this.cache.clear();
    console.log('[Canvas-Chaos Content] Cache cleared');
  }
}

// Export singleton instance
export const contentService = new ContentService();
