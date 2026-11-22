// Lee resultados y clasificaciones de resultadoshockey.isquad.es y los guarda en hockey-data.json
// (lo ejecuta GitHub Actions cada pocas horas; la app lee ese archivo). Sin dependencias: Node 20+.
import fs from 'node:fs';

const HOST = 'resultadoshockey.isquad.es';
const OUT = 'hockey-data.json';
// Para cambiar de competición/temporada, edita estas URLs (si no llevan "id=", se busca el id vigente en la página).
const SOURCES = [
  { div: 'DHA', url: 'https://resultadoshockey.isquad.es/calendario.php?seleccion=0&id=9356&id_ambito=0&id_territorial=9999&id_superficie=1&iframe=0' },
  { div: 'DHB', url: 'https://resultadoshockey.isquad.es/calendario.php?seleccion=0&id=9363&id_ambito=0&id_territorial=9999&id_superficie=1&iframe=0' },
];

// La web sirve páginas "clásicas" (con los datos en el HTML) o una app "beta" (sin datos en el HTML) según el cliente.
// Se prueban varios identificadores hasta recibir la clásica.
const UAS = [
  'Mozilla/5.0 (compatible; EOS-XE-hockey-sync)',
  'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  'curl/8.5.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
];
const isBeta = html => /<title>[^<]*BETA/i.test(html) || /\/maqueta\//.test(html.slice(0, 3000));

async function getHtml(url) {
  let lastErr = null;
  for (const ua of UAS) {
    try {
      const r = await fetch(url, {
        headers: {
          'User-Agent': ua,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
        },
        signal: AbortSignal.timeout(20000),
      });
      if (!r.ok) { lastErr = new Error('HTTP ' + r.status); console.log(`  [${ua.slice(0, 28)}] HTTP ${r.status}`); continue; }
      const buf = await r.arrayBuffer();
      const html = new TextDecoder('utf-8').decode(buf);
      const t = (html.match(/<title>([^<]*)<\/title>/i) || [])[1] || '?';
      console.log(`  [${ua.slice(0, 28)}] ${r.url.replace(/^https?:\/\/[^/]+/, '').slice(0, 70)} -> "${t.trim().slice(0, 50)}" (${html.length} bytes)`);
      if (isBeta(html)) { lastErr = new Error('La web ha devuelto la versión beta (sin datos)'); continue; }
      return html;
    } catch (e) { lastErr = e; console.log(`  [${ua.slice(0, 28)}] ${String((e && e.message) || e)}`); }
  }
  throw lastErr || new Error('Sin respuesta');
}

function decodeEntities(s) {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(+n));
}

