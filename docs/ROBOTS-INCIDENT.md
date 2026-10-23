# Search Console: robots.txt nicht erreichbar

Untersuchung: 23.10.2026, etwa 13:08–13:14 UTC (15:08–15:14 Stockholm).
Produktivstand: Git `97c07c8`, Cloudflare-Version
`2136ab45-a14b-4af3-973a-55479bfd18cc`, 100 % Traffic laut Deployments API.

## Ergebnis und Korrektur der bisherigen Ursachenbehauptung

Der gemeldete Fehler ist aktuell nicht reproduzierbar. Google selbst hat
Startseite, robots.txt und Sitemap erfolgreich abgerufen. Die frühere Aussage,
das statische Asset-Routing sei die nachgewiesene Ursache gewesen, war nicht
belegt. Der vorherige Commit hat das Routing abgesichert; ein Zusammenhang mit
dem historischen Search-Console-Fehler ist damit nicht bewiesen.

In dieser Untersuchung wurden weder Anwendungslogik noch Sicherheitsregeln
geändert und kein weiteres Deployment ausgeführt. Ein erneutes Deployment ohne
Fehlernachweis würde die verbleibende Ursache nicht klären.

## Unabhängige Abrufe durch Google

Das öffentliche Google-Prüftool wurde im URL-Modus auf die echten Produktiv-URLs
angesetzt. Die Ergebnisse stammen von Googles Servern, nicht von einem lokal
gefälschten User-Agent. Zeitangaben unten sind UTC.

| URL | Google-Abruf | HTTP | Content-Type | Cloudflare-Ray / Standort |
| --- | --- | --- | --- | --- |
| `/` | 13:10:56 | 200 | text/html | a4f0fc183c38f1be-DFW |
| `/robots.txt` | 13:11:39 | 200 | text/plain | a4f0fd284b8277e6-DFW |
| `/sitemap.xml` | 13:12:26 | 200 | application/xml | a4f0fe4b2ded9bde-DFW |

Alle drei Berichte zeigen „Crawling erlaubt? Ja“, „Seitenabruf Erfolgreich“ und
„Indexierung zulässig? Ja“. Die HTTP-Antworten wurden im jeweiligen Bericht
aufgeklappt. Googles Quellenansicht von robots.txt enthält genau unsere Regeln
und die richtige Sitemap-Adresse, keine Challenge und kein Login-HTML.

