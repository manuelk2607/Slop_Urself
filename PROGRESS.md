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

## Aktive Fortsetzung am 3. November – abgeschlossene Prüfungen

- Beide zuletzt nutzerbestätigten HF-Sitzungen sind tatsächlich gültig:
  LiveA_825b2353 → Manuel260702, LiveB_825b2353 → Manuel2607;
  owner/identityVerified=true, beide300/300Sekunden. Keine neuen Codes anfordern.
  ControllerPID90780, isolierte RAM-Kontexte, maximale Laufzeit8h, keine Exporte.
- ProduktionslobbyF815: Erstellen/Beitreten, zwei synchrone Spieler, Reload und
  Offline/Wiederverbindung bestanden. Beide Archiv-GETs200; keine Adminrechte
  oder Verwaltungsdaten; anonyme Prüf-GETs401 und fremder Transport400.
- Producer15a332bbb6bd6a389c6a2ec92867846509732f22 tatsächlich RUNNING;
  freie current/requested zero-a10g, Modell initialisiert, preparationOnly=true,
  generationAvailable=false. Offizielle Modelrevisionb8fff7315c768468a5333511427288870b2e9635.
  Modellgewichte34,2GB ausschließlich auf HF, nichts davon lokal.
- Aktuelle Kampagne984a71be-7157-4b53-938d-9432109b883c fürF815, drei Stunden;
  SupervisorPID94906, Moderator3406/Scope122db6fe… . Tatsächliche externe Health
  HTTP200, Scope/Version passend, qualifiedForGeneralUse=false. Erzeugte Videos
  benötigen weiterhin volle Moderation UND tatsächliche Betreiber-Sichtprüfung.
- Veröffentlichung geprüft: App782f36c, Worker UND Services
  4b62baad-18a8-4489-9f1e-5e5925146f1a. Startseite/Config200,
  generationBlocked=true, hfRequired=true, mockAi=false.
- Reale Zuordnung: Beide persönlichen OAuth-Zugänge bestätigen whoami, aber
  Standard-, Cookie- und offizieller Gradio-__sign-Transport liefern
  proxySubjectMatches=false. Ressource als Router-Header wird abgewiesen.
  Bestehender persönlicher Read-Token nur als CPU-Diagnose ebenfalls mismatch.
  Aktuelle native Diagnose bei BEIDEN: other-string / actor_mismatch /
  opaque-unrelated. Keine ID, kein kanonischer Name, auch keine bloße
  Groß-/Kleinschreibung oder erkannten Namespaces. Keine Rohclaims ausgegeben.
- Belegt ist eine VERIFIKATIONSLÜCKE, kein HF-Abrechnungsfehler. HF-Dokumentation
  beschreibt persönliche API-Kontingente, dokumentiert aber keine Bindung der
  opaque X-IP-Token.user-Kennung an whoami-ID/Name. Unser strikter Vergleich kann
  eine nicht unterstützte Annahme sein. Nicht durch fuzzy/contains/owner-Bindung
  ersetzen; HF nach unterstütztem Attributionsvertrag/Beleg fragen.
- Nach ausdrücklicher Nutzerfreigabe Supportanfrage veröffentlicht und Inhalt
  per getrenntem GET verifiziert: https://github.com/huggingface/hub-docs/issues/2966.
  Text/Nachweis: docs/audits/2026-11-03-hf-support-draft.md. Anbieterantwort offen.
  Keine neue Anmeldung, zusätzliche Scopes oder Wiederholung gleicher Proben nötig.
- Commitsd57270b/54be8e6/1527619/782f36c auf origin/codex/audit-remediation
  gepusht.32native Tests,251App-Unit-Tests inCI,12gezielte App-Tests lokal, Build und echter workerd-Test
  erfolgreich; externe Provider dort simuliert, kein Belastungsbeleg.
  CI41551287353 für782f36c vollständig erfolgreich: safety-cpu, Chromium und
  WebKit/macOS (Abschluss00:25:44UTC). Ältere ersetzte Runs sind abgebrochen,
  nicht fehlgeschlagen. Dieser nachfolgende Commit enthält nur Nachweise/Dokumentation.
- Bisher0Video-Uploads,0GPU-Aufträge. Beide kostenlosen Video-Freigaben sind
  unbenutzt. Allgemeine KI-Freigabe unverändert gesperrt. Keine Konten/Spiele/
  Videos gelöscht. Alte Checkpoints darunter sind ausdrücklich HISTORISCH.

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

1. CI41551287353 ist für den veröffentlichten Code782f36c vollständig bestanden.
   Keine bestandenen Tests/Grundlagenanalysen erneut abarbeiten.
2. Anbieterantwort in https://github.com/huggingface/hub-docs/issues/2966
   prüfen und den offiziell bestätigten Zuordnungsweg übernehmen. Anfrage bereits
   veröffentlicht; keine zweite Anfrage erstellen. Keine neuen HF-Codes,
   Scopes, Blindproben oder weiteren Diagnose-Deployments ohne neue Erkenntnis.
3. Bestätigten Attributionsweg implementieren und gezielt testen; dann bestehende
   gültige Sitzungen nutzen und exakt2genehmigte Gratisvideos ausführen. Pro Job
   getrennte Vor-/Nachquotas beider Konten, keine automatischen GPU-Wiederholungen.
4. Originale scene-0/1.png aus.local/audit-tests/live-qualification-629bbb9f-
   fc35-443a-b764-5cfc2021d926 verwenden; tatsächlichen Preview-Pixelhash prüfen.
   Ausgabe vollständig moderieren und echte Betreiber-Sichtprüfung einholen.
5. Dieselben Videos normal abspielen, Reload/Wiederverbindung,4/3-Abstimmungen,
   Endstand, Archiv und Statistik prüfen. Danach endlichen Scope zurücknehmen.
   Quota-Deltas sind Verbrauchsbeobachtungen, keine jobgenauen HF-Rechnungen.

Details/Nachweise:docs/audits/2026-11-03-live-validation.json.

Abschluss dieses Pakets: neue Code-Commitsd57270b/54be8e6/1527619/782f36c gepusht;
produktiver Release4b62baad-18a8-4489-9f1e-5e5925146f1a verifiziert.
Diese Dokumentationsänderung erfordert kein erneutes Deployment. Supportanfrage
veröffentlicht, Anbieterantwort noch ausstehend; kein tatsächlicher GPU-/Abrechnungsnachweis, keine allgemeine KI-Freigabe.
