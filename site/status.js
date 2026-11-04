// Vesalo Systemstatus — liest nur die gleich-herkuenftige daten.json.
// Keine Cookies, kein Speicher, keine Anfragen an Dritte.
(function () {
  'use strict';

  var TEXTE = {
    de: {
      title: 'Systemstatus', skip: 'Zum Inhalt springen', loading: 'Status wird geladen …',
      services: 'Dienste', range: 'Letzte 90 Tage', legend: 'Legende',
      legOk: 'Ohne Störung', legMinor: 'Kurze Störung (unter 1 Std.)', legMajor: 'Störung (ab 1 Std.)', legNone: 'Keine Messung',
      incidents: 'Störungen der letzten 90 Tage',
      howTitle: 'So messen wir',
      how1: 'Ein unabhängiger Wächter prüft von außerhalb unserer Server, ob Website, App, Schnittstelle und Kontaktformular richtig antworten – nicht nur, ob sie erreichbar sind. Er läuft auf GitHub; geplante Läufe führt GitHub nach freier Kapazität aus, derzeit etwa alle drei bis vier Stunden. Als Störung zählt ein Dienst, wenn drei Versuche im Abstand von 20 Sekunden fehlschlagen; gemessen wird ab dieser Bestätigung bis zur Entwarnung. Kurze Störungen zwischen zwei Läufen kann diese Seite deshalb übersehen.',
      how2: 'Alle Zeiten in deutscher Zeit (Europe/Berlin). Die Seite wird regelmäßig und sofort bei jeder Statusänderung neu erzeugt.',
      imprint: 'Impressum', privacy: 'Datenschutz', website: 'Zur Website', legal: 'Rechtliches',
      noTracking: 'Diese Seite setzt keine Cookies, nutzt keine Analyse-Werkzeuge und lädt nichts von Dritten.',
      allOk: 'Alle Systeme laufen',
      disturbed: function (l) { return 'Störung bei ' + l; },
      failed: 'Status konnte nicht geladen werden',
      failedHint: 'Bitte laden Sie die Seite in einigen Minuten neu.',
      asOf: function (z) { return 'Stand: ' + z + ' Uhr'; },
      lastCheck: function (z) { return 'letzte Prüfung ' + z + ' Uhr'; },
      stale: 'Die letzte Prüfung liegt länger als sechs Stunden zurück. Die Anzeige kann veraltet sein.',
      stateOk: 'Läuft', stateBad: 'Gestört',
      availability: function (p) { return p + ' % verfügbar'; },
      ago: 'vor 90 Tagen', today: 'Heute', noData: 'Keine Messung',
      dayOk: 'ohne Störung', dayDown: function (m) { return m + ' Min. gestört'; },
      barLabel: function (n, ok, bad, none) {
        return 'Verlauf der letzten ' + n + ' Tage: ' + ok + ' ohne Störung, ' + bad + ' mit Störung, ' + none + ' ohne Messung.';
      },
      noIncidents: 'Keine Störungen in den letzten 90 Tagen.',
      ongoing: 'andauernd', since: 'seit',
      duration: function (m) { return m < 60 ? m + ' Min.' : Math.floor(m / 60) + ' Std. ' + (m % 60) + ' Min.'; },
      affected: function (l) { return 'Betroffen: ' + l; },
      names: { www: 'Website', app: 'Web-App', api: 'Schnittstelle (API)', kontaktformular: 'Kontaktformular' },
      sub: { www: 'www.vesalo.de', app: 'app.vesalo.de', api: 'api.vesalo.de', kontaktformular: 'Absenden auf www.vesalo.de' },
      and: ' und ', other: 'English', otherLang: 'en'
    },
    en: {
      title: 'System status', skip: 'Skip to content', loading: 'Loading status …',
      services: 'Services', range: 'Last 90 days', legend: 'Legend',
      legOk: 'No disruption', legMinor: 'Short disruption (under 1 h)', legMajor: 'Disruption (1 h or more)', legNone: 'No measurement',
      incidents: 'Disruptions in the last 90 days',
      howTitle: 'How we measure',
      how1: 'An independent monitor checks, from outside our servers, whether the website, app, API and contact form respond correctly – not just whether they are reachable. It runs on GitHub, which executes scheduled runs as capacity allows – currently about every three to four hours. A service counts as disrupted when three attempts 20 seconds apart fail; the disruption is measured from that confirmation until recovery. Short disruptions between two runs may therefore be missed here.',
      how2: 'All times in German time (Europe/Berlin). The page is regenerated regularly and immediately on every status change.',
      imprint: 'Legal notice', privacy: 'Privacy', website: 'Website', legal: 'Legal',
      noTracking: 'This page sets no cookies, uses no analytics and loads nothing from third parties.',
      allOk: 'All systems operational',
      disturbed: function (l) { return 'Disruption: ' + l; },
      failed: 'Status could not be loaded',
      failedHint: 'Please reload the page in a few minutes.',
      asOf: function (z) { return 'As of ' + z; },
      lastCheck: function (z) { return 'last check ' + z; },
      stale: 'The last check was more than six hours ago. This page may be out of date.',
      stateOk: 'Operational', stateBad: 'Disrupted',
      availability: function (p) { return p + ' % uptime'; },
      ago: '90 days ago', today: 'Today', noData: 'No measurement',
      dayOk: 'no disruption', dayDown: function (m) { return m + ' min disrupted'; },
      barLabel: function (n, ok, bad, none) {
        return 'History of the last ' + n + ' days: ' + ok + ' without disruption, ' + bad + ' with disruption, ' + none + ' without measurement.';
      },
      noIncidents: 'No disruptions in the last 90 days.',
      ongoing: 'ongoing', since: 'since',
      duration: function (m) { return m < 60 ? m + ' min' : Math.floor(m / 60) + ' h ' + (m % 60) + ' min'; },
      affected: function (l) { return 'Affected: ' + l; },
      names: { www: 'Website', app: 'Web app', api: 'API', kontaktformular: 'Contact form' },
      sub: { www: 'www.vesalo.de', app: 'app.vesalo.de', api: 'api.vesalo.de', kontaktformular: 'Sending from www.vesalo.de' },
      and: ' and ', other: 'Deutsch', otherLang: 'de'
    }
  };

  var sprache = /[?&]lang=en\b/.test(location.search) ? 'en' : 'de';
  var T = TEXTE[sprache];
  var locale = sprache === 'en' ? 'en-GB' : 'de-DE';
  var ZONE = 'Europe/Berlin';
  var $ = function (id) { return document.getElementById(id); };

  // ── Statische Texte übersetzen ─────────────────────────────────────────────
  document.documentElement.lang = sprache;
  if (sprache === 'en') {
    document.title = 'Vesalo System status';
    Array.prototype.forEach.call(document.querySelectorAll('[data-t]'), function (el) {
      var v = T[el.getAttribute('data-t')];
      if (typeof v === 'string') el.textContent = v;
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-t-label]'), function (el) {
      el.setAttribute('aria-label', T[el.getAttribute('data-t-label')]);
    });
  }
  var link = $('sprache');
  link.textContent = T.other;
  link.lang = T.otherLang;
  link.hreflang = T.otherLang;
  link.href = T.otherLang === 'en' ? '?lang=en' : location.pathname;
  $('jahr').textContent = String(new Date().getFullYear());

  // ── Formatierer ────────────────────────────────────────────────────────────
  var fmtZeit = new Intl.DateTimeFormat(locale, { timeZone: ZONE, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  var fmtUhr = new Intl.DateTimeFormat(locale, { timeZone: ZONE, hour: '2-digit', minute: '2-digit' });
  var fmtTag = new Intl.DateTimeFormat(locale, { timeZone: 'UTC', weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
  var fmtBerlinTag = new Intl.DateTimeFormat('sv-SE', { timeZone: ZONE });
  var fmtProzent = new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  var tagAlsDatum = function (tag) { return fmtTag.format(new Date(tag + 'T12:00:00Z')); };
  var liste = function (xs) {
    if (xs.length <= 1) return xs.join('');
    return xs.slice(0, -1).join(', ') + T.and + xs[xs.length - 1];
  };
  var el = function (tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };

  // Tagesklasse: ab 60 Minuten Ausfall „Störung“, darunter „kurz“.
  function klasse(w) {
    if (!w || w[0] === 0) return 'leer';
    if (w[1] === 0) return 'ok';
    return w[1] >= 60 ? 'stoer' : 'teil';
  }
  function tagText(tag, w) {
    var k = klasse(w);
    var z = k === 'leer' ? T.noData : k === 'ok' ? T.dayOk : T.dayDown(w[1]);
    return tagAlsDatum(tag) + ': ' + z;
  }

  // ── Tooltip für die Leisten (Zusatz; Inhalt steht auch im aria-label) ─────
  var tipp = $('tipp');
  function zeigeTipp(ziel) {
    tipp.textContent = ziel.getAttribute('data-tipp');
    tipp.hidden = false;
    var r = ziel.getBoundingClientRect();
    var b = tipp.offsetWidth;
    var x = Math.min(Math.max(8, r.left + r.width / 2 - b / 2), window.innerWidth - b - 8);
    tipp.style.left = x + 'px';
    tipp.style.top = Math.max(8, r.top - tipp.offsetHeight - 8) + 'px';
  }
  function versteckeTipp() { tipp.hidden = true; }
  document.addEventListener('pointerover', function (e) {
    var z = e.target.closest && e.target.closest('[data-tipp]');
    if (z) zeigeTipp(z); else versteckeTipp();
  });
  document.addEventListener('scroll', versteckeTipp, { passive: true });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') versteckeTipp(); });

  // ── Darstellung ────────────────────────────────────────────────────────────
  function zeige(d) {
    var gestoert = d.dienste.filter(function (s) { return s.gestoert; });
    var gesamt = $('gesamt');
    gesamt.setAttribute('data-zustand', gestoert.length ? 'stoer' : 'ok');
    $('gesamt-text').textContent = gestoert.length
      ? T.disturbed(liste(gestoert.map(function (s) { return T.names[s.key] || s.key; })))
      : T.allOk;
    var stand = T.asOf(fmtZeit.format(new Date(d.erzeugt)));
    if (d.letztePruefung) stand += ' · ' + T.lastCheck(fmtUhr.format(new Date(d.letztePruefung)));
    $('stand').textContent = stand;
    if (d.letztePruefung && Date.now() - Date.parse(d.letztePruefung) > 6 * 3600 * 1000) {
      $('veraltet').textContent = T.stale;
      $('veraltet').hidden = false;
    }

    var ul = $('dienste');
    ul.textContent = '';
    d.dienste.forEach(function (s) {
      var li = el('li', 'dienst');
      var kopf = el('div', 'dienst-kopf');
      kopf.appendChild(el('span', 'dienst-name', T.names[s.key] || s.key));
      kopf.appendChild(el('span', 'dienst-adresse', T.sub[s.key] || ''));
      kopf.appendChild(el('span', 'dienst-zustand' + (s.gestoert ? ' stoer' : ''), s.gestoert ? T.stateBad : T.stateOk));
      li.appendChild(kopf);

      var zaehler = { ok: 0, schlecht: 0, leer: 0 };
      var leiste = el('div', 'leiste');
      s.tage.forEach(function (w, i) {
        var k = klasse(w);
        if (k === 'ok') zaehler.ok++; else if (k === 'leer') zaehler.leer++; else zaehler.schlecht++;
        var sp = el('span', k);
        sp.setAttribute('data-tipp', tagText(d.tage[i], w));
        leiste.appendChild(sp);
      });
      leiste.setAttribute('role', 'img');
      var gestoerteTage = s.tage
        .map(function (w, i) { return klasse(w) === 'teil' || klasse(w) === 'stoer' ? tagText(d.tage[i], w) : null; })
        .filter(Boolean);
      leiste.setAttribute('aria-label',
        T.barLabel(s.tage.length, zaehler.ok, zaehler.schlecht, zaehler.leer) +
        (gestoerteTage.length ? ' ' + gestoerteTage.join('; ') + '.' : ''));
      li.appendChild(leiste);

      var fuss = el('div', 'dienst-fuss');
      fuss.appendChild(el('span', null, T.ago));
      var p = el('span');
      var stark = el('strong', null, s.verfuegbarkeit == null ? '–' : T.availability(fmtProzent.format(s.verfuegbarkeit)));
      p.appendChild(stark);
      fuss.appendChild(p);
      fuss.appendChild(el('span', null, T.today));
      li.appendChild(fuss);
      ul.appendChild(li);
    });

    var vf = $('vorfaelle');
    vf.textContent = '';
    if (!d.vorfaelle.length) {
      vf.appendChild(el('li', 'leer-text', T.noIncidents));
    }
    d.vorfaelle.forEach(function (v) {
      var li = el('li', 'vorfall');
      var namen = v.dienste.map(function (k) { return T.names[k] || k; });
      li.appendChild(el('div', 'vorfall-titel', T.affected(liste(namen))));
      var zeit = v.bis
        ? fmtZeit.format(new Date(v.von)) + ' – ' +
          (fmtBerlinTag.format(new Date(v.von)) === fmtBerlinTag.format(new Date(v.bis)) && v.dauerMin < 1440
            ? fmtUhr.format(new Date(v.bis))
            : fmtZeit.format(new Date(v.bis))) +
          ' · ' + T.duration(v.dauerMin)
        : T.since + ' ' + fmtZeit.format(new Date(v.von)) + ' · ' + T.ongoing;
      li.appendChild(el('div', 'vorfall-zeit', zeit));
      vf.appendChild(li);
    });
  }

  function fehler() {
    $('gesamt').setAttribute('data-zustand', 'fehler');
    $('gesamt-text').textContent = T.failed;
    $('stand').textContent = T.failedHint;
  }

  fetch('daten.json', { cache: 'no-cache' })
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(zeige)
    .catch(fehler);
})();
