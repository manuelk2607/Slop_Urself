# Slop Urself – Fortsetzungspunkt, 3. November 2026

## Auftrag und Freigaben

Nur die drei realen Abnahmen fortsetzen: Moderation, zwei persönliche HF-/Wan-
Aufträge, vollständige veröffentlichte klassische Zwei-Spieler-Partie. Keine
weiteren Gesamtaudits/UX-/SEO-Arbeiten. Repository ausschließlich
/Users/manuelkienmoser/Documents/4 Studium/Sonstiges/SlopUrself, Branch
codex/audit-remediation. Benutzerdatei Nebenprojekte.code-workspace ungetrackt
bewahren. Keine bestehenden Benutzer, Spiele, Videos oder sonstigen Daten löschen.

Genehmigt bleiben genau zwei Videos ab5s, eines je HF-Konto, höchstens120large-
GPU-Sekunden pro Konto/240 insgesamt, nur Gratisressourcen, keine GPU-Wiederholung.
Die beiden exakt vorgelegten Motive/Prompts (hüpfender gelber Ball, drehender roter
Würfel) sind manuell bestätigt. Allgemeine Spielerbilder sind nicht freigegeben.
Gemini laut Nutzer Free/kein Billing-Konto; bezahlte Kontexttests abgelehnt.
Tokens/Cookies niemals ausgeben oder ins Repository schreiben, keine selbst
signierten Ersatzsitzungen und keine Nutzung des Betreiberkontos für Spielerjobs.

## Verifizierter Entwicklungs- und Produktionsstand

- Nachgewiesene Ursache der Producer-503 behoben: workerd unterstützt redirect:
  error nicht und wirft schon vor HTTP einen TypeError. Alle4 betreffenden src-
  Aufrufe verwenden manual und lehnen Weiterleitungen explizit ab. Reales
  workerd-Experiment sowie Services-/Readiness-/Zwei-Konten-Regression ergänzen
  die zuvor zu großzügigen Fetch-Mocks. Headerverlust war keine belegte Ursache.
- Persönliche Header nur an zwei kontrollierte Producer-Hosts; gleicher Token
  für Router/App, widersprüchliche Header abgewiesen. Sichere endliche Fehlercodes,
  einzelne Nur-Lese-Fehlerphasen und optionale Services-Release-ID. Proxy user kann
  nur exakt an die HF-ID oder über erneut verifiziertes whoami an deren kanonischen
  Namen gebunden werden. Unbekannte Schemas bleiben gesperrt.
- Bestehender begrenzter Spielpfad: zwei feste Profile/HF-Subjekte, exakte Pixel/
  Prompts/Seeds,1Runde/2Aufträge, dauerhafte nicht zurücksetzbare GPU-Zulassungen,
  Vorprüfung vor Reservierung, keine Verdrängung vorhandener Archivvideos.
  Ausgabe benötigt vollständige Moderation plus tatsächliche Betreiber-Sichtprüfung.
- Echte Moderation:38 sichere synthetische Fälle,23/23 harmlose erlaubt,15/15
  Risikoabsichten gehalten (3 nur generische Provider-Holds),3 Clips mit81/81
  nativen Frames. Zwei feste Eingaben separat erlaubt. Keine allgemeine
  qualification.json und kein real erzeugtes Video qualifiziert.
- Beide bestehenden Profile LiveA_825b2353/LiveB_825b2353 waren tatsächlich owner-
  verifiziert und mit Manuel260702/Manuel2607 verbunden; persönliche Quotas300/300.
  RaumBEAD mit beiden Spielern synchron, Reload und Offline-Reconnect bestanden.
  Nach Redirect-Fix echte /api/hf/validation für beide HTTP200/Identität=true,
  aber proxySubjectMatches=false. Claim-Schlüssel ip,user,uuid,error,exp; user ist
  ein String, direkte ID-Zuordnung fehlt; kanonischer Namenspfad ebenfalls
  unbestätigt. Das beweist KEINE fremde Abbuchung. Exakt0GPU-Aufträge gestartet.
- Kontrollierter öffentlicher Gratis-Producer zuletzt Quelle/runtime
  574ef59b42a6469fe241f5ec2e3079fa86e15c45;9 Quelldateien unabhängig geprüft,
  20 offizielle Gewichtsdateien/34.201.418.400Bytes extern hashgeprüft, native
  Initialisierung in Vorbereitung-only bestätigt. Keine Gewichte auf dem Mac,
  kein gebuchter Speicher/keine bezahlte Hardware. Alter privater Space unverändert.
- Code37f89f26350b5af6c47ab3e1bc2b905d47b967cd committed/gepusht. Neue lokale
  Commits2884dc1,02948a8,8146b8b,eef628f,1352134,d6f77bd,37f89f2 enthalten alle
  gezielten Fixes. Produktiv zunächstcc45ee32-812f-4720-b51b-206e4b778640,
  nach Entfernen der temporären Testfreigabe aktuell5991962e-cb18-4f0d-b420-67761cf7dd4b.
  URL https://slopurself.maki26.workers.dev; tatsächliche UUID aus API/Header
  bestätigt. Startseite/robots/sitemap200, private APIs401, Producer-Claim503,
  /api/config generationBlocked=true/mockAi=false/hfRequired=true/0.

