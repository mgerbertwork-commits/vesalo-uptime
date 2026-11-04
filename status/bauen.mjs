#!/usr/bin/env node
/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Daten fuer die oeffentliche Status-Seite (status.vesalo.de)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Woher die Zahlen kommen: aus den Vorfall-Issues (Label `uptime-incident`),
 * die der Waechter ohnehin schreibt. Ein Ziel gilt als gestoert von der
 * Bestaetigung (3 Versuche) bis zur Entwarnung. Das IST die Messhistorie —
 * es braucht keinen zweiten Speicher, keine Commits und keinen Cache.
 *
 *   Beginn        `since` im Zustandskommentar des Issues (sonst created_at)
 *   erste Ziele   Titel „Auffaellig: a, b (…)“ — der Issue-Text wird bei jedem
 *                 Lauf ueberschrieben und kennt nur den LETZTEN Stand
 *   Aenderungen   Kommentare „Lage geändert“ („Neu gestört“ / „Wieder
 *                 erreichbar“), Zeitpunkt = created_at des Kommentars
 *   Ende          closed_at (offener Vorfall: jetzt)
 *
 * 🔴 OEFFENTLICH IST NUR DIE POSITIVLISTE `DIENSTE`. Immospur-Ziele (nicht
 * beworbene Adresse), Sicherungen und interne Ziele erscheinen NIE in der
 * Ausgabe — weder als Dienst noch in einem Vorfall. Auch Issue-Texte,
 * Autoren oder Links werden nicht uebernommen: die Ausgabe enthaelt nur
 * Zeitpunkte, Dauern und die Schluessel der Positivliste.
 *
 * Aufruf (im Workflow): node status/bauen.mjs  → schreibt site/daten.json
 * Lokal:  GITHUB_TOKEN=$(gh auth token) GITHUB_REPOSITORY=mgerbertwork-commits/vesalo-uptime node status/bauen.mjs
 */

import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Reihenfolge = Reihenfolge auf der Seite. `ab` = seit wann der Waechter das
// Ziel prueft (erster Commit des Ziels); davor gibt es keine Messung.
export const DIENSTE = [
  { key: 'www', ab: '2026-08-09T11:29:59Z' },
  { key: 'app', ab: '2026-08-09T11:29:59Z' },
  { key: 'api', ab: '2026-08-09T11:29:59Z' },
  { key: 'kontaktformular', ab: '2026-08-10T17:58:29Z' },
];
const OEFFENTLICH = new Set(DIENSTE.map((d) => d.key));

export const TAGE = 90;
const ZONE = 'Europe/Berlin';
const MIN = 60_000;

// ─── Zeit in Europe/Berlin ──────────────────────────────────────────────────
const tagFmt = new Intl.DateTimeFormat('sv-SE', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
/** Kalendertag (YYYY-MM-DD) eines Zeitpunkts in Berlin. */
export const berlinTag = (ms) => tagFmt.format(new Date(ms));

/** Mitternacht (Berlin) des Tages `tag` als UTC-Millisekunden — sommerzeitfest. */
export function tagesbeginn(tag) {
  const [y, m, d] = tag.split('-').map(Number);
  // Kandidaten +1 h / +2 h: genau einer davon faellt in Berlin auf 00:00 dieses Tages.
  for (const off of [1, 2]) {
    const t = Date.UTC(y, m - 1, d, 0, 0, 0) - off * 3600_000;
    if (berlinTag(t) === tag && berlinTag(t - 1) !== tag) return t;
  }
  throw new Error(`Tagesbeginn nicht bestimmbar: ${tag}`);
}
const naechsterTag = (tag) => berlinTag(tagesbeginn(tag) + 26 * 3600_000);

// ─── Vorfall-Issues → Stoerungsintervalle je Ziel ───────────────────────────
const STATE_RE = /<!--\s*vesalo-uptime-state:\s*({[\s\S]*?})\s*-->/;
const schluessel = (text) => [...String(text || '').matchAll(/`([a-z0-9-]+)`/g)].map((m) => m[1]);

function parseUtc(s) {
  // „2026-08-15 18:53:04 UTC“
  const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) UTC$/.exec(String(s || '').trim());
  return m ? Date.parse(`${m[1]}T${m[2]}Z`) : NaN;
}

