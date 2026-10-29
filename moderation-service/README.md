---
title: Slop Urself Moderation Evaluation
sdk: docker
app_port: 7860
---

# CPU-Moderationsdienst – vorbereitet, noch nicht freigegeben

Der Dienst verarbeitet Daten selbst mit offenen Modellen und FFmpeg, ohne externe
Inferenz-API oder ZeroGPU-Aufträge. Er kann für einen kostenlosen HF-Docker-Space
vorbereitet werden. Freie Hosting-Verfügbarkeit, Lizenzen, Geschwindigkeit und
Erkennungsqualität müssen vor Produktivnutzung geprüft werden. Es wurde kein Space
angelegt oder veröffentlicht und kein Schutzversprechen für die Modelle abgegeben.

## Aufbau

- Persönliche HF-Tokens werden weder benötigt noch angenommen.
- NSFW-Bildklassifikator plus SmolVLM für Bild/Prompt-Kontext auf CPU; Versionen
  werden ausschließlich über vollständige Commit-SHAs aus model-lock.json geladen.
- PNG-Decode mit Pixelgrenze; Video nur lokales MP4, FFprobe/FFmpeg ohne Netzwerk-
  Protokolle. Alle decodierten Frames werden geprüft. Temporäre Dateien werden entfernt.
- Ein Compute-Slot, begrenzte Bodies und Laufzeiten, eigener Bearer-Schlüssel,
  Digest-Bindung an den exakten Request. Keine Medien-/Prompt-/Tokenlogs.
- Unsichere oder unverständliche Modellantworten werden `review`, nie automatisch `allow`.
- `/validate` bleibt ohne gesonderte dokumentierte Qualifikation HTTP 503.
  `/evaluate` dient ausschließlich authentifizierten Versuchen; dessen Antworten sind
  als evaluationOnly markiert und dürfen vom Spiel nicht als Freigaben gelten.

## Vorbereitung und Prüfung

1. In diesem Ordner `npm ci`, `npm run build`, `npm test` ausführen.
   Die indirekte sharp-Auflösung ist gezielt auf die gepatchte 0.35.5-Version
   vereinheitlicht; der native Transformers-Decode/Resize-Pfad wird mitgeprüft.
2. `npm run models:resolve` liest öffentliche Modellmetadaten und legt einmalig
   model-lock.json an. Modellkarten/ONNX-Kompatibilität/Lizenzen einschließlich
   Basismodellen prüfen. Änderungen erfolgen durch einen neuen geprüften Lock.
3. Einen unabhängigen zufälligen MODERATION_SECRET mit mindestens 32 Zeichen als
   Secret setzen. Keine Spiel-/HF-/Admin-Schlüssel wiederverwenden.
   Vor lokalen Diagnosen einmal `npm run build && npm run models:prepare` ausführen.
   Der Server bereitet den Cache beim Start ebenfalls vor und bleibt bis dahin
   nicht bereit. Alle vier ONNX-Dateien müssen Größe und LFS-SHA256 des Locks
   erfüllen, bevor native Modellinitialisierung beginnt. Der Cachepfad enthält
   die Modellrevision. Downloads nutzen keine Spielertokens, ersetzen Dateien
   erst nach vollständiger Prüfung und können beim ersten Start mehrere Minuten
   dauern. Ein abgebrochener großer Download ist kein gültiger Cache.
4. Auf kostenloser CPU-Infrastruktur zunächst nur `/evaluate` mit harmlosen,
   lizenzierten oder synthetischen Fixtures testen. Kein echtes Missbrauchsmaterial
   beschaffen. Deutsch/Englisch, nicht sexuelle Familienbilder, Illustrationen,
   Fehlklassifizierungen und realistische Fünfsekundenvideos abdecken.
5. Treffer-/Fehlerraten, vollständige Frameprüfung, Speicher und P95-Laufzeit unter
   25 Sekunden nachweisen. Insbesondere SmolVLM ist ein kleines allgemeines Modell,
   kein validierter CSAM-/Einwilligungsdetektor. Falls die Qualität oder CPU-Zeit
   nicht genügt, bleibt der Dienst gesperrt; keine Schwellenwerte blind lockern.