## Tests und Grenzen

248 App-Units,30 native CPU-/HTTP-Tests, Build sowie beide tatsächlichen workerd-
Integrationen bestanden. Alle externen Anbieter dort simuliert, kein GPU-Nachweis.
Vollständige GitHub-Matrix02948a8/Lauf41520218201 erfolgreich; aktueller Code37f89f2,
Lauf41543724347 läuft: safety-cpu grün, Chromium/WebKit noch in Arbeit. Den
Ausgang separat prüfen, keinen grünen Gesamtlauf behaupten.
Keine tatsächliche Zwei-Video-Partie, GPU-Abrechnung, Wiedergabe erzeugter Videos,
Endwertung oder deren Archiv-/Statistikpersistenz erfolgreich geprüft.

## Unterbrechung und sichere Rückstellung

Die ausschließlich im RAM gehaltenen Browser-/Controller-Prozesse haben die
Unterbrechung nicht überstanden: Session80330 ungültig, kein passender eigener
Controller/Moderator/Tunnelprozess mehr vorhanden. Alte .local/bounded-live-
result.json und roster.json sind historische Belege, KEINE aktuellen Sitzungen!
Keine Cookies exportiert, serverseitige HF-Verbindungen/Benutzerdaten nicht gelöscht.
Nicht wieder behaupten, beide Testfenster seien offen, und keine Anmeldungsschleife
mit automatisch erneuerten Fünf-Minuten-Codes erzeugen.

LIVE_VALIDATION_CAMPAIGN wurde nach bestätigten0GPU-Aufträgen aufCF entfernt.
Öffentlicher Test-Space Manuel2607/SlopUrself-Wan22-Validated ausdrücklich PAUSED
bestätigt, Gratis-Hardwarezero-a10g. Allgemeine Sperre bleibt unabhängig aktiv.
Kampagnen-Arbeitsdatei.local/bounded-current-campaign.json zeigt auf die alte,
inaktive/abgelaufene Kampagne; nicht einfach reaktivieren oder ihre Zäune zurücksetzen.
.local/bounded-controller.mts/actions.mts/play.mts sind nur vorbereitete lokale
Testwerkzeuge, nicht laufende Dienste. Upload-Intents werden vor Klick exklusiv
persistiert; bei Unklarheit nie einen GPU-Auftrag wiederholen.

## Nächster konkreter Schritt

1. GitHub-Lauf41543724347 für37f89f2 prüfen. Den lokalen Dokumentationscommit erst
   danach pushen, damit keine Workflow-Concurrency den laufenden Code-Test abbricht.
   Code37f89f2 ist bereits remote und produktiv. Bei Erfolg nur den Dokumentations-
   checkpoint pushen, kein erneutes Deployment derselben App-Version.
2. Vor erneuter Kontofreigabe Testfenster so betreiben, dass eine Codex-Unterbrechung
   nicht wieder die einzigen Zugriffe vernichtet. Weiterhin keine Token-Dateien
   im Repository. Frische offizielle HF-Freigaben erst anfordern, wenn der Nutzer
   für die reale Prüfung bereit ist; die Kosten-/Motivfreigabe gilt bereits.
3. Zuerst die tatsächliche Proxy-user-Darstellung über strukturelle Diagnostik
   klären, ohne JWT/Claims-Werte auszugeben. ID-/Namensgleichheit ist weiterhin
   NICHT nachgewiesen; keine unbekannten Actor-Schemata akzeptieren und nicht
   vorsorglich OAuth-Rechte erweitern. Eventuelle HF-Schnittstellenlücken offen
   benennen, keine eigene Abrechnung aus erfolgreichem whoami ableiten.
4. Nur bei verifiziertem persönlichen Proxy und exakten Modellpins den Gratis-
   Producer kontrolliert aufwecken/vorbereiten und ein endliches Scope konfigurieren.
   Beide Quotas unmittelbar vor/nach JEDEM der exakt zwei Aufträge erfassen.
5. Originale scene-0/1.png aus.local/audit-tests/live-qualification-629bbb9f-
   fc35-443a-b764-5cfc2021d926 nutzen; tatsächlichen UI-Preview-Pixelhash prüfen.
   Nicht die normalisierten Fixtures nochmals JPEG-kodieren. Ausgabe vollständig
   prüfen und dem Nutzer zeitnah zur tatsächlichen Sichtfreigabe vorlegen.
6. Dieselben Videos über normale Spiel-UI abspielen, Reload/Wiederverbindung,
   gegenseitige4/3-Bewertungen, Endstand, Archiv und Statistik bestätigen.
   Quota-Deltas bleiben kontrollierte Verbrauchsbeobachtungen, keine jobgenauen
   HF-Rechnungsbelege. Danach Scope entfernen und Producer sicher zurückstellen.

Details/Nachweise:docs/audits/2026-11-03-live-validation.json. Ältere Berichte sind
historische Stände, nicht erneut offene Grundlagenanalysen. Die Automation wurde
auf diesen Fortsetzungspunkt eingeschränkt; unveränderte externe Blocker lösen
keine neuen Codes, Deployments oder GPU-Aufträge aus.
