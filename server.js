'use strict';
/* Numero Vault server. No dependencies: run with `node server.js` (Node 18 or newer).
   Settings (environment variables): PORT (default 8080), DATA_DIR (default ./data), HOST (default 0.0.0.0). */
const http = require('http'), fs = require('fs'), fsp = fs.promises, path = require('path'), crypto = require('crypto');

const PORT = +process.env.PORT || 8080, HOST = process.env.HOST || '0.0.0.0';
const DATA = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const PUB = path.join(__dirname, 'public'), FILES = path.join(DATA, 'files');
const DBF = path.join(DATA, 'db.json'), AUDF = path.join(DATA, 'audit.jsonl');
const STARTED = Date.now(), DAY = 864e5, BIN_DAYS = 30, SESSION_DAYS = 7, PERMS = 'vdce';
const LOCK = path.join(DATA, 'server.lock'), ERRLOG = path.join(DATA, 'server-errors.log');
function fatal(msg) { console.error('\nNUMERO VAULT CANNOT START\n' + msg + '\n'); process.exit(1); }
try { fs.mkdirSync(FILES, { recursive: true }); fs.writeFileSync(path.join(DATA, '.write-test'), 'ok'); fs.unlinkSync(path.join(DATA, '.write-test')); }
catch (e) { fatal('The data folder cannot be written to:\n  ' + DATA + '\n  (' + e.message + ')\nMove Numero Vault out of Program Files or a synced/read-only folder, or set DATA_DIR to a folder this account may write to.'); }
try { const pid = +fs.readFileSync(LOCK, 'utf8'), fresh = Date.now() - fs.statSync(LOCK).mtimeMs < 25000; if (pid && pid !== process.pid && fresh) { process.kill(pid, 0); fatal('Another Numero Vault (process ' + pid + ') is already running on this data folder:\n  ' + DATA + '\nTwo servers on one data folder overwrite each other\'s changes. Close the other one first. Run only one instance (no cluster mode).\nIf you stopped it a moment ago, wait half a minute and start again.'); } }
catch (e) { if (e.code === 'EPERM') fatal('Another Numero Vault is already running on this data folder: ' + DATA); }
fs.writeFileSync(LOCK, String(process.pid));
setInterval(() => { const t = new Date(); fs.utimes(LOCK, t, t, () => {}); }, 10000).unref();
let storageError = '';
function logError(where, e) { const line = new Date().toISOString() + ' ' + where + ': ' + (e && e.stack || e) + '\n'; console.error(line); try { fs.appendFileSync(ERRLOG, line); } catch (x) {} }

/* ---------- storage ---------- */
let db = { settings: { brand: '#1f4081' }, users: {}, groups: {}, folders: {}, files: {}, requests: {}, comments: {}, favs: {}, sessions: {} };
if (fs.existsSync(DBF)) db = Object.assign(db, JSON.parse(fs.readFileSync(DBF, 'utf8')));
let saveTimer = null, dirty = false;
function save() { dirty = true; if (!saveTimer) saveTimer = setTimeout(flush, 150); }
function flush() { saveTimer = null; if (!dirty) return; dirty = false; const tmp = DBF + '.tmp', json = JSON.stringify(db);
  try { fs.writeFileSync(tmp, json);
    let done = false; for (let i = 0; i < 5 && !done; i++) { try { fs.renameSync(tmp, DBF); done = true; } catch (e) { if (i === 4) { fs.writeFileSync(DBF, json); done = true; } } } // Windows: antivirus or sync tools can hold the file for a moment
    storageError = ''; }
  catch (e) { storageError = 'Changes could not be written to ' + DBF + ' (' + e.message + ').'; logError('save', e); dirty = true; if (!saveTimer) saveTimer = setTimeout(flush, 3000); } }
function backup() { try { flush(); if (fs.existsSync(DBF)) fs.copyFileSync(DBF, path.join(DATA, 'db.backup-' + new Date().toISOString().slice(0, 10) + '.json'));
  const old = fs.readdirSync(DATA).filter(n => /^db\.backup-/.test(n)).sort(); while (old.length > 14) fs.unlinkSync(path.join(DATA, old.shift())); } catch (e) { console.error('backup failed', e.message); } }

let events = [];
if (fs.existsSync(AUDF)) for (const line of fs.readFileSync(AUDF, 'utf8').split('\n')) { if (line) try { events.push(JSON.parse(line)); } catch (e) {} }
function audit(uid, a, n, extra) { const e = Object.assign({ t: Date.now(), uid, a, n: String(n || '').slice(0, 200) }, extra || {}); events.push(e); fs.appendFile(AUDF, JSON.stringify(e) + '\n', err => { if (err) { storageError = 'The audit log could not be written (' + err.message + ').'; logError('audit', err); } }); }

/* ---------- helpers ---------- */
class HttpError extends Error { constructor(status, message, code) { super(message); this.status = status; this.code = code; } }
const rid = (p, n) => p + crypto.randomBytes(n || 6).toString('hex');
const str = (v, max) => String(v == null ? '' : v).trim().slice(0, max || 200);
const normPerm = s => { s = String(s || ''); let out = [...PERMS].filter(c => s.includes(c)).join(''); if (out && !out.includes('v')) out = 'v' + out; return out; };
const cleanPath = s => String(s || '').split('/').map(x => x.trim().slice(0, 60)).filter(Boolean).slice(0, 8).join('/');
const cleanTags = v => (Array.isArray(v) ? v : String(v || '').split(',')).map(t => str(t, 30)).filter(Boolean).slice(0, 12);
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
const extOf = n => { const m = /\.([A-Za-z0-9]{1,8})$/.exec(n || ''); return m ? m[1].toLowerCase() : ''; };
const INLINE = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', ogg: 'audio/ogg', pdf: 'application/pdf' };
const STATIC = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.map': 'application/json' };
function permMap(obj, keys) { const out = {}; if (obj && typeof obj === 'object') for (const [k, v] of Object.entries(obj)) if (keys[k]) out[k] = normPerm(v); return out; }

