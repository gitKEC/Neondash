// Classement partagé (Upstash Redis, offre gratuite connectée au projet Vercel).
// GET  /api/scores            -> top Infini + top étoiles
// POST /api/scores {id,name,best,stars} -> enregistre le pseudo et les meilleurs scores
// Nettoie les erreurs de copier-coller fréquentes (guillemets, espaces, « NOM= » devant la valeur)
function clean(v) { return String(v || '').trim().replace(/^[A-Z_]+=/, '').replace(/^["'\s]+|["'\s]+$/g, ''); }
const URL_ = clean(process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL);
const TOKEN = clean(process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN);
const K = { names: 'nd:names', endless: 'nd:endless', stars: 'nd:stars' };
const TOP = 50;

function send(res, status, obj) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json');
  res.status(status).send(JSON.stringify(obj));
}

async function pipeline(cmds) {
  const r = await fetch(URL_.replace(/\/+$/, '') + '/pipeline', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmds)
  });
  if (!r.ok) throw new Error('Redis HTTP ' + r.status);
  const out = await r.json();
  return out.map(function (x) { if (x.error) throw new Error(x.error); return x.result; });
}

function pairs(flat) {
  const out = [];
  for (let i = 0; i + 1 < (flat || []).length; i += 2) out.push({ id: flat[i], score: Number(flat[i + 1]) });
  return out;
}

async function board(id) {
  const res = await pipeline([
    ['ZREVRANGE', K.endless, '0', String(TOP - 1), 'WITHSCORES'],
    ['ZREVRANGE', K.stars, '0', String(TOP - 1), 'WITHSCORES'],
    ['ZCARD', K.endless],
    ['ZCARD', K.stars]
  ]);
  const e = pairs(res[0]), s = pairs(res[1]);
  const ids = Array.from(new Set(e.concat(s).map(function (x) { return x.id; }).concat(id ? [id] : [])));
  let names = [];
  const extra = [];
  if (ids.length) extra.push(['HMGET', K.names].concat(ids));
  if (id) extra.push(['ZREVRANK', K.endless, id], ['ZSCORE', K.endless, id], ['ZREVRANK', K.stars, id], ['ZSCORE', K.stars, id]);
  const ex = extra.length ? await pipeline(extra) : [];
  if (ids.length) names = ex.shift() || [];
  const nameOf = {};
  ids.forEach(function (x, i) { nameOf[x] = names[i] || 'Joueur'; });
  const fill = function (l) { return l.map(function (x) { return { id: x.id, name: nameOf[x.id], score: x.score }; }); };
  const me = id ? {
    endlessRank: ex[0] == null ? null : ex[0] + 1, endless: ex[1] == null ? null : Number(ex[1]),
    starsRank: ex[2] == null ? null : ex[2] + 1, stars: ex[3] == null ? null : Number(ex[3])
  } : null;
  return { endless: fill(e), stars: fill(s), players: Math.max(res[2] || 0, res[3] || 0), me: me };
}

module.exports = async function handler(req, res) {
  if (!URL_ || !TOKEN) return send(res, 503, { error: 'NOSTORE', message: 'Base de données du classement non connectée.' });
  try {
    if (req.method === 'GET') {
      const id = String((req.query && req.query.id) || '').slice(0, 40);
      return send(res, 200, await board(/^[a-z0-9-]{8,40}$/i.test(id) ? id : null));
    }
    if (req.method === 'POST') {
      let b = req.body || {};
      if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = {}; } }
      const id = String(b.id || '');
      if (!/^[a-z0-9-]{8,40}$/i.test(id)) return send(res, 400, { error: 'BADID' });
      const name = String(b.name || '').replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, 16);
      if (name.length < 2) return send(res, 400, { error: 'BADNAME', message: 'Pseudo trop court.' });
      const best = Math.floor(Number(b.best) || 0), stars = Math.floor(Number(b.stars) || 0);
      if (best < 0 || best > 50000 || stars < 0 || stars > 60) return send(res, 400, { error: 'BADSCORE' });
      const cmds = [['HSET', K.names, id, name]];
      if (best > 0) cmds.push(['ZADD', K.endless, 'GT', String(best), id]);
      if (stars > 0) cmds.push(['ZADD', K.stars, 'GT', String(stars), id]);
      await pipeline(cmds);
      return send(res, 200, await board(id));
    }
    return send(res, 405, { error: 'METHOD' });
  } catch (e) {
    return send(res, 502, { error: 'STORE', message: e.message });
  }
};
