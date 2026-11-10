import { describe, expect, it } from 'vitest';

import { createLogger, isValidEventName, type LogSink } from '../../src/logging/logger.js';
import { encodeFamilySeed, fixedEntropy, SECP256K1_SEED_PREFIX } from '../helpers/xrpl-fixtures.js';

const SEED = encodeFamilySeed(SECP256K1_SEED_PREFIX, fixedEntropy(33));
const FIXED_TIME = new Date('2026-11-10T10:00:00Z');

class MemorySink implements LogSink {
  readonly lines: string[] = [];
  write(line: string): void {
    this.lines.push(line);
  }
  records(): Record<string, unknown>[] {
    return this.lines.map((line) => JSON.parse(line) as Record<string, unknown>);
  }
}

function makeLogger(sink: LogSink, minLevel?: 'debug' | 'info' | 'warn' | 'error') {
  return createLogger({
    service: 'warden',
    sink,
    clock: () => FIXED_TIME,
    ...(minLevel === undefined ? {} : { minLevel }),
  });
}

describe('logger records', () => {
  it('writes one JSON line per call with time, level, service and event', () => {
    const sink = new MemorySink();
    makeLogger(sink).info('payment.held', { reason: 'DUPLICATE' });

    expect(sink.lines).toHaveLength(1);
    expect(sink.records()).toEqual([
      {
        reason: 'DUPLICATE',
        time: '2026-11-10T10:00:00.000Z',
        level: 'info',
        service: 'warden',
        event: 'payment.held',
      },
    ]);
  });

  it('lets the reserved keys win over caller fields of the same name', () => {
    const sink = new MemorySink();
    makeLogger(sink).error('warden.pause', { level: 'debug', event: 'spoofed', time: 'then' });

    const [record] = sink.records();
    expect(record?.['level']).toBe('error');
    expect(record?.['event']).toBe('warden.pause');
    expect(record?.['time']).toBe('2026-11-10T10:00:00.000Z');
  });

  it('drops records below the minimum level, and keeps the default minimum at info', () => {
    const sink = new MemorySink();
    const logger = makeLogger(sink);
    logger.debug('detail.noise');
    logger.info('kept.info');
    expect(sink.records().map((record) => record['event'])).toEqual(['kept.info']);

    const verbose = new MemorySink();
    makeLogger(verbose, 'debug').debug('detail.kept');
    expect(verbose.lines).toHaveLength(1);
  });

  it('never writes a secret from a field, a message or the service name', () => {
    const sink = new MemorySink();
    const logger = createLogger({
      service: 'warden owner jane.doe@example.com',
      sink,
      clock: () => FIXED_TIME,
    });
    logger.warn('signing.attempt', {
      seed: SEED,
      note: `retry with ${SEED}`,
      amountMinor: 1250050,
    });

    const output = sink.lines.join('\n');
    expect(output).not.toContain(SEED);
    expect(output).not.toContain('jane.doe@example.com');
    expect(output).toContain('[REDACTED:field]');
    expect(output).toContain('"amountMinor":1250050');
  });

  it('records an invalid event name as a fixed event, without echoing the rejected name', () => {
    const sink = new MemorySink();
    makeLogger(sink).info(`payment held ${SEED}`);

    const [record] = sink.records();
    expect(record?.['event']).toBe('logger.invalid_event');
    expect(sink.lines.join('\n')).not.toContain(SEED);
  });

  it('handles circular fields without failing', () => {
    const sink = new MemorySink();
    const loop: Record<string, unknown> = { name: 'loop' };
    loop['self'] = loop;
    makeLogger(sink).info('graph.cycle', { loop });

    expect(sink.records()[0]).toMatchObject({ loop: { name: 'loop', self: '[Circular]' } });
  });

  it('still writes the record when a field getter throws', () => {
    const sink = new MemorySink();
    const hostile = {
      get explode(): string {
        throw new Error('boom');
      },
    };
    makeLogger(sink).info('hostile.field', { hostile });

    expect(sink.records()[0]).toMatchObject({ hostile: { explode: '[Unreadable]' } });
  });
});

describe('logger never fails the caller', () => {
  it('does not throw when the sink throws, and retries once with a minimal line', () => {
    let calls = 0;
    const flaky: LogSink = {
      write(line) {
        calls++;
        if (calls === 1) throw new Error('disk full');
        expect(line).toContain('logger.failed');
      },
    };
    expect(() => {
      makeLogger(flaky).error('payment.failed', { amountMinor: 1 });
    }).not.toThrow();
    expect(calls).toBe(2);
  });

  it('does not leak a sensitive service name in the emergency fallback record', () => {
    const sink = new MemorySink();
    let attempts = 0;
    const firstWriteFails: LogSink = {
      write(line) {
        attempts++;
        if (attempts === 1) throw new Error('sink unavailable');
        sink.write(line);
      },
    };
    const logger = createLogger({
      service: `warden jane.doe@example.com ${SEED}`,
      sink: firstWriteFails,
      clock: () => FIXED_TIME,
    });
    expect(() => {
      logger.error('payment.failed');
    }).not.toThrow();
    expect(attempts).toBe(2);
    expect(sink.lines).toHaveLength(1);
    expect(sink.lines[0]).not.toContain(SEED);
    expect(sink.lines[0]).not.toContain('jane.doe@example.com');
    expect(sink.records()[0]).toEqual({
      level: 'error',
      service: 'logger',
      event: 'logger.failed',
    });
  });

  it('does not throw when the sink keeps failing', () => {
    const broken: LogSink = {
      write() {
        throw new Error('gone');
      },
    };
    expect(() => {
      makeLogger(broken).error('payment.failed');
    }).not.toThrow();
  });
});

describe('event names', () => {
  it.each(['payment.held', 'warden.pause_all', 'a', 'x1.y2'])('accepts %s', (name) => {
    expect(isValidEventName(name)).toBe(true);
  });

  it.each([
    '',
    'Payment',
    'payment..held',
    'payment held',
    '.leading',
    'trailing.',
    '1abc',
    'a'.repeat(121),
  ])('rejects %j', (name) => {
    expect(isValidEventName(name)).toBe(false);
  });
});
