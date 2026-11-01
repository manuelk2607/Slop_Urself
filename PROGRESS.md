# Slop Urself – Fortsetzungspunkt, 1. November 2026

## Auftrag / feste Grenzen

Vier konkrete Pakete: Moderation, kontrollierter Wan-Producer, persönliche
HF-Abrechnungsprüfung, vollständige Multiplayer-Partie. Branch ausschließlich
`codex/audit-remediation`; Commit/Push und geprüfte sichere Deployments autorisiert.
Nur kostenlose synthetische Moderationstests erlaubt. Kostenpflichtige OpenAI-
Kontextaufrufe ausdrücklich abgelehnt. Gemini-Projekt laut Nutzer Free/ohne
Abrechnungskonto. Keine Freigabe echter Spielerbilder an neue Moderationsdienste.
Keine echten GPU-Aufträge freigegeben oder gestartet. Keine Produktivdaten löschen.
Neu freigegeben:34,2GB ausschließlich im bestehenden kostenlosen HF-ZeroGPU-
Space herunterladen und nativ initialisieren, keine Gewichte auf dem Mac,
kein kostenpflichtiger Speicher/Hardware. Vorbereitung muss GPU-Aufrufe sperren.

## Aktuelles Paket – implementiert und lokal geprüft

- Verwalteter Moderationsdienst: explizite Backends, feste Endpunkte/Modelle,
  striktes Antwortformat/Modellversionsprüfung, Bilddekodierung vor Übertragung,
  Timeout/Abbruch, SQLite-Anfragebudget gegen Prozessneustart-Resets, vorhandene
  verschlüsselte Prüfjobs/Recovery weiterverwendet. Gemini-only kann den
  kostenpflichtigen Responses-Endpunkt nicht aufrufen. Keine automatische
  Provider-/Modellumschaltung. Noch keine qualification.json / Veröffentlichung.
- Gratis-Gemini3.5-Flash-Lite ist tatsächlich verfügbar;2.5 antwortet für dieses
  neue Projekt trotz Modelllisteneintrag mit404. Expliziter geprüfter Ersatz.
  OpenAI-Gratis-Test:20/20 harmlose Fälle akzeptiert,3/4 abstrakte Risikofälle
  zurückgehalten; NCII-Anfrage übersehen. Deshalb keine Alleinfreigabe.
- Gemini:20 harmlose Fälle und NCII-Anfrage bestanden. HTTP429 drosselte den
  ersten Lauf; Fortsetzung übersprang abgeschlossene Fälle. Ein weiterer
  Risikofall endete ohne auswertbare Antwort und zählt nicht als Erfolg. Keine
  unveränderte Wiederholung. Alle drei synthetischen5,06s-Clips bestanden mit
  jeweils81/81 verschiedenen nativen Frames (7,9–10,6s, sechs Gratis-Aufrufe).
  Batches maximal64Frames/8MiB, zwei parallel, keine zeitliche Auswahl/Thumbnails.
  Das belegt Transport/Latenz, keine fachliche Missbrauchserkennungsqualität.
- Offizieller Wan5B-Endpunkt vollständig vorbereitet: Gradio/FastAPI,20 Artefakt-
  Pins/34.201.418.400Bytes, offizieller Snapshot
  b8fff7315c768468a5333511427288870b2e9635/Apache2.0-Metadaten. Alle lokalen
  Dateien prüfen, zusätzliche kanonische Gewichte und Symlinks ablehnen.
  Native Gewichte noch nicht heruntergeladen/geladen. Eigenes Profil:
 50Schritte/121Frames/24fps/large/max120GPU-Sekunden (harte Grenze, keine Messung).
- Persönliche HF-Identität vor GPU-Zuteilung, HMAC-Freigabe bindet Konto/Bild/
  Prompt/Seed/Modell. SQLite plus dauerhaftes einmaliges Services-DO-Claim
  verhindern auch nach Space-Rebuild doppelte Zuteilung. Unklare Antwort hält
  zurück. Private Videodateien nur mit kurzlebiger Freigabe, Range/TTL/Prüfung.
  Zusätzliche kanonische Dateien können keine verifizierten Shards übersteuern.
- App-Profil `wan22-official` ist ausdrücklich getrennt, keine4-/8-Schritt-
  Umdeutung oder gemischte Fallbackkette. Standardkonfiguration bleibt unverändert.
  Neuer `/api/producer/claim` bleibt bei blockierter KI ebenfalls gesperrt.
- Vollständig hashgefrorene Space- und CPU-HTTP-Abhängigkeiten. Konkreten
  Gradio/Transformers-Hub-Konflikt behoben. CPU-HTTP-Tests verwenden echte
  Gradio-/FastAPI-Routen und synthetischen Encoder, ausdrücklich keine Wan-Inferenz.
  Whitelist-Paketbau/Uploader: nur bestehender privater pausierter Gratis-Test-
  Space; keine Hardware-/Sichtbarkeitsänderung, kein automatisches Wiederaufwecken.

## Verifikation / Veröffentlichungsstand

- Moderationsdienst: Build/37 technische Tests bestanden, einschließlich präziser
  Trennung von Provider-Safety-Hold und semantischer Risikoeinstufung.
- Wan:15 CPU-/HTTP-/Krypto-/Replay-/Range-/Dateischutztests bestanden; Cross-Runtime-
  HMAC Node→Python und sechs neue App-/Worker-/DO-Regressionen bestanden.