export function parseCalendar(html) {
  const out = [];
  const rows = html.split(/<tr[\s>]/i).slice(1);
  let jornada = null;
  for (const chunk of rows) {
    const row = chunk.split(/<\/tr>/i)[0];
    const txt = decodeEntities(row.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    const jm = /^VS\s/.test(txt) ? null : txt.match(/JORNADA\s+(\d+)\s*\(/i);
    if (jm) { jornada = +jm[1]; continue; }
    const m = txt.match(
      /^VS\s+(.+?)\s+-\s+(.+?)(?:\s+(\d+)\s*-\s*(\d+)|\s+-)?\s+(\d{1,2}):(\d{2})\s+(\d{2})\/(\d{2})\/(\d{4})(?:\s|$)/,
    );
    if (!m) continue;
    const [, home, away, hs, as_, hh, mm, dd, mo, yy] = m;
    out.push({
      jornada,
      home: home.trim(),
      away: away.trim(),
      hs: hs === undefined ? null : +hs,
      as: as_ === undefined ? null : +as_,
      // 0:00 = "hora por confirmar" en la web federativa
      time: (+hh === 0 && +mm === 0) ? null : String(hh).padStart(2, '0') + ':' + mm,
      date: `${yy}-${mo}-${dd}`,
    });
  }
  return out;
}

export function parseStandings(html) {
  const rows = [];
  const RE =
    /^(\d+)\s+(?:(-?\d+)\s+)?(.+?)\s+((?:[GEP-]\s+){0,5})(-?\d+)\s+(\d+)\s+(\d+)\s+\d+\s*%\s+(\d+)\s+\d+\s*%\s+(\d+)\s+\d+\s*%\s+(\d+)\s+[\d.,]+\s*gol\/part\.?\s+(\d+)\s+[\d.,]+\s*gol\/part\.?\s+(-?\d+)\s*$/;
  for (const chunk of html.split(/<tr[\s>]/i).slice(1)) {
    const row = chunk.split(/<\/tr>/i)[0];
    const txt = decodeEntities(row.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    const m = txt.match(RE);
    if (!m) continue;
    rows.push({
      pos: +m[1], mov: m[2] === undefined ? 0 : +m[2], team: m[3].trim(),
      form: m[4].replace(/\s+/g, ''), pt: +m[5], pj: +m[6], pg: +m[7], pe: +m[8], pp: +m[9],
      gf: +m[10], gc: +m[11], dif: +m[12],
    });
  }
  const all = decodeEntities(html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ');
  const j = all.match(/Jornada\s+(\d+)\s*\(\s*(\d{2})-(\d{2})-(\d{4})\s*\)/);
  const h = html.match(/<h4[^>]*>\s*([^<]*?(?:FASE|LIGA|GRUPO)[^<]*?)\s*<\/h4>/i);
  return {
    rows,
    jornada: j ? +j[1] : null,
    date: j ? `${j[4]}-${j[3]}-${j[2]}` : null,
    stage: h ? decodeEntities(h[1]).replace(/\s+/g, ' ').trim() : null,
  };
}

async function resolveCompId(rawUrl) {
  const u = new URL(rawUrl);
  if (u.hostname !== HOST) throw new Error('Dominio no permitido');
  const direct = u.searchParams.get('id');
  if (direct && /^\d+$/.test(direct)) return direct;
  const html = await getHtml(u.toString());
  const cats = {};
  for (const m of html.matchAll(/<a[^>]*href="[^"]*id_categoria=(\d+)[^"]*"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const t = decodeEntities(m[2].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    if (t) cats[m[1]] = t;
  }
  if (Object.keys(cats).length) console.log('  categorías:', JSON.stringify(cats));
  const mm = html.match(/calendario\.php\?[^"']*?\bid=(\d+)/);
  if (!mm) throw new Error('No se encontró el id de la competición');
  return mm[1];
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// --- API JSON de la web BETA (json/beta.php): es lo que ve la web desde los servidores de GitHub ---
let _sess = null;
async function betaSession() {
  if (_sess) return _sess;
  const r = await fetch(`https://${HOST}/maqueta/`, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; EOS)', 'Accept-Language': 'es-ES,es;q=0.9' } });
  if (!r.ok) throw new Error('beta HTTP ' + r.status);
  const html = await r.text();
  const tm = html.match(/<meta[^>]*name="client-token"[^>]*content="([^"]*)"/i) || html.match(/<meta[^>]*content="([^"]*)"[^>]*name="client-token"/i);
  const cookies = (r.headers.getSetCookie ? r.headers.getSetCookie() : []).map(c => c.split(';')[0]).join('; ');
  _sess = { token: tm ? tm[1] : '', cookies };
  return _sess;
}
async function betaApi(datos) {
  const s = await betaSession();
  const r = await fetch(`https://${HOST}/maqueta/json/beta.php`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Client-Token': s.token, 'Cookie': s.cookies, 'User-Agent': 'Mozilla/5.0 (compatible; EOS)', 'Accept-Language': 'es-ES,es;q=0.9' },
    body: new URLSearchParams(datos),
  });
  if (!r.ok) throw new Error('API HTTP ' + r.status);
  return r.json();
}
function matchesFromApi(j) {
  // Partidos aplazados: la federación mantiene la fecha original (sin resultado) además de la nueva.
  // Si hay dos entradas de la misma jornada y mismos equipos, se queda la que tiene resultado (o la más tardía).
  const seen = {};
  const raw = j.partidos || [];
  raw.forEach(p => {
    const k = p.j + '|' + (p.l && p.l.id) + '|' + (p.v && p.v.id);
    const cur = seen[k];
    const better = !cur || (cur.gl == null && p.gl != null) || ((cur.gl == null) === (p.gl == null) && String(p.fecha) > String(cur.fecha));
    if (better) seen[k] = p;
  });
  return raw.filter(p => seen[p.j + '|' + (p.l && p.l.id) + '|' + (p.v && p.v.id)] === p).map(p => {
    const [d, t] = String(p.fecha || '').split(' ');
    const hhmm = (t || '').slice(0, 5);
    return {
      jornada: p.j == null ? null : +p.j,
      home: p.l && p.l.n, away: p.v && p.v.n,
      hs: p.gl == null ? null : +p.gl, as: p.gv == null ? null : +p.gv,
      time: (!hhmm || hhmm === '00:00') ? null : hhmm,
      date: d,
      _fase: p.fase || '',
    };
  }).filter(m => m.home && m.away && m.date).sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));
}
// Clasificación calculada a partir de los resultados (3-1-0) de la fase en curso: respaldo si la página clásica no está disponible.
function standingsFromMatches(ms) {
  const played = ms.filter(m => m.hs != null && m.as != null);
  if (!played.length) return { rows: [], jornada: null, date: null, stage: null };
  const last = played[played.length - 1];
  const fase = last._fase;
  const T = {};
  const get = n => T[n] || (T[n] = { team: n, pt: 0, pj: 0, pg: 0, pe: 0, pp: 0, gf: 0, gc: 0, hist: [] });
  for (const m of played.filter(x => x._fase === fase)) {
    const a = get(m.home), b = get(m.away);
    a.pj++; b.pj++; a.gf += m.hs; a.gc += m.as; b.gf += m.as; b.gc += m.hs;
    if (m.hs > m.as) { a.pg++; a.pt += 3; b.pp++; a.hist.push('G'); b.hist.push('P'); }
    else if (m.hs < m.as) { b.pg++; b.pt += 3; a.pp++; a.hist.push('P'); b.hist.push('G'); }
    else { a.pe++; b.pe++; a.pt++; b.pt++; a.hist.push('E'); b.hist.push('E'); }
  }
  const rows = Object.values(T).map(t => ({ ...t, dif: t.gf - t.gc }))
    .sort((x, y) => y.pt - x.pt || y.dif - x.dif || y.gf - x.gf || x.team.localeCompare(y.team))
    .map((t, i) => ({ pos: i + 1, mov: 0, team: t.team, form: t.hist.slice(-5).join(''), pt: t.pt, pj: t.pj, pg: t.pg, pe: t.pe, pp: t.pp, gf: t.gf, gc: t.gc, dif: t.dif }));
  return { rows, jornada: last.jornada, date: last.date, stage: fase || null };
}
async function classicStandings(compId) {
  // Cookie «versión clásica» (y ?clasica=1) para que la web no redirija a la beta.
  const url = `https://${HOST}/clasificacion.php?seleccion=0&id=${compId}&id_ambito=0&id_territorial=9999&id_superficie=1&iframe=0&clasica=1`;
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36', 'Cookie': 'resultados_version=clasica-sesion', 'Accept-Language': 'es-ES,es;q=0.9' }, redirect: 'follow' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const html = new TextDecoder('utf-8').decode(await r.arrayBuffer());
  if (/Resultados ESHOCKEY · BETA/.test(html)) throw new Error('beta');
  return parseStandings(html);
}

async function main() {
  let prev = { divs: {}, errors: {} };
  try { prev = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch (e) { /* primera vez */ }
  const next = { updated: prev.updated || null, divs: { ...(prev.divs || {}) }, errors: {} };
  let ok = 0;
  for (const s of SOURCES) {
    try {
      const compId = new URL(s.url).searchParams.get('id');
      if (!compId || !/^\d+$/.test(compId)) throw new Error('Falta el id de la competición en SOURCES');
      const api = await betaApi({ tipo: 'torneo', id: compId });
      const all = matchesFromApi(api);
      if (!all.length) throw new Error('La API no devolvió partidos');
      let standings, via = 'clásica';
      try { standings = await classicStandings(compId); if (!standings.rows.length) throw new Error('vacía'); }
      catch (e) { standings = standingsFromMatches(all); via = 'calculada (' + ((e && e.message) || e) + ')'; }
      const matches = all.map(({ _fase, ...m }) => m);
      next.divs[s.div] = { compId, matches, standings };
      ok++;
      console.log(`${s.div}: ${matches.length} partidos, ${standings.rows.length} filas de clasificación [${via}]`);
    } catch (e) {
      next.errors[s.div] = String((e && e.message) || e);
      console.error(`${s.div}: ${next.errors[s.div]}`);
    }
    await sleep(1000);
  }
  // Solo se reescribe (y cambia 'updated') si los datos o los errores son distintos: así no hay un commit por ejecución.
  const strip = o => JSON.stringify({ divs: o.divs || {}, errors: o.errors || {} });
  if (strip(next) !== strip(prev)) {
    next.updated = new Date().toISOString();
    fs.writeFileSync(OUT, JSON.stringify(next, null, 1) + '\n');
    console.log('hockey-data.json actualizado');
  } else {
    console.log('Sin cambios');
  }
  if (ok === 0) process.exit(1);
}

if (process.argv[1] && process.argv[1].endsWith('hockey-sync.mjs')) main();
