/**
 * hopeOS — bug intake + backlog (Vercel Blob) with auto-filed GitHub issues.
 *
 *   POST /api/bugs   body { world, description, sessionId, meta, worldState, screenshot(dataURL) }
 *        → stores the bug (+ screenshot) in Blob and opens a GitHub issue. Public (any visitor can report).
 *   GET  /api/bugs   (admin only) → every filed bug, newest first, for the dashboard.
 *
 * Env: BLOB_READ_WRITE_TOKEN (auto), GITHUB_TOKEN (PAT w/ repo+issues), GITHUB_REPO
 * (defaults to kennyAIrepo/hopeOSEngine). Without GITHUB_TOKEN the bug is still
 * stored — it just isn't pushed to GitHub (reason is recorded on the bug).
 */
import { put, list } from '@vercel/blob';
import { randomUUID } from 'crypto';
import { blobToken } from './_blob.js';
import { requireAdmin } from './_admin.js';

const GH_REPO = process.env.GITHUB_REPO || 'kennyAIrepo/hopeOSEngine';
const slugify = (s) => String(s || 'unknown').trim().replace(/[^\w-]+/g, '_').slice(0, 80) || 'unknown';
const pad = (n) => String(n).padStart(16, '0');

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

async function fileGitHubIssue(bug) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return { filed: false, reason: 'GITHUB_TOKEN not set' };
  const m = bug.meta || {};
  const title = '🐛 ' + (bug.description || 'world bug').replace(/\s+/g, ' ').slice(0, 90);
  const body = [
    bug.description || '_(no description)_',
    '', '---',
    `**World:** \`${bug.world}\`  ·  [open](https://h0p3.io/world/${bug.world})`,
    `**Session:** \`${bug.sessionId}\`  ·  **When:** ${new Date(bug.ts).toISOString()}`,
    `**Avatar pos:** \`${JSON.stringify(m.pos || null)}\`  ·  **Mode:** ${m.mode || '?'}  ·  **Objects:** ${m.objectCount ?? '?'}`,
    `**Agent:** ${m.ua || '?'}`,
    bug.screenshotUrl ? `\n![screenshot](${bug.screenshotUrl})` : '_(no screenshot)_',
    '',
    '<details><summary>World state snapshot</summary>',
    '',
    '```json',
    JSON.stringify(bug.worldState || {}, null, 2).slice(0, 55000),
    '```',
    '</details>',
    '',
    `<sub>auto-filed by hopeOS bug reporter · bug id \`${bug.id}\`</sub>`,
  ].join('\n');
  try {
    const r = await fetch(`https://api.github.com/repos/${GH_REPO}/issues`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'hopeOS-bugbot',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ title, body, labels: ['world-bug', 'auto-filed'] }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { filed: false, reason: `GitHub ${r.status}: ${j.message || 'error'}` };
    return { filed: true, issueUrl: j.html_url, issueNumber: j.number };
  } catch (e) {
    return { filed: false, reason: 'github fetch error: ' + e.message };
  }
}

export default async function handler(req, res) {
  const token = blobToken();
  try {
    if (req.method === 'POST') {
      if (!token) { res.status(500).json({ error: 'no Vercel Blob token on the server' }); return; }
      let body = {};
      try { body = JSON.parse(await rawBody(req)) || {}; } catch { /* ignore */ }
      const description = String(body.description || '').slice(0, 4000);
      if (!description) { res.status(400).json({ error: 'description required' }); return; }
      const world = slugify(body.world);
      const ts = Date.now();
      const id = `${pad(ts)}-${randomUUID().slice(0, 8)}`;

      // Persist the screenshot as its own public blob, embed its URL in the issue.
      let screenshotUrl = null;
      const shot = String(body.screenshot || '');
      const mm = shot.match(/^data:(image\/\w+);base64,(.+)$/s);
      if (mm) {
        try {
          const ext = mm[1].split('/')[1].replace('jpeg', 'jpg');
          const sb = await put(`bugs/${world}/${id}.${ext}`, Buffer.from(mm[2], 'base64'), {
            access: 'public', addRandomSuffix: false, allowOverwrite: true, contentType: mm[1], token,
          });
          screenshotUrl = sb.url;
        } catch { /* screenshot optional */ }
      }

      const bug = {
        id, ts, world, status: 'open',
        description,
        sessionId: String(body.sessionId || 'anon').slice(0, 64),
        meta: body.meta || {},
        worldState: body.worldState || null,
        screenshotUrl,
      };
      bug.github = await fileGitHubIssue(bug);
      await put(`bugs/${world}/${id}.json`, JSON.stringify(bug), {
        access: 'public', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json', token,
      });
      res.status(200).json({ ok: true, id, filed: !!bug.github.filed, issueUrl: bug.github.issueUrl || null, reason: bug.github.reason || null });
    } else if (req.method === 'GET') {
      if (!requireAdmin(req, res)) return;
      if (!token) { res.status(500).json({ error: 'no Vercel Blob token on the server' }); return; }
      const { blobs } = await list({ prefix: 'bugs/', limit: 1000, token });
      const jsons = blobs.filter(b => b.pathname.endsWith('.json'));
      const bugs = (await Promise.all(jsons.map(async (b) => {
        try { const r = await fetch(b.url + (b.url.includes('?') ? '&' : '?') + 'v=' + b.pathname, { cache: 'no-store' }); return await r.json(); }
        catch { return null; }
      }))).filter(Boolean).sort((a, b) => b.ts - a.ts);
      res.setHeader('cache-control', 'no-store, max-age=0, must-revalidate');
      res.status(200).json({ count: bugs.length, bugs });
    } else {
      res.status(405).json({ error: 'GET or POST' });
    }
  } catch (e) {
    res.status(502).json({ error: 'bug intake error: ' + e.message });
  }
}