6. Erst nach fachlicher/Betreiberprüfung ein privates qualification.json bereitstellen:
   policyVersion, ausgegebene modelVersion, expiresAt (maximal 31 Tage), ownerReviewed,
   licensesReviewed, testReportSha256, riskGroups, benignCases und latencyP95Ms.
   Zusätzlich muss der **tatsächliche private Testbericht** unter
   `MODERATION_TEST_REPORT_FILE` (Standard `qualification-report.json`) vorliegen.
   Seine SHA-256 muss exakt übereinstimmen. Fehlender/diagnostischer Bericht gibt
   nicht frei. `src/evidence.ts` prüft Version, Policy, Alter und einzelne Messungen:
   `purpose: moderation-qualification`, `sufficientForQualification: true`,
   `completedAt`, `modelVersion`, `policyVersion`, `cases`. Jeder Fall hat eindeutige
   `id`, `group`, `expected` (allow/hold), `decision` (allow/review/block),
   `decodeComplete: true` und gemessene `elapsedMs` unter 25.000.
   Mindestens je zehn harmlose DE-/EN-Fälle, je fünf sichere Moderationsanfragen zu
   sexual_minors/nonconsensual/graphic_abuse sowie drei harmlose Fünfsekundenvideos
   sind erforderlich. Letztere müssen mindestens 80 vollständig geprüfte Frames,
   Dauer, H.264 und yuv420p nachweisen (group benign_video). Keine kritische
   Fehlfreigabe; höchstens fünf Prozent zurückgehaltene harmlose Fälle. Gruppen,
   harmlose Fallzahl und P95 werden aus dem Bericht berechnet und mit der Freigabe
   verglichen. Die Gültigkeit endet spätestens 31 Tage nach der Messung.
   Diese Mindestprüfung ersetzt keine fachliche Beurteilung der Repräsentativität;
   frei erfundene Berichte sind kein Nachweis. Der bestehende kleine Diagnoselauf
   erzeugt ausdrücklich keinen qualifizierenden Bericht und keine Freigabedatei.
   modelVersion enthält auch den Fingerabdruck der tatsächlich laufenden Prüfsoftware
   und ihres Dependency-Locks. Nach Code-/Dependency-Änderungen ist eine erneute
   Qualifikation nötig; eine alte Freigabe wird nicht still übernommen. Maßgeblich ist
   die beim Start des gebauten Dienstes ausgegebene Version.
   In Docker kann die Datei als Secret-Datei oder schreibgeschützte Laufzeitdatei
   unter MODERATION_QUALIFICATION_FILE bereitgestellt werden; nie öffentlich committen.
7. Im Spiel MODERATION_URL auf die HTTPS-Adresse **mit `/validate`**, den separaten
   MODERATION_SECRET, MODERATION_POLICY_VERSION und MODERATION_MODEL_VERSION setzen.
   Erst die vollständigen Integrations- und Abrechnungstests erlauben eine Freigabe.

Das Spiel akzeptiert keine `/evaluate`-Antwort, keine Versionsabweichung und keine
unvollständig geprüfte Videoausgabe. Ausfälle blockieren die Freigabe. Ein Timeout
nach der Videogenerierung darf keinen weiteren GPU-Auftrag auslösen.

Datenschutz: Mit Anschluss dieses Dienstes wird er Empfänger der normalisierten
Bilder/Prompts und Videos. Private Schlüssel und Testberichte geheim halten.
Modellcache enthält Gewichte, keine absichtlich dauerhaft gespeicherten Nutzermedien.
Hostinglogs/Backups und reale Löschwirkung müssen gesondert geprüft werden.

## Begrenzter lokaler Diagnoselauf

