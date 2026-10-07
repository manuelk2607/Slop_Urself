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
Die HTML-Verweise verwenden `?v=2`, damit Browser die neue Version abrufen.
Die Browserpruefung decodiert ICO und PNG und kontrolliert die Pixel des Symbols.
Das bestaetigt die Bilddecodierung in WebKit, aber nicht automatisch die Anzeige
in der Tab-Leiste der installierten Safari-Version.

## Generierungsprompt

Erstelle ein quadratisches Favicon fuer das Spiel Slop Urself: eine kraeftige
korallrote Filmklappe (#ff4757) mit grosser weisser Play-Taste und einem einzelnen
mintgruenen Klappenstreifen (#2ed573), zentriert auf dunklem Hintergrund (#12141a).
Flache, klare Logo-Grafik, sehr breite Formen, hohe Kontraste, bei 16 Pixeln
erkennbar. Symbol fuellt 85 Prozent des Bildes. Keine Schrift, keine Schatten,
keine Verlaeufe, keine feinen Details, kein Mockup.
