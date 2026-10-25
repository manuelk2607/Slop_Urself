# HF/Wan: Inhaltsmoderation und Missbrauchsschutz

Stand: 24. Oktober 2026. Analyse ohne schädliche Testprompts, illegale Testdateien oder neue GPU-Aufträge. Prioritäten, Aufwand und Komponenten stehen unter M01–M04, M06/M07/M10/M18/M20/M42 im [Maßnahmenkatalog](</Users/manuelkienmoser/Documents/4 Studium/Sonstiges/SlopUrself/docs/audits/2026-10-24-website.md>). Die folgenden Details konkretisieren diese Maßnahmen, statt neue Parallelvorschläge zu bilden.

## Antwort auf die zentrale Frage

**Für den tatsächlich verwendeten Generierungsweg lässt sich keine Inhaltsklasse benennen, deren Blockierung durch HF zuverlässig nachgewiesen wäre.** HF verbietet zahlreiche missbräuchliche Inhalte ausdrücklich. Eine Plattformrichtlinie ist jedoch keine Garantie für automatische Prüfung jeder Anfrage an einen Community-Space. Sichtbare Schutzmechanismen gegen sexualisierte Minderjährigendarstellungen, nicht einvernehmliche sexuelle Deepfakes oder andere missbräuchliche Bild-/Videoinhalte fehlen im untersuchten Inferenzpfad.

Das bedeutet nicht, dass ein schädlicher Prompt sicher eine schädliche Ausgabe erzeugt oder HF keinerlei interne Maßnahmen hat. Es bedeutet: **Unsere Freigabe darf nicht von einer ungeprüften Schutzannahme abhängen.** Verdeckte Plattformkontrollen, konkrete Blockierungsquoten und tatsächliche missbräuchliche Generierbarkeit wurden nicht verifiziert.

## 1. Tatsächlich verwendeter Dienst und Datenweg

[Providerkonfiguration](</Users/manuelkienmoser/Documents/4 Studium/Sonstiges/SlopUrself/src/ai/providers.ts:34>):

| Eigenschaft | Geprüfter Stand |
|---|---|
| Spielmodi | `wan22`: 8 Schritte; `wan22-fast`: 4 Schritte |
| Beide Modi | derselbe Space `Saravutw/WAN2.2_I2V_LIGHTNING_4-8step_custom` |
| Logischer API-Endpunkt | `/generate_video`, via Gradio-Queue, kein belegter moderierter Inference-Provider-Endpunkt |
| Tatsächliche Requests | Space-Metadaten; `/gradio_api/info`, `/config`; Upload an `/gradio_api/upload`; `/gradio_api/queue/join`; Ergebnisstrom über `/gradio_api/queue/data` |
| Zuordnung | persönliche HF-Zugangsdaten und Replica-Bindung für Upload, Auftrag und Ergebnis |
| Space-Code/Runtime-Revision | `fca7f5a33da3057bae497de5cd70f49ce75e6c02` bei Abruf |
| Beobachtete Laufzeit | RUNNING, vier Replicas; eine abgefragte Konfiguration nennt `WAMU-Merge-AlienFilter WAN2.2 I2V LIGHTNING` |
| Beobachtetes Modell | `TestOrganizationPleaseIgnore/WAMU-Merge-AlienFilter_WAN2.2_I2V_LIGHTNING`, Revision `717eee033113e1edbde6e39ef9c9d8af85c4d20e` |

