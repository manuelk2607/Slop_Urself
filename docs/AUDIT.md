# Technische Prüfung

## Erneute robots.txt-Ursachenanalyse vom 23. Oktober 2026

Google hat die produktive Startseite, robots.txt und Sitemap zwischen 13:10 und
13:13 UTC erfolgreich abgerufen. Für robots.txt sind HTTP 200, text/plain und die
tatsächlichen Regeln direkt in Googles Prüfbericht nachgewiesen. Eine aktuelle
Sperre und die historische Ursache des gemeldeten Search-Console-Fehlers sind
nicht nachgewiesen. Die frühere Ursachenbehauptung zum Asset-Routing wird nicht
aufrechterhalten. Keine weiteren spekulativen Codeänderungen oder Deployments.
HTTP-Matrix, produktive Cloudflare-Einstellungen, Grenzen der WAF-Prüfung und
die notwendigen nächsten Berichtsdaten stehen in [ROBOTS-INCIDENT.md](ROBOTS-INCIDENT.md).

## Verpflichtende persönliche HF-Verbindung und SEO vom 23. Oktober 2026

Ausgangspunkt: `91c4b60`, Implementierung auf `codex/mandatory-hf-seo`.

- Node und Cloudflare prüfen die kontogebundene HF-Verbindung vor Raum-Erstellung,
  Spielerbeitritt und Wiederaufnahme. Zuschauer und ausdrücklich konfigurierte
  Mock-KI sind ausgenommen. Ein eigener WebSocket-Fehler `hfRequired` öffnet die
  Wiederverknüpfung, ohne die gespeicherte Raumsitzung zu verwerfen. Der Dialog
  bleibt bei Zustandsupdates bedienbar. Widerrufene Kontingentrechte blockieren
  neue Jobs und fordern erneute Verknüpfung an.
- Echte Reservierungen benötigen sämtliche verifizierten Teilnehmer. Jeder Job
  pinnt die Ersteller-Verbindung und prüft bei Verwendung Profil-ID und HF-Subjekt.
  Ein Server-Token wird weder als Ersatz noch zur Kontingentabfrage verwendet.
  Die alte zentrale Identität dient ausschließlich der Zuordnung bestehender
  Reservierungen. Fehlende, fremde, abgelaufene und manipulierte Zuordnungen
  blockieren den Auftrag. Bekannte Aufträge behalten ihren ursprünglichen Zugang.
- Die Rundengrenze entspricht dem knappsten persönlichen Videobudget. Gleiche
  HF-Identitäten mehrerer Profile zählen gemeinsam, nicht mehrfach. Zwei getrennte
  300-Sekunden-Testkonten erlauben bei 79 Sekunden Planbudget drei Runden/sechs
  Videos. Ein zentraler HF_TOKEN ist keine Deployment-Voraussetzung mehr und wird
  standardmäßig nicht hochgeladen. Die erforderliche HF_OAUTH_CLIENT_ID ist im
  bestehenden Cloudflare-Deployment als Secret vorhanden; nur Namen wurden geprüft.
- Die öffentliche Startseite enthält statisch lesbare Spielinformationen,
  Sprachangabe, Titel/Beschreibung, Canonical, Open Graph, Twitter-Metadaten,
  WebSite/VideoGame-JSON-LD und den vorgegebenen Google-Verifizierungstag.
  robots.txt und Sitemap enthalten die tatsächliche öffentliche Origin.
  API-Antworten erhalten zusätzlich Noindex- und No-store-Header. Private Inhalte
  behalten ihre Berechtigungsprüfung. Alle Skripte laden mit defer; der Einstieg
  benötigt keine zusätzliche Konfigurationsabfrage für die HF-Oberfläche.
- Die neuen Tests prüfen unter anderem direkte umgangene UI-Sperren in Node und
  workerd, einen fremden HF-Cookie, gepinnte Job-Zuordnung, widerrufene Rechte,
  getrennte Ersteller-Tokens, Wiederaufnahme, Kontingentreservierungen und statische
  Indexierbarkeit ohne JavaScript. Bestehende Tests für gemeinsame Kontingente
  verwenden nun explizit verknüpfte Testprofile derselben HF-Identität.

Verifikation: TypeScript-/Browser-Build und 144 Unit-Tests bestanden. Sämtliche
Chromium- und WebKit-Prüfungen bestanden, einschließlich Node und lokalem
workerd, beider Archivmodi, Mehrspieler-/Zuschauer-/Revanche-Abläufen und SEO.
Der nach der Unterbrechung separat abgeschlossene WebKit-CI-Lauf endete mit
Exitcode 0. Alle HF-Aufrufe und
Videoerstellungen in automatisierten Tests waren simuliert; kein echtes
GPU-Kontingent, keine Produktivdatenbank und kein Produktivarchiv wurden genutzt.
Der öffentliche Bestands-Host antwortete vor der Veröffentlichung auch mit
Googlebot-User-Agent über HTTPS mit HTTP 200. Ein echter persönlicher
GPU-Abbuchungsnachweis wurde in diesem Auftrag nicht ausgeführt.

Search Console: Der HTML-Tag allein bestätigt die Property noch nicht. Nach dem
Deployment in der URL-Präfix-Property die Verifizierung bestätigen und
`sitemap.xml` einreichen; Google bestimmt die Aufnahme in den Suchindex.
Details stehen in `docs/SEO.md`.

## Neuimplementierung vom 21. Oktober 2026

Ausgangspunkt und unveränderter Git-HEAD: `d166133ab02dd7c3a6094811524df63f16d848d6`.
Die Anforderungen wurden in diesem Repository neu implementiert; Zahlen aus der
verlorenen Cloud-Arbeitskopie wurden nicht als Testnachweis übernommen.

- Atomare Sammelwiederherstellung mit maximal 200 deduplizierten bigint-IDs,
  8-KiB-Grenze, Same-Origin/Sitzungsprüfung und gemeinsamem SQL-Anweisungsbeginn.
  Vorhandene Runden werden wieder verknüpft; abgelaufene Fristen bleiben endgültig.
  Browserpakete starten parallel, temporäre Fehler bleiben bis zur Frist erneut
  versuchbar. Die sofortige Anzeige und Tab-Wiederaufnahme bleiben erhalten.
- Freiwilliger Profilpasswortschutz mit PBKDF2-SHA256, 100.000 Iterationen,
  zufälligem 16-Byte-Salt und konstantzeitlichem Vergleich. Additive SQL-Spalten
  `password_hash`/`auth_version`, entsprechender DO-Store und separate Admin-
  Freigabe mit exakter Zielbestätigung. Alte HTTP-/WebSocket-Anfragen werden
  widerrufen; auch vor neuen privaten Snapshots wird die Sitzung frisch geprüft.
  Zusammenfallende Snapshot-Prüfungen liefern den neuesten Zustand statt alte
  wartende Ansichten. Passwortwerte werden beim Schließen sofort geleert.
- Persönliche Bereitschaft und standardmäßig deaktiviertes `requireReady`;
  erneute Serverprüfung nach Budgetabfragen. Änderungen an Besetzung, Runden,
  Regeln und gemeinsamem Bild setzen die Bereitschaft zurück.
- Bis zu zehn Spieler und zwanzig getrennte Zuschauer, einschließlich Beitritt
  während einer Partie, Wiederaufnahme, Hibernation und Rückführung beim letzten
  Spielerabgang. Zuschauer haben keine Schreibrechte, Punkte oder GPU-Reservierung
  und erhalten keine privaten Aufgaben, unveröffentlichten Rateversuche oder Keys.