function hashPw(pw, salt) { return crypto.scryptSync(String(pw), salt, 64).toString('hex'); }
function setPw(u, pw) { u.salt = crypto.randomBytes(16).toString('hex'); u.hash = hashPw(pw, u.salt); }
function checkPw(u, pw) { try { return crypto.timingSafeEqual(Buffer.from(u.hash, 'hex'), Buffer.from(hashPw(pw, u.salt), 'hex')); } catch (e) { return false; } }
function goodPw(pw) { if (typeof pw !== 'string' || pw.length < 8) throw new HttpError(400, 'The password needs at least 8 characters.'); }

if (!Object.keys(db.users).length) {
  const pw = crypto.randomBytes(9).toString('base64').replace(/[^A-Za-z0-9]/g, 'x'), id = rid('u_');
  db.users[id] = { username: 'admin', name: 'Administrator', role: 'admin', active: true, groups: [], defaults: '', created: Date.now(), mustChange: true };
  setPw(db.users[id], pw); flush(); dirty = true; flush();
  const note = 'Numero Vault first sign-in\nUsername: admin\nPassword: ' + pw + '\nYou will be asked to choose a new password. Delete this file afterwards.\n';
  fs.writeFileSync(path.join(DATA, 'FIRST-LOGIN.txt'), note); console.log('\n' + note);
}

/* ---------- recovery: stored files the database does not know about (for example after an interrupted save) ---------- */
(function recover() { let n = 0;
  for (const id of fs.readdirSync(FILES)) { if (!/^f_[a-f0-9]+$/.test(id) || db.files[id]) continue; const dir = path.join(FILES, id); let names = [];
    try { names = fs.readdirSync(dir); } catch (e) { continue; }
    for (const x of names) if (x.endsWith('.part')) try { fs.unlinkSync(path.join(dir, x)); } catch (e) {}
    const vs = names.map(x => /^(\d+)\.bin$/.exec(x)).filter(Boolean).map(m => +m[1]).sort((a, b) => a - b); if (!vs.length) continue;
    if (events.some(e => e.f === id && e.a === 'purge')) continue; // deliberately deleted; leftovers only
    let name = ''; for (const e of events) if (e.f === id && (e.a === 'upload' || e.a === 'edit') && e.n && !/^Renamed to /.test(e.n)) name = e.n;
    const up = events.find(e => e.f === id && e.a === 'upload'), sizeOf = v => { try { return fs.statSync(path.join(dir, v + '.bin')).size; } catch (e) { return 0; } }, cur = vs[vs.length - 1];
    db.files[id] = { name: name || 'recovered-' + id.slice(2, 10), size: sizeOf(cur), mime: '', folder: 'Recovered', tags: [], desc: 'Recovered automatically after a storage problem. Check the name, folder and access.', docDate: '', review: '',
      at: up ? up.t : Date.now(), by: up ? up.uid : '', v: cur, versions: vs.slice(0, -1).map(v => ({ v, name: name || 'earlier version', size: sizeOf(v), mime: '', at: up ? up.t : Date.now(), by: '' })),
      grants: {}, ggrants: {}, limits: {}, once: {}, views: {}, deletedAt: 0, hasText: fs.existsSync(path.join(dir, 'text.txt')) };
    audit('', 'recover', db.files[id].name, { f: id }); n++; }
  if (n) { dirty = true; flush(); console.log('Recovered ' + n + ' stored file(s) that were missing from the database. They are in the folder "Recovered" with no user access set.'); }
})();

/* ---------- permissions ---------- */
function folderChain(p) { const out = []; if (!p) return out; const ps = p.split('/'); for (let i = 1; i <= ps.length; i++) { const d = db.folders[ps.slice(0, i).join('/')]; if (d) out.push(d); } return out; }
function effPerm(f, uid, noOnce) {
  const u = db.users[uid]; if (!u || u.active === false) return '';
  if (u.role === 'admin') return PERMS;
  const gs = (u.groups || []).filter(g => db.groups[g]);
  let s = String((f.grants && f.grants[uid]) || ''); for (const g of gs) s += (f.ggrants && f.ggrants[g]) || '';
  for (const d of folderChain(f.folder)) { s += (d.grants && d.grants[uid]) || ''; for (const g of gs) s += (d.ggrants && d.ggrants[g]) || ''; }
  if (!noOnce && f.once && f.once[uid] === true) s += 'e';
  return normPerm(s);
}
function access(f, uid) { // what this person may do right now, with view limits applied
  if (f.deletedAt && db.users[uid].role !== 'admin') return { p: '', lim: 0, used: 0, over: false, listed: false };
  const base = effPerm(f, uid), admin = db.users[uid].role === 'admin', lim = admin ? 0 : (+(f.limits && f.limits[uid]) || 0), used = +(f.views && f.views[uid]) || 0, over = lim > 0 && used >= lim;
  return { p: over ? '' : base, lim, used, over, listed: !!base, one: !admin && !!(f.once && f.once[uid] === true) && !effPerm(f, uid, true).includes('e') };
}
function consumeOnce(f, uid) { if (f.once && f.once[uid] === true && !effPerm(f, uid, true).includes('e')) delete f.once[uid]; }
const fileDir = id => path.join(FILES, id);
const filePath = (id, v) => path.join(FILES, id, v + '.bin');
const totalBytes = () => Object.values(db.files).reduce((a, f) => a + (+f.size || 0) + (f.versions || []).reduce((b, v) => b + (+v.size || 0), 0), 0);
function disk() { const out = { used: totalBytes() }; try { const s = fs.statfsSync(DATA); out.free = Number(s.bavail) * Number(s.bsize); out.total = Number(s.blocks) * Number(s.bsize); } catch (e) {} return out; }

