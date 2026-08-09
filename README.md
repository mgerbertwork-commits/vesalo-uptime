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
