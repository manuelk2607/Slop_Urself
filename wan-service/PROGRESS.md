# Controlled Wan producer preparation

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
