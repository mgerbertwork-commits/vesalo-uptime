# vesalo-uptime — externer Wächter für vesalo.de

Prüft alle 5 Minuten von **GitHubs** Infrastruktur aus, ob die öffentlichen
Vesalo-Adressen erreichbar sind. Bewusst außerhalb des eigenen Servers: ein
Wächter, der auf dem überwachten Server läuft, schweigt genau dann, wenn es
darauf ankommt.

Anlass: `api.vesalo.de` war über Wochen von außen nicht erreichbar, ohne dass
es jemand bemerkte.

## Was geprüft wird

| Ziel | Prüfung |
|---|---|
| `api.vesalo.de` | echter Health-Endpunkt — HTTP 200 **und** `status:"ok"` im Body, nicht nur TCP |
| `app.vesalo.de` | dito |
| `www.vesalo.de` | HTTP 200 mit HTML-Body |
| E-Mail-Webhook | Route lebt und weist absichtlich fehlende Zugangsdaten korrekt ab (Adresse steht im Secret `WEBHOOK_PROBE_URL`, nicht im Code) |

Ein Ziel gilt erst nach **3 fehlgeschlagenen Versuchen mit 20 s Abstand** als
gestört — ein einzelner Schluckauf löst keinen Alarm aus.

## Wie alarmiert wird

Der Zustand liegt im offenen GitHub-Issue mit dem Label `uptime-incident`;
ein externer Speicher ist nicht nötig.

* **Ausfall, kein offener Vorfall** → Issue anlegen **und genau eine** Alarm-Mail
* **Ausfall, Vorfall läuft schon** → still. Nur wenn ein *zusätzliches* Ziel
  ausfällt, gibt es eine weitere Mail
* **Wieder alles grün** → Issue schließen, eine Entwarnungs-Mail
* **Alles grün, kein Vorfall** → nichts

Der Lauf endet auch während eines Ausfalls mit Erfolg. Rot wird er nur, wenn
der Wächter **selbst** scheitert — dann meldet sich GitHub von sich aus.

## Secrets

Im Code steht kein einziges Geheimnis.

| Secret | Zweck |
|---|---|
| `RESEND_API_KEY` | eigener Resend-Key, **nur Sende-Recht** |
| `ALERT_TO` | Empfänger der Alarm-Mails |
| `ALERT_FROM` | Absender auf einer bei Resend verifizierten Domain |
| `WEBHOOK_PROBE_URL` | Adresse des Webhook-Ziels (bleibt aus dem öffentlichen Code heraus) |

`GITHUB_TOKEN` stellt GitHub selbst.

## Bedienung

* **Selbsttest:** Actions → *Uptime* → *Run workflow* → Häkchen bei
  *Selbsttest*. Prüft zusätzlich eine Adresse, die es nicht geben kann → ein
  echter Alarm samt Mail und Issue. Das Issue danach schließen bzw. den
  nächsten regulären Lauf abwarten — der schickt die Entwarnung.
* **Stummschalten:** Actions → *Uptime* → `…` → *Disable workflow*.
  (Wieder an über *Enable workflow*.)
* **Intervall ändern:** `cron` in `.github/workflows/uptime.yml`. 5 Minuten ist
  das Feinste, was GitHub anbietet.
* **Ziel hinzufügen/ändern:** `TARGETS` in `monitor.mjs`.
* **Empfänger ändern:** Secret `ALERT_TO`.

## Kosten

Öffentliches Repo → Actions-Minuten auf Standard-Runnern sind kostenlos. Das
Minuten-Budget des privaten Hauptrepos bleibt unangetastet.

`keepalive.yml` schreibt einmal im Monat ein Lebenszeichen, weil GitHub geplante
Workflows in inaktiven Repos nach 60 Tagen abschaltet.

---

## Immospur (der Immobilienfinder) — seit 21.08.2026

Vier zusaetzliche Ziele. Sie brauchen drei Secrets: `IMMOSPUR_URL`,
`IMMOSPUR_BENUTZER`, `IMMOSPUR_PASSWORT`.

🔴 **Adresse und Zugangsdaten stehen NICHT im Code.** Immospur laeuft unter
einer nicht beworbenen Adresse mit Zugangsabfrage; dieses Repository ist
oeffentlich. Sie hier hinzuschreiben hiesse, die Adresse mit dem eigenen
Waechter zu bewerben. `redact()` ersetzt sie zusaetzlich in Issues und Mails.

| Ziel | gesund ist | warum |
|---|---|---|
| `immospur-schutz` | **401** mit `WWW-Authenticate` | Bei einer geschuetzten Adresse waere **200** der Alarm. Ein Waechter, der nur auf 200 prueft, schluege dauernd Alarm; einer, der nur „antwortet ueberhaupt" prueft, saehe einen weggefallenen Schutz nicht. |
| `immospur-web` | 200 + Marke im Body | Gegenrichtung: hinter der Abfrage muss wirklich die Website stehen. Ein 401 fuer ALLE waere sonst „gruen". |
| `immospur-api` | 200 + `status:"ok"` + **40-stelliger Commit** | Der Deploy-Pin. „unbekannt" hiesse: das Image weiss nicht, was in ihm steckt. |
| `immospur-webhook` | **401 OHNE** `WWW-Authenticate` | Zwei gleiche Zahlen, zwei verschiedene Dinge: hier ist es die Signaturpruefung. Steckte hier die Zugangsabfrage, kaeme keine Bounce-Meldung je an — und die Sperrliste bliebe fuer immer leer. |

### Uebersprungen ist nicht gruen

Fehlen die Secrets, werden diese Ziele ausgelassen — und das steht **sichtbar
in der Lauf-Zusammenfassung**, nicht nur in einer Konsolenzeile, die bei einem
gruenen Lauf niemand aufklappt. Ein Waechter, der ein Ziel gar nicht mehr
prueft, ist sonst von einem, bei dem das Ziel gesund ist, nicht zu
unterscheiden.

### In der Ernstfall-Lage gemessen (21.08.2026)

Dieselben Ziele gegen eine **ungeschuetzte** Adresse gerichtet:

```
FEHL immospur-schutz   HTTP 200 — erwartet: HTTP 401 mit WWW-Authenticate
FEHL immospur-web      HTTP 200 — erwartet: HTTP 200 und die Marke im Body
FEHL immospur-api      HTTP 200 — erwartet: … und ein echter 40-stelliger Commit
```

Der Schutz-Waechter schlaegt also an, wenn der Schutz fehlt. Ohne diese Probe
waere „immer gruen" von „kann gar nicht rot werden" nicht zu unterscheiden.
