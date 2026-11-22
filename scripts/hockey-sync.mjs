// Lee resultados y clasificaciones de resultadoshockey.isquad.es y los guarda en hockey-data.json
// (lo ejecuta GitHub Actions cada pocas horas; la app lee ese archivo). Sin dependencias: Node 20+.
import fs from 'node:fs';

const HOST = 'resultadoshockey.isquad.es';
const OUT = 'hockey-data.json';
// Para cambiar de competición/temporada, edita estas URLs (si no llevan "id=", se busca el id vigente en la página).
const SOURCES = [
  { div: 'DHA', url: 'https://resultadoshockey.isquad.es/competicion.php?id_superficie=1&seleccion=0&id_categoria=8&id_temp=2627&id_ambito=0&id_territorial=9999' },
  { div: 'DHB', url: 'https://resultadoshockey.isquad.es/calendario.php?seleccion=0&id=9363&id_ambito=0&id_territorial=9999&id_superficie=1&iframe=0' },
];

async function getHtml(url) {
  const r = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
    },
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const buf = await r.arrayBuffer();
  return new TextDecoder('utf-8').decode(buf);
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
  const mm = html.match(/calendario\.php\?[^"']*?\bid=(\d+)/);
  if (!mm) throw new Error('No se encontró el id de la competición');
  return mm[1];
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  let prev = { divs: {}, errors: {} };
  try { prev = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch (e) { /* primera vez */ }
  const next = { updated: prev.updated || null, divs: { ...(prev.divs || {}) }, errors: {} };
  let ok = 0;
  for (const s of SOURCES) {
    try {
      const compId = await resolveCompId(s.url);
      await sleep(1000);
      const cal = await getHtml(`https://${HOST}/calendario.php?seleccion=0&id=${compId}&id_ambito=0&id_territorial=9999&id_superficie=1&iframe=0`);
      await sleep(1000);
      const cla = await getHtml(`https://${HOST}/clasificacion.php?seleccion=0&id=${compId}&id_ambito=0&id_territorial=9999&id_superficie=1&iframe=0`);
      const matches = parseCalendar(cal);
      const standings = parseStandings(cla);
      if (!matches.length && !standings.rows.length) throw new Error('La página no contiene datos (¿ha cambiado el formato?)');
      next.divs[s.div] = { compId, matches, standings };
      ok++;
      console.log(`${s.div}: ${matches.length} partidos, ${standings.rows.length} filas de clasificación`);
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