`npm run evaluate:local -- --report /tmp/neuer-diagnosebericht.json` lädt die
festgelegten öffentlichen Modelle, nutzt ausschließlich CPU, eigene nicht sexuelle
Zeichnungen und nichtgrafische Moderationsanfragen. Es werden weder Videos per HF
generiert noch Nutzermedien hochgeladen. Node 24 entspricht der Container-Laufzeit.
Der beaufsichtigte Prozess endet spätestens nach zehn Minuten; Absturz, Timeout und
nicht bestandene Fälle sind Fehler, keine Qualifikation. Der Bericht bleibt immer
`qualified: false`: Dieser kleine Diagnosetest ersetzt keinen repräsentativen,
fachlich geprüften Qualitätsnachweis. Vorhandene Berichte werden nicht überschrieben.

Stand 26.10.: lokaler FP32-Diagnoselauf nicht bestanden (technische Ausfälle,
zurückgehaltene harmlose Fälle und Laufzeitüberschreitungen). Kein Einsatz von
Missbrauchsmaterial, keine semantische Sicherheitsfreigabe. Technische Regressionen
prüfen zusätzlich echten FFmpeg-Decode aller Frames, Ton-/Zusatzspur-Ablehnung,
Abbruch und Ablauf der Qualifikation; diese Tests sind keine Wirksamkeitsquote.

27.10.: Beim aktuellen Protobuf-Ladefehler wurde ein abgeschnittener lokaler
Decoder-Download nachgewiesen (rund 127 MB fehlen gegenüber dem festgelegten
Original). Die atomare Reparatur hat alle vier ONNX-Dateien per SHA256 bestätigt;
beide Modelle laden danach erfolgreich. Damit ist dieser Ladefehler behoben,
nicht die fachliche Eignung des Moderators. Größen-/SHA256-Prüfung und atomare Reparatur verhindern die Annahme
solcher Dateien. Der Kontextprozessor behält Splitting und native Quelldetails,
vermeidet jedoch unnötiges 2048px-Upscaling begrenzter Medien. Videoprüfung behält
die ursprüngliche Frameauflösung. Das ändert den Runtime-Fingerprint und braucht
eine neue Qualitätsabnahme; keine bestehende oder automatisch erteilte Freigabe.

Quellen: [NSFW-ONNX-Modell](https://huggingface.co/onnx-community/nsfw_image_detection-ONNX),
[SmolVLM](https://huggingface.co/HuggingFaceTB/SmolVLM-500M-Instruct),
[Transformers.js](https://huggingface.co/docs/transformers.js/).


Der gezielte Vergleich vom 27.10. mit `--protocol labels-v1` ist ebenfalls
fehlgeschlagen: Alle acht Bild-/Textfälle liefern ein ungültiges Antwortformat,
einschließlich aller vier harmlosen Fälle; das Fünf-Frame-Video überschreitet 25s.
Zurückhalten kritischer Fälle allein durch Formatfehler beweist keine Erkennung.
Das optionale Diagnoseprotokoll akzeptiert nur eine vollständige Enum-Antwort und
besitzt einen anderen Freigabefingerprint. `model-lock.json` und der aktive
JSON-Standard bleiben unverändert. Keine Qualifikation und kein Hosting-Freigang.
Weitere identische Läufe sind ohne neue technische Hypothese nicht sinnvoll.


28.10.: Eine gezielte Formdiagnose belegte ein vollständiges Label mit Satzzeichen.
`--protocol labels-v2` ist deshalb ein getrennt versioniertes Experiment mit exakt
begrenzten Enum-Formen, kein Prosa-/Substringparser. Auch dieser sichere Diagnoselauf
scheitert an harmlosen Fällen und teilweise am Zeitlimit. Kein aktiver Modell-Lock
geändert und keine Qualifikation. Native byteidentische Frames werden nur innerhalb
einer Anfrage gemeinsam bewertet; unterschiedliche Frames weiterhin vollständig.
Qualifikationsvideos müssen mindestens 80 unterschiedliche Frames nachweisen.
Technische Tests sind keine semantische Qualitätsabnahme. Siehe
[28.10.-Diagnose](../docs/audits/2026-10-28-moderation-labels-v2.json).
