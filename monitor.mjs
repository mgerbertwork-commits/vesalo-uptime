#!/usr/bin/env node
/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Externer Uptime-Waechter fuer vesalo.de
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Laeuft auf GitHubs Infrastruktur — sieht damit auch einen komplett toten
 * Server. Genau das war der Anlass: api.vesalo.de war ueber Wochen nicht
 * erreichbar, ohne dass es jemand bemerkte.
 *
 * Ablauf pro Lauf:
 *   1. Alle Ziele pruefen. Ein Ziel gilt erst als "unten", wenn es bei
 *      MEHREREN Versuchen mit Pause dazwischen scheitert (kein Alarm wegen
 *      eines einzelnen Schluckaufs).
 *   2. Zustand liegt im offenen GitHub-Issue mit dem Label `uptime-incident`
 *      — kein externer Speicher noetig.
 *        · Ausfall + kein offener Vorfall  -> Issue anlegen + Alarm-Mail
 *        · Ausfall + offener Vorfall       -> still (kein Alarm pro Lauf!),
 *                                             ausser ein ZUSAETZLICHES Ziel
 *                                             faellt aus -> eine Eskalations-Mail
 *        · alles gruen + offener Vorfall   -> Issue schliessen + Entwarnungs-Mail
 *        · alles gruen + kein Vorfall      -> still
 *   3. Der Prozess endet mit Code 0, AUCH waehrend eines Ausfalls. Nur ein
 *      interner Fehler (Bug, kaputtes Secret) endet != 0 — dann meldet sich
 *      GitHub selbst per "workflow failed"-Mail. Sonst haetten wir bei einem
 *      langen Ausfall alle 5 Minuten eine Fehlschlag-Mail.
 *
 * Secrets (nie im Code):
 *   RESEND_API_KEY      Resend-Key, nur Sende-Recht
 *   ALERT_TO            Empfaenger der Alarm-Mails
 *   ALERT_FROM          Absender (verifizierte Resend-Domain)
 *   WEBHOOK_PROBE_URL   Pfad des E-Mail-Webhooks (steht bewusst NICHT im Code,
 *                       damit dieses oeffentliche Repo keine internen Pfade nennt)
 */

const REPO = process.env.GITHUB_REPOSITORY || '';
const GH_TOKEN = process.env.GITHUB_TOKEN || '';
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const ALERT_TO = process.env.ALERT_TO || '';
const ALERT_FROM = process.env.ALERT_FROM || '';
const WEBHOOK_PROBE_URL = process.env.WEBHOOK_PROBE_URL || '';
const FORCE_FAIL = process.env.FORCE_FAIL === '1';
// Trockenlauf: prueft die Ziele wirklich, schreibt aber weder Issue noch Mail.
// Nur fuer lokales Nachpruefen — im Workflow nie gesetzt.
const DRY_RUN = process.env.DRY_RUN === '1';
const RUN_URL = REPO && process.env.GITHUB_RUN_ID
  ? `https://github.com/${REPO}/actions/runs/${process.env.GITHUB_RUN_ID}`
  : '';

const LABEL = 'uptime-incident';
const ATTEMPTS = 3;          // Bestaetigungsversuche, bevor "unten" gilt
const RETRY_DELAY_MS = 20_000;
const TIMEOUT_MS = 20_000;