Der [geprüfte Space-Code](https://huggingface.co/spaces/Saravutw/WAN2.2_I2V_LIGHTNING_4-8step_custom/blob/fca7f5a33da3057bae497de5cd70f49ce75e6c02/app.py) wählt um Zeile 243–249 ohne gesetztes `REPO_ID` zufällig ein Modell einer Organisation. Die offizielle Wan-Modellzeile ist auskommentiert. In der beobachteten [Modellkarte](https://huggingface.co/TestOrganizationPleaseIgnore/WAMU-Merge-AlienFilter_WAN2.2_I2V_LIGHTNING) waren wesentliche Angaben zu Basismodell, Lizenz, Evaluation und Sicherheit nicht ausgefüllt. Nicht alle vier Replicas wurden unabhängig charakterisiert. **M05/M34.**

Ein unabhängiger Sicherheitsdienst wird in diesem Requestpfad nicht aufgerufen. LTX ist kein automatischer neuer Fallback für das begrenzte aktuelle Bildprofil; Legacy-Unterstützung in der Codebasis ist kein weiterer nachgewiesener produktiver Filter.

## 2. Vorhandene Kontrollen versus fehlende Inhaltskontrollen

| Ebene | Tatsächlich vorhanden | Nicht nachgewiesen beziehungsweise fehlend |
|---|---|---|
| HF-Plattform | Kontozugang, Kontingente, Plattformregeln und Melde-/Durchsetzungsprozesse | Garantie einer synchronen Prompt-, Bild- oder Video-Moderation für diesen Space |
| Space-Eingang | Bild muss vorhanden sein; Größenanpassung und Inferenzparameter | Inhaltsklassifikation, belastbare Alters-/Einwilligungsprüfung, semantische Promptfreigabe |
| Space-Inferenz | Direkter Aufruf `pipe(image, prompt, negative_prompt, ...)` um Zeile 485–498 | Moderationsentscheidung vor oder nach dem Modell |
| Space-Ausgang | Frames in MP4 exportiert und zurückgegeben, um Zeile 501–625 | Frame-/Videoprüfung, Quarantäne, Sicherheitsverdict als API-Ausgabe |
| Spiel-Eingang | Anmeldung/HF-Pflicht, Rollen, Promptlänge, Bildsignaturen/-größen und begrenzte Zielmaße | Gemeinsame Prüfung der Bedeutung von Prompt und Bild; vollständiger serverseitiger Bilddecode |
| Spiel-Ausgang | Downloadhost-/Größenprüfung, MP4-Signatur, authentifiziertes Archiv | Inhaltssicherheitsstatus, Moderation sämtlicher Ausgabeframes, missbrauchsbezogene Abrufsperre |
| Zugang/Geheimnisse | PKCE, zeitlich begrenzter verschlüsselter Vault, kontogebundene Jobzugänge | Dauerhafte beweiskräftige Bindung offener Spielprofile an die zugehörige Person; Objektberechtigungen im gesamten Archiv |

### Besonders missverständliche Schalter

- **`safe_mode` ist hier keine Inhaltsmoderation.** Der Space verwendet ihn in der Dauerberechnung als zusätzliche GPU-Zeitreserve von 30 %. Unser `safe_mode: false` deaktiviert deshalb keinen belegten Jugendschutzfilter; `true` wäre keine Sicherheitskorrektur.
- Der **Negative Prompt** behandelt Bildfehler. Er ist keine Zugriffskontrolle und keine belastbare Inhaltsentscheidung. Zudem verwendet unser Wan-Aufruf `guidance_scale: 1` und `guidance_scale_2: 1`; in der geprüften [Diffusers-Pipeline 0.38.0](https://github.com/huggingface/diffusers/blob/v0.38.0/src/diffusers/pipelines/wan/pipeline_wan_i2v.py) ist Classifier-Free-Guidance erst oberhalb 1 aktiv. Aus diesem Parameter darf kein semantischer Schutz abgeleitet werden. Guidance nicht ohne Qualitäts-/Kostenvergleich erhöhen.
- „Safe“-Hinweise beziehungsweise Malware-/Pickle-Prüfungen auf dem Hub bewerten andere Risiken. Sie sind kein Nachweis einer Inhaltsprüfung von hochgeladenen Bildern und erzeugten Videos. [HF-Sicherheitsübersicht](https://huggingface.co/docs/hub/security).

### Welche Anfragen könnten ungeprüft weiterlaufen?

Technisch valide Bilder und kurze Prompts gelangen ohne eigenen Inhaltsfilter zur Inferenz. Das umfasst potentiell sexualisierte Inhalte mit Minderjährigen, intime Manipulationen realer Personen ohne Einwilligung, entwürdigende Deepfakes sowie andere verbotene oder gefährliche Inhalte. Auch ein unauffälliger Prompt kann zusammen mit einem problematischen Bild kritisch sein; harmlose Eingaben können unerwartete Ausgaben erzeugen. **Dies ist eine belegte Lücke im Prüfpfad, keine durch schädliche Generierung bestätigte Erfolgsliste.**

Die [HF Content Policy](https://huggingface.co/content-policy) untersagt u. a. sexuelle Ausbeutung Minderjähriger und nicht einvernehmliche sexuelle Inhalte. Melden, Sperren und Plattformdurchsetzung bleiben relevant, ersetzen aber unsere Freigabe vor Verwendung und Verbreitung nicht.

## 3. Empfohlenes mehrstufiges Freigabemodell

Zielablauf: **berechtigter Nutzer → technische Bildprüfung → gemeinsame Eingabeprüfung → budgetgebundener HF-Auftrag → private Ausgabe → Ausgabeprüfung → berechtigter Spiel-/Archivzugriff**. Bei nicht verfügbarer Sicherheitsprüfung bleiben ungeprüfte Inhalte zurückgehalten; ein sicherheitsbezogener Ausfall darf nicht automatisch den ungefilterten Providerpfad freischalten.

| Stufe / Katalog | Konkrete Umsetzung | Entscheidung und Fehlklassifizierungen |
|---|---|---|
| Zugang und Regeln / M01, M06, M07 | Bestätigte Profilidentität; verantwortliche Gruppe/Einladungen für Uploadfunktionen; verständliche Regeln für Bildrechte und Einwilligung. Kein öffentliches Durchreichen beliebiger Uploads ohne Schutz. | Zustimmungserklärung hilft beim Verhalten, beweist aber weder Alter noch Einwilligung. Eine öffentlich indexierbare Startseite erfordert keine öffentlich unbeschränkte Generierungs-API. |
| Technische Aufnahme / M10 | Bild tatsächlich mit Zeit-/Pixel-/Speicherlimit decodieren, erlaubtes Format neu erzeugen, Metadaten entfernen. Ablehnung vor externem Upload. | Signatur-/MIMEprüfung allein reicht nicht. Keine Übernahme der Client-Prüfung als Sicherheitsbeweis. Grundlage: [OWASP File Upload](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html). |
| Text und Bild gemeinsam / M02 | Unicode-/Längenvalidierung, wenige klare Hochrisikoregeln plus kontextbezogener Klassifikator; Bild und Bearbeitungsabsicht zusammen bewerten. Vor HF-Upload und Kontingentstart durchführen. | Nicht pauschal Wörter wie „Kind“, Körperbegriffe oder Kunst blockieren. Harmlose Familienbilder, Sport, medizinische Darstellung und kreative Verwandlung im Kontext unterscheiden. |
| Minderjährige und sexuelle Inhalte / M02 | Sexualisierung mit Hinweis auf Minderjährigkeit beziehungsweise unklarem Alter nicht freigeben; Unsicherheit als eigenen Zustand behandeln. Keine automatische Zusicherung „volljährig“ anhand einer Gesichtsschätzung. | Altersmodelle sind unzuverlässig; synthetische Figuren und stilisierte Bilder bleiben relevant. Lieber eng definierte Hochrisikofunktionen begrenzen als harmlose Kinderbilder allgemein verbieten. |
| Nicht einvernehmliche Deepfakes / M02, M04 | Sexualisierte beziehungsweise entwürdigende Bearbeitung identifizierbarer Personen besonders streng behandeln; bei ungeklärter Berechtigung zurückhalten. Melde-/Sperrpfad für Betroffene vorsehen. | Gesichtserkennung oder eine Upload-Checkbox kann Einwilligung nicht beweisen. Keine Ausweis-/Gesichtsdatenbank als vermeintliche kostenlose Standardlösung aufbauen. |
| Ergebnisquarantäne / M03 | Video zuerst privat und gesperrt speichern; Freigabestatus bindend im Dateiabruf, in WS-Snapshots, Downloads, Statistiken und Archivpartien prüfen. | Ein unbekannter UUID-Dateiname ist kein Moderationszustand. Auch bekannte Links und Kopien müssen bei Sperrung unzugänglich werden. |
| Videoprüfung / M03 | Bei kurzen Clips möglichst alle decodierten Frames in geeigneter Auflösung prüfen, zeitlichen Kontext einbeziehen; bei längeren Clips nur validiertes abgestuftes Verfahren. | Einzelbilder oder grobes Sampling können einzelne kritische Frames verpassen. Auch vollständige Frameklassifikation garantiert keine fehlerfreie semantische Bewertung. |
| Nachsorge / M04, M18 | Meldung mit Video-ID, sofortige Zugriffssperre, eingeschränkte Betreiberprüfung, nachvollziehbare Entscheidung und dokumentierte Aufbewahrung. | Sicherheitsblockade von gewöhnlichem Löschen/Undo trennen; gesperrte Inhalte nicht durch Benutzer wieder freischaltbar machen. Keine unnötigen Kopien problematischer Medien anlegen. |

Die Sperrentscheidung muss auf dem tatsächlich normalisierten Bild, dem tatsächlich gesendeten Prompt, Parametern und Policy-/Prüfmodellversion beruhen. Eine geänderte Eingabe darf keine alte Freigabe übernehmen. Technische Validierung, Eingabemoderation und Ausgabemoderation sind unterschiedliche Gates; keines ersetzt die anderen.

## 4. Was kostengünstig realistisch ist

| Ansatz | Nutzen | Kosten und Grenzen |
|---|---|---|
| Serverseitige Grenzen, erlaubte Formate, identitätsgebundene Rechte, sichere Vorlagen | Sehr gutes Verhältnis zwischen Aufwand und Wirkung; reduziert Missbrauchsfläche vor dem GPU-Auftrag | Keine semantische Vollprüfung; begrenzter Produktumfang kann nötig sein |
| Leichte lokale Textregeln | Günstig für eindeutig unzulässige Anfragen und technische Eingabeprobleme | Nicht allein ausreichend; Sprache/Kontext und Umformulierungen erzeugen Fehlentscheidungen |
| Offener Bildklassifikator | Vorprüfung und Frameklassifikation ohne bezahlte Modelllizenz eventuell möglich | Hosting, Rechenzeit, Lizenzbedingungen und Wartung separat prüfen; kostenloses Modell bedeutet keinen kostenlos verfügbaren zuverlässigen Dienst |
| Kontextbezogenes Bild-/Textmodell | Kann Bearbeitungsabsicht besser einschätzen als reine Schlüsselwörter | Benötigt mehr Ressourcen; ungesicherte Freikontingente oder zusätzliche ZeroGPU-Nutzung verringern die praktisch spielbaren Runden |
| Bekannte-Hash-Abgleich | Ergänzung für bereits bekannte rechtswidrige Dateien bei legitimem Zugang zu geeigneten Diensten | Verfügbarkeit, Berechtigung und Preis prüfen; erkennt keine beliebigen neu erzeugten Inhalte und ersetzt keine Kontextprüfung |
| Eingeschränkte manuelle Prüfung | Für kleine Freundesgruppe bei echten Zweifelsfällen möglich | Kein skalierbarer Vollersatz; belastend, datenschutzsensibel und ohne klare Verfahren ungeeignet |

Als **zu evaluierender Kandidat**, nicht als fertige Empfehlung, ist [ShieldGemma 2 4B](https://huggingface.co/google/shieldgemma-2-4b-it) für Bildinhaltsklassen dokumentiert. Es erkennt weder Einwilligung noch Volljährigkeit zuverlässig und wurde hier nicht hinsichtlich Trefferquote, Geschwindigkeit oder Kosten getestet. Die Lizenz-/Zugangsbedingungen müssen geprüft werden. Ein Modell dieser Größe passt nicht in den bestehenden Cloudflare-Worker; siehe [Worker-Ressourcenlimits](https://developers.cloudflare.com/workers/platform/limits/).

**Empfehlung unter der Kostenlos-Vorgabe:** zuerst kostengünstige technische Gates, belastbare Identität/Rechte und eine klar begrenzte Eingabepalette; anschließend einen unabhängig budgetierten Moderationspfad auf realistisch verfügbarer Infrastruktur benchmarken. Eine frei zugängliche Generierung beliebiger Bilder mit verlässlicher automatischer Inhaltskontrolle und garantiert null Betriebskosten lässt sich auf Basis des vorgefundenen Setups nicht zusagen. Die öffentlichen SEO-Seiten können unabhängig davon erreichbar bleiben.

Nach [ZeroGPU-Dokumentation](https://huggingface.co/docs/hub/spaces-zerogpu) unterscheiden sich GPU-Größen und Kontingentverbrauch. Hostingplätze sind kein zusätzliches Nutzerbudget. Ein eigener Space ermöglicht Kontrolle, liefert aber nicht automatisch mehr Sekunden oder kostenlose Moderationskapazität. Die 300 Sekunden eines Spielers sollten ausschließlich dessen explizit geplante Aufträge tragen; zusätzliche Moderationskosten müssen sichtbar kalkuliert werden.

## 5. Datenschutz und Geheimnisse

- Bild und Prompt verlassen unser System zum Betreiber des Community-Spaces. Eigene Vault-Verschlüsselung schützt gespeicherte Tokens bei uns, nicht die beim Inferenzdienst verarbeiteten Inhalte. Für sensible Fotos ist dieser Unterschied wesentlich.
- Der Space enthält `delete_cache=(3600, 10800)`: zeitgesteuerte Cachebereinigung mit Intervall und Altersgrenze, **keine verbindliche sofortige Löschung nach Spielende**. Betreiberlogs, Backups und sämtliche Replicas sind nicht einsehbar. Keine Zusage machen, fremde Speicherung vollständig erzwingen zu können.
- Moderationsdienste sind weitere Empfänger. Nur erforderliche normalisierte Daten übertragen, Transport/Region/Aufbewahrung prüfen; keine Bilder, Rohprompts, Tokens oder vollständigen OAuth-URLs in gewöhnliche Logs schreiben.
- Der OAuth-Scope lautet derzeit `openid profile read-billing`. Das benötigte Kontingentlesen ist damit keine auf unser Spiel zugeschnittene Minimalberechtigung: der Billing-Lesescope ist breiter. Den Umfang im Verbindungsdialog korrekt erklären und keine zusätzlichen Rechte auf Vorrat anfordern. Die tatsächlich genutzten Routen und notwendigen Scopes regelmäßig gegen die [HF-OAuth-Dokumentation](https://huggingface.co/docs/hub/oauth) prüfen; keine vorhandene Berechtigung ungeprüft entfernen.
- Entscheidungen möglichst als begrenzte Metadaten speichern: Akteur-/Video-ID, Zeitpunkt, Policyversion, Grundkategorie und Zugriffssperre. Hashes ebenfalls mit Zugriffsschutz und begrenzter Aufbewahrung behandeln; keine neue öffentliche Suchbarkeit sensibler Bilder schaffen.
- Bei mutmaßlich rechtswidrigem Material weder automatische unbegrenzte Beweiskopien noch pauschale Sofortvernichtung zusagen. Zugriff unverzüglich sperren und für Aufbewahrung/Meldung die konkret geltenden Pflichten fachkundig klären. Dieser technische Audit bestimmt keine allgemeingültigen gesetzlichen Fristen oder Meldepflichten.

## 6. Abnahme und verbleibende Unsicherheit

Vor Freigabe M42 um folgende Prüfungen ergänzen: direkte API-Umgehungsversuche gegen die Gates, gemeinsames Ausgangsbild und alle Varianten, geänderte Datei nach Freigabe, nicht verfügbarer Prüfdienst, gesperrte Ausgabe über bekannte URL, Restore-/Archivspiel-Umgehung sowie identischer Auftrag nach Neustart. Nur harmlose, lizenzierte/synthetische Prüfmittel verwenden; keine realen Missbrauchsdateien beschaffen oder herstellen.

Fehlklassifizierungen getrennt messen: fälschlich blockierte harmlose Inhalte und übersehene kritische Fälle. Deutsch/Englisch, Fotografie/Illustration, unterschiedliche Hauttöne, unklare Altersdarstellung und nicht sexuelle Alltagskontexte berücksichtigen. Schwellenwerte anhand eines dokumentierten zulässigen Testkorpus festlegen, nicht aus dem Sicherheitsnamen eines Modells ableiten. Ein Widerspruchspfad darf klare Hochrisikosperren nicht automatisch überstimmen.

**Nicht verifiziert:** interne HF-Moderation jenseits des sichtbaren Codes; tatsächliche Blockierungsquoten; Verhalten bei schädlichen Generierungsversuchen; Gleichheit aller Replicas; konkrete Moderationskosten und Anbieteraufbewahrung; juristische Einzelfallpflichten. Deshalb weder „HF blockiert das zuverlässig“ noch „unser Filter verhindert sämtliche rechtswidrigen Ausgaben“ versprechen.

**Nächste Entscheidung:** M01 als begrenzten Schutzrahmen festlegen und M02–M04 mit einem überprüfbaren Freigabestatus planen. Erst danach beliebige Bilder/Prompts breiter freigeben. Verbesserte Videoqualität und ein persönliches HF-Kontingent ersetzen diese Schutzmaßnahmen nicht.
