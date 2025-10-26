import Joi from 'joi';
import type { ValidationResult } from '../types/core.js';

/**
 * Unified Validation Service
 *
 * Provides common validation and sanitization functions used by all games:
 * - Room code validation
 * - Player name validation/sanitization
 * - Chat message validation/sanitization
 * - Input sanitization
 *
 * Uses Joi for schema validation and custom sanitization functions.
 */
export class ValidationService {
  // Validation schemas
  private schemas = {
    roomCode: Joi.string()
      .length(6)
      .uppercase()
      .pattern(/^[A-Z0-9]{6}$/)
      .required(),

    playerName: Joi.string()
      .min(1)
      .max(20)
      .trim()
      .pattern(/^[a-zA-Z0-9\s\-_]+$/)
      .required(),

    chatMessage: Joi.string().min(1).max(500).trim().required(),

    roomSettings: Joi.object({
      minPlayers: Joi.number().integer().min(1).max(20).default(2),
      maxPlayers: Joi.number().integer().min(1).max(20).default(8),
      gameSpecific: Joi.object().optional(),
    }),
  };

  /**
   * Validate room code
   * Format: 6 uppercase alphanumeric characters (e.g., 'ABC123')
   */
  validateRoomCode(code: string): ValidationResult {
    const { error, value } = this.schemas.roomCode.validate(code);

    if (error) {
      return {
        isValid: false,
        error: 'Room code must be 6 uppercase alphanumeric characters',
      };
    }

    return {
      isValid: true,
      sanitizedValue: value,
    };
  }

  /**
   * Validate and sanitize player name
   * - 1-20 characters
   * - Letters, numbers, spaces, hyphens, underscores only
   * - Trimmed whitespace
   */
  validatePlayerName(name: string): ValidationResult {
    const { error, value } = this.schemas.playerName.validate(name);

    if (error) {
      return {
        isValid: false,
        error: 'Player name must be 1-20 characters (letters, numbers, spaces, - or _ only)',
      };
    }

    // Additional sanitization
    const sanitized = this.sanitizeInput(value);

    return {
      isValid: true,
      sanitizedValue: sanitized,
    };
  }

  /**
   * Validate and sanitize chat message
   * - 1-500 characters
   * - Trimmed whitespace
   * - XSS protection
   */
  validateChatMessage(message: string): ValidationResult {
    const { error, value } = this.schemas.chatMessage.validate(message);

    if (error) {
      return {
        isValid: false,
        error: 'Message must be 1-500 characters',
      };
    }

    // Sanitize for XSS
    const sanitized = this.sanitizeInput(value);

    // Check for spam patterns (optional)
    if (this.isSpam(sanitized)) {
      return {
        isValid: false,
        error: 'Message appears to be spam',
      };
    }

    return {
      isValid: true,
      sanitizedValue: sanitized,
    };
  }

  /**
   * Validate room settings
   */
  validateRoomSettings(settings: any): ValidationResult {
    const { error, value } = this.schemas.roomSettings.validate(settings);

    if (error) {
      return {
        isValid: false,
        error: error.details[0].message,
      };
    }

    // Ensure minPlayers <= maxPlayers
    if (value.minPlayers > value.maxPlayers) {
      return {
        isValid: false,
        error: 'minPlayers cannot be greater than maxPlayers',
      };
    }

    return {
      isValid: true,
      sanitizedValue: value,
    };
  }

  /**
   * Generic input sanitization (XSS protection)
   */
  sanitizeInput(input: string): string {
    return input
      .trim()
      .replace(/[<>]/g, '') // Remove < and > to prevent HTML injection
      .replace(/javascript:/gi, '') // Remove javascript: protocol
      .replace(/on\w+=/gi, ''); // Remove event handlers like onclick=
  }

  /**
   * Generate random room code
   * Format: 6 uppercase alphanumeric characters
   */
  generateRoomCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Excluding ambiguous chars
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }

  /**
   * Basic spam detection (can be enhanced)
   */
  private isSpam(message: string): boolean {
    // Check for repeated characters (e.g., "aaaaaaaaaa")
    if (/(.)\1{9,}/.test(message)) {
      return true;
    }

    // Check for all caps with length > 50
    if (message.length > 50 && message === message.toUpperCase()) {
      return true;
    }

    // Check for common spam patterns
    const spamPatterns = [
      /\b(buy|cheap|discount|offer|click here|free money)\b/i,
      /\b(viagra|cialis|pharmacy)\b/i,
      /http[s]?:\/\//i, // URLs (optional: block all URLs in chat)
    ];

    return spamPatterns.some((pattern) => pattern.test(message));
  }

  /**
   * Validate game-specific data using custom Joi schema
   */
  validateCustom(data: any, schema: Joi.Schema): ValidationResult {
    const { error, value } = schema.validate(data);

    if (error) {
      return {
        isValid: false,
        error: error.details[0].message,
      };
    }

    return {
      isValid: true,
      sanitizedValue: value,
    };
  }

  /**
   * Rate limiting check (simple implementation)
   * Can be enhanced with Redis or similar for distributed rate limiting
   */
  private rateLimitCache = new Map<string, { count: number; resetAt: number }>();

  checkRateLimit(identifier: string, maxRequests: number, windowMs: number): boolean {
    const now = Date.now();
    const record = this.rateLimitCache.get(identifier);

    if (!record || now > record.resetAt) {
      // First request or window expired
      this.rateLimitCache.set(identifier, {
        count: 1,
        resetAt: now + windowMs,
      });
      return true;
    }

    if (record.count >= maxRequests) {
      // Rate limit exceeded
      return false;
    }

    // Increment count
    record.count++;
    return true;
  }

  /**
   * Clean up old rate limit records (call periodically)
   */
  cleanupRateLimits(): void {
    const now = Date.now();
    for (const [key, record] of this.rateLimitCache.entries()) {
      if (now > record.resetAt) {
        this.rateLimitCache.delete(key);
      }
    }
  }
}

// Singleton instance
export const validationService = new ValidationService();

// Cleanup rate limits every 5 minutes
setInterval(() => {
  validationService.cleanupRateLimits();
}, 5 * 60 * 1000);
