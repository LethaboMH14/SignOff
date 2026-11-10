import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import { z } from 'zod';

import { AuthError, RequestVerifier, type Role, type SignedHeaders } from './auth.js';
import { WardenError, WardenService } from './service.js';

/**
 * The HTTP surface. Agent and operator routes need a signed request; the supplier change route is signed by
 * the supplier's own key inside the body. Errors return a short message and never an internal detail.
 */

const MAX_BODY_BYTES = 64 * 1024;

const CoSignBody = z.strictObject({
  signedBlob: z
    .string()
    .regex(/^[0-9A-Fa-f]+$/)
    .min(2)
    .max(200_000),
});
const ApprovalBody = z.strictObject({ proposal: z.unknown() });
const ChangeBody = z.strictObject({
  request: z.unknown(),
  signature: z.string().min(1).max(200),
});

/** Parses a request body against its schema. A body that does not match is the caller's error, so it is a 400. */
function bodyOf<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new WardenError(400, 'the request does not match the schema');
  }
  return parsed.data;
}

type Handler = (body: unknown, actor: string) => Promise<unknown>;

interface Matched {
  /** The role a signed request must carry. Null means the route authenticates the body itself. */
  readonly role: Role | null;
  readonly handler: Handler;
}

const CO_SIGNATURE_PATH = /^\/v1\/attempts\/([0-9a-f-]{36})\/co-signature$/;
const SUPPLIER_APPROVE_PATH = /^\/v1\/suppliers\/(SUP-[A-Z0-9]{4,16})\/approve$/;
const SUPPLIER_CHANGES_PATH = /^\/v1\/suppliers\/(SUP-[A-Z0-9]{4,16})\/changes$/;
const SUPPLIER_CHANGE_STEP_PATH =
  /^\/v1\/suppliers\/(SUP-[A-Z0-9]{4,16})\/changes\/([0-9a-f-]{36})\/(confirm|approve)$/;

function routeFor(service: WardenService, method: string, path: string): Matched | null {
  if (method !== 'POST') {
    return null;
  }
  if (path === '/v1/proposals') {
    return { role: 'agent', handler: (body) => service.propose(body) };
  }
  const coSignature = CO_SIGNATURE_PATH.exec(path);
  if (coSignature !== null) {
    const attemptId = coSignature[1] ?? '';
    return {
      role: 'agent',
      handler: async (body) => {
        const parsed = bodyOf(CoSignBody, body);
        return service.coSign(attemptId, parsed.signedBlob);
      },
    };
  }
  if (path === '/v1/control/pause' || path === '/v1/control/resume') {
    const paused = path.endsWith('pause');
    return {
      role: 'operator',
      handler: async (_body, actor) => {
        await service.setPaused(paused, actor);
        return { paused };
      },
    };
  }
  if (path === '/v1/policy/limits') {
    return {
      role: 'operator',
      handler: async (body, actor) => ({ policyVersion: await service.setLimits(body, actor) }),
    };
  }
  if (path === '/v1/approvals') {
    return {
      role: 'operator',
      handler: (body, actor) => service.approveProposal(bodyOf(ApprovalBody, body).proposal, actor),
    };
  }
  if (path === '/v1/suppliers') {
    return {
      role: 'operator',
      handler: async (body, actor) => {
        await service.enrolSupplier(body, actor);
        return {};
      },
    };
  }
  return supplierRouteFor(service, path);
}

/** The supplier routes. Each has its own fixed pattern, so a path matches at most one of them. */
function supplierRouteFor(service: WardenService, path: string): Matched | null {
  const approve = SUPPLIER_APPROVE_PATH.exec(path);
  if (approve !== null) {
    const supplierId = approve[1] ?? '';
    return {
      role: 'operator',
      handler: async (_body, actor) => {
        await service.approveSupplier(supplierId, actor);
        return {};
      },
    };
  }
  const changes = SUPPLIER_CHANGES_PATH.exec(path);
  if (changes !== null) {
    const supplierId = changes[1] ?? '';
    return {
      role: null,
      handler: async (body) => {
        const parsed = bodyOf(ChangeBody, body);
        const changeId = await service.requestChange(supplierId, parsed.request, parsed.signature);
        return { changeId };
      },
    };
  }
  const step = SUPPLIER_CHANGE_STEP_PATH.exec(path);
  if (step !== null) {
    const supplierId = step[1] ?? '';
    const changeId = step[2] ?? '';
    if (step[3] === 'confirm') {
      return {
        role: 'operator',
        handler: async (_body, actor) => {
          await service.confirmChange(supplierId, changeId, actor);
          return {};
        },
      };
    }
    return {
      role: 'operator',
      handler: async (_body, actor) => {
        await service.approveChange(supplierId, changeId, actor);
        return {};
      },
    };
  }
  return null;
}

function signedHeadersOf(request: IncomingMessage): SignedHeaders | null {
  const principal = request.headers['x-signoff-principal'];
  const timestamp = request.headers['x-signoff-timestamp'];
  const nonce = request.headers['x-signoff-nonce'];
  const signature = request.headers['x-signoff-signature'];
  if (
    typeof principal !== 'string' ||
    typeof timestamp !== 'string' ||
    typeof nonce !== 'string' ||
    typeof signature !== 'string'
  ) {
    return null;
  }
  return { principal, timestamp, nonce, signature };
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let tooLarge = false;
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        tooLarge = true;
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (tooLarge) {
        reject(new WardenError(413, 'the request body is too large'));
        return;
      }
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    request.on('error', reject);
  });
}

function send(response: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(text),
  });
  response.end(text);
}

function sendError(response: ServerResponse, status: number, message: string): void {
  send(response, status, { error: message });
}

async function handle(
  request: IncomingMessage,
  response: ServerResponse,
  service: WardenService,
  verifier: RequestVerifier,
): Promise<void> {
  const method = request.method ?? '';
  const path = new URL(request.url ?? '/', 'http://localhost').pathname;
  if (method === 'GET' && path === '/v1/health') {
    send(response, 200, service.health());
    return;
  }
  const matched = routeFor(service, method, path);
  if (matched === null) {
    sendError(response, 404, 'not found');
    return;
  }
  const body = await readBody(request);
  let principal = '';
  if (matched.role !== null) {
    principal = verifier.verify({
      method,
      path,
      headers: signedHeadersOf(request),
      body,
      role: matched.role,
    }).id;
  }
  let parsed: unknown;
  try {
    parsed = body === '' ? undefined : (JSON.parse(body) as unknown);
  } catch {
    sendError(response, 400, 'the body is not JSON');
    return;
  }
  const result = await matched.handler(parsed, principal);
  send(response, 200, result);
}

/** Maps any failure to a status. Only WardenError and the authentication check are shown to the caller. */
function failureOf(error: unknown): { status: number; message: string } {
  if (error instanceof WardenError) {
    return { status: error.status, message: error.message };
  }
  if (error instanceof AuthError) {
    return { status: 401, message: error.message };
  }
  return { status: 500, message: 'internal error' };
}

/** The HTTP server for one Warden. It holds no state of its own: every decision goes through the service. */
export function createWardenServer(
  service: WardenService,
  verifier: RequestVerifier,
  onInternalError: (error: unknown) => void,
): Server {
  return createServer((request, response) => {
    handle(request, response, service, verifier).catch((error: unknown) => {
      const failure = failureOf(error);
      if (failure.status === 500) {
        onInternalError(error);
      }
      sendError(response, failure.status, failure.message);
    });
  });
}