// ─── Ziele ───────────────────────────────────────────────────────────────────
// Nur oeffentlich erreichbare Adressen. Der Webhook-Pfad kommt aus einem
// Secret und taucht deshalb weder hier noch in Issues/Mails auf.
const TARGETS = [
  {
    key: 'api',
    name: 'API — api.vesalo.de',
    method: 'GET',
    url: 'https://api.vesalo.de/api/health',
    // Echter Health-Endpunkt, nicht nur TCP: der Body muss "ok" melden.
    expect: (r) => r.status === 200 && /"status"\s*:\s*"ok"/.test(r.body),
    expectText: 'HTTP 200 und status:"ok" im Body',
  },
  {
    key: 'app',
    name: 'App — app.vesalo.de',
    method: 'GET',
    url: 'https://app.vesalo.de/api/health',
    expect: (r) => r.status === 200 && /"status"\s*:\s*"ok"/.test(r.body),
    expectText: 'HTTP 200 und status:"ok" im Body',
  },
  {
    key: 'www',
    name: 'Website — www.vesalo.de',
    method: 'GET',
    url: 'https://www.vesalo.de/',
    expect: (r) => r.status === 200 && /<html/i.test(r.body),
    expectText: 'HTTP 200 und HTML-Body',
  },
  {
    key: 'webhook',
    name: 'E-Mail-Webhook (Inbound)',
    method: 'POST',
    url: WEBHOOK_PROBE_URL,
    skipIf: () => !WEBHOOK_PROBE_URL,
    // 401 ist hier das GESUNDE Ergebnis: die Route lebt und weist unsere
    // absichtlich fehlenden Zugangsdaten korrekt ab. 404/502/Timeout dagegen
    // heisst, der Weg von aussen ist gestoert — genau der Fehler von 07/2026.
    expect: (r) => r.status === 401 && /invalid credentials/i.test(r.body),
    expectText: 'HTTP 401 mit erwarteter Abweisung (Route lebt)',
  },
  {
    key: 'kontaktformular',
    name: 'Kontaktformular — darf www.vesalo.de absenden?',
    method: 'OPTIONS',
    url: 'https://api.vesalo.de/api/leads',
    headers: {
      origin: 'https://www.vesalo.de',
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'content-type',
    },
    // 🔴 Warum es dieses Ziel gibt: am 2026-08-10 stand CORS_ORIGINS in
    // Produktion auf ausschliesslich https://app.vesalo.de. Der
    // Same-Origin-Guard der API hat damit JEDE Absendung von der
    // Marketing-Domain mit 403 abgewiesen — das Kontaktformular war tot.
    // Rund 90 Tage lang, unbemerkt.
    //
    // Und zwar unbemerkbar fuer jeden bisherigen Waechter: www lieferte
    // brav HTTP 200 mit HTML, die API meldete status:"ok". Beide gesund,
    // die wichtigste Funktion der Website trotzdem kaputt. Genau dieselbe
    // Fehlerklasse wie beim wochenlang toten api.vesalo.de.
    //
    // Der Preflight fragt die API in der Sprache des Browsers: "darf
    // www.vesalo.de bei dir absenden?" Fehlt der Allow-Origin-Header,
    // kann das Formular nicht funktionieren — egal wie gesund alles wirkt.
    expect: (r) => {
      if (r.status < 200 || r.status >= 400) return false;
      const allow = r.headers?.get?.('access-control-allow-origin') ?? '';
      return allow === 'https://www.vesalo.de' || allow === '*';
    },
    expectText:
      'Preflight mit Access-Control-Allow-Origin fuer https://www.vesalo.de',
  },
];

// Selbsttest: ein absichtlich fehlschlagendes Zusatzziel. Erzeugt einen echten
// Alarm ueber den echten Weg, ohne ueber ein echtes Ziel die Unwahrheit zu sagen.
if (FORCE_FAIL) {
  TARGETS.push({
    key: 'selbsttest',
    name: 'Selbsttest (absichtlich fehlschlagend)',
    method: 'GET',
    url: 'https://api.vesalo.de/api/__uptime-selbsttest-gibt-es-nicht',
    expect: (r) => r.status === 200,
    expectText: 'HTTP 200 (kann es nicht geben — das ist der Zweck)',
  });
}

