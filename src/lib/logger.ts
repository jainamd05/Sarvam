/**
 * Development-only logger utility for ELYSIA.
 * Wraps console methods to only log in development mode, keeping production clean.
 * Supports prefixed logging with context-aware colors and formatting.
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogOptions {
  prefix?: string;
  color?: string;
}

const isDev = process.env.NODE_ENV === 'development' || typeof window !== 'undefined';

/**
 * Format a log message with optional prefix and styling.
 */
function formatMessage(level: LogLevel, message: any, prefix?: string): string {
  const timestamp = new Date().toISOString().split('T')[1].slice(0, 8);
  const levelUpper = level.toUpperCase().padEnd(5);
  const prefixStr = prefix ? `[${prefix}]` : '';
  return `[${timestamp}] ${levelUpper} ${prefixStr}`.trim() + (prefixStr ? ' ' : '') + message;
}

/**
 * Logger instance with development-only output.
 */
export const logger = {
  /**
   * Debug-level logging (lowest priority).
   */
  debug(message: any, options?: LogOptions): void {
    if (!isDev) return;
    const formatted = formatMessage('debug', message, options?.prefix);
    console.debug(formatted);
  },

  /**
   * Info-level logging (standard).
   */
  info(message: any, options?: LogOptions): void {
    if (!isDev) return;
    const formatted = formatMessage('info', message, options?.prefix);
    console.info(formatted);
  },

  /**
   * Warning-level logging.
   */
  warn(message: any, options?: LogOptions): void {
    if (!isDev) return;
    const formatted = formatMessage('warn', message, options?.prefix);
    console.warn(formatted);
  },

  /**
   * Error-level logging (highest priority, always shown).
   */
  error(message: any, error?: Error | unknown, options?: LogOptions): void {
    if (!isDev) return;
    const formatted = formatMessage('error', message, options?.prefix);
    console.error(formatted);
    if (error) {
      console.error(error instanceof Error ? error.stack : error);
    }
  },

  /**
   * Log an object or data structure (pretty-printed).
   */
  table(data: any, options?: LogOptions): void {
    if (!isDev) return;
    const prefix = options?.prefix ? `[${options.prefix}] ` : '';
    console.log(prefix + 'Data:');
    console.table(data);
  },

  /**
   * Group related logs together.
   */
  group(label: string, fn: () => void): void {
    if (!isDev) return;
    console.group(label);
    fn();
    console.groupEnd();
  },

  /**
   * Time a code block execution.
   */
  time(label: string, fn: () => void): void {
    if (!isDev) return;
    console.time(label);
    fn();
    console.timeEnd(label);
  },

  /**
   * Async version of time.
   */
  async timeAsync(label: string, fn: () => Promise<void>): Promise<void> {
    if (!isDev) {
      await fn();
      return;
    }
    console.time(label);
    await fn();
    console.timeEnd(label);
  },
};

/**
 * Create a scoped logger with a consistent prefix.
 */
export function createLogger(scope: string) {
  return {
    debug: (msg: any) => logger.debug(msg, { prefix: scope }),
    info: (msg: any) => logger.info(msg, { prefix: scope }),
    warn: (msg: any) => logger.warn(msg, { prefix: scope }),
    error: (msg: any, err?: Error | unknown) => logger.error(msg, err, { prefix: scope }),
    table: (data: any) => logger.table(data, { prefix: scope }),
  };
}

export default logger;
