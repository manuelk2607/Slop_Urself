# Official controlled endpoint – not released for public inference

Stand1.11.: `app.py` ist ein ausführbarer Gradio-/FastAPI-Adapter mit einem
**explizit anderen** offiziellen Wan2.2-TI2V5B-Profil. Alte Merge-Vorbereitung
bleibt unten als historische Referenz erhalten; sie ist kein Ersatzprofil.

- `official-model-lock.json`:20 Dateien/34.201.418.400Bytes, offizieller Wan-AI-
  Snapshot b8fff7315c768468a5333511427288870b2e9635, Apache2.0 laut Modellkarte.
  Kleine Konfigurationen unabhängig gehasht; große Gewichte nur HF-LFS-Hashes,
  noch nicht geladen. Vor nativem Laden alle lokalen Dateien hashen, Symlinks
  und unaufgeführte Dateien ablehnen (auch alternative kanonische Gewichte).
- Eigenes fixes Profil:50Schritte/121Frames/24fps/Guidance5/UniPC-Shift5,
  `large`,120Sekunden harte GPU-Laufzeitgrenze. **Keine Laufzeitmessung** und
  kein4-/8-Schritt-Lightning-Modell. Das Spiel muss ausdrücklich
  `AI_PROVIDER_CHAIN=wan22-official` konfigurieren; gemischte Fallbackketten
  werden verweigert. Alte Spielräume behalten ihr vorhandenes Profil.
- Jeder Aufruf braucht einen persönlichen Bearer-Zugang, der vor GPU-Zuteilung
  bei HF geprüft wird, und einen signierten, zeitlich begrenzten Auftrag für
  genau Konto/Bild/Prompt/Seed/Modell. Betreiber-HF-Tokens im Prozess sind verboten.
  Lokales SQLite-Journal und eine einmalige Freigabe im Cloudflare-Services-DO
  verhindern auch nach einem Space-Rebuild die erneute Zuteilung. Bei unklarer
  Freigabeantwort kein GPU-Aufruf/Neuversuch. HF-Abrechnung bleibt unbestätigt.
- Ergebnisse liegen privat und werden nur mit kurzlebiger kryptografischer
  Dateifreigabe abgerufen; generische Gradio-Dateirouten sind gesperrt. Nach15min
  bereinigen. Export H.264/yuv420p/faststart;121Frames dauern5,0417s. Danach muss
  die Spielseite weiterhin die komplette Ausgabemoderation bestehen.
- `requirements-space.txt` fixiert die vollständige Linux/Python3.12-Auflösung
  samt Paket-Hashes. Konkreter Konflikt behoben: Gradio6.31 und Transformers4.57
  verwenden inkompatible Hub-Versionen. Endpoint-Profil verwendet ausdrücklich
  Diffusers0.42.1/Transformers5.22.1/Hub2.4.0. Native CUDA-Kompatibilität bleibt
  ungetestet; CPU-HTTP-Prüfungen verwenden keine Modellgewichte/keine GPU.

Vorbereitung:

```sh
node --import tsx tools/package-wan-producer.mts
# Erst mit gezieltem HF_DEPLOY_TOKEN und geprüfter Paketdatei:
node --import tsx tools/deploy-wan-producer.mts --upload-paused-space --package .local/wan-producer-package-...
```

Der Uploader ist auf den bestehenden privaten pausierten Test-Space beschränkt,
aktiviert kein Modell/GPU/Hardware und kopiert ausschließlich acht geprüfte
Dateien. Keine .env/Tokens/Gewichte gelangen in das Paket. HF_DEPLOY_TOKEN dient
nur der Bereitstellung und wird niemals für persönliche Generierung verwendet.
Vier alte reine Prototype-Helfer bleiben erhalten. Der neue Endpunkt importiert
sie nicht; der Uploader prüft ihre tatsächlich gelesenen SHA256 vor jeder Änderung.
Insbesondere wird der alte AOTI-Downloadpfad nicht mehr ausgeführt. Weitere oder
geänderte ausführbare Dateien/Build-Eingaben werden abgewiesen statt gelöscht.
Danach explizite Gewichts-Vorbereitung auf geeignetem kostenlosem Host mit
mindestens34,2GB freiem Speicher plus Reserve, kein Download auf dem Mac nötig:

```sh
python prepare_official.py --download-public-snapshot --destination models/official
```

Voraussetzungen für tatsächliche Aktivierung: geprüftes kostenloses ZeroGPU-
Hosting, native Installation/Artefaktprüfung, qualifizierter Moderator,
WAN_PRODUCER_SECRET auf Spiel und Producer, nach Deployment genau gepinnte
WAN_SPACE_REVISION sowie gesonderte GPU-Freigabe. Private-Space-Zugriff des zweiten
Kontos muss geklärt sein; kein automatischer Wechsel zur öffentlichen Sichtbarkeit.
`WAN_ENABLE_MODEL_LOADING` bleibt standardmäßig deaktiviert, `/config` behauptet
dann keine geladene Modellidentität. Vorhandene Produktion bleibt blockiert.

## Historischer Merge-Kern (nicht das offizielle Endpoint-Profil)

This package replaces the prototype's mutable model selection, runtime installers,
unpinned AOTI downloads and scheduler switches with a local, verified model core.
It **does not expose a web endpoint, allocate ZeroGPU, qualify moderation, attest
HF billing or change the game release gate**. Do not deploy the private prototype
or advertise this package as a qualified provider.

## Verified preparation

- Existing MotionBoost merge and immutable revision are explicit in `model-lock.json`.
  This is **not** the official Wan checkpoint. All 22 required files have pinned
  sizes/SHA-256: small configurations were retrieved and hashed locally; large
  weights use HF's reported LFS size/hash and were not downloaded or independently
  hashed. Actual weight verification happens only in `verify_directory`.
- `producer.py` checks every local file before native loading; missing/corrupt
  weights, symlinks, executable artifacts, unapproved pipeline components and
  recipe drift fail. Loading uses local files only and safetensors, with no hub
  token or remote custom code. No random/automatic model or LoRA fallback.
- Fixed UniPC/shift3, boundary0.9, guidance1, explicit seed, four/eight steps,
  81 frames at16fps and bounded input dimensions. Exact moderated prompt is retained.
  FP8 transformers/int8 text encoder follow the inspected prototype's recipe;
  compatibility, transient memory, actual quality and speed are **not** proven.
  The three input sizes exactly match the app's 832×624/624×832/640×640 contract;
  a CPU regression checks that shared contract against the actual TypeScript file.
- Explicit H.264/yuv420p MP4 encoder. Encoded synthetic frames can test this
  encoder independently, but cannot qualify real Wan inference or prompt adherence.
- `requirements.txt` is a hash-pinned full dependency resolution for Linux x86_64,
  Python3.12, generated by uv0.9.7. Resolution is not a native installation test.
  No runtime `pip install`, `torch.compile` or downloaded AOTI binary is used.

## CPU checks (no downloads/GPU)

```sh
cd wan-service
python3 -m unittest -v test_producer.py
python3 producer.py
```

## Preconditions before a GPU trial or endpoint integration

1. Resolve the model's license/provenance: the queried immutable model metadata
   has no declared license. No license approval has been inferred from Wan upstream.
2. Check actual free hosting capacity. The locked artifacts total **68,788,615,789
   bytes**; the CPU memory/disk requirement and 48GB `large` runtime fit are not
   verified. Do not download these weights automatically or switch to paid hardware.
3. Install only the frozen requirements into an isolated Linux environment and
   verify all weights there. Hash verification covers files; it is not remote
   cryptographic attestation of a third party's live GPU or loaded tensors.
4. Integrate the qualified input/output moderator, private quarantine, durable
   job/recovery boundaries and explicit per-caller HF authentication into an
   endpoint adapter. Declare `slop_model` in `/config` only after verified loading;
   bind the new Space source/runtime SHA in the existing strict game contract.
5. Only after separately scoped approval: test the actual ZeroGPU hardware with
   harmless input, two personal grants and before/after quota observations.
   Never present aggregate quota change as a per-job billing receipt.

There is no silently substituted cheaper model. A smaller official checkpoint
would need an explicit different recipe, parameters, budget calibration and quality
qualification. Existing production remains on its verified blocked release.
