import { createClient, SupabaseClient } from '@supabase/supabase-js';

/**
 * SupabaseService - Optional database integration for DDF
 *
 * Provides READ capability for:
 * - Questions (read from Supabase if available)
 * - Game state persistence (save/load game progress)
 * - Event logging (track game activities)
 *
 * Falls back gracefully to local storage if Supabase credentials not provided.
 */
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
   * Fetch all questions from Supabase
   *
   * Expected table schema:
   * - id: UUID
   * - question_text: string
   * - answer: string
   * - category: string
   * - difficulty: string (optional)
   * - is_bad: boolean (default: false)
   * - created_at: timestamp
   * - updated_at: timestamp
   */
  async getQuestions(): Promise<any[]> {
    if (!this.isAvailable || !this.supabase) {
      console.log('[Supabase] Supabase not available, returning empty array');
      return [];
    }

    try {
      const { data, error } = await this.supabase
        .from('questions')
        .select('*')
        .eq('is_bad', false) // Only fetch valid questions
        .order('created_at', { ascending: false });

      if (error) {
        console.error('[Supabase] Error fetching questions:', error);
        return [];
      }

      console.log(`[Supabase] Fetched ${data?.length || 0} questions from database`);
      return data || [];
    } catch (error) {
      console.error('[Supabase] Exception fetching questions:', error);
      return [];
    }
  }

  /**
   * Fetch questions by category from Supabase
   */
  async getQuestionsByCategory(category: string): Promise<any[]> {
    if (!this.isAvailable || !this.supabase) {
      return [];
    }

    try {
      const { data, error } = await this.supabase
        .from('questions')
        .select('*')
        .eq('category', category)
        .eq('is_bad', false)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('[Supabase] Error fetching questions by category:', error);
        return [];
      }

      return data || [];
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
    gameState: any,
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
  async loadGameState(roomCode: string): Promise<any | null> {
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
    eventData: any
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
   * Mark question as bad in Supabase
   */
  async markQuestionAsBad(questionId: string): Promise<boolean> {
    if (!this.isAvailable || !this.supabase) {
      return false;
    }

    try {
      const { error } = await this.supabase
        .from('questions')
        .update({ is_bad: true })
        .eq('id', questionId);

      if (error) {
        console.error('[Supabase] Error marking question as bad:', error);
        return false;
      }

      console.log(`[Supabase] Marked question ${questionId} as bad`);
      return true;
    } catch (error) {
      console.error('[Supabase] Exception marking question as bad:', error);
      return false;
    }
  }

  /**
   * Get unique categories from Supabase questions
   */
  async getCategories(): Promise<string[]> {
    if (!this.isAvailable || !this.supabase) {
      return [];
    }

    try {
      const { data, error } = await this.supabase
        .from('questions')
        .select('category')
        .eq('is_bad', false)
        .order('category');

      if (error) {
        console.error('[Supabase] Error fetching categories:', error);
        return [];
      }

      // Extract unique categories
      const categories = data?.map((q: any) => q.category).filter(Boolean) || [];
      const uniqueCategories = Array.from(new Set(categories)) as string[];

      return uniqueCategories;
    } catch (error) {
      console.error('[Supabase] Exception fetching categories:', error);
      return [];
    }
  }
}

// Export singleton instance
export const supabaseService = new SupabaseService();
