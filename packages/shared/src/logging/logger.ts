import { redactText, redactValue } from './redact.js';

/**
 * A structured logger that redacts before it writes and never throws. Each record is one JSON line:
 * the caller's fields first, then the reserved keys, which always win. A log call cannot fail the
 * payment it is describing, and a broken sink cannot take the service down.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_RANK: ReadonlyMap<LogLevel, number> = new Map<LogLevel, number>([
  ['debug', 10],
  ['info', 20],
  ['warn', 30],
  ['error', 40],
]);

/** Event names are dotted lower-case words, e.g. payment.held or warden.pause. */
const EVENT_PART = /^[a-z][a-z0-9_]*$/;

export interface LogSink {
  write(line: string): void;
}

export interface LoggerOptions {
  readonly service: string;
  readonly minLevel?: LogLevel;
  readonly sink?: LogSink;
  readonly clock?: () => Date;
}

export interface Logger {
  debug(event: string, fields?: Readonly<Record<string, unknown>>): void;
  info(event: string, fields?: Readonly<Record<string, unknown>>): void;
  warn(event: string, fields?: Readonly<Record<string, unknown>>): void;
  error(event: string, fields?: Readonly<Record<string, unknown>>): void;
}

export function isValidEventName(event: string): boolean {
  return (
    event.length > 0 &&
    event.length <= 120 &&
    event.split('.').every((part) => EVENT_PART.test(part))
  );
}

const consoleSink: LogSink = {
  write(line) {
    process.stdout.write(`${line}\n`);
  },
};

export function createLogger(options: LoggerOptions): Logger {
  const minimum = LEVEL_RANK.get(options.minLevel ?? 'info') ?? 0;
  const sink = options.sink ?? consoleSink;
  const clock = options.clock ?? (() => new Date());

  function emit(
    level: LogLevel,
    event: string,
    fields: Readonly<Record<string, unknown>> | undefined,
  ): void {
    if ((LEVEL_RANK.get(level) ?? 0) < minimum) return;
    try {
      const safeEvent = isValidEventName(event) ? event : 'logger.invalid_event';
      const redactedFields = fields === undefined ? {} : redactValue(fields);
      const record = {
        ...(typeof redactedFields === 'object' && redactedFields !== null ? redactedFields : {}),
        time: clock().toISOString(),
        level,
        service: redactText(options.service),
        event: safeEvent,
      };
      sink.write(JSON.stringify(record));
    } catch {
      // The log call must never fail the work it describes. Try a minimal line, then give up silently.
      try {
        sink.write(JSON.stringify({ level, service: options.service, event: 'logger.failed' }));
      } catch {
        // A sink that throws twice is not something a log call can fix.
      }
    }
  }

  return {
    debug: (event, fields) => {
      emit('debug', event, fields);
    },
    info: (event, fields) => {
      emit('info', event, fields);
    },
    warn: (event, fields) => {
      emit('warn', event, fields);
    },
    error: (event, fields) => {
      emit('error', event, fields);
    },
  };
}
