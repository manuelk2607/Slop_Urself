# Öffentliche Startseite und Indexierung

Die kanonische Spieladresse lautet https://slopurself.maki26.workers.dev/.
Cloudflare `workers_dev = true` und die statischen Assets machen die Startseite
öffentlich über HTTPS erreichbar, unabhängig von Spielserver-Anmeldung und HF.
Der Spielzugang bleibt unmittelbar auf der ersten Seite verfügbar. Ein kurzer
statischer Text beschreibt das tatsächliche Spiel auch ohne JavaScript.

`public/index.html` enthält Titel, Beschreibung, deutsche Sprachangabe,
Canonical-Link, Open-Graph- und Twitter-Metadaten, Filmklappen-Icon sowie
WebSite/VideoGame-Daten als JSON-LD. Es werden keine Bewertungen erfunden.
Die strukturierten Daten versprechen kein Google-Rich-Result.

`public/sitemap.xml` enthält ausschließlich die öffentliche Startseite.
`public/robots.txt` verweist auf die Sitemap und sperrt API, WebSockets und
OAuth-Metadaten fürs Crawling. Node und Worker versehen private HTTP-Antworten
zusätzlich mit `X-Robots-Tag: noindex, nofollow, nosnippet` und `no-store`.
Die eigentlichen Sitzungs- und Berechtigungsprüfungen schützen Konten, Räume,
Statistiken, Bilder und Videos. robots.txt ist keine Zugriffskontrolle.
Raum-Einladungen und OAuth-Rückkehrparameter erhalten durch den festen
Canonical-Link keine separaten kanonischen Inhaltsseiten. Unbekannte Pfade
liefern 404, keine pauschale Weiterleitung auf die Startseite.

## Google Search Console

1. Nach dem Deployment die URL-Präfix-Property
   `https://slopurself.maki26.workers.dev/` in der Search Console öffnen.
2. „HTML-Tag“ wählen und die Verifizierung bestätigen. Der angegebene
   `google-site-verification`-Tag steht bereits im statischen `<head>`.
3. `sitemap.xml` unter „Sitemaps“ einreichen.
4. Die Startseite über „URL-Prüfung“ testen und Indexierung beantragen.

Der Meta-Tag verifiziert eine URL-Präfix-Property. Eine Domain-Property erfordert
DNS-Nachweis. Aufnahme und Ranking bestimmt Google; die Verifizierung selbst
und eine Indexierungsanfrage werden nicht durch den HTML-Tag ausgelöst.
Bei einer Domainänderung Canonical, JSON-LD, Social-URLs, robots.txt und Sitemap
gemeinsam aktualisieren. Ebenso HF-Rückleitungen und Spiel-Origin prüfen.

## Prüfung

`tests/e2e/seo.e2e.mts` prüft mit deaktiviertem JavaScript und Googlebot-Agent
öffentliches HTML, Metadaten, Google-Tag, JSON-LD, Sitemap und robots.txt,
Social-Bildabruf, private Noindex-Header, 404 und mobiles Layout. Der CI-Lauf
führt diese Prüfung für Node und workerd in Chromium und WebKit aus.

Quellen: [Google robots.txt](https://developers.google.com/search/docs/crawling-indexing/robots/intro),
[Canonical-URLs](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls),
[Sitemaps](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap).
