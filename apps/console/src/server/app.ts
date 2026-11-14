import { readFileSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { basename, extname, resolve, sep } from 'node:path';

import { type ApiContext, callerOf, handleApi } from './api.js';
import { sendJson, SECURITY_HEADERS } from './http.js';
import { mapEventOf } from './map-event.js';
import { SSE_RETRY_LINE, sseEvent } from './sse.js';
import { TransitionTail } from './transitions-tail.js';

export type ConsoleMode = 'simulated' | 'live';

export interface ConsoleOptions {
  /** The agent's transition log. The console only reads it. */
  readonly transitionsPath: string;
  /** Labels the map as a replay of a simulated run, or as a live run. */
  readonly mode: ConsoleMode;
  readonly pollMs: number;
  /** The built web app, or null when only the API is served. */
  readonly staticDir: string | null;
  /** Sign-in, the desk and the changes. Every route except health and the app's own files needs a session. */
  readonly api: ApiContext;
}

const CONTENT_TYPES: ReadonlyMap<string, string> = new Map<string, string>([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.json', 'application/json; charset=utf-8'],
]);

/** The file a request names inside the built web app, or null. A path that leaves that folder is never served. */
function staticFileOf(staticDir: string, pathname: string): string | null {
  let relative: string;
  try {
    relative = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.slice(1));
  } catch {
    return null;
  }
  const root = resolve(staticDir);
  const target = resolve(root, relative);
  if (target !== root && !target.startsWith(root + sep)) {
    return null;
  }
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- the target is inside the built web folder and was checked above
    return statSync(target).isFile() ? target : null;
  } catch {
    return null;
  }
}

function parseLastEventId(value: string | string[] | undefined): number {
  if (typeof value !== 'string') {
    return 0;
  }
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : 0;
}

/**
 * The live stream. It sends the whole log first, then each new line as it is written. A reconnect sends the last id the
 * browser saw, and older records are skipped. A new run starts again at sequence 1, which is sent even after a higher number; a repeat of sequence 1 on reconnect is ignored by the browser.
 */
function streamEvents(
  request: IncomingMessage,
  response: ServerResponse,
  options: ConsoleOptions,
): void {
  const tail = new TransitionTail(options.transitionsPath);
  let lastSent = parseLastEventId(request.headers['last-event-id']);
  response.writeHead(200, {
    ...SECURITY_HEADERS,
    'content-type': 'text/event-stream; charset=utf-8',
    connection: 'keep-alive',
  });
  response.write(SSE_RETRY_LINE);
  response.write(
    sseEvent('hello', null, { mode: options.mode, file: basename(options.transitionsPath) }),
  );
  const pump = (): void => {
    const { records, damaged } = tail.readNew();
    for (const record of records) {
      const newRun = record.seq === 1 && lastSent > 1;
      if (record.seq <= lastSent && !newRun) {
        continue;
      }
      lastSent = record.seq;
      response.write(sseEvent('transition', record.seq, mapEventOf(record)));
    }
    if (damaged > 0) {
      response.write(sseEvent('damaged', null, { count: damaged }));
    }
  };
  pump();
  const timer = setInterval(pump, options.pollMs);
  request.on('close', () => {
    clearInterval(timer);
  });
}

/**
 * The same records as the stream, for hosts that cannot hold a connection open. The browser sends the last sequence
 * number it has, and gets the records after it. If the log starts again at a lower number, every record is sent.
 */
function transitionsSince(
  request: IncomingMessage,
  response: ServerResponse,
  options: ConsoleOptions,
): void {
  const after = parseLastEventId(
    new URL(request.url ?? '/', 'http://localhost').searchParams.get('after') ?? undefined,
  );
  const { records, damaged } = new TransitionTail(options.transitionsPath).readNew();
  const highest = records.reduce((max, record) => Math.max(max, record.seq), 0);
  const restarted = after > highest;
  const sent = records.filter((record) => restarted || record.seq > after);
  sendJson(response, 200, { mode: options.mode, damaged, events: sent.map(mapEventOf) });
}

function serveStatic(response: ServerResponse, path: string): void {
  response.writeHead(200, {
    ...SECURITY_HEADERS,
    'content-type': CONTENT_TYPES.get(extname(path)) ?? 'application/octet-stream',
  });
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- the path comes from staticFileOf, which keeps it inside the built web folder
  response.end(readFileSync(path));
}

/** The console server. It serves the sign-in and the desk API, the event stream and the built web app. It never writes to the agent's log. */
export function createConsoleServer(options: ConsoleOptions): Server {
  return createServer((request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
    if (pathname.startsWith('/api/')) {
      if (pathname === '/api/transitions' && request.method === 'GET') {
        if (callerOf(request, options.api) === null) {
          sendJson(response, 401, { error: 'sign in to continue' });
          return;
        }
        transitionsSince(request, response, options);
        return;
      }
      if (pathname === '/api/events' && request.method === 'GET') {
        if (callerOf(request, options.api) === null) {
          sendJson(response, 401, { error: 'sign in to continue' });
          return;
        }
        streamEvents(request, response, options);
        return;
      }
      handleApi(request, response, pathname, options.api).catch(() => {
        if (!response.headersSent) {
          sendJson(response, 500, { error: 'internal error' });
        } else {
          response.end();
        }
      });
      return;
    }
    if (request.method !== 'GET') {
      sendJson(response, 405, { error: 'method not allowed' });
      return;
    }
    if (options.staticDir !== null) {
      const path = staticFileOf(options.staticDir, pathname);
      if (path !== null) {
        serveStatic(response, path);
        return;
      }
    }
    sendJson(response, 404, { error: 'not found' });
  });
}
