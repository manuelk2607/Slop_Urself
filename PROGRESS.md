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

## Aktive Fortsetzung am 3. November (00:14 UTC)

- Nutzerbestätigte neue HF-Sitzungen tatsächlich gültig: LiveA_825b2353 →
  Manuel260702, LiveB_825b2353 → Manuel2607; owner/identityVerified=true,
  beide300/300Sekunden. ControllerPID90780 hält zwei isolierte RAM-Kontexte,
  maximal8h, keine Cookieexporte. KEINE erneuten Codes anfordern.
- Neue LobbyF815: Anmeldung, Erstellen/Beitreten, synchroner Zustand, Reload
  und Offline/Wiederverbindung produktiv bestanden. Kein Video hochgeladen,
  keine GPU-Aufträge. Eigene Quota-GETs sind kein Belastungsnachweis.
- Öffentlicher Gratis-Producer8a1467627cf78078fd7a857f3341769dea62b88d
  ist RUNNING, offizielle20Dateien/34,2GB ausschließlich extern verifiziert und
  Modell initialisiert; weiterhin preparation-only, generationAvailable=false.
- Aktuelle Kampagne984a71be-7157-4b53-938d-9432109b883c fürF815, drei Stunden,
  dedizierter SupervisorPID94906/Moderator3406, Scope122db6fe…, Health bestätigt.
  Pointer.local/bounded-current-campaign.json; Steuerung ausschließlich
  .local/bounded-live-command.json / bounded-live-result.json. Alte Abschnitte
  darunter zu verlorenen Sitzungen/PAUSED sind historische Checkpoints.
- Appfixd57270b: tatsächlicher HF-JWT-Vertrag hat token und abweichendes
  legacy-accessToken; nur rohe kurzlebige JWT verwenden. Build,5gezielte Tests
  und echter workerd-Integrationstest bestanden. 54be8e6 ergänzt offiziellen
  Gradio-__sign-Transport als ausschließlich lesende Kampagnendiagnose.
  Worker/Servicesc8e13f35-5902-4dba-b0a6-7d458e89d746 bestätigt.
- Reale Resultate mit beiden persönlichen OAuth-Konten: Standard/Cookie/
  offizieller signierter Transport HTTP200, whoami=true, Proxyactor jedoch
  actor_mismatch/other-string; Ressource als X-HF-Authorization wird abgewiesen.
  Zusätzlich bestehender persönlicher Read-Token (nur CPU-Diagnose, kein Job)
  ebenfalls actor_mismatch. Daher NICHT einfach OAuth erneut autorisieren.
- Vorheriger GET lief jeweils kurz nach Deployment im alten Service; Versionen
  separat nachgewiesen, keine GPU-Wiederholungen. Eine automatische Prüfung
  lehnte einen identischen GET ab; erst nach belegtem Service-Versionsunterschied
  und unverändert0GPU wurde die neue Version gelesen.
- Neue rein kategoriale Actor-Diagnose lokal implementiert: case-only-name,
  namespaced-subject/name, contains-subject/name oder opaque-unrelated.
  Keine Actor-/Freigaberegel gelockert.32native und12gezielte App-Tests sowie
  Build erfolgreich. Nächster Schritt: dieses geprüfte Paket veröffentlichen,
  neuen Producer exakt pinnen und einmal die Ursache am tatsächlichen HF-Actor
  abgrenzen. Kontingentbelastung und echte Videos weiterhin NICHT nachgewiesen.
- CI:f0c19b5 vollständig erfolgreich; neuere Runs durch nächste Pushes teilweise
  ersetzt/abgebrochen, neuester Code noch in Prüfung. Vor Abschluss prüfen.

## Verifizierter Entwicklungs- und Produktionsstand vor dieser Fortsetzung

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
Lauf41543724347 für37f89f2 inzwischen vollständig bestanden; neue Diagnostik separat
wie oben geprüft, deren spätere CI noch nicht als erfolgreich behaupten.
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

1. Geprüfte kategoriale Producer-Diagnose bereitstellen, neuen Quellpin mit
   tatsächlicher HF-Revision/Runtime abgleichen, keine Actor-Regel lockern.
2. Bestehende zwei bestätigte Sitzungen verwenden; tatsächliche Zuordnung anhand
   neuer Diagnose klären. Keine weiteren Codes/gleichartigen Blindproben.
3. Erst bei verifizierter Zuordnung kontrolliertes Gratisfenster aktivieren;
   exakt2genehmigte Originalmotive, persönliche Quotas vor/nach JEDEM Job,
   volle Ausgabemoderation plus echte Betreiber-Sichtfreigabe vor Veröffentlichung.
4. Dieselben Videos in normaler UI abspielen, abstimmen4/3, Endstand/Archiv/
   Statistiken prüfen. Scope danach zurücknehmen, Producer sicher zurückstellen.
5. CI-Ergebnisse und produktive Version dokumentieren. Quota-Deltas sind
   Verbrauchsbeobachtungen, keine jobgenauen Rechnungen. Allgemeine Sperre bleibt.

Details/Nachweise:docs/audits/2026-11-03-live-validation.json.