- Host-Revanche mit neuem Raumcode, frischen persönlichen Sitzungen und leerem
  Spielzustand. Historie bleibt erhalten; ausstehende alte Writes werden vorher
  abgearbeitet. Node hält fehlgeschlagene Writes in Reihenfolge zurück;
  Cloudflare verwendet seine dauerhafte Queue und eine idempotente Zielübergabe.
  Eine verlorene Antwort erzeugt beim nächsten Versuch keinen zweiten Raum.
- GitHub Actions als getrennte Chromium-/WebKit-Matrix, Node 24, je 25 Minuten,
  `fail-fast: false`, eindeutige Artefakte und isolierter PostgreSQL-17-Service.
- Manueller persönlicher HF-Nachweis vorbereitet: explizites Flag und erwartetes
  Konto, exklusive Ausführungssperre und persistenter Einmalzaun vor dem Klick.
  Genau ein synthetisches fünfsekündiges Economy-Video, MP4/Range/Wiedergabe,
  gespeicherte Statistik und beobachtete persönliche Abbuchung als Erfolgskriterien.
  Nicht in CI, keine GPU-Ausführung im Rahmen dieses Auftrags.

### Tatsächlich geprüft

- Beide TypeScript-Projekte und Browser-Bundles erfolgreich gebaut.
- 141 Unit-Tests erfolgreich, einschließlich Passwortmigration/-widerruf,
  Zuschauerschutz, Bereitschaft nach asynchroner Reservierung, idempotenter
  Revanche bei verlorener Antwort und HF-Evidenzsperre.
- Isoliertes lokales PostgreSQL 17: Legacy-Profil mit unveränderter ID migriert,
  Passwort geprüft und altes JWT widerrufen. Ein verlangsamter SQL-Trigger lässt
  Fristen während des Statements verstreichen: berechtigte Videos werden trotzdem
  gemeinsam wiederhergestellt, zuvor abgelaufene nicht. Relinking, Wiederholung
  und Wiederherstellung ohne alten Raum bestanden.
  Eine neu angelegte Revanche-Lobby mit frischen IDs und Nullpunkten erhält
  nachweislich alte Partien, Videos, Siege und kumulierte Spielerpunkte.
- Die bestehende vollständige PostgreSQL-Integration mit temporären Tabellen
  ebenfalls bestanden: Runden, Stimmen, Endwertung, Statistik, Rollback,
  Archivtrennung und bestehende additive Migrationen.
- Live-Nachweiswerkzeug separat mit TypeScript geprüft. Seine Sperrlogik wurde
  ohne Browser-/Netzwerkzugriff und ohne echten KI-Auftrag getestet.
- Mobile Screenshots für Passwortdialog und Zuschauer-Revanche visuell geprüft;
  keine Überlappungen oder horizontales Überlaufen in den geprüften Ansichten.
- Abschließender vollständiger Chromium-/WebKit-Gesamtlauf erfolgreich (Exit 0),
  einschließlich Node, echter workerd-/SQLite-Durable-Object-Laufzeit,
  Passwortänderung und Widerruf einer untätigen Verbindung, Bereitschaft,
  absichtlich verbotenen Zuschauerkommandos, Revanche, vollständiger unabhängiger
  Wiederverbindung und Bereinigung beim letzten Spielerabgang.
  Die 451-ID-Browserprüfung bestätigt gleichzeitig gestartete Pakete sowie
  Wiederholung nach temporärem Fehler und Reload.
- Lokale Tests liefen mit Node 26.8.1 auf macOS. Node 24 ist für GitHub Actions
  konfiguriert; ein neuer externer CI-Lauf wurde nicht ausgelöst. Beim ersten
  WebKit-Start fehlte lokal die Browserdatei; nach Installation vollständig geprüft.
- Ein vorheriger Gesamtlauf hatte einmal einen 15-Sekunden-Timeout beim Erstellen
  eines Cloudflare-Mock-Raums. Im isolierten Test und im vollständigen Nachlauf
  nicht erneut aufgetreten; Ursache nicht belegt. Datensparsame Diagnose protokolliert
  bei Testfehlern nur Nachrichtentypen, Phase und Teilnehmerzahl, keine Sitzungskeys
  oder vollständigen Snapshots. Keine automatische Testwiederholung oder schwächere
  Erfolgsprüfung eingebaut. Dieser sporadische Testbefund bleibt zu beobachten.

### Separat offen

- Genau ein echtes persönliches HF-Video mit nachgewiesener Kontingentabbuchung.
  Anmeldung und simulierte Zuordnung allein ersetzen diesen Nachweis nicht.
- Bestätigung des externen GitHub-Actions-Laufs zu `d166133`; nicht aus lokalen
  Tests abgeleitet und für diesen Auftrag nicht abgefragt.
- Kein Push, Commit, Deployment, Secret-Upload oder produktiver DB-Eingriff.
  Alle Änderungen bleiben lokal. Die lokale PostgreSQL-Instanz ist ausschließlich
  ein Testsystem; keine Neon-Produktivdaten wurden migriert oder gelöscht.
- Keine ungeprüfte Übernahme der früheren Cloud-Proxy-Diagnose. Ein tatsächlicher
  CONNECT-Fehler wäre vor der API einzuordnen; erst bei erreichbarer GitHub-API
  wären deren Anmeldung und Rechte zu prüfen. Zugangsdaten wurden nicht übertragen.

## Sicherheits- und Stabilitätskorrekturen vom 19. Oktober 2026

- Den globalen Rate-Limiter gegen Registry-Erschöpfung abgesichert:
  variable URL-IDs werden auf feste Routengruppen reduziert, Cloudflare-Zähler
  nach anonymisiertem Client-/Routenschlüssel isoliert. Lokale Speichergrenzen
  lösen keine globale Sperre mehr aus. Regression mit 2.100 unterschiedlichen
  ungültigen URLs: ab Anfrage 121 begrenzt, unabhängige Clients bleiben nutzbar.
- Persönliche HF-Verbindungen funktionieren bei widerrufenem zentralem Token.
  Eine gespeicherte zentrale Identität erhält die Zuordnung bereits bestehender
  Reservierungen; gemischte Partien benötigen weiterhin ein nutzbares Budget
  für jeden Spieler. Keine geschätzten oder zusätzlich erfundenen GPU-Sekunden.
- Einmalig ausgegebene Gerätetokens werden vor weiteren Netzwerkprüfungen
  verschlüsselt gesichert. Nach temporärem Kontingentfehler und Objektneustart
  wird die Validierung wiederholt, nicht der einmalige Tokenaustausch.
  Gleichzeitige Polls und Callback-Wiederholungen bleiben einmalig; parallele
  Vault-Schreibvorgänge und Bereinigung erhalten den vollständigen Ablaufindex.
- HF-Anmeldung und reine Budgetansichten liegen außerhalb der globalen
  Reservierungswarteschlange. Langsame Statusabfragen blockieren weder andere
  HF-Konten noch Budgetfreigaben. Reservierungen und Verbrauch bleiben atomar
  serialisiert, einschließlich gleichzeitiger Starts in mehreren Räumen.
  Gleichzeitige Bereinigungsanfragen behalten stets den frühesten Termin;
  spätere HF-Fristen verschieben keine anstehende Videolöschung.
- Bei Sammellöschung erscheint Rückgängig unmittelbar nach jeder bestätigten
  Löschung und bleibt auch während einer langsamen Folgeanfrage verfügbar.
- 125 Unit-Tests, beide TypeScript-Prüfungen und `npm audit` bestanden.
  Vollständige CI-Suite mit Node, echter lokaler Cloudflare-Laufzeit,
  Chromium und WebKit bestanden, einschließlich zehn gleichzeitiger Spieler,
  persönlicher HF-Konten, Reload, synchroner Bewertung und Statistikverwaltung.
  Nach der zusätzlichen Alarm-Absicherung beide workerd-Integrationstests
  erneut erfolgreich geprüft. Keine echten HF-Aufträge und keine Änderungen an
  produktiven Benutzern, Spielen, Videodateien oder dem Datenbankschema.

