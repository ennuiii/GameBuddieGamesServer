import { createClient, SupabaseClient } from '@supabase/supabase-js';

/**
 * SupabaseService - Database integration for DDF (LastBrainStanding)
 *
 * Now uses the unified game_content table for questions.
 * Provides READ capability for:
 * - Questions (read from game_content table where 'ddf' is in game_ids)
 * - Game state persistence (save/load game progress)
 * - Event logging (track game activities)
 *
 * Falls back gracefully to local storage if Supabase credentials not provided.
 */

// Unified game_content row interface
interface GameContentRow {
  id: string;
  game_ids: string[];
  text_content: string;
  media_url?: string;
  language: string;
  difficulty_level: number;
  is_premium: boolean;
  is_verified: boolean;
  tags: string[];
  data: {
    answer?: string;
    category?: string;
    bad_mark_count?: number;
    source_table?: string;
    [key: string]: unknown;
  };
  created_at: string;
  updated_at: string;
}

// Legacy DDF question format for backward compatibility
interface DDFQuestion {
  id: string;
  question: string;
  answer: string;
  category: string;
  difficulty?: string;
  is_bad: boolean;
  created_at: string;
  updated_at?: string;
}

// Helper to convert game_content row to legacy DDF question format
function convertToDDFQuestion(row: GameContentRow): DDFQuestion {
  const difficultyMap: Record<number, string> = { 1: 'easy', 2: 'medium', 3: 'hard' };

  // Get category from: data.category -> data.subject -> first relevant tag -> 'general'
  const category = (row.data?.category as string)
    || (row.data?.subject as string)
    || row.tags.find(t => !['trivia', 'ddf', 'schooled', 'question'].includes(t.toLowerCase()))
    || 'general';

  return {
    id: row.id,
    question: row.text_content,
    answer: (row.data?.answer as string) || '',
    category,
    difficulty: difficultyMap[row.difficulty_level] || 'medium',
    is_bad: !row.is_verified,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

export class SupabaseService {
  private supabase: SupabaseClient | null = null;
  private isAvailable: boolean = false;

  constructor() {
    // Initialize Supabase client if credentials provided
    if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
      try {
        this.supabase = createClient(
          process.env.SUPABASE_URL,
          process.env.SUPABASE_SERVICE_ROLE_KEY
        );
        this.isAvailable = true;
        console.log('[Supabase] ✅ Connected to Supabase');
      } catch (error) {
        console.log('[Supabase] ⚠️ Failed to initialize Supabase:', error);
        this.isAvailable = false;
      }
    } else {
      console.log('[Supabase] ℹ️ Supabase credentials not provided - using local storage');
    }
  }

  /**
   * Check if Supabase is available
   */
  public isSupabaseAvailable(): boolean {
    return this.isAvailable;
  }

  /**
   * Fetch all questions from game_content table where 'ddf' is in game_ids
   * @param language - Optional language filter ('en' | 'de'). Defaults to 'en' if not provided.
   */
  async getQuestions(language?: 'en' | 'de'): Promise<DDFQuestion[]> {
    if (!this.isAvailable || !this.supabase) {
      console.log('[Supabase] Supabase not available, returning empty array');
      return [];
    }

    const lang = language || 'en'; // Default to English

    try {
      const { data, error } = await this.supabase
        .from('game_content')
        .select('*')
        .contains('game_ids', ['ddf'])
        .eq('is_verified', true) // Only fetch valid questions
        .eq('language', lang) // Filter by language
        .order('created_at', { ascending: false });

      if (error) {
        console.error('[Supabase] Error fetching questions:', error);
        return [];
      }

      const questions = (data as GameContentRow[] || []).map(convertToDDFQuestion);
      console.log(`[Supabase] Fetched ${questions.length} questions from game_content table (language: ${lang})`);
      return questions;
    } catch (error) {
      console.error('[Supabase] Exception fetching questions:', error);
      return [];
    }
  }

  /**
   * Fetch questions by category from game_content table
   * @param category - Category to filter by
   * @param language - Optional language filter ('en' | 'de'). Defaults to 'en' if not provided.
   */
  async getQuestionsByCategory(category: string, language?: 'en' | 'de'): Promise<DDFQuestion[]> {
    if (!this.isAvailable || !this.supabase) {
      return [];
    }

    const lang = language || 'en'; // Default to English

    try {
      // First try filtering by data->>'category', then fallback to tags
      const { data, error } = await this.supabase
        .from('game_content')
        .select('*')
        .contains('game_ids', ['ddf'])
        .eq('is_verified', true)
        .eq('language', lang) // Filter by language
        .or(`data->>category.eq.${category},tags.cs.{${category.toLowerCase()}}`)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('[Supabase] Error fetching questions by category:', error);
        return [];
      }

      return (data as GameContentRow[] || []).map(convertToDDFQuestion);
    } catch (error) {
      console.error('[Supabase] Exception fetching questions by category:', error);
      return [];
    }
  }

  /**
   * Save game state to Supabase
   */
  async saveGameState(
    roomCode: string,
    gameState: unknown,
    playerId: string
  ): Promise<boolean> {
    if (!this.isAvailable || !this.supabase) {
      return false;
    }

    try {
      const { error } = await this.supabase
        .from('ddf_game_states')
        .insert({
          room_code: roomCode,
          game_state: gameState,
          saved_by: playerId,
          created_at: new Date().toISOString(),
        });

      if (error) {
        console.error('[Supabase] Error saving game state:', error);
        return false;
      }

      console.log(`[Supabase] Saved game state for room ${roomCode}`);
      return true;
    } catch (error) {
      console.error('[Supabase] Exception saving game state:', error);
      return false;
    }
  }

  /**
   * Load latest game state from Supabase (for reconnection)
   */
  async loadGameState(roomCode: string): Promise<unknown | null> {
    if (!this.isAvailable || !this.supabase) {
      return null;
    }

    try {
      const { data, error } = await this.supabase
        .from('ddf_game_states')
        .select('game_state')
        .eq('room_code', roomCode)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (error) {
        console.log('[Supabase] No saved game state found for room:', roomCode);
        return null;
      }

      console.log(`[Supabase] Loaded game state for room ${roomCode}`);
      return data?.game_state || null;
    } catch (error) {
      console.error('[Supabase] Exception loading game state:', error);
      return null;
    }
  }

  /**
   * Log game event to Supabase
   */
  async logEvent(
    roomCode: string,
    playerId: string,
    eventType: string,
    eventData: unknown
  ): Promise<boolean> {
    if (!this.isAvailable || !this.supabase) {
      return false;
    }

    try {
      const { error } = await this.supabase
        .from('ddf_events')
        .insert({
          room_code: roomCode,
          player_id: playerId,
          event_type: eventType,
          event_data: eventData,
          created_at: new Date().toISOString(),
        });

      if (error) {
        console.error('[Supabase] Error logging event:', error);
        return false;
      }

      return true;
    } catch (error) {
      console.error('[Supabase] Exception logging event:', error);
      return false;
    }
  }

  /**
   * Mark question as bad in game_content table (set is_verified to false)
   */
  async markQuestionAsBad(questionId: string): Promise<boolean> {
    if (!this.isAvailable || !this.supabase) {
      return false;
    }

    try {
      // First, get the current data to increment bad_mark_count
      const { data: existing } = await this.supabase
        .from('game_content')
        .select('data')
        .eq('id', questionId)
        .single();

      const currentBadCount = (existing?.data as { bad_mark_count?: number })?.bad_mark_count || 0;
      const newBadCount = currentBadCount + 1;

      // Update the question
      const { error } = await this.supabase
        .from('game_content')
        .update({
          is_verified: false,
          data: {
            ...(existing?.data || {}),
            bad_mark_count: newBadCount
          },
          updated_at: new Date().toISOString()
        })
        .eq('id', questionId);

      if (error) {
        console.error('[Supabase] Error marking question as bad:', error);
        return false;
      }

      console.log(`[Supabase] Marked question ${questionId} as bad (count: ${newBadCount})`);
      return true;
    } catch (error) {
      console.error('[Supabase] Exception marking question as bad:', error);
      return false;
    }
  }

  /**
   * Get all questions for admin (includes unverified, supports language filter)
   */
  async getAllQuestionsForAdmin(language?: 'en' | 'de'): Promise<DDFQuestion[]> {
    if (!this.isAvailable || !this.supabase) {
      console.log('[Supabase] Supabase not available, returning empty array');
      return [];
    }

    try {
      let query = this.supabase
        .from('game_content')
        .select('*')
        .contains('game_ids', ['ddf'])
        .order('created_at', { ascending: false });

      // Apply language filter if specified
      if (language) {
        query = query.eq('language', language);
      }

      const { data, error } = await query;

      if (error) {
        console.error('[Supabase] Error fetching all questions:', error);
        return [];
      }

      const questions = (data as GameContentRow[] || []).map(row => {
        const q = convertToDDFQuestion(row);
        // Add language and badMarkCount for admin view
        return {
          ...q,
          language: row.language as 'en' | 'de',
          badMarkCount: (row.data?.bad_mark_count as number) || 0
        };
      });

      console.log(`[Supabase] Fetched ${questions.length} questions for admin (language: ${language || 'all'})`);
      return questions;
    } catch (error) {
      console.error('[Supabase] Exception fetching all questions:', error);
      return [];
    }
  }

  /**
   * Get unique categories from game_content table for DDF
   * @param language - Optional language filter ('en' | 'de'). Filters categories to only those in the selected language.
   */
  async getCategories(language?: 'en' | 'de'): Promise<string[]> {
    if (!this.isAvailable || !this.supabase) {
      return [];
    }

    try {
      let query = this.supabase
        .from('game_content')
        .select('data, tags')
        .contains('game_ids', ['ddf'])
        .eq('is_verified', true);

      // Apply language filter if specified
      if (language) {
        query = query.eq('language', language);
      }

      const { data, error } = await query;

      if (error) {
        console.error('[Supabase] Error fetching categories:', error);
        return [];
      }

      // Extract categories from data.category and tags
      const categories = new Set<string>();

      (data as GameContentRow[] || []).forEach(row => {
        // Try data.category first
        if (row.data?.category) {
          categories.add(row.data.category as string);
        }
        // Also check tags (excluding common ones)
        (row.tags || []).forEach(tag => {
          const lowerTag = tag.toLowerCase();
          if (!['trivia', 'ddf', 'question'].includes(lowerTag)) {
            categories.add(tag);
          }
        });
      });

      const result = Array.from(categories).sort();
      console.log(`[Supabase] Fetched ${result.length} categories (language: ${language || 'all'})`);
      return result;
    } catch (error) {
      console.error('[Supabase] Exception fetching categories:', error);
      return [];
    }
  }
}

// Export singleton instance
export const supabaseService = new SupabaseService();