- [Startseite: Google-Ergebnis](https://search.google.com/test/rich-results/result?id=SjS273Jhoj6NB5xmZi2lEQ)
- [robots.txt: Google-Ergebnis](https://search.google.com/test/rich-results/result?id=UHUT55XjXsRoILegy7wyTA)
- [Sitemap: Google-Ergebnis](https://search.google.com/test/rich-results/result?id=HS3JoND8V-UVt83DQ84Yyw)

Diese Ergebnisse belegen den Zugriff des Google-Prüftools (Smartphone) zu diesen
Zeitpunkten. Sie beweisen weder jeden organischen Googlebot-Abruf noch, dass der
authentifizierte Search-Console-Bericht schon aktualisiert wurde. „Keine Elemente
erkannt“ meint fehlende unterstützte Rich-Result-Typen, keinen Crawling-Fehler.
Die Ergebnislinks sind kein dauerhaftes Logarchiv.

## HTTP, Routing und private Bereiche

15 zusätzliche HTTPS-GET-Prüfungen aus dem lokalen Netz (Cloudflare ARN): normale
Anfrage, Desktop-Googlebot-User-Agent und Smartphone-Googlebot-User-Agent, jeweils
robots.txt, Sitemap, Startseite, private Statistik und unbekannter öffentlicher
Pfad. Alle Assertions erfolgreich:

- robots.txt: 200, exakt `text/plain`, 160 Byte, gleicher Text wie im Repository,
  kein Location-, Set-Cookie-, Challenge- oder Noindex-Header.
- Sitemap: 200, application/xml, gültiges XML, ausschließlich die kanonische
  Startseite `https://slopurself.maki26.workers.dev/`.
- Startseite: 200, text/html, index/follow, Google-Verifikationstag, kein
  X-Robots-Tag: noindex. Der feste Canonical-Link entspricht dem Host.
- `/api/stats`: ohne Anmeldung 401, noindex/nofollow/nosnippet.
- Unbekannte öffentliche Seite: echtes 404, kein Soft-404 als Spiel-HTML.
- Zusätzlicher IPv4-/HTTP-1.1-Abruf: 200, TLS-Prüfung erfolgreich, kein Redirect.
  DNS über Google Public DNS liefert gültige AAAA-Antworten. Lokales IPv6 ist
  nicht testbar: Auch die Kontrollanfrage an www.google.com scheitert vor HTTP.
  Daraus lässt sich kein IPv6-Fehler des Spiels ableiten.
- Der externe Web-Abrufdienst dieser Sitzung konnte keine der drei URLs lesen;
  er lieferte keinen verwertbaren HTTP-Status. Das ist kein Beleg für eine
  Cloudflare- oder Googlebot-Sperre, insbesondere angesichts der Google-Ergebnisse.

`wrangler.toml` führt robots.txt und Sitemap ausdrücklich mit run_worker_first
durch den Worker. `publicSeoResponse` antwortet vor Authentifizierung und
Rate-Limits; DB, HF und Durable Objects werden dafür nicht aufgerufen.
`indexingResponse` markiert nur private Pfade als noindex. Die statischen
Fallback-Dateien stimmen mit den Worker-Inhalten überein. Lokaler Node-Server
und Produktions-Worker verwenden dieselben SEO-Inhalte; ein erfolgreicher
localhost-Test allein wäre kein Beleg für Cloudflare-Erreichbarkeit.

## Cloudflare-Einstellungen außerhalb des Repositorys

Lesend mit vorhandener Wrangler-Anmeldung geprüft, keine Tokens ausgegeben:

- Worker-Subdomain: enabled=true, previews_enabled=false.
- Account-Subdomain: maki26. Richtiger Produktionshost, keine Preview-Adresse.
- Access-API: 403 mit explizitem `access.api.error.not_enabled` / „Access is not
  enabled“. Das ist keine generische Berechtigungsfehlermeldung: Laut diesem
  Endpunkt ist Access für das abgefragte Konto nicht eingerichtet.
- Sichtbare Zonen: leere Liste. workers.dev ist keine hier verwaltete eigene
  Zone. Eine pauschale Anleitung „WAF in deiner workers.dev-Zone deaktivieren“
  wäre deshalb unzutreffend.
- Kontoweite Rulesets-API: 403 / 10000 Authentication error. Die vorhandene
  Anmeldung erlaubt diese Prüfung nicht. Deshalb wurden WAF/Bot-Regeln und
  historische Security Events nicht vollständig geprüft oder ausgeschlossen.
- Persistierte Worker-Logs sind aktiv, automatische Invocation-Logs deaktiviert.
  Es liegen keine rückwirkenden, verifizierten Googlebot-Fehlerlogs vor.

## Noch erforderliche Zuordnung in Search Console / Dashboard

1. Search Console: Property exakt `https://slopurself.maki26.workers.dev/`,
   Einstellungen → Crawling → robots.txt-Bericht öffnen. Betroffene vollständige
   URL, letztes Abrufdatum und konkreten Abruffehler festhalten. Frühere Hosts
   (jsbk9gv78n / manuelk2607), HTTP und Preview-Hosts getrennt behandeln.
2. Im robots.txt-Bericht einen erneuten Abruf anfordern. Zusätzlich die Startseite
   mit „Live-URL testen“ prüfen. Den neuen Zeitstempel mit den obigen erfolgreichen
   Google-Abrufen vergleichen; einen alten Bericht nicht als aktuellen Test werten.
3. Cloudflare → Workers & Pages → slopurself → Domains bzw. Settings → Domains &
   Routes: Produktionsroute muss Enabled bleiben. Keine Access-Anwendung für
   den öffentlichen Host einrichten. Diese Route ist bereits aktiv; eine
   notwendige Dashboard-Änderung ist bisher nicht nachgewiesen.
4. Falls ein neuer Google-Abruf wieder scheitert: Zeitpunkt und Ray-ID korrelieren.
   Bei einem eigenen Domain-Host unter Security → Events nach Host, `/robots.txt`
   und Zeitpunkt filtern; Action, Rule-ID und verifizierte Bot-Klassifikation
   prüfen. Nur die nachweislich treffende Regel korrigieren. Eine Ausnahme darf
   nicht allein auf dem frei fälschbaren User-Agent beruhen. Für robots.txt und
   Sitemap muss der öffentliche Abruf ohne Challenge und Login möglich sein.
5. Gibt es für den workers.dev-Host keinen zugänglichen Security-Eintrag und der
   Fehler liegt vor dem Worker: Cloudflare-Support/Community mit Host, UTC-Zeit,
   Google-Abruffehler und ggf. Ray-ID einschalten. Regeln der Cloudflare-eigenen
   workers.dev-Zone können wir nicht im Projekt-Dashboard bearbeiten.

Ein zwischengespeicherter Fehler, eine andere Property und ein zeitweiser
Netzwerk-/Edge-Fehler bleiben Hypothesen. Ohne aktuellen Bericht und korrelierte
Fehlerdaten wird keine davon als Ursache bezeichnet. Keine pauschale Abschaltung
von WAF oder Bot-Schutz und kein zusätzlicher kostenpflichtiger Dienst nötig.

Quellen:
- [Google: robots.txt-Cache aktualisieren](https://developers.google.com/crawling/docs/robots-txt/submit-updated-robots-txt)
- [Google: Netzwerk- und DNS-Fehler untersuchen](https://developers.google.com/crawling/docs/troubleshooting/dns-network-errors)
- [Cloudflare: workers.dev und Access](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/)
