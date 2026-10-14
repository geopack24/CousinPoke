"""Local stand-in for the Cloudflare Pages Function: serves public/ and the same /api/ routes on SQLite."""
import json, os, re, sqlite3, sys, time, random
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

ROOT = sys.argv[1]
PORT = int(sys.argv[2]) if len(sys.argv) > 2 else 8766
DBP = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'dev.sqlite')
if os.path.exists(DBP): os.remove(DBP)
db = sqlite3.connect(DBP, check_same_thread=False)
db.execute('CREATE TABLE IF NOT EXISTS docs (col TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, updated_at INTEGER NOT NULL, PRIMARY KEY (col,id))')
COLS = {'games', 'decks', 'players'}
ID = re.compile(r'^[A-Za-z0-9_-]{1,48}$')
import threading
lock = threading.Lock()

def row_to_doc(r):
    return {'id': r[0], 'version': r[2], **json.loads(r[1])}

def get_doc(col, id):
    r = db.execute('SELECT id,data,version FROM docs WHERE col=? AND id=?', (col, id)).fetchone()
    return row_to_doc(r) if r else None

class H(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=ROOT, **k)
    def log_message(self, *a): pass
    def send_json(self, o, status=200):
        b = json.dumps(o).encode()
        self.send_response(status); self.send_header('content-type', 'application/json'); self.send_header('content-length', str(len(b))); self.send_header('cache-control', 'no-store'); self.end_headers(); self.wfile.write(b)
    def body(self):
        n = int(self.headers.get('content-length') or 0)
        return json.loads(self.rfile.read(n) or b'{}') if n else {}
    def do_GET(self):
        if self.path.startswith('/api/'):
            parts = self.path[5:].split('?')[0].split('/')
            col, id = (parts + [None])[:2]
            if col in COLS and id:
                with lock: d = get_doc(col, id)
                return self.send_json(d or {'missing': True})
            return self.send_json({'error': 'not_found'}, 404)
        return super().do_GET()
    def do_POST(self):
        if self.path == '/api/sync':
            b = self.body(); out = {'now': int(time.time()*1000)}
            with lock:
                out['players'] = {r[0]: json.loads(r[1]) for r in db.execute("SELECT id,data FROM docs WHERE col='players'")}
                if b.get('pid'):
                    out['decks'] = [row_to_doc(r) for r in db.execute("SELECT id,data,version FROM docs WHERE col='decks' AND json_extract(data,'$.owner')=? ORDER BY updated_at DESC", (b['pid'],))]
                if b.get('lobby'):
                    gs = []
                    for r in db.execute("SELECT id,data,version FROM docs WHERE col='games' ORDER BY updated_at DESC LIMIT 40"):
                        d = json.loads(r[1]); s = d.pop('state', None); d.pop('log', None)
                        gs.append({'id': r[0], 'version': r[2], **d, 'state': {'turnNo': s.get('turnNo')} if s else None})
                    out['games'] = gs
                if b.get('game'):
                    r = db.execute("SELECT id,data,version FROM docs WHERE col='games' AND id=?", (b['game'],)).fetchone()
                    out['game'] = {'missing': True} if not r else ({'unchanged': True, 'version': r[2]} if r[2] == b.get('gv') else row_to_doc(r))
            return self.send_json(out)
        return self.send_json({'error': 'not_found'}, 404)
    def do_PUT(self):
        parts = self.path[5:].split('/'); col, id = (parts + [None])[:2]
        if col not in COLS or not id or not ID.match(id): return self.send_json({'error': 'bad'}, 400)
        b = self.body(); data = b.get('data'); txt = json.dumps(data); now = int(time.time()*1000)
        with lock:
            if b.get('ifVersion') is not None:
                cur = db.execute('UPDATE docs SET data=?, version=version+1, updated_at=? WHERE col=? AND id=? AND version=? RETURNING version', (txt, now, col, id, b['ifVersion'])).fetchone()
                if cur: db.commit(); return self.send_json({'version': cur[0]})
                ex = get_doc(col, id)
                if ex: return self.send_json({'conflict': True, 'doc': ex}, 409)
            r = db.execute('INSERT INTO docs (col,id,data,version,updated_at) VALUES (?,?,?,1,?) ON CONFLICT(col,id) DO UPDATE SET data=excluded.data, version=docs.version+1, updated_at=excluded.updated_at RETURNING version', (col, id, txt, now)).fetchone()
            db.commit()
        return self.send_json({'version': r[0]})
    def do_DELETE(self):
        parts = self.path[5:].split('/'); col, id = (parts + [None])[:2]
        with lock:
            db.execute('DELETE FROM docs WHERE col=? AND id=?', (col, id)); db.commit()
        return self.send_json({'ok': True})

print('serving', ROOT, 'on', PORT, flush=True)
ThreadingHTTPServer(('127.0.0.1', PORT), H).serve_forever()
