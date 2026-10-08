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
Die HTML-Verweise verwenden `?v=3`, damit Browser die neue Version abrufen.
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

## Generierungsprompt

Erstelle ein quadratisches Favicon fuer das Spiel Slop Urself: eine kraeftige
korallrote Filmklappe (#ff4757) mit grosser weisser Play-Taste und einem einzelnen
mintgruenen Klappenstreifen (#2ed573), zentriert auf dunklem Hintergrund (#12141a).
Flache, klare Logo-Grafik, sehr breite Formen, hohe Kontraste, bei 16 Pixeln
erkennbar. Symbol fuellt 85 Prozent des Bildes. Keine Schrift, keine Schatten,
keine Verlaeufe, keine feinen Details, kein Mockup.