## HF-Anmeldefehler und Gerätecodefluss vom 17. Oktober 2026

- Den 404 auch im echten Safari reproduziert: Die Zustimmungsseite war
  erreichbar, nach dem Absenden von HF selbst erschien aber erneut 404.
  Die vorherigen Vermutungen zu Scope-Kodierung, `prompt=consent` und einem
  kurzzeitigen Cachefehler waren damit kein ausreichender Ursachenbeleg.
  Das erzwungene automatische Neuladen und das Skript-Popup wurden entfernt.
- Offiziellen Gerätecodefluss mit derselben öffentlichen OAuth-App und
  unveränderten Scopes `openid profile read-billing` geprüft. HF meldet
  `/oauth/device/success`, Tokenaustausch und persönliche Kontingentabfrage
  liefern HTTP 200 und 300 von 300 GPU-Sekunden. Auch im lokalen Spiel
  erfolgreich bestätigt und automatisch als verbunden übernommen.
- Die Spieloberfläche zeigt den Bestätigungscode, einen normalen externen
  Link und Abbrechen. Gerätecode und Zugangstoken bleiben verschlüsselt auf
  dem Server; öffentliche Antworten geben keine internen Capabilities aus.
  Profil-ID, Spieladresse und HTTP-only-Cookie binden jede Bestätigung.
  Pollingintervalle, `slow_down`, Ablehnung, Ablauf und Wiederaufnahme nach
  Reload sind berücksichtigt. Ein wiederholter Poll nach verlorener Antwort
  verwendet denselben bereits gespeicherten Zugang.
- Verifikation: 119 Unit-Tests und die vollständige CI-Suite mit Chromium,
  WebKit und echter lokaler Cloudflare-Laufzeit bestanden. Die abschließende
  UI-Fassung zusätzlich in beiden Browsern geprüft: Codeanzeige, Abbruch,
  Wiederaufnahme einer offenen Bestätigung nach Reload, automatische Anzeige
  des verbundenen Kontos und drei vollständige Zwei-Spieler-Runden mit sechs
  simulierten Videos und übereinstimmender Endwertung.
- Kein echter GPU-Auftrag für diese Anmeldung gestartet. Die persönliche
  Zuordnung eines tatsächlich generierten Videos bleibt separat zu prüfen.
- Produktiven Live-Test am 18. Oktober 2026 vollständig abgeschlossen:
  bestehendes Testprofil `LiveTestA1015`, echte HF-Freigabe für Manuel2607,
  automatische Übernahme im veröffentlichten Spiel und erneute Anzeige nach
  Reload: 300 / 300 GPU-Sekunden. Die Bestätigung im nativen Safari wurde
  begonnen; nach Unterbrechung war die Fernsteuerung dort nicht stabil
  verfügbar. Der vollständige produktive Nachweis erfolgte deshalb im
  In-App-Browser; Safari/WebKit ist zusätzlich automatisiert getestet.
  Cloudflare-Version `376247ac-db11-4a0e-bbc2-21afa101a984`, Code-Commit
  `488799e`; zugehöriger GitHub-Actions-Lauf `39071057511` erfolgreich.
  Keine Spiel-, Video- oder Statistikdaten für diesen Anmeldetest verändert.

## Persönliches HF-Kontingent vom 17. Oktober 2026

- Optionale HF-Anbindung zusätzlich zur unveränderten Anmeldung mit einem
  Benutzernamen. Öffentliche OAuth-App ohne Client-Secret, PKCE S256,
  einmaliger Zustand und eigenes HTTP-only-Lax-Cookie für die Rückleitung.
  Die vom Nutzer freigegebene echte App wurde im HF-Konto angelegt;
  Rückleitungen sind auf Loopback und die bestehende Spieladresse begrenzt.
- Echte Profilanmeldung nach gesonderter Freigabe getestet: Tokenaustausch,
  Userinfo und kanonische Identitätsprüfung erfolgreich. Im ersten Versuch
  schlug die ZeroGPU-Kontingentabfrage mit den Scopes `openid profile` fehl;
  dabei wurde keine Verbindung gespeichert.
  Laut HF-Dokumentation benötigt der Kontingentendpunkt zusätzlich die
  Leseberechtigung für Nutzungsdaten und Zahlungsstatus (`read-billing`).
  Nach ausdrücklicher Freigabe die echte OAuth-App um `read-billing`
  erweitert und die lokale Verbindung mit Manuel2607 erneut autorisiert.
  Erfolg: echtes persönliches Restkontingent von 75 / 300 GPU-Sekunden
  angezeigt, verschlüsselte Verbindung gespeichert und nach Seitenneuladen
  erneut korrekt abgerufen. Keine zusätzlichen Repository-, Inference-,
  Jobs-, Kauf- oder Schreibrechte angefordert. Anwendungscode liest nur
  Profil und Kontingent, keine Zahlungsdetails. Keine kostenpflichtigen
  Aufträge oder Zahlungen freigegeben.
- Zugangsdaten serverseitig AES-GCM-verschlüsselt, mit konto- und
  browsergebundener zufälliger Capability statt Token im Browser.
  Maximal acht Stunden Laufzeit, Trennen und Bereinigung nach Ablauf.
  Spielzustände und öffentliche Kontoantworten enthalten keine HF-Capability,
  Tokens oder persönlichen Kontingentdaten anderer Spieler. Lokal
  verschlüsselte Dateien unter `.local/hf/`, von Git ausgeschlossen;
  Cloudflare nutzt das Service-Durable-Object. Kein DB-Schema geändert.
- Reservierungen und Aufträge werden nach verifizierter HF-Identität
  getrennt. Mehrere Spielprofile mit demselben HF-Konto, einschließlich des
  gemeinsamen Serverkontos, vervielfachen dessen Budget nicht. Gemeinsame
  Runden richten sich nach dem knappsten Konto. Bei zwei unabhängigen vollen
  Konten reichen jeweils 300 Sekunden mit 79 Sekunden Planung für drei
  Runden und sechs Videos; es ist keine garantierte Laufzahl.
  Ein persönlicher Zugang fällt bei Ablauf nicht still auf das Serverkonto
  zurück. Bereits gestartete Aufträge behalten für die Ergebnisabfrage ihren
  verschlüsselten ursprünglichen Zugang bis Abschluss oder Ablauf.
- Isolierte Tests prüfen Zustandswiederholung, fremde Browser und Konten,
  Quotenfehler ohne gespeicherte Verbindung, Secret-Bereinigung,
  Kontendeduplizierung, parallele Raumreservierungen und Tokenzuordnung.
  Zwei getrennte Browserprofile spielen mit simulierten HF-Konten drei
  Runden mit sechs Videos, Reload, gegenseitigen Bewertungen und identischer
  Endwertung. Echte workerd-Laufzeit prüft Worker-Routen, verschlüsselte
  DO-Persistenz nach Eviction, persönliches Kontingent und Trennen.
- Nebenbefund: Eintreffende Lobby-Snapshots konnten gültige Eingaben in der
  Rundenauswahl vor dem Bestätigen überschreiben. Eine gerade bearbeitete
  gültige Host-Eingabe bleibt jetzt erhalten; neue Budgetgrenzen gelten
  weiterhin sofort. Der neue KI-Kontodialog wird auf Mobilgerät und Desktop
  zentriert und gegen Überlauf geprüft. Nur der Host fragt periodisch das
  Raumkontingent ab; Beitritte und Änderungen aktualisieren weiterhin sofort.
