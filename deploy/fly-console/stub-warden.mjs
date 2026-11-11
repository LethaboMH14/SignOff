// Demo stub for the simulated replay on Fly only. It is NOT the Warden: it keeps state in memory and accepts any credentials.
import http from 'node:http';
const state = {
  paused: false,
  rev: 1,
  limits: { perPaymentMinor: 500000, supplierDailyMinor: 1000000, dailyTotalMinor: 2000000 },
  pending: null,
};
const send = (res, code, body) => {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};
const view = () => ({
  paused: state.paused,
  policyVersion: `2026-11-11.${state.rev}`,
  limits: state.limits,
  usageToday: { day: '2026-11-11', totalMinor: 0 },
  pendingLimitChange: state.pending,
});
http
  .createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const p = new URL(req.url, 'http://x').pathname;
      let body = {};
      try {
        body = raw ? JSON.parse(raw) : {};
      } catch {}
      if (req.method === 'GET') {
        if (p === '/v1/health')
          return send(res, 200, {
            paused: state.paused,
            policyVersion: view().policyVersion,
            version: 'demo-stub',
            ready: true,
          });
        if (p === '/v1/ops/overview') return send(res, 200, view());
        if (p === '/v1/ops/proposals') return send(res, 200, { proposals: [] });
        if (p === '/v1/ops/suppliers') return send(res, 200, { suppliers: [] });
        return send(res, 404, { error: 'not found' });
      }
      if (p === '/v1/control/pause' || p === '/v1/control/resume') {
        state.paused = p.endsWith('pause');
        return send(res, 200, { paused: state.paused });
      }
      if (p === '/v1/policy/limits') {
        const next = { ...state.limits, ...body };
        const raises = Object.keys(next).some((k) => next[k] > state.limits[k]);
        if (raises) {
          state.pending = {
            requestId: '11111111-1111-4111-8111-111111111111',
            requestedBy: 'operator-alice',
            requestedAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 864e5).toISOString(),
            ...next,
          };
          return send(res, 200, {
            applied: false,
            requestId: state.pending.requestId,
            expiresAt: state.pending.expiresAt,
          });
        }
        state.limits = next;
        state.pending = null;
        state.rev += 1;
        return send(res, 200, { applied: true, policyVersion: view().policyVersion });
      }
      if (/\/approve$/.test(p)) {
        if (state.pending) {
          const { requestId, requestedBy, requestedAt, expiresAt, ...l } = state.pending;
          state.limits = l;
          state.pending = null;
          state.rev += 1;
        }
        return send(res, 200, { policyVersion: view().policyVersion });
      }
      send(res, 404, { error: 'not found' });
    });
  })
  .listen(8790, '127.0.0.1', () => console.log('stub warden on 8790'));
