# Controlled Wan – current checkpoint, 1 November 2026

- Official 5B endpoint, pinned 20-file/34.2GB manifest and frozen native dependencies implemented.
- Existing private paused Space updated to 4cd4df2894e8c1c8ad6c50080fd38097a8856647;
  eight source files remotely hashed, loading disabled, zero-a10g unchanged.
- Remote-only preparation approved by user, conditional on no Mac weight downloads
  and no paid storage/hardware. New preparation-only implementation passes 19 CPU
  and real HTTP tests; native install/model initialization is not yet verified.
- Next: publish checked preparation-only source, start only the existing free Space,
  observe disk/download/hash/native-init events, preserve game inference block.
- No GPU calls authorized or performed. No moderation/billing qualification.
- Root PROGRESS.md is authoritative for release IDs and subsequent checkpoints.

## Historical preparation notes (superseded where contradicted above)

# Controlled Wan producer preparation

Latest package 30.10.: a CPU-testable controlled core now exists in producer.py,
with a measured 22-file model manifest and a fully hash-pinned Linux/Python3.12
dependency resolution. Six CPU tests pass, including the actual app image-size
contract. No weight downloads or GPU invocation.
Source/model identity and recipe checks are implemented; endpoint adapter, native
installation, inference, hosting and qualification remain open. In particular,
68,788,615,789 bytes of artifacts and a missing declared model license are concrete
preconditions, not a successful free deployment. See README.md. Historical notes
below describe the earlier preparation stage and must not override this checkpoint.

Objective: Prepare a pinned, locally verifiable Gradio producer compatible with
`src/ai/provider-trust.ts` and `src/ai/generation.ts`. Work stays in this folder.
No GPU jobs, deployment, secrets, DB, release changes or commits.

- Branch checked: `codex/audit-remediation`; initial working tree clean.
- Contract inspected: `/generate_video`, queue/upload/file API, `slop_model`.
- Official Wan, Diffusers, LightX2V and HF sources under review.
- Next: verify adapter format/recipe, pin dependencies and implement CPU checks.
- Unverified: real inference, 8-step recipe, output quality, hosting/quota,
  moderation qualification and Space source/runtime identity.

Checkpoint: Preparation interrupted; no executable producer implemented. Do not treat this folder as deployable. Official candidates inspected: Wan-AI/Wan2.2-I2V-A14B-Diffusers and lightx2v/Wan2.2-Lightning. Exact adapter format, immutable pins, scheduler, dual-expert recipe and free hardware fit remain unverified.

## Read-only discovery, 2026-10-30

An existing **private remote prototype** was found using the owner's existing
local credential without exposing it. The connector's unauthenticated/not-found
response did not mean that the Space was deleted. HF API confirms
`Manuel2607/SlopUrself-Wan22-GPU-Test`, source
`ed1bb1cacd00f89c789b1d8d13657d71d49ad4a6`, **PAUSED**, no current hardware.
The Space was neither resumed nor modified and no GPU request was made.

Source at that immutable revision uses the fixed merge
`TestOrganizationPleaseIgnore/WAMU-Merge-MotionBoost_WAN2.2_I2V_LIGHTNING`, revision
`261ceaab8aeeb2493bf0b7304a51c190c1e91073`, and `size="large"`. This is a
community merge, not proof of the official Wan weights or a successful inference.
The LoRA list is empty. Remaining reproducibility issues include startup
`pip install --upgrade --no-deps spaces`, unpinned dependencies, and two
`spaces.aoti_load` calls to `cbensimon/WanTransformer3DModel-sm120-cu130-raa`
without an immutable revision in the call. Source SHA alone therefore does not
establish a stable runtime. The application still requires matching source and
runtime SHAs, declared `slop_model` identity and an approved endpoint schema.
The inspected prototype does not declare `slop_model`; the existing strict
application gate correctly refuses this producer rather than silently trusting it.

Next: replace/lock these runtime inputs and implement the identity contract in a
reviewable producer package, review the merge's license/provenance and validate
CPU contract checks before seeking a separately scoped free GPU test. The local
folder still contains no qualified, deployable producer; do not enable the game
or claim successful large-hardware operation based on this discovery.
