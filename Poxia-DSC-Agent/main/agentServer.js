const http = require('http');

// The local door the LIMS web page uses to ask this agent to sign. It listens on
// this PC only (127.0.0.1), answers only the LIMS addresses allowed in Settings
// (browser Origin check, plus Host check against DNS-rebinding), and every
// signing still needs its one-time job token from the server.
const MAX_BODY = 16 * 1024;

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(Object.assign(new Error('Request too large'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch { reject(Object.assign(new Error('Invalid JSON'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

function createAgentServer({ config, tokens, signing, version }) {
  const server = http.createServer(async (req, res) => {
    const cfg = config.get();
    const send = (status, body, extra = {}) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra });
      res.end(JSON.stringify(body));
    };

    const host = String(req.headers.host || '').toLowerCase();
    if (host !== `127.0.0.1:${cfg.port}` && host !== `localhost:${cfg.port}`) return send(403, { error: 'Unexpected host' });

    const origin = req.headers.origin;
    const allowed = !!origin && cfg.allowedOrigins.includes(origin);
    const cors = allowed ? {
      'Access-Control-Allow-Origin': origin, Vary: 'Origin', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Private-Network': 'true', 'Access-Control-Max-Age': '600',
    } : {};
    const reply = (status, body) => send(status, body, cors);

    if (req.method === 'OPTIONS') { res.writeHead(allowed ? 204 : 403, cors); return res.end(); }

    const url = new URL(req.url, `http://${host}`);
    try {
      // Anyone may ask whether the agent is running (lets the page show "install / start the agent").
      if (req.method === 'GET' && url.pathname === '/health') return reply(200, { ok: true, name: 'Poxia DSC Agent', version, busy: signing.isBusy() });

      // Everything else needs a LIMS page the agent has been told to trust.
      if (!allowed) return send(403, { error: 'This web page is not allowed to use the Poxia DSC Agent. Add its address in the agent settings.' });

      if (req.method === 'GET' && url.pathname === '/version') return reply(200, { version });
      if (req.method === 'GET' && url.pathname === '/tokens') {
        return reply(200, { tokens: tokens.tokens.map((t) => ({ id: t.id, label: t.label, manufacturer: t.manufacturer, model: t.model })) });
      }
      if (req.method === 'GET' && url.pathname === '/certificates') {
        const list = tokens.certificates(url.searchParams.get('token')).map((c) => ({ id: c.id, commonName: c.commonName, issuer: c.issuer, serial: c.serial, notAfter: c.notAfter, usable: c.usable }));
        return reply(200, { certificates: list });
      }
      if (req.method === 'POST' && url.pathname === '/sign') {
        const body = await readJson(req);
        return reply(202, signing.accept({ server: body.server, jobId: body.jobId, token: body.token, origin }));
      }
      const m = /^\/jobs\/([0-9a-f-]{36})$/i.exec(url.pathname);
      if (req.method === 'GET' && m) {
        const snap = signing.snapshot();
        if (!snap || snap.id !== m[1]) return reply(404, { error: 'Unknown job' });
        return reply(200, { id: snap.id, status: snap.status, message: snap.message, error: snap.error });
      }
      if (req.method === 'POST' && url.pathname === '/cancel') return reply(200, await signing.cancel());
      return reply(404, { error: 'Not found' });
    } catch (e) {
      const status = e.status && e.status >= 400 && e.status < 600 ? e.status : 500;
      return reply(status, { error: e.message, code: e.code });
    }
  });

  return {
    listen: () => new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(config.get().port, '127.0.0.1', resolve);
    }),
    close: () => new Promise((resolve) => server.close(resolve)),
    server,
  };
}

module.exports = { createAgentServer };
