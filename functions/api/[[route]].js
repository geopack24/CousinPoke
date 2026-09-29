// Poké Table API — a tiny document store on Cloudflare D1.
// Routes (all under /api/):
//   POST sync                 -> { players, decks, games?, game? }  (the page polls this)
//   GET  :col/:id             -> the document, or { missing: true }
//   PUT  :col/:id             -> body { data, ifVersion? }; returns { version } or 409 { conflict, doc }
//   DELETE :col/:id
// Collections: games, decks, players. No accounts: anyone with the link can play.

const COLS = new Set(['games', 'decks', 'players']);
const ID = /^[A-Za-z0-9_-]{1,48}$/;
const MAX_BYTES = 400000;
let schemaReady = false;

const json = (o, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

async function ensureSchema(db) {
  if (schemaReady) return;
  await db.prepare(
    'CREATE TABLE IF NOT EXISTS docs (col TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, updated_at INTEGER NOT NULL, PRIMARY KEY (col, id))'
  ).run();
  await db.prepare('CREATE INDEX IF NOT EXISTS docs_col_upd ON docs (col, updated_at)').run();
  schemaReady = true;
}

const rowToDoc = (r) => ({ id: r.id, version: r.version, ...JSON.parse(r.data) });

async function getDoc(db, col, id) {
  const r = await db.prepare('SELECT id, data, version FROM docs WHERE col = ? AND id = ?').bind(col, id).first();
  return r ? rowToDoc(r) : null;
}

async function handleSync(db, body) {
  const out = { now: Date.now() };
  const pl = await db.prepare("SELECT id, data FROM docs WHERE col = 'players' LIMIT 500").all();
  out.players = {};
  for (const r of pl.results) out.players[r.id] = JSON.parse(r.data);

  if (body.pid && ID.test(body.pid)) {
    const dk = await db
      .prepare("SELECT id, data, version FROM docs WHERE col = 'decks' AND json_extract(data, '$.owner') = ? ORDER BY updated_at DESC LIMIT 200")
      .bind(body.pid)
      .all();
    out.decks = dk.results.map(rowToDoc);
  }
  if (body.lobby) {
    const gs = await db.prepare("SELECT id, data, version FROM docs WHERE col = 'games' ORDER BY updated_at DESC LIMIT 40").all();
    out.games = gs.results.map((r) => {
      const d = JSON.parse(r.data);
      const s = d.state;
      delete d.state;
      delete d.log;
      return { id: r.id, version: r.version, ...d, state: s ? { turnNo: s.turnNo } : null };
    });
  }
  if (body.game && ID.test(body.game)) {
    const r = await db.prepare("SELECT id, data, version FROM docs WHERE col = 'games' AND id = ?").bind(body.game).first();
    out.game = !r ? { missing: true } : r.version === body.gv ? { unchanged: true, version: r.version } : rowToDoc(r);
  }
  // Occasionally forget tables nobody has touched in 45 days.
  if (Math.random() < 0.02) {
    await db.prepare("DELETE FROM docs WHERE col = 'games' AND updated_at < ?").bind(Date.now() - 45 * 86400000).run();
  }
  return json(out);
}

export async function onRequest({ request, env, params }) {
  const db = env.DB;
  if (!db) return json({ error: 'no_db', message: 'The D1 database binding "DB" is not configured for this deployment.' }, 503);
  try {
    await ensureSchema(db);
  } catch (e) {
    return json({ error: 'db_init', message: String((e && e.message) || e) }, 500);
  }
  const parts = Array.isArray(params.route) ? params.route : params.route ? [params.route] : [];
  const method = request.method;
  try {
    if (parts[0] === 'sync' && method === 'POST') {
      const body = await request.json().catch(() => ({}));
      return handleSync(db, body || {});
    }
    const [col, id] = parts;
    if (!COLS.has(col)) return json({ error: 'not_found' }, 404);
    if (id && !ID.test(id)) return json({ error: 'bad_id' }, 400);

    if (method === 'GET' && id) {
      const d = await getDoc(db, col, id);
      return json(d || { missing: true });
    }
    if (method === 'PUT' && id) {
      const body = await request.json().catch(() => null);
      const data = body && body.data;
      if (!data || typeof data !== 'object' || Array.isArray(data)) return json({ error: 'bad_body', message: 'Expected { data }' }, 400);
      const txt = JSON.stringify(data);
      if (txt.length > MAX_BYTES) return json({ error: 'too_large', message: 'Document too large' }, 413);
      const now = Date.now();
      if (body.ifVersion != null) {
        const r = await db
          .prepare('UPDATE docs SET data = ?, version = version + 1, updated_at = ? WHERE col = ? AND id = ? AND version = ? RETURNING version')
          .bind(txt, now, col, id, body.ifVersion)
          .first();
        if (r) return json({ version: r.version });
        const cur = await getDoc(db, col, id);
        if (cur) return json({ conflict: true, doc: cur }, 409);
        // The document does not exist yet: fall through and create it.
      }
      const r = await db
        .prepare(
          'INSERT INTO docs (col, id, data, version, updated_at) VALUES (?, ?, ?, 1, ?) ON CONFLICT (col, id) DO UPDATE SET data = excluded.data, version = docs.version + 1, updated_at = excluded.updated_at RETURNING version'
        )
        .bind(col, id, txt, now)
        .first();
      return json({ version: r.version });
    }
    if (method === 'DELETE' && id) {
      await db.prepare('DELETE FROM docs WHERE col = ? AND id = ?').bind(col, id).run();
      return json({ ok: true });
    }
    return json({ error: 'not_found' }, 404);
  } catch (e) {
    return json({ error: 'server', message: String((e && e.message) || e) }, 500);
  }
}
