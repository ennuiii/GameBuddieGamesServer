/**
 * Environment-aware logger utility for GameBuddies Server
 *
 * Logging is enabled when DEBUG=true environment variable is set.
 * In production, only errors are logged for visibility.
 *
 * Usage: import { logger } from '../services/logger';
 *        logger.log('[GamePlugin]', 'message', data);
 */
const DEBUG = process.env.DEBUG === 'true' || process.env.NODE_ENV !== 'production';

export const logger = {
  /** Debug logging - only when DEBUG=true or in development */
  log: (...args: unknown[]) => {
    if (DEBUG) console.log(...args);
  },
  /** Error logging - always visible (production issues need visibility) */
  error: (...args: unknown[]) => {
    console.error(...args);
  },
  /** Warning logging - only in debug mode */
  warn: (...args: unknown[]) => {
    if (DEBUG) console.warn(...args);
  },
  /** Info logging - only in debug mode */
  info: (...args: unknown[]) => {
    if (DEBUG) console.info(...args);
  },
  /** Debug flag for conditional logging blocks */
  isDebug: DEBUG,
};
