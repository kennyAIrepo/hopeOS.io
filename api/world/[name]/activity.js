/**
 * hopeOS — per-world live activity log (Vercel Blob).
 * Records every "ask the world" turn so the world's owner can watch real visitor
 * conversations live. Each event is written as its OWN immutable blob, so many
 * users writing at once never clobber each other (no read-modify-write race).
 *
 *   POST /api/world/<name>/activity   body { sessionId, role, text }  → appends one event
 *   GET  /api/world/<name>/activity[?limit=N&since=<ts>]              → recent events, oldest→newest
 *
 * Storage path:  worlds/<name>/activity/<ts>-<rand>.json
 * ts is zero-padded so a prefix list sorts chronologically by pathname.
 */
import { put, list } from '@vercel/blob';
import { randomUUID } from 'crypto';
import { blobToken } from '../../_blob.js';
import { requireAdmin } from '../../_admin.js';

function slugify(name) {
  return String(name || '').trim().replace(/[^\w-]+/g, '_').slice(0, 80);
}
const pad = (n) => String(n).padStart(16, '0');   // lexical-sortable timestamp

async function rawBody(req) {
  if (req.body) {
    if (typeof req.body === 'string') return req.body;
    if (Buffer.isBuffer(req.body)) return req.body.toString('utf8');
    return JSON.stringify(req.body);
  }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

export default async function handler(req, res) {
  const name = slugify(req.query.name);
  if (!name) { res.status(400).json({ error: 'bad world name' }); return; }
  const dir = `worlds/${name}/activity/`;

  const token = blobToken();
  if (!token) { res.status(500).json({ error: 'no Vercel Blob token on the server' }); return; }

  try {
    if (req.method === 'POST') {
      let body = {};
      try { body = JSON.parse(await rawBody(req)) || {}; } catch { /* ignore */ }
      const role = body.role === 'agent' ? 'agent' : 'user';
      const text = String(body.text == null ? '' : body.text).slice(0, 4000);
      if (!text) { res.status(400).json({ error: 'empty text' }); return; }
      const ts = Date.now();
      const ev = { ts, role, text, sessionId: String(body.sessionId || '').slice(0, 64) || 'anon' };
      await put(`${dir}${pad(ts)}-${randomUUID().slice(0, 8)}.json`, JSON.stringify(ev), {
        access: 'public',
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: 'application/json',
        token,
      });
      res.status(200).json({ ok: true });
    } else if (req.method === 'GET') {
      if (!requireAdmin(req, res)) return;                 // chat logs are owner-only
      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 500);
      const since = parseInt(req.query.since, 10) || 0;
      const { blobs } = await list({ prefix: dir, limit: 1000, token });
      // pathnames sort chronologically; take the newest `limit`, then re-sort oldest→newest.
      const recent = blobs.sort((a, b) => a.pathname.localeCompare(b.pathname)).slice(-limit);
      const events = (await Promise.all(recent.map(async (b) => {
        try {
          const r = await fetch(b.url + (b.url.includes('?') ? '&' : '?') + 'v=' + b.pathname, { cache: 'no-store' });
          const ev = await r.json();
          ev.id = b.pathname.slice(dir.length).replace(/\.json$/, '');
          return ev;
        } catch { return null; }
      }))).filter(ev => ev && ev.ts > since).sort((a, b) => a.ts - b.ts);
      res.setHeader('cache-control', 'no-store, max-age=0, must-revalidate');
      res.status(200).json({ world: name, count: events.length, events });
    } else {
      res.status(405).json({ error: 'GET or POST' });
    }
  } catch (e) {
    res.status(502).json({ error: 'blob error: ' + e.message });
  }
}