- Abschlussprüfung: Build und 118 Unit-Tests bestanden, vollständiger
  `npm run test:ci` mit Chromium, WebKit und lokaler Cloudflare-Laufzeit
  bestanden. Anschließend die letzten UI-Änderungen nochmals in beiden
  Browsern gezielt geprüft: Anmeldung, zentrierter Dialog, lesbarer mobiler
  Benutzername, individuelles Budget und Rundenlimit. Im Zwei-Konten-Test
  laufen alle sechs mindestens fünfsekündigen Mock-MP4s in beiden Browsern;
  Gewinner und vollständige Endwertung stimmen überein. Keine echten
  GPU-, Datenbank- oder Archivschreibzugriffe durch diese Tests.
- Echter zentraler Kontingentcheck weiterhin `base=300`,
  `current=75.285468`, Reset am 17. Oktober um 17:27:28,692 UTC.
  Kein neuer GPU-Auftrag: Das Restbudget deckt keine weitere konservativ
  geplante Standardgenerierung mit Reserve. Persönliche Live-Generierung
  und deren reale Kontingentabbuchung sind daher noch nicht nachgewiesen.
  Keine Produktionsdaten geändert, kein Push und kein Deployment.

Quellen: [HF OAuth](https://huggingface.co/docs/hub/oauth),
[HF Kontingentabfrage](https://huggingface.co/docs/huggingface_hub/en/guides/manage-spaces#track-your-zerogpu-quota).

## ZeroGPU-large-Test vom 17. Oktober 2026

- Nach Anmeldung des Nutzers kostenlose private ZeroGPU-Kopie angelegt:
  `Manuel2607/SlopUrself-Wan22-GPU-Test`. Upstream-Quellstand
  `fca7f5a33da3057bae497de5cd70f49ce75e6c02`; Teststand
  `ed1bb1cacd00f89c789b1d8d13657d71d49ad4a6`. GPU-Größe fest `large`,
  Laufzeitfreigabe für den Test 87,5 Sekunden statt 35. Zufällige Modellwahl
  ersetzt durch `TestOrganizationPleaseIgnore/WAMU-Merge-MotionBoost_WAN2.2_I2V_LIGHTNING`
  mit Revision `261ceaab8aeeb2493bf0b7304a51c190c1e91073`.
  Keine zusätzlichen Tokenrechte erteilt. Keine Änderung am produktiven Spiel.
- Genau ein echter Auftrag, keine Wiederholung: öffentliches bestehendes
  Testbild (Katze mit Sonnenbrille), 624 x 832, Seed 42, vier Schritte,
  fünf Sekunden, Guidance 1/1, UniPCMultistep, Flow-Shift 3, keine
  Zwischenbildberechnung. Prompt: Kopf langsam nach links drehen, Kamera
  festhalten und Sonnenbrille erhalten; derselbe Promptzusatz wie im Spiel.
- Erfolg: H.264, yuv420p, 16 fps, 5,0625 Sekunden, 887.063 Bytes.
  Download HTTP 200 als `video/mp4`; vollständiges Decodieren mit ffmpeg
  ohne Fehler. Anfangs-/Endbild bestätigen die sichtbare Kopfdrehung und
  erhaltene Sonnenbrille; die Qualität ist nur für dieses Beispiel bewertet.
  Native Safari-Wiedergabe wurde für diesen isolierten Lauf nicht geprüft.
- Laufzeit laut GPU-Funktion 70,28 Sekunden (davon 69,37 Inferenz);
  Auftrag insgesamt 77,80 Sekunden. Tatsächliche HF-Abbuchung:
  77,091136 Sekunden, von 152,376604 auf 75,285468 Restsekunden.
  Spitzenwerte laut PyTorch: 42.587.323.904 Bytes alloziert und
  46.586.134.528 Bytes reserviert. Kein Speicherausfall bei diesem Lauf;
  daraus folgt keine Zusicherung für andere Einstellungen.
- Frühere xlarge-Läufe mit gleichem Bildformat, fünf Sekunden und vier
  Schritten kosteten 72,950944 bzw. 74,672452 Sekunden. Modellstand und Seed
  waren dabei nicht kontrolliert identisch: historische Referenzwerte,
  kein strenger A/B-Vergleich. Der large-Test zeigt keine Kontingentersparnis;
  deshalb keine Umstellung oder Halbierung der Budgetschätzungen im Spiel.
  Ein frischer xlarge-Gegenlauf passt nicht mehr mit Reserve ins Restbudget
  und wurde nicht gestartet. Testkopie anschließend pausiert, nicht gelöscht;
  Ergebnisvideo lokal unter `/tmp/slop-wan22-large-result.mp4` gesichert.
- Persönliche HF-Anbindung ist hier nur bewertet, nicht implementiert:
  OAuth mit PKCE und minimalen Berechtigungen, geschützte Tokens sowie
  Reservierungen und Jobs pro verifizierter HF-Identität. Ein bloßer
  Spielname darf keinen Zugriff auf den HF-Zugang des Namensinhabers geben.
  Vor Umsetzung prüfen, ob der OAuth-Token sowohl die ZeroGPU-Kontingent-
  abfrage als auch die Gradio-Queue autorisiert; der dokumentierte Scope
  `inference-api` allein beweist das nicht. Gemeinsame Runden richten sich
  nach dem kleinsten individuell verfügbaren Videobudget, nicht nach der
  Summe der persönlichen Sekunden. Für Freunde wären keine eigenen Spaces
  oder manuell kopierten API-Schlüssel nötig.

Quellen: [HF ZeroGPU](https://huggingface.co/docs/hub/spaces-zerogpu),
[HF OAuth](https://huggingface.co/docs/hub/oauth),
[aktueller Wan-Space](https://huggingface.co/spaces/Saravutw/WAN2.2_I2V_LIGHTNING_4-8step_custom/blob/main/app.py).

## Korrektur des GitHub-Testbilds vom 17. Oktober 2026

Der GitHub-Actions-Lauf 38981968541 scheiterte im ersten Linux-WebKit-
Spielablauf, bevor ein Video erzeugt wurde: `Decoding error.`, anschließend
fehlende Bildauswahl und Timeout beim Warten auf `screenVoting`. Chromium
und die vorherigen Tests desselben Laufs waren erfolgreich. Das alte inline
gespeicherte 1x1-PNG ist beschädigt; auch der strikte pngjs-Decoder weist
seine Bytes zurück. Lokales macOS-WebKit hatte dieses Bild noch akzeptiert.

Die drei betroffenen Browser-Tests (Spielablauf, Videowiedergabe, Zusatzrunden)
verwenden jetzt den bestehenden Generator für vollständige PNG-Dateien und
warten vor dem Absenden auf die vorbereitete Bildvorschau. Ein zusätzlicher
Unit-Test prüft Prüfsummen, Abmessungen und Pixelinhalt der gemeinsamen
Bild-Fixtures. Keine Tests wurden abgeschwächt oder übersprungen. Keine
Anwendung, KI-Konfiguration oder Produktivdatenbank geändert; ein neues
Cloudflare-Deployment ist für diese reine Testkorrektur nicht erforderlich.

## Party-Erweiterungen vom 17. Oktober 2026

- GPU-Planung nutzt weiterhin ausschließlich das echte HF-Restkontingent,
  verbleibende Aufrufe, Spielerzahl und globale Reservierungen. Das kostenlose
  Gesamtbudget wurde lesend mit `base=300` bestätigt; zum Prüfzeitpunkt waren
  `current=152.376604` Sekunden und sechs Aufrufe übrig, Reset am
  17. Oktober um 17:27:29 UTC. Kein neuer GPU-Auftrag wurde gestartet.
  Die xlarge-Gewichtung wird nicht doppelt angewandt. Die bisherigen
  70/110-Sekunden-Schätzungen für vorbereitete Bilder unterschätzten die
  gemessene Abrechnung; Reserven sind jetzt 79/126 Sekunden, quadratisch
  67/100 Sekunden. Eine komplette Runde benötigt ein Video pro Spieler.
  Das volle Fünf-Minuten-Budget garantiert daher nicht vier Videos.
- Datenschutzfreundliche Fehlerdiagnose ergänzt die Pipeline-Phase und den
  HTTP-Status. Speicherfehler, volle Queue, Serverneustart, fehlende und
  nicht klassifizierbare Providerdetails sind unterscheidbar. Keine
  Original-Fehlertexte, Tokens, Prompts, Upload-URLs oder Cookies in KI-Logs.
  Die alte Ursache von `provider_error` wird dadurch nicht rückwirkend bewiesen.
- Einladungslinks enthalten nur den Raumcode. Registrierung und Anmeldung
  behalten die Einladung bei; ein erfolgreicher Beitritt verbraucht sie.
  Alte gespeicherte Räume haben gegenüber einer anderen Einladung keinen
  Vorrang. Neue Räume bleiben klassisch mit eigenen Bildern voreingestellt.
- Optionale Zeitlimits und bestätigtes Abschließen durch den Host verwenden
  dieselbe gemeinsame Zustandslogik in Node und im Room-Durable-Object.
  Deadline und Phasenschlüssel überstehen DO-Neustart und Reload. Fehlende
  Stimmen sind Enthaltungen, unbestätigte Treffer geben keine Bonuspunkte.
  Unklare laufende Generierungen werden nicht übersprungen oder wiederholt.
- Archiv-Best-of und Archiv-Prompt-Raten sind auch bei leerem KI-Budget
  spielbar. Ein begrenzter SQL-Pool schließt gelöschte, evizierte und externe
  Videos aus. Archivpartien schreiben keine neuen Erstellungspunkte, Runden
  oder Videos in die Dauerstatistik. Best-of berücksichtigt alle Stimmen;
  beim Raten rotiert die Auflösung. Keine neue Schemaänderung erforderlich.
- 110 Unit-Tests bestanden. Echte PostgreSQL-Integration mit ausschließlich
  temporären Tabellen bestanden, einschließlich des neuen Archiv-Pools und
  Löschfilters; keine Produktivzeilen geändert. Browserprüfungen umfassen
  beide Archivmodi ohne GPU, Einladungen mit Anmeldung, mobile Darstellung,
  echte MP4-Wiedergabe und zehn getrennte gleichzeitige Mock-Spieler mit
  Host-Skip, neun Videos, 81 Bewertungen, Reload und identischer Endwertung.
  Nativer Safari-Gesamtablauf ist nicht bestätigt; dafür wird automatisiert
  WebKit geprüft. Der Versuch im nativen Safari wurde bei einem Wechsel des
  aktiven Fensters beendet, ohne andere Tabs weiter zu bedienen.

- Vollständiges `npm run test:ci` mit Chromium und WebKit auf Node und dem
  echten lokalen workerd-Runtime bestanden, einschließlich der neuen
  Archivtests und der Zehn-Spieler-Tests auf beiden Backends. Browser- und
  API-Tests verwenden ausschließlich isolierte Fixtures/Mock-AI; der
  PostgreSQL-Test beschränkt alle Tabellen auf `pg_temp`.
- Getesteter Build auf Cloudflare veröffentlicht, Version
  `6bb89ef7-b192-4a4b-8366-5cd3308b40a1`, unter
  `https://slopurself.maki26.workers.dev/`. Gefilterte Live-Logs bestätigten
  exakt diese ausführende Version für Worker, RoomDurableObject und
  ServiceDurableObject, ohne Exceptions im Release-Check.
- Produktiver Release-Check mit dem vorhandenen Profil LiveTestA1015 und
  flüchtigem Raum FCD4: Archiv-Best-of gestartet, gespeichertes MP4 als
  authentifizierter Range mit 206 und exakt 128 Bytes abgerufen, getrennte
  WebSocket-Verbindung wieder aufgenommen, identische Deadline/Video,
  vier Punkte nur für die Videowertung, keine neuen Spielerpunkte.
  Dauerstatistik vor/nach identisch und kein zusätzlicher Raum in der DB.
  Anschließend den flüchtigen Raum verlassen. Keine bestehenden Daten gelöscht,
  kein GPU-Auftrag gestartet. Dieser Release-Check war API-/WebSocket-basiert,
  keine zusätzliche Browserwiedergabe auf Produktion.
- SHA-256-Vergleich von produktivem HTML, CSS und Client-Bundle mit dem lokal
  getesteten Cloudflare-Build bestanden. Der konfigurierte Provider bleibt
  echtes Wan 2.2; Mock-AI wurde nicht produktiv aktiviert. Die fünf Minuten
  Gesamtbudget und 152 verbleibenden Sekunden werden auch von der
  veröffentlichten API getrennt zurückgegeben.

## Geplanter Live-Test am 16. Oktober 2026, 19:20 Uhr

**Bestanden:** Eine vollständige klassische Zwei-Spieler-Runde auf
`https://slopurself.maki26.workers.dev/`, Raum **8FC7**, mit echter KI,
dauerhaftem Archiv, gegenseitigen Bewertungen und gespeicherter Endwertung.
Dieser neue Prüfstand ersetzt die unten dokumentierte frühere Live-Blockade,
ohne deren Ursache nachträglich als geklärt darzustellen.

- Startkontingent: 300 GPU-Sekunden und acht verfügbare Aufrufe. Die gefilterten
  Live-Logs bestätigten Version `5bed741c-44c1-43e5-b6fe-ffbf633dc8bb` für
  Worker, RoomDurableObject und ServiceDurableObject, nicht nur die
  Deployment-Konfiguration.
- Vorhandene Profile LiveTestA1015 und LiveTestB1015, getrennt authentifiziert:
  Spieler A im In-App-Browser, Spieler B über einen eigenständigen WebSocket-
  und HTTP-Testclient. Ein geplanter Durchgang, klassische Regeln, Sparmodus,
  keine Zusatzvarianten, kein Mock und keine kostenpflichtigen Dienste.
- Zwei einzelne Bild-/Prompt-Aufträge mit dem öffentlichen Wan-Beispielbild,
  je ein eigener Upload pro Ersteller. Beide Wan-2.2-Aufträge mit vier Schritten
  wurden ohne Fallback, Fehler oder erneute GPU-Beauftragung abgeschlossen.
  Vom Speichern des Auftrags bis zum KI-Ergebnis vergingen rund 36,9 bzw.
  37,8 Sekunden. Die sichtbare Kopfbewegung des zweiten Clips entspricht der
  einfachen Bewegungsanweisung; dies ist kein allgemeiner Modellqualitätstest.
- Beide Clips wurden als verschiedene Dateien dauerhaft archiviert: 730.193
  und 779.440 Bytes. Im Browser jeweils 5,0625 Sekunden, 624 × 832 Pixel,
  laufende Wiedergabe und kein MediaError. Beide authentifizierten Range-
  Abrufe lieferten HTTP 206, `video/mp4` und genau die angeforderten 128 Bytes.
- Beide Clients erhielten die erwarteten Spielphasen. Host-Reloads in Lobby,
  Bewertung, während der zweiten Generierung und nach Spielende behielten
  Spieler-ID, Raum, Spielphase, Videos und Punkte bei. Kein verfrühter Sprung
  zur Endwertung und kein zusätzlicher KI-Auftrag nach Wiederverbindung.
- Gegenseitige Bewertungen: B vergab vier Punkte an A, A drei Punkte an B.
  Endwertung auf beiden Clients: A gewinnt 4:3. Eine ausschließlich lesende
  Neon-Transaktion bestätigte `GAME_OVER`, Gewinner, Endzeit, Platzierungen
  1/2, genau zwei Runden, je eine Stimme mit passendem Punktwert und zwei
  Video-Historieneinträge mit korrekten Erstellern. Keine doppelten Punkte.
- Statistik-API und Browseransicht zeigen beide Videos, die kumulierten
  Punktestände 4/3 und den Sieg von A. Beide neuen Clips lassen sich auch nach
  dem Verlassen des Spiels aus der Statistik abspielen. Die bestehende Partie
  und das ältere Archivvideo blieben erhalten. Keine Löschung von Testdaten.
- HF-Abschlussstand: 152,376604 GPU-Sekunden und sechs weitere Aufrufe;
  tatsächlich verbraucht wurden 147,623396 Sekunden für genau zwei Aufträge.
  Die Reservierungsformel hatte 140 Sekunden kalkuliert. Die Abrechnung kann
  also auch im Sparmodus höher ausfallen; zusätzliche Budgetreserve bleibt
  eine offene Verbesserung. Der Test hat weder Limits umgangen noch einen
  nicht budgetgedeckten Auftrag gestartet.
- Grenzen: echte Browserwiedergabe hier in Chromium, kein neuer nativer
  Safari-Live-Test, kein Lasttest mit zehn Spielern. Die frühere Ursache von
  `provider_error` ist weiterhin nicht sicher bestimmt; ein erfolgreicher
  Durchgang garantiert keine dauerhafte Verfügbarkeit des kostenlosen Space.
  Für diesen Test wurden nur der Prüfbericht und temporäre Testhilfen geändert,
  keine Anwendungskorrektur deployed und nichts zu Git gepusht.

## Frühere Live-Prüfung vom 16. Oktober 2026, nachts

- Die aktuelle Cloudflare-Adresse ist `https://slopurself.maki26.workers.dev/`.
  Die frühere Adresse unter `manuelk2607.workers.dev` ist nicht mehr gültig.
- Ein echter Wan-2.2-Aufruf mit einem öffentlichen Testbild erzeugte beim
  direkten Space-Test ein 5,0625 Sekunden langes, im Browser abspielbares Video.
  Die gewünschte langsame Kopfbewegung war erkennbar. Dieser direkte Test
  bestätigt noch nicht den vollständigen Spielablauf über Cloudflare.
- Ein echter Spielversuch erreichte die Archivierung, scheiterte aber mit
  HTTP 403/404 beim Abruf der temporären HF-Datei. Upload, Queue und Dateiabruf
  sind jetzt an dieselbe Space-Replik gebunden; diese URL bleibt im KI-Journal
  erhalten. Die Korrektur ist mit Cloudflare-Version
  `5bed741c-44c1-43e5-b6fe-ffbf633dc8bb` veröffentlicht.
- Neue Wan-Aufträge verwenden die vollständige Gradio-Queue. Ein inkrementeller
  SSE-Parser prüft die Event-ID und übernimmt nur bestätigte Endergebnisse,
  ohne auf das Schließen der Verbindung zu warten. Fehlertexte werden nur in
  feste, datensparsame Hinweise übersetzt. Legacy-Aufträge bleiben abrufbar;
  unklare Antworten starten nicht blind einen weiteren GPU-Auftrag.
- Ein gezielt bildloser Queue-Vertragstest gegen den echten Space wurde vor
  jeder GPU-Berechnung korrekt abgelehnt. Queue-Ereignisse und Fehlerstruktur
  sind damit auch ohne weiteren Kontingentverbrauch geprüft.
- Die vom Nutzer bereitgestellten Logs zeigen: Sowohl Raum 36F8 als auch Raum
  1380 liefen noch mit Version `90762bf6-d3a3-4862-a4aa-9758d2dd0ab6`. Der
  unmittelbare Nach-Deployment-Test von 1380 hatte die Queue-Korrektur daher
  entgegen der ersten zeitlichen Einordnung noch nicht geprüft. Cloudflare
  dokumentiert die kurzzeitig verzögerte Verteilung von Worker-/DO-Code unter
  [Known issues](https://developers.cloudflare.com/durable-objects/platform/known-issues/#code-updates).
- Um 01:58 Uhr wurde die tatsächlich ausgeführte Version über datensparsam
  gefilterte Live-Logs geprüft: Worker, RoomDurableObject und ServiceDurableObject
  liefen mit `5bed741c-44c1-43e5-b6fe-ffbf633dc8bb`. Der neue Einzeltest in Raum
  98EC erreichte die vollständige Queue mit Warte-/Start-Ereignissen, endete
  aber bereits rund 0,7 Sekunden nach Auftragserfassung mit `provider_error`.
  Kein Video wurde publiziert. Die aktuelle Klassifizierung unbekannter
  Anbietermeldungen lässt die konkrete Ursache weiterhin offen; weder
  Kontingentmangel noch ein Modell-/GPU-Ausfall sind damit sicher belegt.
- Eine vollständige neue Zwei-Spieler-Partie mit echter KI, Archivierung und
  Endwertung ist deshalb weiterhin **nicht bestanden**. Der rückwirkende
  Observability-API-Abruf wird von der vorhandenen CLI-Berechtigung mit HTTP 403
  abgelehnt; Live-Tailing funktioniert nun, WebSocket-Logs erscheinen erst nach
  dem Schließen der Verbindung. Dabei wurden nur Versions-/Ereignisnamen und
  technische KI-Felder ausgegeben, keine IPs, Cookies oder Anfrageinhalte.
  Auch der neu geprüfte Fehlversuch verbrauchte laut anschließendem HF-Abruf
  keine weitere GPU-Zeit; es blieben unverändert rund 113 Sekunden und sechs
  mögliche Aufrufe. Es wurde kein weiterer Generierungsversuch gestartet.
- Das vorhandene Produktionsvideo aus Raum F6ED wurde über die aktuelle
  Cloudflare-Adresse aus dem privaten Archiv abgespielt: 5,0625 Sekunden,
  624 × 832 Pixel, `readyState = 4`, Wiedergabe bis zum Ende. Das ist ein
  Chromium-Nachweis; ein echter Safari-Live-Test ist damit nicht ersetzt.
  Der authentifizierte Range-Abruf lieferte HTTP 206, `video/mp4` und genau die
  angeforderten 128 Bytes mit passendem `Content-Range`.
- Nach den Queue-Anpassungen erneut bestanden: TypeScript-Build, alle 103
  Unit-Tests und die vollständige CI in Chromium und WebKit gegen Node und
  workerd/Cloudflare. Abgedeckt sind unter anderem der klassische Zwei-Spieler-
  Ablauf, mehrere Runden, Varianten, Wiederverbindung, Wertung und Archiv-UI.
  Diese Browserabläufe verwenden ausdrücklich Mock-KI.
- Die Budgetformel folgt der angeforderten Space-Laufzeit, ist aber keine
  Garantie der tatsächlichen Abrechnung: Der direkte Acht-Schritte-Test
  verbrauchte rund 121,9 GPU-Sekunden statt der kalkulierten 110. Für knappe
  Automatik-Upgrades bleibt eine zusätzliche Reserve bzw. Kalibrierung offen.
- Die isolierten Tests verwenden Mock-Videos und verändern keine produktiven
  Spielstände. Die ausdrücklich für den Live-Test angelegten Profile und
  begonnenen Testpartien bleiben erhalten; es wurde nichts ohne Freigabe gelöscht.

## Ergänzung vom 15. Oktober 2026

- Drei kombinierbare Spielvarianten: gemeinsames Ausgangsbild, geheime Aufträge
  mit getrennter Aufgaben-/Unterhaltungswertung und Freitext-Promptraten.
  Nur der Ersteller bestätigt Treffer; je Treffer werden genau einmal zwei
  Bonuspunkte vergeben. Private Aufgaben und Rateversuche werden gezielt pro
  Spieler gesendet. Die neue Prüfphase bleibt nach Reload/Object-Neustart erhalten.
- Aufgaben, Bewertungskriterien und kumulierte Ratepunkte werden mit der Runde
  atomar gespeichert. PostgreSQL-Tests mit temporären Tabellen bestätigen
  Wiederholbarkeit und den Erhalt von Video-Aufgaben nach einer Raumlöschung.
- Wan 2.2 bleibt das einzige Modell für neue Partien: Automatik (8/4 Schritte),
  Qualität (8) oder Sparmodus (4). LTX ist aus der automatischen Kette und der
  Cloudflare-Konfiguration entfernt; bereits gestartete Legacy-Aufträge bleiben
  wiederaufnehmbar. Keine parallele Vorbereitung oder Generierung eingebaut.
- Bilder werden ohne Beschnitt auf 832 × 624, 624 × 832 oder 640 × 640
  vorbereitet und serverseitig geprüft. Die Fünf-Sekunden-Reserve beträgt damit
  höchstens 70 Sekunden im Sparmodus statt 92; acht Schritte benötigen höchstens
  110 statt 154. Bei vollen 300 Sekunden und genügend Aufrufen passen vier
  Videos bzw. zwei vollständige Zwei-Spieler-Runden ins Budget. Ein teilweise
  verbrauchtes Kontingent wird nicht künstlich größer gerechnet.
- Gemeinsame Bilder liegen temporär in 64-KiB-DO-Chunks, nicht im Videoarchiv
  oder in Postgres. Austausch, Ablauf nach zwei Stunden und leerer Raum räumen
  die Bildteile auf. Ein abgelaufenes Bild lässt sich vor der nächsten Erstellung
  ohne Spielneustart ersetzen.
- Verifikation ohne echte GPU-Aufträge: Unit-Tests prüfen private Snapshots,
  idempotente Bonuspunkte, Bildgrenzen und tatsächliche I2V-Parameter/Budgetkosten;
  Browser-Tests prüfen kombinierte Varianten und Kontingentwechsel. Die
  Bildqualität des Vier-Schritte-Modus ist weiterhin nicht live neu bewertet.
- Der klassische Ablauf bleibt ausdrücklich Standard: eigenes Bild plus Prompt
  pro Ersteller, normale Bewertungen ohne Bonusphase. Zusatzregeln sind
  zugeklappt und gemeinsam zurücksetzbar. Der normale lokale Start nutzt dieselbe
  Profil-Anmeldung wie die veröffentlichte Seite, auch bei Mock-Videos.
- Erfolgreich: TypeScript-Build, 96 Unit-Tests, komplette CI in Chromium/WebKit
  gegen Node und Cloudflare, PostgreSQL-Integration mit temporären Tabellen.
  Die Varianten wurden nach den letzten Anpassungen auf allen vier Kombinationen
  erneut geprüft; Desktop- und Mobilansichten visuell kontrolliert.

## Ergänzung vom 14. Oktober 2026

- Archiv und Statistik werden anhand vollständiger Speicherlisten abgeglichen.
  Automatisch entfernte Clips behalten ihre Metadaten, werden jedoch nicht mehr
  als verfügbare Dateien gezählt. Ungültige Listen und Storage-Ausfälle verändern
  keine Verfügbarkeitsmarker. Nachholende Rundenwrites reaktivieren keine alten Dateien.
- Videos und Räume sind vollständig über validierte Keyset-Seiten erreichbar.
  Laufende Wiedergabe und Mehrfachauswahl bleiben beim Nachladen erhalten.
  Filterwechsel verwerfen veraltete Antworten; fehlgeschlagene Seiten bleiben erneut ladbar.
- Verfügbare Archivvideos besitzen einen MP4-Download mit authentifizierter
  Auslieferung; normale Wiedergabe und Byte-Ranges bleiben unverändert.
- CI startet zusätzlich workerd mit den echten Worker-/Durable-Object-Klassen.
  Ein Runtime-Test prüft den persistenten 30-Sekunden-Löschalarm nach Object-Eviction.
  Externe Neon-/S3-Verträge werden dort isoliert ersetzt, echte SQL-Abfragen
  separat mit temporären Postgres-Tabellen geprüft. Es werden keine produktiven
  Spielzeilen verändert und keine GPU-Aufträge gestartet.
- Verifiziert: TypeScript-Build, 89 Unit-Tests, vollständige CI-Suiten in Chromium
  und WebKit gegen Node und Cloudflare sowie echte Postgres-Integrationstests mit
  temporären Tabellen. Desktop- und Mobilansichten visuell geprüft.

Die folgenden Abschnitte dokumentieren den älteren Prüfstand vom 6./7. Oktober.

## Behobene Fehler

- Spielablauf: Punktvergabe genau einmal, stabile Spieler-IDs nach Reload,
  vollständige Wiederherstellung von Lobby, Generierung, Voting und Ergebnissen.
- Verlassen und Wiederverbindung: laufende Ersteller-Runde wird abgebrochen,
  spät eintreffende KI-Ergebnisse werden verworfen, der nächste Spieler wird
  nicht übersprungen. Netzwerkabbrüche haben 15 Sekunden Wiederverbindungszeit.
- Cloudflare-Netzwerk: automatische WebSocket-Wiederverbindung, keine
  HTML-Antwort mehr auf die Socket.IO-Script-Anfrage und keine Raum-Snapshots
  für Verbindungen ohne Mitgliedschaft. Sitzungsschlüssel bleiben privat.
- KI: tatsächliche Space-Hostnamen und API-Parameter werden gelesen; bisher
  vertauschte Parameter sind korrigiert. Mindestdauer 5 Sekunden, korrekte
  Abschlussereignisse, Zeitlimits und Fallback von Wan 2.2 mit 8 auf 4 Schritte,
  danach LTX. Einheitliche, bildformatabhängige Kostenschätzung für alle Modi.
- Persistenz: Runden, Stimmen, Punktestand und Endwertung werden atomar
  gespeichert. Cloudflare wiederholt fehlgeschlagene Rundenwrites aus dem
  Durable-Object-Speicher. Raumcode-Kollisionen überschreiben keine Historie.
- Statistik/UI: reine Warteräume zählen nicht als gespielte Partien,
  abgegebene Stimmen bleiben beim Reload erkennbar, Bildauswahl und laufende
  Videos werden nicht durch jeden Snapshot zurückgesetzt. Mobile Statistik,
  Tastatur-Fokus, Dateiformate und Feedback für abgelaufene Videos verbessert.
- Abhängigkeiten: bekannte npm-Audit-Sicherheitslücken geschlossen und
  unbenutzten Gradio-Client entfernt. Datenbank-TLS wird nicht mehr pauschal
  ohne Zertifikatsprüfung konfiguriert.
- Kontingent: offizielles HF-ZeroGPU-Restkontingent wird gelesen. Rundenauswahl,
  serverseitige Startprüfung und globale Reservierung berücksichtigen GPU-Zeit
  und Aufruflimit. Vollständige Runden berücksichtigen die Spielerzahl:
  zwei Runden mit drei Spielern reservieren sechs Videos. Lobby-Grenzen werden
  bei Beitritt/Verlassen aktualisiert; ausstehende Erstellungen von Spielern,
  die verlassen haben, entfallen. Fallbacks schützen reserviertes Budget.
  Die Rundengrenze berücksichtigt den günstigsten konfigurierten 5-Sekunden-Modus,
  ohne das gemeinsame HF-Kontingent mehrfach zu zählen. Aufwendigere laufende
  Jobs bleiben auch vor dem HF-Kontingentabzug geschützt.
- Zusatzrunden: Nach dem geplanten Ende wird das aktuelle Restkontingent neu
  gelesen. Nur der Host kann eine weitere vollständige Runde für alle
  verbleibenden Spieler reservieren. Raum, Spieler-IDs, Punkte und Historie
  bleiben erhalten; Endwertung und Sieg werden beim Fortsetzen zurückgesetzt,
  damit die verlängerte Partie in der Statistik nicht doppelt zählt.
- Identität: bewusst vereinfachter Einstieg nur mit Benutzername. Neue
  Profile haben eine feste ID und eine eindeutige normalisierte Namenskennung.
  Doppelte Erstellung ist serverseitig und per Datenbankindex gesperrt.
  Signierte HTTP-only-Browsersitzungen erhalten die ID nach Reload; vorhandene
  Namen lassen sich ohne Passwort weiterverwenden. Legacy-Statistiken bleiben erhalten.
- Archiv: private Neon-MP4-Dateien, 512-MB-Limit, automatische Löschung
  ältester Videos und authentifizierte Range-Auslieferung. Originalbilder
  werden nicht im eigenen Archiv gespeichert.
- Seitenstart: sichtbarer Lade-/Fehlerzustand statt leerem Rechteck. Browser-
  Bundles liegen getrennt von Node-Ausgaben, sodass ein unterbrochener
  TypeScript-Build keine CommonJS-Datei als Browser-Script ausliefert.
- KI-Ausfallsicherheit: dauerhaftes Journal mit Event-ID und Auftragsstatus,
  Wiederaufnahme derselben Ergebnisabfrage nach Worker-Neustart oder Netzfehler.
  Keine blinden Fallbacks bei ungeklärten POST-Antworten. Abgebrochene Ersteller-
  Jobs werden im Hintergrund abgeschlossen, Budgetfreigaben dauerhaft wiederholt.
- Leichter Zugriffsschutz: keine neuen Passwörter, aber begrenzte HTTP- und
  Spielnachrichten. Anonyme Aufrufe fragen kein echtes HF-Kontingent ab;
  Anzeige-Cache und frische Startprüfung sind getrennt. Technische KI-Logs
  enthalten keine Bilder, Prompts oder Tokens. CI für Push und Pull Request.

## Verifikation

- TypeScript-Build für Node, Browser und Cloudflare erfolgreich.
- 53 automatisierte Tests für Spiellogik, KI-Protokoll, Worker, Quota,
  Archiv und Zugriffskontrolle bestanden.
- Mehrere getrennte Browser-Sitzungen: drei Spieler, zwei vollständige Runden
  mit sechs Videos, Punkten und Endwertung,
  Reload, neues Spiel, Ersteller verlässt, Wiederverbindung und Statistiken.
  Chromium und WebKit bestanden; Desktop und mobile Darstellung geprüft.
- Neon: Transaktionen, doppelte Rundenspeicherung, Endwertung, Statistik und
  Rollback mit temporären Tabellen geprüft. Keine Produktiv-Spielzeilen
  angelegt oder verändert. Cloudflare-DB-Schreibpfad nicht live belastet.
- Öffentliche Cloudflare-Seite, Konfiguration und Statistik antworteten;
  Worker-Bindings/Secrets und Deployment-Bundle geprüft.
- Echter Wan-2.2-Test mit einem öffentlichen Busfoto: abspielbares Video,
  5,06 Sekunden, 624 x 832 Pixel. Der Bus bewegt sich sichtbar auf die Kamera
  zu, passend zum Testprompt. Kleine Bildverformungen sind weiterhin sichtbar.
- npm audit: keine gemeldeten Sicherheitslücken zum Prüfzeitpunkt.
- Browser-Profileinstieg: nur ein Namensfeld, Duplikatprüfung, Namensübernahme,
  Reload, Raumwiederherstellung und Abmeldung. PostgreSQL-Namenseindeutigkeit
  einschließlich gleichzeitiger Erstellung in temporären Tabellen getestet.
- Echte HF-Kontingentabfrage und privates Neon-S3-Archiv getestet: MP4-Upload,
  Byte-Range 206 und anschliessende Löschung ausschließlich des Testvideos.
- Simulierte fehlende Browser-Datei, Backend-Ausfall, Rundenauswahl 1 statt
  100 und Sperre bei Kontingent 0 in Chromium und WebKit bestanden.
- Spielerabhängiges Kontingent mit Fallback-Sparmodus geprüft: 185 GPU-Sekunden
  erlauben eine vollständige Zwei-Spieler-Runde mit zwei 5-Sekunden-Videos.
  Ein dritter Spieler benötigt mehr Budget. Beitritt und
  Verlassen passen die Auswahl an; drei Spieler mit zwei Runden reservieren
  sechs Videos. Wiederholungen schützen alle noch ausstehenden Erstellungen.
- KI-Protokolltests prüfen den 4-Schritte-Aufruf bei knappen 185 Sekunden,
  8 Schritte bei ausreichend Budget und erneute Kontingentprüfung vor Fallbacks.
  Kein weiterer echter GPU-Job für diese Fallback-Erweiterung gestartet;
  die Bildqualität des 4-Schritte-Modus ist nicht live verifiziert.
- Zusatzrunden in Chromium und WebKit sowie gegen den lokalen Cloudflare-Worker
  getestet: Zwei Spieler erreichen sechs Videos in drei Durchgängen bei
  simuliertem günstigem Verbrauch. Hostberechtigung, erneute Kontingentprüfung,
  doppelte Startanfragen, Reload und mobiles Layout bestanden. Kein echter
  GPU-Job. Neon-Transaktionen prüfen dieselbe Partie vor und nach Fortsetzung;
  Worker-Tests prüfen die dauerhafte Write-Warteschlange bei Datenbankausfall.

## Verbleibende Grenzen

- Kein produktives Deployment im Rahmen dieser Prüfung. Der Git-Push allein
  aktiviert die Änderungen noch nicht auf Cloudflare. Ein neuer HF_TOKEN in .env.local aktualisiert
  nicht automatisch den Cloudflare-Secret.
- Kostenloses Hugging Face garantiert weder Verfügbarkeit noch Prompttreue.
  ZeroGPU-Kontingente gelten pro Account, nicht additiv pro Fallback-Space.
  Die Rundenkosten sind konservativ aus den Space-Einstellungen geschätzt;
  HF-Nutzung außerhalb des Spiels oder GPU-verbrauchende Fehlversuche können
  bereits reservierte Budgets vermindern. Es gibt keine bezahlten Credits.
- Bereits abgelaufene historische HF-Links lassen sich nicht retten.
  Bei einem Archiv-Ausfall bleibt ein temporärer Link mit Warnung erhalten.
  Die App kann externe Löschfristen der HF-Spaces nicht erzwingen.
- Der Benutzername ist bewusst kein Identitätsnachweis: Jeder kann einen
  bekannten Namen verwenden und damit unter diesem Profil spielen. Die Seite
  ist nicht auf Freunde beschränkt; Neon-Auth-Anmeldung und Zugangscode sind entfernt.
- Ein verlorenes HF-Start-POST ohne Event-ID kann nicht eindeutig wiederhergestellt
  werden. Es wird kein zweiter Auftrag auf Verdacht gestartet; nach 15 Minuten
  endet der Versuch, seine ungeklärte Reservierung läuft erst nach TTL aus.
  Bereits gelöschte Space-Ergebnisse können nicht gerettet werden. Beim lokalen
  Node-Prozessneustart gehen laufende Raumzustände weiterhin verloren.
  Dauerhafte DB-/Quota-Wiederholung gilt für Cloudflare, nicht für Node.

Start-, Test- und Deployment-Befehle stehen in README.md.
