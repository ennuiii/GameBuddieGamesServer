import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { WordPair, Question } from '../types/types.js';

/**
 * SupabaseService - Database integration for SUSD (BadActor)
 *
 * Uses the unified game_content table for word pairs and questions.
 * Falls back gracefully to local content.json if Supabase credentials not provided.
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
    similar?: string;
    type?: string;
    category?: string;
    imposterHint?: string;
    originalId?: string;
    [key: string]: unknown;
  };
  created_at: string;
  updated_at: string;
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
        console.log('[SUSD Supabase] ✅ Connected to Supabase');
      } catch (error) {
        console.log('[SUSD Supabase] ⚠️ Failed to initialize Supabase:', error);
        this.isAvailable = false;
      }
    } else {
      console.log('[SUSD Supabase] ℹ️ Supabase credentials not provided - using local content.json');
    }
  }

  /**
   * Check if Supabase is available
   */
  public isSupabaseAvailable(): boolean {
    return this.isAvailable;
  }

  /**
   * Fetch word pairs from game_content table
   * Returns { wordPairs, classicWords } for backward compatibility
   * @param language - Optional language filter ('en' | 'de'). Defaults to 'en' if not provided.
   */
  async getWordPairs(language?: 'en' | 'de'): Promise<{ wordPairs: WordPair[]; classicWords: string[] }> {
    if (!this.isAvailable || !this.supabase) {
      console.log('[SUSD Supabase] Supabase not available for word pairs');
      return { wordPairs: [], classicWords: [] };
    }

    const lang = language || 'en'; // Default to English

    try {
      const { data, error } = await this.supabase
        .from('game_content')
        .select('*')
        .contains('game_ids', ['badactor'])
        .contains('tags', ['word_pair'])
        .eq('is_verified', true)
        .eq('language', lang); // Filter by language

      if (error) {
        console.error('[SUSD Supabase] Error fetching word pairs:', error);
        return { wordPairs: [], classicWords: [] };
      }

      // Convert to WordPair format
      const wordPairs: WordPair[] = (data as GameContentRow[] || []).map(row => ({
        normal: row.text_content,
        similar: (row.data?.similar as string) || row.text_content
      }));

      // Classic words are just the "normal" words from word pairs
      const classicWords = wordPairs.map(wp => wp.normal);

      console.log(`[SUSD Supabase] Fetched ${wordPairs.length} word pairs from game_content (language: ${lang})`);
      return { wordPairs, classicWords };
    } catch (error) {
      console.error('[SUSD Supabase] Exception fetching word pairs:', error);
      return { wordPairs: [], classicWords: [] };
    }
  }

  /**
   * Fetch questions from game_content table
   * Returns { personalQuestions, comparativeQuestions } for backward compatibility
   * @param language - Optional language filter ('en' | 'de'). Defaults to 'en' if not provided.
   */
  async getQuestions(language?: 'en' | 'de'): Promise<{ personalQuestions: Question[]; comparativeQuestions: Question[] }> {
    if (!this.isAvailable || !this.supabase) {
      console.log('[SUSD Supabase] Supabase not available for questions');
      return { personalQuestions: [], comparativeQuestions: [] };
    }

    const lang = language || 'en'; // Default to English

    try {
      const { data, error } = await this.supabase
        .from('game_content')
        .select('*')
        .contains('game_ids', ['badactor'])
        .contains('tags', ['question'])
        .eq('is_verified', true)
        .eq('language', lang); // Filter by language

      if (error) {
        console.error('[SUSD Supabase] Error fetching questions:', error);
        return { personalQuestions: [], comparativeQuestions: [] };
      }

      const personalQuestions: Question[] = [];
      const comparativeQuestions: Question[] = [];

      (data as GameContentRow[] || []).forEach(row => {
        const question: Question = {
          id: row.data?.originalId as string || row.id,
          text: row.text_content,
          type: (row.data?.type as 'personal' | 'comparative') || 'personal',
          category: (row.data?.category as string) || 'general',
          imposterHint: row.data?.imposterHint as string
        };

        if (row.tags.includes('personal') || row.data?.type === 'personal') {
          personalQuestions.push(question);
        } else if (row.tags.includes('comparative') || row.data?.type === 'comparative') {
          comparativeQuestions.push(question);
        }
      });

      console.log(`[SUSD Supabase] Fetched ${personalQuestions.length} personal and ${comparativeQuestions.length} comparative questions (language: ${lang})`);
      return { personalQuestions, comparativeQuestions };
    } catch (error) {
      console.error('[SUSD Supabase] Exception fetching questions:', error);
      return { personalQuestions: [], comparativeQuestions: [] };
    }
  }

  /**
   * Fetch all content (word pairs and questions) in a single call
   * @param language - Optional language filter ('en' | 'de'). Defaults to 'en' if not provided.
   */
  async getAllContent(language?: 'en' | 'de'): Promise<{
    wordPairs: WordPair[];
    classicWords: string[];
    personalQuestions: Question[];
    comparativeQuestions: Question[];
  }> {
    const [wordData, questionData] = await Promise.all([
      this.getWordPairs(language),
      this.getQuestions(language)
    ]);

    return {
      ...wordData,
      ...questionData
    };
  }
}

// Export singleton instance
export const supabaseService = new SupabaseService();