- Gesamtmatrix vollständig bestanden (Exit0):237 Units/98 PASS-Prüfschritte,
  Chromium/WebKit, Node/workerd, klassische Mehrspielerpartien inklusive
  Anmeldung, Upload, Wiedergabe, gegenseitiger Bewertung, Endwertung und Reload.
  Externe HF-/Storage-Dienste simuliert; keine echte Produktionsrunde. Log:
  `.local/audit-tests/ci-2026-11-01-managed-official-validated.log`.
  Erster eingeschränkter Lauf:237 Units und workerd-Grenzen bestanden, macOS
  verweigerte anschließend Chromium-Mach-Port vor Browserstart. Kein Codefehler,
  kein Gesamterfolg. Finaler SHA256: cd5770215269d30f3847ed214da3086c7ae53ccb91d3e5464f9ec1220a0b5b3b.
- Commits e2df2a2/b3f965e auf origin/codex/audit-remediation gepusht/verifiziert.
  Cloudflare veröffentlicht:6c6d1e83-10cf-41a5-b876-306245af4f52, Anwendungscode
  b3f965e. Produktiver Smoke-Test vollständig bestanden:Release/Header, Startseite,
  robots/sitemap200, Metadaten/CSP, private APIs401, fremde Herkunft403,
  Producer-Claim503 und offengelegte KI-Sperre. Keine Schreib-/Inferenzaufrufe.
  Kein aktueller angemeldeter positiver Produktionstest; lokale Matrix ist simuliert.
- Privater pausierter HF-Space veröffentlicht und acht Quelldateien unabhängig
  gehasht:4cd4df2894e8c1c8ad6c50080fd38097a8856647. ZeroGPU unverändert,
  Modellladen=no bestätigt, kein Gewichts-/GPU-Aufruf. Scoped Deploy-Zugang nur
  lokal/HF, nie im Repository. Neue Vorbereitungsversion folgt gesondert.
- Externer Vorbereitungsmodus implementiert und19CPU-/HTTP-Tests bestanden:
  lokaler/ohne Flags erfolgender Download verweigert; echte freie Bytes vor
  Download, Hashprüfung bestehender Dateien, keine doppelte Blob-/Xet-Ablage;
  preparation-only registriert auch nach Modellinitialisierung keine GPU-Funktion.
  Native Installation/Speicher/Modell noch nicht nachgewiesen. Kein Freigabeersatz.
- Persönliche Zwei-HF-Konten und Produktionslobby am30.10. bereits bestanden,
  je300/300 unverändert, Verbindungen danach getrennt. Nicht erneut anmelden,
  solange kein tatsächlich ausführbarer freigegebener GPU-Test ansteht.

## Nächste Schritte (nicht neu auditieren)

1. Neues Vorbereitungs-Paket nach bestandenem Build/Typprüfung committen/pushen,
   privaten PAUSED-Space aktualisieren. Remote-SHA/hashgeprüft explizit mit
   `tools/prepare-wan-space.mts --prepare-free-remote-only --revision <HF-SHA>`
   starten. Nur unverändertes zero-a10g, keine Storage-/Hardware-/Sichtbarkeitsänderung.
   Modellgewichte ausschließlich extern, bei Platzmangel abbrechen. Gefilterte
   Build-/Prüfereignisse und /healthz lesen; nicht blind neu starten.
2. Native Ergebnisse dokumentieren und erforderlichenfalls gezielt reparieren.
   Cloudflare-Code unverändert; kein erneutes App-Deployment für reine Space-/Docs-
   Änderungen erforderlich. Aktuelle Produktionssperre beibehalten.
3. Verbleibende Moderationsrisikogruppen/kuratierten sicheren Korpus und fachliche
   Betreiberabnahme vervollständigen; aktuellen Bericht nicht als qualifiziert
   ausgeben. Dauerhaftes kostenloses Diensthosting und Datenschutzfreigabe fehlen.
4. Native Modell-/Host-/Diskprüfung jetzt nur im genehmigten externen Gratis-
   Umfang. Zweites Konto braucht Zugriff auf
   privaten Producer; keine automatische öffentliche Sichtbarkeit.
5. Erst nach ausreichend geprüften Voraussetzungen separat begrenzten Test mit
   je einem persönlichen Auftrag/max120large-GPU-Sekunden und Quota vor/nach
   genehmigen lassen. Aggregierte Differenz ist kein jobgenauer HF-Beleg.
   Anschließend vollständige reale Produktionsrunde; aktuell nur Simulationen.

## Fortsetzungsbelege

Private, ignorierte Messungen: `.local/audit-tests/managed-free-755f8db2-*.json`,
`managed-free-f5263a04-*.json`, `managed-free-000e18c3-*.json`,
`managed-video-49da7a07-*.json`. Keine Tokens/Originalantworten enthalten.
Details: docs/IMPLEMENTATION-2026-10-25.md, beide Audits24.10.,
moderation-service/README.md, wan-service/README.md. Älterer vollständiger Stand:
docs/progress/2026-11-01-before-managed-official.md. Noch offene P1/P2/P3 aus
vorigem Stand bleiben erhalten; dieses Paket behauptet nicht deren Gesamtabnahme.

Gefilterter aktueller Nachweis: docs/audits/2026-11-01-managed-official.json.
