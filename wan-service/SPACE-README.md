---
title: Slop Urself Controlled Wan
emoji: 🎬
colorFrom: red
colorTo: pink
sdk: gradio
sdk_version: 6.31.0
python_version: '3.12'
app_file: app.py
---

Controlled official Wan2.2 TI2V5B producer. Default startup is CPU-only and
unready. It does not download weights or allocate a GPU automatically.

The reviewed deployment package fixes code, weights, scheduler, 50 steps,
121 frames at24fps, bounded dimensions and a120-second large ZeroGPU ceiling.
The ceiling is a hard timeout, **not a proven inference time or billing receipt**.
Requests require the caller's own HF identity and a signed moderated-input permit.
No owner inference token, alternate model, LoRA or paid hardware fallback.

An explicitly approved remote-only preparation uses WAN_PREPARATION_ONLY=yes,
WAN_PREPARE_PUBLIC_WEIGHTS=yes and WAN_ENABLE_MODEL_LOADING=yes. It checks the
designated SPACE_ID and free disk (34.2GB plus reserve), downloads only the fixed
public snapshot into this Space's ephemeral filesystem, verifies every hash and
initializes the native pipeline. ZeroGPU requires a registered GPU function at
startup; preparation keeps that private function disconnected from every API
and queue path and rejects generation before any invocation. Registration alone
does not request GPU allocation.
No model weights are downloaded onto the operator's computer. No storage bucket
or paid hardware is requested. Insufficient disk fails before the download.
GET /healthz reports initialization separately from generation availability.

Inference still requires qualified input/output moderation, confirmed personal
quota isolation, controlled runtime and separately scoped inference approval.
The game release gate remains independently blocked until acceptance; model
initialization is not a moderation, billing or inference qualification.

The clean public validation copy additionally requires exactly two fixed HF
subjects. Inference activation needs a canonical campaign UUID and an explicit
expiry no more than six hours away. Expiry hides readiness and rejects before
GPU allocation. Cold starts may prepare the same verified public snapshot only
inside that finite window; every GPU call still requires the exact input permit
and durable game admission. The ordinary game release remains blocked.

Before allocation the caller must retain the same Gradio LocalContext and a
non-error HF proxy token identifying the verified HF subject. Missing, foreign
or expired context is rejected rather than accepting the SDK's IP fallback.
GET /identity provides an authenticated read-only preflight without disclosing
the proxy token. This structural check is not signature attestation or proof of
actual per-account billing; the separately approved quota measurements remain
mandatory.