/**
 * @param issue  GitHub-Issue (number, title, body, created_at, closed_at, state)
 * @param kommentare  Kommentare des Issues (body, created_at)
 * @returns {Array<{key, von, bis}>}  nur oeffentliche Ziele
 */
export function intervalle(issue, kommentare, jetzt) {
  let state = {};
  try {
    state = JSON.parse(STATE_RE.exec(issue.body || '')?.[1] || '{}');
  } catch {
    state = {};
  }
  const beginn = Number.isFinite(parseUtc(state.since)) ? parseUtc(state.since) : Date.parse(issue.created_at);
  const ende = issue.closed_at ? Date.parse(issue.closed_at) : jetzt;

  // Erste Ziele aus dem Titel: „🔴 Auffaellig: a, b (2026-…)“
  const titel = /:\s*([a-z0-9,\s-]+?)\s*\(/.exec(issue.title || '');
  const erste = titel ? titel[1].split(',').map((s) => s.trim()).filter(Boolean) : state.failing || [];

  const offen = new Map(erste.map((k) => [k, beginn]));
  const aus = [];
  const schliesse = (k, t) => {
    if (offen.has(k)) {
      aus.push({ key: k, von: offen.get(k), bis: t });
      offen.delete(k);
    }
  };
  const lage = kommentare
    .filter((c) => /Lage geändert/.test(c.body || ''))
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  for (const c of lage) {
    const t = Date.parse(c.created_at);
    if (t > ende) break;
    const neu = schluessel(/Neu gestört:([^\n]*)/.exec(c.body)?.[1]);
    const zurueck = schluessel(/Wieder erreichbar:([^\n]*)/.exec(c.body)?.[1]);
    for (const k of zurueck) schliesse(k, t);
    for (const k of neu) if (!offen.has(k)) offen.set(k, t);
  }
  for (const k of [...offen.keys()]) schliesse(k, ende);
  return aus.filter((i) => OEFFENTLICH.has(i.key) && i.bis > i.von);
}

// ─── Aggregation ────────────────────────────────────────────────────────────
/**
 * Reine Funktion — lokal pruefbar ohne Netz.
 * @param vorfaelle  Array<{ issue, kommentare }>
 * @param jetzt      ms
 * @param letztePruefung  ISO-Zeit des letzten Waechter-Laufs oder null
 */
export function berechne(vorfaelle, jetzt, letztePruefung = null) {
  const heute = berlinTag(jetzt);
  const tage = [];
  let t = tagesbeginn(heute);
  for (let i = 0; i < TAGE; i++) {
    tage.unshift(berlinTag(t));
    t -= 20 * 3600_000; // irgendwo in den Vortag
    t = tagesbeginn(berlinTag(t));
  }
  const fensterBeginn = tagesbeginn(tage[0]);

  const alle = vorfaelle.flatMap(({ issue, kommentare }) =>
    intervalle(issue, kommentare, jetzt).map((iv) => ({ ...iv, offen: !issue.closed_at, nr: issue.number })),
  );

  const dienste = DIENSTE.map((d) => {
    const ab = Date.parse(d.ab);
    const ivs = alle.filter((i) => i.key === d.key);
    let summeGemessen = 0;
    let summeAusfall = 0;
    const tageswerte = tage.map((tag) => {
      const von = Math.max(tagesbeginn(tag), ab);
      const bis = Math.min(tagesbeginn(naechsterTag(tag)), jetzt);
      if (bis <= von) return { tag, gemessenMin: 0, ausfallMin: 0 };
      let aus = 0;
      for (const iv of ivs) aus += Math.max(0, Math.min(bis, iv.bis) - Math.max(von, iv.von));
      summeGemessen += bis - von;
      summeAusfall += aus;
      return { tag, gemessenMin: Math.round((bis - von) / MIN), ausfallMin: Math.ceil(aus / MIN) };
    });
    const gestoert = ivs.some((i) => i.offen && i.von <= jetzt);
    return {
      key: d.key,
      gestoert,
      // Abgerundet auf zwei Nachkommastellen: lieber zu ehrlich als geschoent.
      verfuegbarkeit: summeGemessen > 0 ? Math.floor((1 - summeAusfall / summeGemessen) * 10000) / 100 : null,
      tage: tageswerte.map((w) => [w.gemessenMin, w.ausfallMin]),
    };
  });

  // Vorfaelle der letzten 90 Tage, je Issue zusammengefasst (nur oeffentliche Ziele).
  const proIssue = new Map();
  for (const iv of alle) {
    if (iv.bis < fensterBeginn) continue;
    const v = proIssue.get(iv.nr) || { von: iv.von, bis: iv.bis, offen: iv.offen, dienste: new Set() };
    v.von = Math.min(v.von, iv.von);
    v.bis = Math.max(v.bis, iv.bis);
    v.dienste.add(iv.key);
    proIssue.set(iv.nr, v);
  }
  const vorfallListe = [...proIssue.values()]
    .sort((a, b) => b.von - a.von)
    .map((v) => ({
      von: new Date(v.von).toISOString(),
      bis: v.offen ? null : new Date(v.bis).toISOString(),
      dauerMin: Math.max(1, Math.round((v.bis - v.von) / MIN)),
      dienste: DIENSTE.map((d) => d.key).filter((k) => v.dienste.has(k)),
    }));

  return {
    version: 1,
    erzeugt: new Date(jetzt).toISOString(),
    letztePruefung,
    zeitzone: ZONE,
    tage,
    dienste,
    vorfaelle: vorfallListe,
  };
}

// ─── GitHub lesen ───────────────────────────────────────────────────────────
async function gh(pfad) {
  const res = await fetch(`https://api.github.com${pfad}`, {
    headers: {
      authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      accept: 'application/vnd.github+json',
      'user-agent': 'vesalo-status',
    },
  });
  if (!res.ok) throw new Error(`GitHub GET ${pfad} -> ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

async function holeVorfaelle(repo, seit) {
  const aus = [];
  for (let seite = 1; seite <= 10; seite++) {
    const liste = await gh(`/repos/${repo}/issues?labels=uptime-incident&state=all&per_page=100&page=${seite}`);
    for (const issue of liste) {
      if (issue.pull_request) continue;
      if (issue.closed_at && Date.parse(issue.closed_at) < seit) continue;
      const kommentare = issue.comments > 0 ? await gh(`/repos/${repo}/issues/${issue.number}/comments?per_page=100`) : [];
      aus.push({ issue, kommentare });
    }
    if (liste.length < 100) break;
  }
  return aus;
}

async function letzterWaechterLauf(repo) {
  const r = await gh(`/repos/${repo}/actions/workflows/uptime.yml/runs?status=completed&per_page=1`);
  return r.workflow_runs?.[0]?.updated_at ?? null;
}

async function main() {
  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo || !process.env.GITHUB_TOKEN) throw new Error('GITHUB_REPOSITORY und GITHUB_TOKEN noetig.');
  const jetzt = Date.now();
  const [vorfaelle, letztePruefung] = await Promise.all([
    holeVorfaelle(repo, jetzt - (TAGE + 1) * 86400_000),
    letzterWaechterLauf(repo),
  ]);
  const daten = berechne(vorfaelle, jetzt, letztePruefung);
  const ziel = join(dirname(fileURLToPath(import.meta.url)), '..', 'site', 'daten.json');
  await writeFile(ziel, JSON.stringify(daten) + '\n');
  const gestoert = daten.dienste.filter((d) => d.gestoert).map((d) => d.key);
  console.log(
    `daten.json: ${daten.dienste.map((d) => `${d.key} ${d.verfuegbarkeit} %`).join(' · ')} · ` +
      `${daten.vorfaelle.length} Vorfall/Vorfaelle · gestoert: ${gestoert.join(', ') || '—'} · letzte Pruefung ${letztePruefung}`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error('Status-Daten nicht erzeugt:', e.message);
    process.exit(1);
  });
}
