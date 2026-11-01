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

Requirements before enabling model loading: actual verified local snapshot,
ZeroGPU eligibility, separate WAN_PRODUCER_SECRET, confirmed free hosting,
qualified input/output moderation, and separately scoped inference approval.
The game release gate remains independent and blocked until acceptance.
