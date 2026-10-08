# Favicon

Erstellt mit dem eingebauten ImageGen-Tool. Der originale Entwurf wurde fuer
die Browserformate verkleinert; die ICO-Datei enthaelt klassische 32-Bit-Bitmap-
Frames mit 16, 32 und 48 Pixeln statt PNG-komprimierter Frames. Die PNG-Dateien
verwenden True-Color-RGBA statt einer indizierten Farbpalette.

- `public/favicon.ico`: Browser-Favicon.
- `public/assets/favicon-32.png`: PNG-Favicon.
- `public/apple-touch-icon.png`: Safari-/Home-Screen-Symbol (180 Pixel) am Standardpfad.
- `public/assets/apple-touch-icon.png`: identische Kopie fuer alte Seitenverweise.

Der Build kopiert diese Assets auch nach `cloudflare/public`.
Der Build erstellt zusaetzlich `/apple-touch-icon-precomposed.png` als Alias
des 180-Pixel-Symbols; der Node-Server bietet denselben Pfad an.
Die HTML-Verweise verwenden eigene Dateinamen statt `?v=3`:
`/assets/slopurself-favicon-v4.ico`, `/assets/slopurself-favicon-v4.png` und
`/assets/slopurself-touch-v4.png`. Der Build erstellt diese identischen Kopien
fuer Node und Cloudflare aus den obigen Quelldateien. Es gibt keine zweite
manuell gepflegte Version der Bilder. Beide Apple-Link-Typen zeigen auf dasselbe
versionierte Touch-Icon; die automatischen Standardpfade bleiben erhalten.
Die Browserpruefung decodiert ICO und PNG und kontrolliert die Pixel des Symbols.
Das bestaetigt die Bilddecodierung in WebKit, aber nicht automatisch die Anzeige
in der Tab-Leiste der installierten Safari-Version.

## Cloudflare-Routing

Der urspruengliche SPA-Fallback lieferte fuer fehlende Icon-Pfade, einschliesslich
`/apple-touch-icon-precomposed.png`, die Spielseite mit Status 200 und HTML statt
eines Bildes. Dies wurde live und im lokalen Cloudflare-Worker reproduziert.
`not_found_handling = "none"` laesst unbekannte Pfade jetzt korrekt mit 404
antworten. Die Spielansichten liegen weiterhin alle unter `/`; eigene
Browser-Routen, die einen SPA-Fallback benoetigen, gibt es nicht.

Regressionstests pruefen beide automatischen Safari-Pfade, die PNG-Signaturen,
die Bildpixel und fehlende Dateien sowohl als Bild- als auch Navigationsanfrage.
Die Routing-Korrektur behebt einen nachgewiesenen Serverfehler; ob dieser allein
die fehlende Anzeige in einer konkreten Safari-Installation verursacht hat,
muss separat am Browser bestaetigt werden.

## Safari-Diagnose

Die deployten Bilder liefern auch mit Safari-User-Agent, per HEAD und mit
`Cache-Control: no-cache` gueltige Bildantworten. Der Nutzer hat die korrekte
Darstellung der deployten ICO-Datei beim direkten Aufruf in Safari bestaetigt.
Trotzdem wurde in der Safari-Tab-Leiste weiterhin ein W gemeldet. Die falsche
HTML-Antwort erklaert diesen verbleibenden Fehler daher nicht vollstaendig.

Die echten neuen Dateipfade sind ein gezielter Kompatibilitaetsversuch, keine
Bestaetigung einer Cache-Ursache. Safari hat einen separat gemeldeten Fehler
bei Favicon-Aktualisierungen:
https://bugs.webkit.org/show_bug.cgi?id=266426. Browserdaten werden weder
geloescht noch veraendert. Tests pruefen GET, HEAD, Bilddecodierung und gleiche
Dateiinhalte fuer versionierte und automatische Pfade. Die native Tab-Anzeige
muss weiterhin separat bestaetigt werden.

## Generierungsprompt

Erstelle ein quadratisches Favicon fuer das Spiel Slop Urself: eine kraeftige
korallrote Filmklappe (#ff4757) mit grosser weisser Play-Taste und einem einzelnen
mintgruenen Klappenstreifen (#2ed573), zentriert auf dunklem Hintergrund (#12141a).
Flache, klare Logo-Grafik, sehr breite Formen, hohe Kontraste, bei 16 Pixeln
erkennbar. Symbol fuellt 85 Prozent des Bildes. Keine Schrift, keine Schatten,
keine Verlaeufe, keine feinen Details, kein Mockup.