/* ---------- sessions ---------- */
const tokKey = t => crypto.createHash('sha256').update(t).digest('hex');
function sessionUser(req) {
  const m = /(?:^|;\s*)nv=([a-f0-9]{64})/.exec(req.headers.cookie || ''); if (!m) return null;
  const s = db.sessions[tokKey(m[1])]; if (!s || s.exp < Date.now()) return null;
  const u = db.users[s.uid]; if (!u || u.active === false) return null; return { uid: s.uid, u, key: tokKey(m[1]) };
}
const fails = new Map();
const tickets = new Map();
const presence = new Map(); // live monitoring: one entry per signed-in browser, kept in memory only
setInterval(() => { const now = Date.now(); for (const [k, v] of tickets) if (v.exp < now) tickets.delete(k); for (const [k, v] of presence) if (v.t < now - 5 * 6e4) presence.delete(k); for (const [k, v] of fails) if (v.until < now && v.at < now - 36e5) fails.delete(k);
  let ch = false; for (const [k, s] of Object.entries(db.sessions)) if (s.exp < now) { delete db.sessions[k]; ch = true; } if (ch) save(); }, 6e4).unref();

/* ---------- recycle bin clean-up, daily backup ---------- */
async function purge(id, uid, why) { const f = db.files[id]; if (!f) return; delete db.files[id]; delete db.comments[id]; for (const [k, r] of Object.entries(db.requests)) if (r.fid === id) delete db.requests[k];
  textCache.delete(id); await fsp.rm(fileDir(id), { recursive: true, force: true }); audit(uid, 'purge', f.name + (why || ''), { f: id }); save(); }
async function sweep() { const now = Date.now(); for (const [id, f] of Object.entries(db.files)) if (f.deletedAt && now - f.deletedAt > BIN_DAYS * DAY) await purge(id, '', ' (recycle bin, ' + BIN_DAYS + ' days)'); }
setInterval(() => { sweep().catch(() => {}); }, 6 * 36e5).unref(); sweep().catch(() => {});
setInterval(backup, DAY).unref(); backup();

/* ---------- http plumbing ---------- */
function send(res, status, body, headers) { const data = body == null ? '' : (Buffer.isBuffer(body) || typeof body === 'string') ? body : JSON.stringify(body);
  res.writeHead(status, Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }, headers || {})); res.end(data); }
function readBody(req, max) { return new Promise((resolve, reject) => { const chunks = []; let n = 0;
  req.on('data', c => { n += c.length; if (n > (max || 1e6)) { reject(new HttpError(413, 'That request is too large.')); req.destroy(); } else chunks.push(c); });
  req.on('end', () => resolve(Buffer.concat(chunks))); req.on('error', reject); }); }
async function readJson(req) { const b = await readBody(req); if (!b.length) return {}; try { const o = JSON.parse(b.toString('utf8')); return o && typeof o === 'object' ? o : {}; } catch (e) { throw new HttpError(400, 'The request could not be read.'); } }
async function receive(req, dest) { await fsp.mkdir(path.dirname(dest), { recursive: true }); const part = dest + '.part';
  return new Promise((resolve, reject) => { const ws = fs.createWriteStream(part); let n = 0, done = false;
    const fail = e => { if (done) return; done = true; ws.destroy(); fs.unlink(part, () => {}); reject(e); };
    req.on('data', c => { n += c.length; }); req.on('aborted', () => fail(new HttpError(400, 'The upload was interrupted.'))); req.on('error', fail); ws.on('error', fail);
    ws.on('finish', () => { if (done) return; done = true; if (!n) { fs.unlink(part, () => {}); return reject(new HttpError(400, 'The file is empty.')); } fs.rename(part, dest, e => e ? reject(e) : resolve(n)); });
    req.pipe(ws); }); }
