/**
 * hopeOS — shared admin-token gate for owner-only endpoints (dashboard reads).
 * Set ADMIN_KEY in Vercel env. Clients send it as `x-admin-key` header or `?key=`.
 * Writes (chat/bug POST) stay public; only READS (chat log, bug list) are gated.
 *
 * (Files starting with "_" under /api are NOT exposed as routes — this is a helper.)
 */
export function requireAdmin(req, res) {
  const want = process.env.ADMIN_KEY || '';
  if (!want) { res.status(503).json({ error: 'ADMIN_KEY not configured on the server' }); return false; }
  const got = (req.headers['x-admin-key'] || (req.query && req.query.key) || '').toString();
  if (got !== want) { res.status(401).json({ error: 'unauthorized — admin key required' }); return false; }
  return true;
}