// ─── Hilfen ──────────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Entfernt das Webhook-Secret aus allem, was nach aussen geht. */
function redact(s) {
  let out = String(s ?? '');
  if (WEBHOOK_PROBE_URL) out = out.split(WEBHOOK_PROBE_URL).join('<webhook-url>');
  return out;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

async function probe(t) {
  const started = Date.now();
  try {
    const res = await fetch(t.url, {
      method: t.method,
      redirect: 'manual',
      headers: {
        ...(t.method === 'POST' ? { 'content-type': 'application/json' } : {}),
        // Ziel-eigene Header — der CORS-Preflight braucht Origin und die
        // Access-Control-Request-*-Angaben, sonst antwortet die API gar nicht
        // als Preflight.
        ...(t.headers || {}),
      },
      body: t.method === 'POST' ? '{}' : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = await res.text().catch(() => '');
    // `headers` mitgeben: manche Ziele beweisen ihre Gesundheit nicht am
    // Body, sondern an einem Antwort-Header (CORS).
    const ok = t.expect({ status: res.status, body, headers: res.headers });
    return {
      ok,
      ms: Date.now() - started,
      detail: ok ? `HTTP ${res.status}` : `HTTP ${res.status} — erwartet: ${t.expectText}`,
    };
  } catch (e) {
    return { ok: false, ms: Date.now() - started, detail: redact(`${e.name}: ${e.message}`) };
  }
}

// ─── GitHub-API ──────────────────────────────────────────────────────────────
async function gh(path, init = {}) {
  if (DRY_RUN) {
    console.log(`[trocken] GitHub ${init.method || 'GET'} ${path}`);
    if (init.body) console.log(`[trocken]   ${redact(init.body).slice(0, 600)}`);
    // Beim Suchen nach offenen Vorfaellen muss etwas Iterierbares zurueck.
    return init.method ? { number: 0, html_url: '(trocken)' } : [];
  }
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${GH_TOKEN}`,
      accept: 'application/vnd.github+json',
      'content-type': 'application/json',
      'user-agent': 'vesalo-uptime',
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub ${init.method || 'GET'} ${path} -> ${res.status} ${(await res.text()).slice(0, 300)}`);
  }
  return res.status === 204 ? null : res.json();
}

const STATE_RE = /<!--\s*vesalo-uptime-state:\s*({[\s\S]*?})\s*-->/;

function readState(body) {
  const m = STATE_RE.exec(body || '');
  if (!m) return { failing: [] };
  try { return JSON.parse(m[1]); } catch { return { failing: [] }; }
}

function buildIssueBody(state, lines) {
  return [
    `<!-- vesalo-uptime-state: ${JSON.stringify(state)} -->`,
    '',
    `**Vorfall begonnen:** ${state.since}`,
    '',
    '| Ziel | Zustand | Antwortzeit | Beobachtung |',
    '|---|---|---|---|',
    ...lines,
    '',
    RUN_URL ? `Letzter Lauf: ${RUN_URL}` : '',
    '',
    '_Dieses Issue wird vom Uptime-Waechter automatisch gepflegt und bei Erholung ' +
      'geschlossen. Es ersetzt keine manuelle Nachschau._',
  ].filter((l) => l !== undefined).join('\n');
}

// ─── Resend ──────────────────────────────────────────────────────────────────
async function sendMail(subject, html) {
  if (DRY_RUN) {
    console.log(`[trocken] Mail an ${ALERT_TO || '(kein Empfaenger)'}: ${subject}`);
    return false;
  }
  if (!RESEND_API_KEY || !ALERT_TO || !ALERT_FROM) {
    console.warn('!! Mailversand uebersprungen — RESEND_API_KEY / ALERT_TO / ALERT_FROM nicht gesetzt.');
    return false;
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: ALERT_FROM, to: [ALERT_TO], subject, html }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Resend -> ${res.status} ${text.slice(0, 300)}`);
  console.log(`Mail verschickt: ${subject}`);
  return true;
}

function mailHtml(headline, rows, footer) {
  return [
    `<div style="font-family:-apple-system,Segoe UI,Inter,sans-serif;font-size:15px;color:#111">`,
    `<h2 style="margin:0 0 12px">${esc(headline)}</h2>`,
    `<table cellpadding="6" cellspacing="0" border="0" style="border-collapse:collapse;font-size:14px">`,
    `<tr style="background:#f4f4f5"><th align="left">Ziel</th><th align="left">Zustand</th><th align="left">Beobachtung</th></tr>`,
    ...rows,
    `</table>`,
    `<p style="color:#555;font-size:13px;margin-top:16px">${footer}</p>`,
    `</div>`,
  ].join('');
}

// ─── Hauptlauf ───────────────────────────────────────────────────────────────
async function main() {
  const active = TARGETS.filter((t) => !(t.skipIf && t.skipIf()));
  for (const t of TARGETS) {
    if (t.skipIf && t.skipIf()) console.warn(`!! Ziel "${t.key}" uebersprungen — kein WEBHOOK_PROBE_URL gesetzt.`);
  }

  const results = new Map();
  let pending = active.slice();
  for (let attempt = 1; attempt <= ATTEMPTS && pending.length > 0; attempt++) {
    if (attempt > 1) {
      console.log(`… ${pending.length} Ziel(e) auffaellig, Bestaetigungsversuch ${attempt} in ${RETRY_DELAY_MS / 1000}s`);
      await sleep(RETRY_DELAY_MS);
    }
    const out = await Promise.all(pending.map(probe));
    const next = [];
    pending.forEach((t, i) => {
      results.set(t.key, { ...out[i], attempts: attempt });
      if (!out[i].ok) next.push(t);
    });
    pending = next;
  }

  for (const t of active) {
    const r = results.get(t.key);
    console.log(`${r.ok ? 'OK  ' : 'FEHL'} ${t.key.padEnd(11)} ${String(r.ms).padStart(5)}ms  ${r.detail}`);
  }

  const failing = active.filter((t) => !results.get(t.key).ok);
  const failingKeys = failing.map((t) => t.key);

  // Offenen Vorfall suchen
  const open = await gh(`/repos/${REPO}/issues?state=open&labels=${LABEL}&per_page=10`);
  const incident = (open || []).find((i) => !i.pull_request) || null;

  const tableRows = active.map((t) => {
    const r = results.get(t.key);
    return `| ${t.name} | ${r.ok ? '✅ erreichbar' : '🔴 gestört'} | ${r.ms} ms | ${redact(r.detail)} |`;
  });
  const mailRows = active.map((t) => {
    const r = results.get(t.key);
    return `<tr><td>${esc(t.name)}</td><td>${r.ok ? '✅ erreichbar' : '🔴 gestört'}</td><td>${esc(redact(r.detail))} (${r.ms} ms)</td></tr>`;
  });
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';

  // ── Fall A: alles gruen ────────────────────────────────────────────────────
  if (failingKeys.length === 0) {
    if (!incident) {
      console.log('Alles gruen, kein offener Vorfall — nichts zu tun.');
      return;
    }
    const prev = readState(incident.body);
    await gh(`/repos/${REPO}/issues/${incident.number}/comments`, {
      method: 'POST',
      body: JSON.stringify({
        body: `✅ **Entwarnung** — ${now}\n\nAlle Ziele antworten wieder wie erwartet.\n\n` +
          `| Ziel | Zustand | Antwortzeit |\n|---|---|---|\n` +
          active.map((t) => `| ${t.name} | ✅ | ${results.get(t.key).ms} ms |`).join('\n') +
          (RUN_URL ? `\n\nLauf: ${RUN_URL}` : ''),
      }),
    });
    await gh(`/repos/${REPO}/issues/${incident.number}`, {
      method: 'PATCH',
      body: JSON.stringify({ state: 'closed', state_reason: 'completed' }),
    });
    await sendMail(
      `✅ Vesalo wieder erreichbar`,
      mailHtml(
        'Entwarnung — alle Ziele antworten wieder',
        mailRows,
        `Betroffen war: ${esc((prev.failing || []).join(', ') || 'unbekannt')}. ` +
          `Vorfall begonnen ${esc(prev.since || 'unbekannt')}, beendet ${esc(now)}. ` +
          `Vorfall geschlossen: <a href="${incident.html_url}">#${incident.number}</a>`,
      ),
    );
    console.log(`Vorfall #${incident.number} geschlossen, Entwarnung verschickt.`);
    return;
  }

  // ── Fall B: Ausfall, noch kein offener Vorfall -> genau EIN Alarm ──────────
  if (!incident) {
    const state = { failing: failingKeys, since: now };
    const created = await gh(`/repos/${REPO}/issues`, {
      method: 'POST',
      body: JSON.stringify({
        title: `🔴 Nicht erreichbar: ${failing.map((t) => t.key).join(', ')} (${now})`,
        body: buildIssueBody(state, tableRows),
        labels: [LABEL],
      }),
    });
    await sendMail(
      `🔴 Vesalo nicht erreichbar: ${failing.map((t) => t.key).join(', ')}`,
      mailHtml(
        `${failing.length} Ziel(e) nicht erreichbar`,
        mailRows,
        `Bestätigt nach ${ATTEMPTS} Versuchen mit ${RETRY_DELAY_MS / 1000}s Abstand. ` +
          `Vorfall: <a href="${created.html_url}">#${created.number}</a>. ` +
          `Solange der Vorfall offen ist, kommt KEINE weitere Mail — erst bei Erholung ` +
          `oder wenn ein zusätzliches Ziel ausfällt.`,
      ),
    );
    console.log(`Vorfall #${created.number} angelegt, Alarm verschickt.`);
    return;
  }

  // ── Fall C: Ausfall, Vorfall laeuft schon ─────────────────────────────────
  const prev = readState(incident.body);
  const prevFailing = prev.failing || [];
  const neu = failingKeys.filter((k) => !prevFailing.includes(k));
  const behoben = prevFailing.filter((k) => !failingKeys.includes(k));
  const state = { failing: failingKeys, since: prev.since || now };

  if (neu.length === 0 && behoben.length === 0) {
    // Unveraendert: nur den Stand im Issue frisch halten, kein Laerm.
    await gh(`/repos/${REPO}/issues/${incident.number}`, {
      method: 'PATCH',
      body: JSON.stringify({ body: buildIssueBody(state, tableRows) }),
    });
    console.log(`Vorfall #${incident.number} unveraendert (${failingKeys.join(', ')}) — kein Alarm.`);
    return;
  }

  await gh(`/repos/${REPO}/issues/${incident.number}`, {
    method: 'PATCH',
    body: JSON.stringify({ body: buildIssueBody(state, tableRows) }),
  });
  await gh(`/repos/${REPO}/issues/${incident.number}/comments`, {
    method: 'POST',
    body: JSON.stringify({
      body: `🔄 **Lage geändert** — ${now}\n\n` +
        (neu.length ? `Neu gestört: \`${neu.join('`, `')}\`\n` : '') +
        (behoben.length ? `Wieder erreichbar: \`${behoben.join('`, `')}\`\n` : '') +
        `\n| Ziel | Zustand | Antwortzeit | Beobachtung |\n|---|---|---|---|\n` + tableRows.join('\n'),
    }),
  });

  if (neu.length > 0) {
    // Nur die Ausweitung ist eine neue Mail wert — Teil-Erholung bleibt still.
    await sendMail(
      `🔴 Vesalo-Ausfall weitet sich aus: ${neu.join(', ')}`,
      mailHtml(
        `Zusätzlich gestört: ${neu.join(', ')}`,
        mailRows,
        `Der Vorfall <a href="${incident.html_url}">#${incident.number}</a> läuft seit ${esc(state.since)}.`,
      ),
    );
  }
  console.log(`Vorfall #${incident.number} aktualisiert (neu: ${neu.join(',') || '—'}, behoben: ${behoben.join(',') || '—'}).`);
}

main().catch((e) => {
  // Interner Fehler -> Lauf rot -> GitHub schickt von sich aus eine Mail.
  console.error('Waechter selbst gescheitert:', redact(e.stack || e.message));
  process.exit(1);
});