function sendFile(req, res, fp, size, type, name, attach) {
  let start = 0, end = size - 1, code = 200; const r = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (r && (r[1] || r[2])) { if (r[1]) { start = +r[1]; if (r[2]) end = Math.min(+r[2], size - 1); } else start = Math.max(0, size - +r[2]);
    if (start > end || start >= size) { res.writeHead(416, { 'Content-Range': 'bytes */' + size }); return res.end(); } code = 206; }
  const h = { 'Content-Type': type, 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:", 'Content-Disposition': (attach ? 'attachment' : 'inline') + "; filename*=UTF-8''" + encodeURIComponent(name) };
  if (code === 206) h['Content-Range'] = 'bytes ' + start + '-' + end + '/' + size;
  res.writeHead(code, h); if (req.method === 'HEAD' || size === 0) return res.end();
  const rs = fs.createReadStream(fp, { start, end }); rs.on('error', () => res.destroy()); res.on('close', () => rs.destroy()); rs.pipe(res);
}
const PAGE_CSP = "default-src 'self'; script-src 'self' https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob:; media-src 'self' blob:; worker-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";
function serveStatic(req, res, urlPath) {
  let rel = urlPath === '/' ? '/index.html' : urlPath; const fp = path.normalize(path.join(PUB, rel));
  if (!fp.startsWith(PUB + path.sep)) return send(res, 404, { error: 'Not found' });
  fs.stat(fp, (e, st) => { if (e || !st.isFile()) return send(res, 404, { error: 'Not found' });
    res.writeHead(200, { 'Content-Type': STATIC[path.extname(fp).toLowerCase()] || 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': PAGE_CSP });
    if (req.method === 'HEAD') return res.end(); fs.createReadStream(fp).pipe(res); });
}

/* ---------- views of the data ---------- */
const publicUser = (id, u) => ({ username: u.username, name: u.name, role: u.role, active: u.active !== false, groups: (u.groups || []).filter(g => db.groups[g]), defaults: u.defaults || '', lastSeen: u.lastSeen || 0, mustChange: !!u.mustChange });
function recentsOf(uid) { const out = []; for (let i = events.length - 1; i >= 0 && i > events.length - 20000 && out.length < 20; i--) { const e = events[i]; if (e.uid === uid && e.a === 'view' && e.f && !out.includes(e.f)) out.push(e.f); } return out; }
function stateFor(uid, u) {
  const me = { id: uid, username: u.username, name: u.name, role: u.role }, base = { me, settings: db.settings, favs: db.favs[uid] || [], recents: recentsOf(uid), binDays: BIN_DAYS };
  if (u.mustChange) return { me, settings: db.settings, mustChange: true };
  if (u.role === 'admin') {
    const people = Object.keys(db.users).filter(x => db.users[x].role !== 'admin' && db.users[x].active !== false), files = {}, count = {};
    for (const [id, f] of Object.entries(db.files)) { let n = 0; if (!f.deletedAt) for (const x of people) if (effPerm(f, x)) { n++; count[x] = (count[x] || 0) + 1; } files[id] = Object.assign({}, f, { people: n }); }
    const users = {}; for (const [id, x] of Object.entries(db.users)) users[id] = Object.assign(publicUser(id, x), { fileCount: count[id] || 0 });
    return Object.assign(base, { admin: true, files, users, groups: db.groups, folders: db.folders, requests: db.requests, comments: db.comments, disk: disk(), server: { dataDir: DATA, started: STARTED, storageError, saved: fs.existsSync(DBF) ? fs.statSync(DBF).mtimeMs : 0 } });
  }
  const files = {};
  for (const [id, f] of Object.entries(db.files)) { const a = access(f, uid); if (!a.listed) continue;
    const req = Object.values(db.requests).find(r => r.uid === uid && r.fid === id);
    files[id] = { name: f.name, size: f.size, mime: f.mime, folder: f.folder || '', desc: f.desc || '', tags: f.tags || [], docDate: f.docDate || '', at: f.updatedAt || f.at, p: a.p, lim: a.lim, used: a.used, over: a.over, one: a.one,
      hasText: !!f.hasText, thread: ((db.comments[id] || {})[uid] || []).map(m => ({ t: m.t, x: m.x, mine: m.by === uid })), req: req ? req.want : '' }; }
  return Object.assign(base, { admin: false, files });
}

/* ---------- search inside files ---------- */
const textCache = new Map();
async function textOf(id) { if (textCache.has(id)) return textCache.get(id); let t = ''; try { t = (await fsp.readFile(path.join(fileDir(id), 'text.txt'), 'utf8')).toLowerCase(); } catch (e) {}
  if (textCache.size > 3000) textCache.delete(textCache.keys().next().value); textCache.set(id, t); return t; }

/* ---------- API ---------- */
async function api(req, res, url) {
  const p = url.pathname, m = req.method, q = url.searchParams, ip = req.socket.remoteAddress || '';
  if (m !== 'GET' && m !== 'HEAD' && req.headers['x-vault'] !== '1') throw new HttpError(403, 'Request refused.');

  if (p === '/api/login' && m === 'POST') {
    const b = await readJson(req), name = str(b.username, 60).toLowerCase(), key = ip + '|' + name, f = fails.get(key);
    if (f && f.until > Date.now()) throw new HttpError(429, 'Too many wrong passwords. Try again in a few minutes.');
    const found = Object.entries(db.users).find(([, u]) => u.username === name);
    if (!found || found[1].active === false || !checkPw(found[1], b.password || '')) {
      const n = (f ? f.n : 0) + 1; fails.set(key, { n, at: Date.now(), until: n >= 5 ? Date.now() + 5 * 6e4 : 0 }); if (n >= 5) fails.get(key).n = 0;
      audit(found ? found[0] : '', 'loginfail', name); throw new HttpError(401, 'Wrong username or password.', 'login'); }
    fails.delete(key); const token = crypto.randomBytes(32).toString('hex'); db.sessions[tokKey(token)] = { uid: found[0], exp: Date.now() + SESSION_DAYS * DAY };
    found[1].lastSeen = Date.now(); save(); audit(found[0], 'login', '');
    return send(res, 200, { ok: true }, { 'Set-Cookie': 'nv=' + token + '; HttpOnly; SameSite=Strict; Path=/; Max-Age=' + SESSION_DAYS * 86400 });
  }
  const sess = sessionUser(req); if (!sess) throw new HttpError(401, 'Please sign in.', 'auth');
  const { uid, u } = sess, admin = u.role === 'admin';
  const needAdmin = () => { if (!admin) throw new HttpError(403, 'Only a vault admin can do that.'); };
  const fileOf = id => { const f = db.files[id]; if (!f) throw new HttpError(404, 'That file no longer exists.'); return f; };
  const ok = extra => send(res, 200, Object.assign({ ok: true }, extra || {}));

  if (p === '/api/logout' && m === 'POST') { delete db.sessions[sess.key]; presence.delete(sess.key); save(); return send(res, 200, { ok: true }, { 'Set-Cookie': 'nv=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' }); }
  if (p === '/api/password' && m === 'POST') { const b = await readJson(req); if (!checkPw(u, b.old || '')) throw new HttpError(400, 'The current password is wrong.'); goodPw(b.new);
    if (b.new === b.old) throw new HttpError(400, 'Choose a password different from the current one.'); setPw(u, b.new); u.mustChange = false;
    for (const [k, s] of Object.entries(db.sessions)) if (s.uid === uid && k !== sess.key) delete db.sessions[k]; save(); audit(uid, 'password', ''); return ok(); }
  if (p === '/api/state' && m === 'GET') { if (Date.now() - (u.lastSeen || 0) > 6e4) { u.lastSeen = Date.now(); save(); } return send(res, 200, stateFor(uid, u)); }
  if (u.mustChange) throw new HttpError(403, 'Choose a new password first.', 'password');

  /* content tickets, viewing, downloading */
  let mt = /^\/api\/files\/(f_[a-f0-9]+)\/open$/.exec(p);
  if (mt && m === 'POST') { const f = fileOf(mt[1]), b = await readJson(req), mode = b.mode === 'download' ? 'download' : 'view', a = access(f, uid);
    if (a.over) throw new HttpError(403, 'You have used all ' + a.lim + ' views of this file. Request more views from the admin.', 'limit');
    if (!a.p.includes(mode === 'download' ? 'd' : 'v')) throw new HttpError(403, mode === 'download' ? 'You may not download this file.' : 'You may not open this file.');
    let v = f.v; if (admin && b.v != null && (f.versions || []).some(x => x.v === +b.v)) v = +b.v;
    if (mode === 'view' && !admin) { f.views = f.views || {}; f.views[uid] = (+f.views[uid] || 0) + 1; save(); }
    if (!(b.quiet && admin)) audit(uid, mode, f.name, { f: mt[1] });
    const t = crypto.randomBytes(24).toString('hex'); tickets.set(t, { uid, fid: mt[1], v, mode, exp: Date.now() + (mode === 'view' ? 8 * 36e5 : 36e5) });
    return ok({ ticket: t, url: '/api/files/' + mt[1] + '/content?t=' + t }); }
  mt = /^\/api\/files\/(f_[a-f0-9]+)\/content$/.exec(p);
  if (mt && (m === 'GET' || m === 'HEAD')) { const tk = tickets.get(q.get('t') || ''); const f = fileOf(mt[1]);
    if (!tk || tk.exp < Date.now() || tk.uid !== uid || tk.fid !== mt[1]) throw new HttpError(403, 'This link has expired. Open the file again.');
    const dl = q.get('dl') === '1'; if (dl && tk.mode !== 'download') throw new HttpError(403, 'You may not download this file.');
    const ver = tk.v === f.v ? f : (f.versions || []).find(x => x.v === tk.v); if (!ver) throw new HttpError(404, 'That version no longer exists.');
    const fp = filePath(mt[1], tk.v); let st; try { st = await fsp.stat(fp); } catch (e) { throw new HttpError(404, 'The stored file is missing on the server.'); }
    return sendFile(req, res, fp, st.size, dl ? 'application/octet-stream' : (INLINE[extOf(ver.name)] || 'application/octet-stream'), ver.name, dl); }

  /* upload, replace, text index */
  if (p === '/api/files' && m === 'POST') { needAdmin(); const name = str(q.get('name'), 200); if (!name) throw new HttpError(400, 'The file needs a name.');
    const id = rid('f_'), size = await receive(req, filePath(id, 1)), grants = {}, ggrants = {};
    if (q.get('defaults') === '1') { for (const [k, x] of Object.entries(db.users)) if (x.role !== 'admin' && normPerm(x.defaults)) grants[k] = normPerm(x.defaults);
      for (const [k, g] of Object.entries(db.groups)) if (normPerm(g.defaults)) ggrants[k] = normPerm(g.defaults); }
    db.files[id] = { name, size, mime: str(q.get('mime'), 100), folder: cleanPath(q.get('folder')), tags: cleanTags(q.get('tags')), desc: '', docDate: '', review: '', at: Date.now(), by: uid, v: 1, versions: [], grants, ggrants, limits: {}, once: {}, views: {}, deletedAt: 0, hasText: false };
    save(); audit(uid, 'upload', name, { f: id }); return ok({ id }); }
  mt = /^\/api\/files\/(f_[a-f0-9]+)\/content$/.exec(p);
  if (mt && m === 'PUT') { const f = fileOf(mt[1]); if (f.deletedAt || !access(f, uid).p.includes('e')) throw new HttpError(403, 'You may not edit this file. Ask the admin for edit access.');
    const nv = Math.max(f.v, ...(f.versions || []).map(x => x.v)) + 1, size = await receive(req, filePath(mt[1], nv));
    f.versions = (f.versions || []).concat([{ v: f.v, name: f.name, size: f.size, mime: f.mime, at: f.updatedAt || f.at, by: f.updatedBy || f.by }]);
    const name = str(q.get('name'), 200); Object.assign(f, { v: nv, size, mime: str(q.get('mime'), 100) || f.mime, name: name || f.name, updatedAt: Date.now(), updatedBy: uid, hasText: false });
    textCache.delete(mt[1]); fsp.rm(path.join(fileDir(mt[1]), 'text.txt'), { force: true }).catch(() => {}); consumeOnce(f, uid); save(); audit(uid, 'edit', f.name, { f: mt[1] }); return ok(); }
  mt = /^\/api\/files\/(f_[a-f0-9]+)\/text$/.exec(p);
  if (mt && m === 'PUT') { const f = fileOf(mt[1]); if (!admin && !(f.updatedBy === uid && Date.now() - f.updatedAt < 10 * 6e4)) throw new HttpError(403, 'Not allowed.');
    const body = await readBody(req, 3e6); await fsp.writeFile(path.join(fileDir(mt[1]), 'text.txt'), body); f.hasText = body.length > 0; textCache.delete(mt[1]); save(); return ok(); }
  if (p === '/api/search' && m === 'GET') { const term = str(q.get('q'), 100).toLowerCase(), hits = {}; if (term.length < 2) return send(res, 200, { hits });
    for (const [id, f] of Object.entries(db.files)) { if (!f.hasText || f.deletedAt || !access(f, uid).p.includes('v')) continue; const t = await textOf(id), i = t.indexOf(term);
      if (i >= 0) { const s = Math.max(0, i - 40); hits[id] = (s ? '…' : '') + t.slice(s, i + term.length + 60).replace(/\s+/g, ' ') + '…'; if (Object.keys(hits).length >= 300) break; } }
    return send(res, 200, { hits }); }

  /* file details and access */
  mt = /^\/api\/files\/(f_[a-f0-9]+)$/.exec(p);
  if (mt && m === 'PATCH') { const f = fileOf(mt[1]), b = await readJson(req);
    if (!admin) { if (f.deletedAt || !access(f, uid).p.includes('e')) throw new HttpError(403, 'You may not edit this file. Ask the admin for edit access.');
      const name = str(b.name, 200); if (!name || name === f.name) return ok(); f.name = name; f.updatedAt = Date.now(); f.updatedBy = uid; consumeOnce(f, uid); save(); audit(uid, 'edit', 'Renamed to ' + name, { f: mt[1] }); return ok(); }
    const what = [];
    if (b.name != null && str(b.name, 200) && str(b.name, 200) !== f.name) { f.name = str(b.name, 200); what.push('name'); }
    if (b.folder != null && cleanPath(b.folder) !== (f.folder || '')) { f.folder = cleanPath(b.folder); what.push('folder'); }
    if (b.desc != null) f.desc = str(b.desc, 600); if (b.tags != null) f.tags = cleanTags(b.tags);
    if (b.docDate != null) f.docDate = isDate(b.docDate) ? b.docDate : ''; if (b.review != null) f.review = isDate(b.review) ? b.review : '';
    if (what.length || b.desc != null || b.tags != null || b.docDate != null || b.review != null) audit(uid, 'meta', f.name, { f: mt[1] });
    if (b.grants || b.ggrants || b.limits) { if (b.grants) f.grants = permMap(b.grants, db.users); if (b.ggrants) f.ggrants = permMap(b.ggrants, db.groups);
      if (b.limits && typeof b.limits === 'object') { f.limits = {}; for (const [k, v] of Object.entries(b.limits)) if (db.users[k] && +v > 0) f.limits[k] = Math.floor(+v); } audit(uid, 'access', f.name, { f: mt[1] }); }
    if (b.revokeOnce && f.once) { delete f.once[b.revokeOnce]; audit(uid, 'access', f.name + ': one-time edit revoked', { f: mt[1], u: b.revokeOnce }); }
    if (b.resetViews && f.views) { delete f.views[b.resetViews]; audit(uid, 'views', f.name, { f: mt[1], u: b.resetViews }); }
    if (b.restoreVersion != null) { const i = (f.versions || []).findIndex(x => x.v === +b.restoreVersion); if (i < 0) throw new HttpError(404, 'That version no longer exists.');
      const old = f.versions[i]; f.versions.splice(i, 1); f.versions.push({ v: f.v, name: f.name, size: f.size, mime: f.mime, at: f.updatedAt || f.at, by: f.updatedBy || f.by });
      Object.assign(f, { v: old.v, name: old.name, size: old.size, mime: old.mime, updatedAt: Date.now(), updatedBy: uid, hasText: false }); textCache.delete(mt[1]); audit(uid, 'version', f.name, { f: mt[1] }); }
    save(); return ok(); }
  if (p === '/api/bulk' && m === 'POST') { needAdmin(); const b = await readJson(req), ids = (Array.isArray(b.ids) ? b.ids : []).filter(id => db.files[id]);
    for (const id of ids) { const f = db.files[id];
      if (b.op === 'move') f.folder = cleanPath(b.folder);
      else if (b.op === 'bin') { f.deletedAt = Date.now(); audit(uid, 'bin', f.name, { f: id }); }
      else if (b.op === 'restore') { f.deletedAt = 0; audit(uid, 'restore', f.name, { f: id }); }
      else if (b.op === 'purge') { if (f.deletedAt) await purge(id, uid); }
      else if (b.op === 'access') { for (const [k, v] of Object.entries(permMap(b.grants, db.users))) if (v) f.grants[k] = normPerm((f.grants[k] || '') + v);
        for (const [k, v] of Object.entries(permMap(b.ggrants, db.groups))) if (v) f.ggrants[k] = normPerm((f.ggrants[k] || '') + v); } }
    if (b.op === 'move') audit(uid, 'move', ids.length + ' files to ' + (cleanPath(b.folder) || 'no folder')); if (b.op === 'access') audit(uid, 'access', 'Added access on ' + ids.length + ' files');
    save(); return ok(); }

  /* people, groups, folders, settings */
  if (p === '/api/users' && m === 'POST') { needAdmin(); const b = await readJson(req), username = str(b.username, 60).toLowerCase();
    if (!/^[a-z0-9._@-]{2,60}$/.test(username)) throw new HttpError(400, 'Usernames use letters, digits, dot, dash, underscore or @, at least 2 characters.');
    if (Object.values(db.users).some(x => x.username === username)) throw new HttpError(400, 'That username is already taken.'); goodPw(b.password);
    const id = rid('u_'); db.users[id] = { username, name: str(b.name, 80) || username, role: b.role === 'admin' ? 'admin' : 'user', active: true, groups: [], defaults: 'v', created: Date.now(), mustChange: true };
    setPw(db.users[id], b.password); save(); audit(uid, 'useradd', db.users[id].name, { u: id }); return ok({ id }); }
  mt = /^\/api\/users\/(u_[a-f0-9]+)$/.exec(p);
  if (mt && (m === 'PATCH' || m === 'DELETE')) { needAdmin(); const x = db.users[mt[1]]; if (!x) throw new HttpError(404, 'That user no longer exists.');
    const lastAdmin = () => x.role === 'admin' && Object.values(db.users).filter(y => y.role === 'admin' && y.active !== false).length <= 1;
    if (m === 'DELETE') { if (mt[1] === uid) throw new HttpError(400, 'You cannot remove yourself.'); if (lastAdmin()) throw new HttpError(400, 'The vault needs at least one admin.');
      delete db.users[mt[1]]; delete db.favs[mt[1]]; for (const [k, s] of Object.entries(db.sessions)) if (s.uid === mt[1]) delete db.sessions[k];
      for (const [k, r] of Object.entries(db.requests)) if (r.uid === mt[1]) delete db.requests[k];
      for (const f of Object.values(db.files)) for (const key of ['grants', 'limits', 'once', 'views']) if (f[key]) delete f[key][mt[1]];
      for (const d of Object.values(db.folders)) if (d.grants) delete d.grants[mt[1]]; save(); audit(uid, 'userremove', x.name); return ok(); }
    const b = await readJson(req), what = [];
    if ((b.role && b.role !== x.role && x.role === 'admin' || b.active === false) && (lastAdmin() || mt[1] === uid)) throw new HttpError(400, mt[1] === uid ? 'You cannot demote or deactivate yourself.' : 'The vault needs at least one admin.');
    if (b.name != null && str(b.name, 80)) { x.name = str(b.name, 80); what.push('name'); }
    if (b.role === 'admin' || b.role === 'user') { if (x.role !== b.role) what.push('role: ' + b.role); x.role = b.role; }
    if (typeof b.active === 'boolean') { if (x.active !== b.active) what.push(b.active ? 'activated' : 'deactivated'); x.active = b.active; if (!b.active) for (const [k, s] of Object.entries(db.sessions)) if (s.uid === mt[1]) delete db.sessions[k]; }
    if (Array.isArray(b.groups)) { x.groups = b.groups.filter(g => db.groups[g]); what.push('groups'); }
    if (b.defaults != null) { x.defaults = normPerm(b.defaults); what.push('default access'); }
    if (b.password != null) { goodPw(b.password); setPw(x, b.password); x.mustChange = true; for (const [k, s] of Object.entries(db.sessions)) if (s.uid === mt[1]) delete db.sessions[k]; what.push('password reset'); }
    if (b.applyDefaults) { for (const f of Object.values(db.files)) if (!f.deletedAt) { if (x.defaults) f.grants[mt[1]] = x.defaults; else delete f.grants[mt[1]]; } what.push('default access applied to all files'); }
    save(); audit(uid, 'userchange', what.join(', '), { u: mt[1] }); return ok(); }
  if (p === '/api/groups' && m === 'POST') { needAdmin(); const b = await readJson(req), name = str(b.name, 60); if (!name) throw new HttpError(400, 'The group needs a name.');
    const id = rid('g_'); db.groups[id] = { name, defaults: '' }; save(); audit(uid, 'group', 'Created ' + name); return ok({ id }); }
  mt = /^\/api\/groups\/(g_[a-f0-9]+)$/.exec(p);
  if (mt && (m === 'PATCH' || m === 'DELETE')) { needAdmin(); const g = db.groups[mt[1]]; if (!g) throw new HttpError(404, 'That group no longer exists.');
    if (m === 'DELETE') { delete db.groups[mt[1]]; for (const f of Object.values(db.files)) if (f.ggrants) delete f.ggrants[mt[1]]; for (const d of Object.values(db.folders)) if (d.ggrants) delete d.ggrants[mt[1]];
      save(); audit(uid, 'group', 'Deleted ' + g.name); return ok(); }
    const b = await readJson(req); if (b.name != null && str(b.name, 60)) g.name = str(b.name, 60); if (b.defaults != null) g.defaults = normPerm(b.defaults); save(); audit(uid, 'group', g.name + ' changed'); return ok(); }
  if (p === '/api/folders' && m === 'PUT') { needAdmin(); const b = await readJson(req), fp = cleanPath(b.path); if (!fp) throw new HttpError(400, 'The folder needs a name.');
    const d = db.folders[fp] || (db.folders[fp] = { grants: {}, ggrants: {} }); if (b.grants) d.grants = permMap(b.grants, db.users); if (b.ggrants) d.ggrants = permMap(b.ggrants, db.groups);
    save(); audit(uid, b.grants || b.ggrants ? 'folderaccess' : 'folder', fp); return ok(); }
  if (p === '/api/folders' && m === 'DELETE') { needAdmin(); const fp = cleanPath(q.get('path'));
    if (Object.values(db.files).some(f => !f.deletedAt && (f.folder === fp || (f.folder || '').startsWith(fp + '/')))) throw new HttpError(400, 'Move or delete the files in this folder first.');
    for (const k of Object.keys(db.folders)) if (k === fp || k.startsWith(fp + '/')) delete db.folders[k]; save(); audit(uid, 'folder', 'Deleted ' + fp); return ok(); }
  if (p === '/api/settings' && m === 'PATCH') { needAdmin(); const b = await readJson(req); if (/^#[0-9a-fA-F]{6}$/.test(b.brand || '')) db.settings.brand = b.brand.toLowerCase(); save(); audit(uid, 'settings', 'Theme colour ' + db.settings.brand); return ok(); }

  /* requests, comments, favourites, copy log */
  if (p === '/api/requests' && m === 'POST') { const b = await readJson(req), f = fileOf(b.fid), a = access(f, uid); if (admin || !a.listed) throw new HttpError(403, 'Not allowed.');
    const want = [...'dcem'].filter(c => String(b.want || '').includes(c)).join(''); if (!want) throw new HttpError(400, 'Tick what you need first.');
    for (const [k, r] of Object.entries(db.requests)) if (r.uid === uid && r.fid === b.fid) delete db.requests[k];
    db.requests[rid('r_')] = { uid, fid: b.fid, want, note: str(b.note, 300), at: Date.now() }; save(); audit(uid, 'request', f.name, { f: b.fid }); return ok(); }
  mt = /^\/api\/requests\/(r_[a-f0-9]+)\/decide$/.exec(p);
  if (mt && m === 'POST') { needAdmin(); const r = db.requests[mt[1]]; if (!r) throw new HttpError(404, 'That request was already handled.'); const b = await readJson(req), f = db.files[r.fid];
    if (b.ok && f && db.users[r.uid]) { const add = normPerm(r.want.replace(/[^dc]/g, '')); if (add) f.grants[r.uid] = normPerm((f.grants[r.uid] || '') + add);
      if (r.want.includes('e')) { f.once = f.once || {}; f.once[r.uid] = true; } if (r.want.includes('m') && f.views) delete f.views[r.uid]; }
    delete db.requests[mt[1]]; save(); audit(uid, b.ok ? 'approve' : 'refuse', f ? f.name : '', { f: r.fid, u: r.uid }); return ok(); }
  mt = /^\/api\/files\/(f_[a-f0-9]+)\/comments$/.exec(p);
  if (mt && m === 'POST') { const f = fileOf(mt[1]), b = await readJson(req), x = str(b.x, 1000); if (!x) throw new HttpError(400, 'Write something first.');
    const who = admin ? b.uid : uid; if (!db.users[who] || (!admin && !access(f, uid).listed)) throw new HttpError(403, 'Not allowed.');
    const c = db.comments[mt[1]] || (db.comments[mt[1]] = {}); c[who] = (c[who] || []).concat([{ t: Date.now(), by: uid, x }]).slice(-200); save();
    audit(uid, admin ? 'reply' : 'comment', f.name, admin ? { f: mt[1], u: who } : { f: mt[1] }); return ok(); }
  if (p === '/api/favs' && m === 'POST') { const b = await readJson(req), list = (db.favs[uid] || []).filter(x => x !== b.fid && db.files[x]); if (b.on && db.files[b.fid]) list.push(b.fid); db.favs[uid] = list.slice(-500); save(); return ok(); }
  if (p === '/api/log' && m === 'POST') { const b = await readJson(req), f = fileOf(b.fid); if (b.a !== 'copy' || !access(f, uid).p.includes('c')) throw new HttpError(403, 'Not allowed.'); audit(uid, 'copy', f.name, { f: b.fid }); return ok(); }

  /* live monitoring */
  if (p === '/api/ping' && m === 'POST') { const b = await readJson(req), now = Date.now(), old = presence.get(sess.key), fid = db.files[b.fid] ? b.fid : '';
    presence.set(sess.key, { uid, t: now, since: old && now - old.t < 60000 ? old.since : now, ip: ip.replace(/^::ffff:/, ''), ua: str(req.headers['user-agent'], 300), tab: str(b.tab, 20), fid,
      scroll: Math.max(0, Math.min(1, +b.scroll || 0)), idle: Math.max(0, Math.floor(+b.idle || 0)), hidden: !!b.hidden, folder: cleanPath(b.folder), q: str(b.q, 80), dialog: str(b.dialog, 120) });
    if (now - (u.lastSeen || 0) > 6e4) { u.lastSeen = now; save(); } return ok(); }
  if (p === '/api/live' && m === 'GET') { needAdmin(); const now = Date.now(), sessions = [];
    for (const [k, v] of presence) if (now - v.t < 20000 && db.users[v.uid]) sessions.push(Object.assign({ key: k.slice(0, 16), name: db.files[v.fid] ? db.files[v.fid].name : '' }, v));
    return send(res, 200, { now, sessions, recent: events.slice(-40).reverse() }); }
  if (p === '/api/live/watch' && m === 'POST') { needAdmin(); const b = await readJson(req); if (!db.users[b.uid]) throw new HttpError(404, 'That user no longer exists.'); audit(uid, 'watch', '', { u: b.uid }); return ok(); }
  mt = /^\/api\/users\/(u_[a-f0-9]+)\/kick$/.exec(p);
  if (mt && m === 'POST') { needAdmin(); if (mt[1] === uid) throw new HttpError(400, 'Use Sign out for your own session.'); if (!db.users[mt[1]]) throw new HttpError(404, 'That user no longer exists.');
    for (const [k, s] of Object.entries(db.sessions)) if (s.uid === mt[1]) { delete db.sessions[k]; presence.delete(k); } save(); audit(uid, 'kick', '', { u: mt[1] }); return ok(); }

  if (p === '/api/audit' && m === 'GET') { needAdmin(); const from = +q.get('from') || Date.now() - 90 * DAY, to = +q.get('to') || Infinity, out = [];
    for (let i = events.length - 1; i >= 0 && out.length < 50000; i--) { const e = events[i]; if (e.t < from) break; if (e.t <= to) out.push(e); } return send(res, 200, { events: out, total: events.length }); }
  throw new HttpError(404, 'Not found');
}

const server = http.createServer((req, res) => {
  let url; try { url = new URL(req.url, 'http://x'); } catch (e) { return send(res, 400, { error: 'Bad request' }); }
  if (!url.pathname.startsWith('/api/')) { if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Not allowed' }); let p; try { p = decodeURIComponent(url.pathname); } catch (e) { return send(res, 400, { error: 'Bad request' }); } return serveStatic(req, res, p); }
  api(req, res, url).catch(e => { if (res.headersSent) return res.destroy(); if (!(e instanceof HttpError)) console.error(new Date().toISOString(), req.method, url.pathname, e);
    send(res, e instanceof HttpError ? e.status : 500, { error: e instanceof HttpError ? e.message : 'The server hit a problem. Check the server log.', code: e.code }); });
});
server.requestTimeout = 0; server.headersTimeout = 60000; server.timeout = 0;
server.on('error', e => fatal(e.code === 'EADDRINUSE' ? 'Port ' + PORT + ' is already in use. Numero Vault is probably already running in another window. Close it, or start this one on another port (set PORT).' : e.message));
process.on('uncaughtException', e => logError('uncaught', e));
process.on('unhandledRejection', e => logError('unhandled', e));
server.listen(PORT, HOST, () => console.log('Numero Vault is running on http://localhost:' + PORT + '  (data folder: ' + DATA + ')'));
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) process.on(sig, () => process.exit(0));
process.on('exit', () => { flush(); try { if (+fs.readFileSync(LOCK, 'utf8') === process.pid) fs.unlinkSync(LOCK); } catch (e) {} });
