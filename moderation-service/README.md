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
   Die Pflichtfelder prüft src/policy.ts. Der Nachweis muss auf tatsächlichen Tests
   beruhen; ein ausgefülltes JSON allein beweist keine Schutzwirkung.
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

Quellen: [NSFW-ONNX-Modell](https://huggingface.co/onnx-community/nsfw_image_detection-ONNX),
[SmolVLM](https://huggingface.co/HuggingFaceTB/SmolVLM-500M-Instruct),
[Transformers.js](https://huggingface.co/docs/transformers.js/).
