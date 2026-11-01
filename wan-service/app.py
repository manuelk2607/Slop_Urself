"""Controlled Gradio/ZeroGPU adapter. Disabled until explicit model loading.

The public game remains blocked independently. No owner HF token is accepted.
CPU validation, personal HF identity and the signed moderated-input permit run
before the private @spaces.GPU function. Unknown jobs are never resubmitted.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import time
from contextlib import asynccontextmanager
from urllib.request import Request, urlopen
from urllib.parse import urlencode
from official import manifest, parameters, load_pipeline, infer
from producer import write_video
from jobs import JobLedger, validate_permit, media_capability, validate_media_capability


def hf_subject(authorization):
    if not isinstance(authorization,str) or not authorization.startswith('Bearer ') or len(authorization)>4096 or re.search(r'[\r\n]',authorization):
        raise ValueError('Personal HF authorization required')
    # No redirect can receive a personal credential. Never fall back to HF_TOKEN.
    import urllib.request
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            return None
    request = Request('https://huggingface.co/api/whoami-v2', headers={'Authorization':authorization})
    with urllib.request.build_opener(NoRedirect()).open(request,timeout=10) as response:
        body = response.read(65537)
    if len(body)>65536:
        raise ValueError('Invalid identity response')
    identity=json.loads(body)
    subject=identity.get('id') if isinstance(identity,dict) else None
    if not isinstance(subject,str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,128}',subject):
        raise ValueError('Invalid personal identity')
    return subject


def input_path(value, upload_root):
    if not isinstance(value,dict) or set(value)-{'path','orig_name','mime_type','meta'} or value.get('mime_type')!='image/png' or not isinstance(value.get('path'),str):
        raise ValueError('Uploaded PNG FileData required')
    raw=Path(value['path'])
    if raw.is_symlink():
        raise ValueError('Symlink input')
    root=Path(upload_root).resolve(); path=raw.resolve(strict=True)
    if root not in path.parents or not path.is_file() or path.stat().st_size>10*1024*1024:
        raise ValueError('Invalid upload path')
    return path


def claim_on_game(permit):
    # A second, durable one-shot fence survives a free Space rebuild (its local
    # SQLite/temporary disk is not assumed durable). No HF token leaves HF here.
    import urllib.request
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            return None
    request=Request('https://slopurself.maki26.workers.dev/api/producer/claim',
        method='POST',headers={'content-type':'application/json'},data=json.dumps({'permit':permit}).encode())
    with urllib.request.build_opener(NoRedirect()).open(request,timeout=10) as response:
        if response.status!=201 or response.read(4096)!=b'{"claimed":true}':
            raise ValueError('Durable producer claim was not acknowledged')


def build_app():
    import gradio as gr
    from fastapi import FastAPI, Request as HttpRequest, HTTPException
    from fastapi.responses import FileResponse, JSONResponse
    from PIL import Image
    if any(os.environ.get(k) for k in ('HF_TOKEN','HF_ACCESS_TOKEN')):
        raise ValueError('Remove operator HF tokens from the producer environment')
    secret=os.environ.get('WAN_PRODUCER_SECRET','')
    if len(secret)<32:
        raise ValueError('A dedicated producer secret is required')
    lock=manifest()
    upload_root=Path(os.environ.get('GRADIO_TEMP_DIR','/tmp/slop-wan/uploads'))
    os.environ['GRADIO_TEMP_DIR']=str(upload_root)
    output_root=Path(os.environ.get('WAN_OUTPUT_DIR','/tmp/slop-wan/private'))
    output_root.mkdir(parents=True,exist_ok=True,mode=0o700)
    ledger=JobLedger(os.environ.get('WAN_JOB_DB','/tmp/slop-wan/jobs.sqlite'))
    gpu=None
    if os.environ.get('WAN_ENABLE_MODEL_LOADING')=='yes':
        if not re.fullmatch(r'[a-z0-9-]+\.hf\.space',os.environ.get('SPACE_HOST','')):
            raise ValueError('Expected explicit HF Space host before model loading')
        import spaces
        pipe=load_pipeline(os.environ.get('WAN_MODEL_DIRECTORY','models/official'))
        @spaces.GPU(duration=120,size='large')
        def allocate(image,prompt,seed,steps,duration_seconds):
            return infer(pipe,image,prompt,seed,steps,duration_seconds)
        gpu=allocate
    # Typed request must be injected by Gradio rather than becoming an API input.
    def generate_video(input_image: dict, prompt: str, seed: int, steps: int, duration_seconds: float, permit: str, request: gr.Request):
        if gpu is None:
            raise gr.Error('Producer not ready; no GPU request started')
        path=None;consumed=False
        try:
            subject=hf_subject(request.headers.get('authorization'))
            path=input_path(input_image,upload_root)
            data=path.read_bytes()
            if data[:8]!=b'\x89PNG\r\n\x1a\n':
                raise ValueError('Expected PNG signature')
            Image.MAX_IMAGE_PIXELS=832*832
            with Image.open(path) as decoded:
                if decoded.format!='PNG' or getattr(decoded,'n_frames',1)!=1:
                    raise ValueError('Expected one decoded PNG')
                parameters(prompt,*decoded.size,seed,steps,duration_seconds)
                decoded.load(); image=decoded.convert('RGB')
            job_id=validate_permit(permit,secret,subject,hashlib.sha256(data).hexdigest(),prompt,seed)
            ledger.prune(output_root);ledger.reserve(job_id,subject)
            consumed=True
            claim_on_game(permit)
        except Exception:
            raise gr.Error('Producer authorization or input validation failed; no GPU request started') from None
        finally:
            if consumed and path is not None:
                path.unlink(missing_ok=True)
        try:
            frames=gpu(image,prompt,seed,steps,duration_seconds)
            video=output_root/(job_id+'.mp4')
            write_video(frames,video,expected_frames=121,fps=24)
            if video.stat().st_size>15*1024*1024:
                video.unlink(missing_ok=True);raise ValueError('Oversized output')
            ledger.complete(job_id,subject,video)
            host=os.environ.get('SPACE_HOST','')
            if not re.fullmatch(r'[a-z0-9-]+\.hf\.space',host):
                raise ValueError('Expected explicit HF Space host')
            expires=int(time.time())+600
            query=urlencode({'expires':expires,'access':media_capability(job_id,expires,secret)})
            return {'url':f'https://{host}/private-videos/{job_id}.mp4?{query}'}
        except Exception:
            # The durable reserved fence remains even on timeout/lost result.
            raise gr.Error('Video request failed or status unknown; do not submit it again') from None
    with gr.Blocks() as demo:
        gr.Markdown('Controlled Wan producer. The game provides moderation, personal authorization and signed requests.')
        fields=[gr.JSON(label='Uploaded image'),gr.Textbox(label='Exact moderated prompt'),gr.Number(value=1,precision=0,label='Seed'),
            gr.Number(value=50,precision=0,label='Steps'),gr.Number(value=5,label='Seconds'),gr.Textbox(label='Signed permit')]
        gr.Button('Generate authorized request').click(generate_video,inputs=fields,outputs=gr.JSON(),api_name='generate_video',concurrency_limit=1)
    if gpu is not None:
        demo.config['slop_model']={'id':lock['id'],'revision':lock['revision']}
    demo.queue(max_size=4,default_concurrency_limit=1)
    @asynccontextmanager
    async def lifespan(_app):
        try:
            yield
        finally:
            ledger.close()
    app=FastAPI(lifespan=lifespan)
    @app.get('/config')
    def pinned_config():
        # Gradio rebuilds its config during queue/mount setup. Inject the
        # verified identity at response time, never from an unverified env var.
        config=dict(demo.config)
        config.pop('slop_model',None)
        if gpu is not None:
            config['slop_model']={'id':lock['id'],'revision':lock['revision']}
        return JSONResponse(config,headers={'cache-control':'no-store'})
    @app.middleware('http')
    async def private_boundary(request: HttpRequest,call_next):
        from starlette.concurrency import run_in_threadpool
        path=request.url.path
        if '/file=' in path or path.startswith('/file/') or '/stream/' in path:
            return JSONResponse({'error':'not_found'},status_code=404)
        if path.endswith('/upload') or path.endswith('/queue/join'):
            try:
                await run_in_threadpool(hf_subject,request.headers.get('authorization'))
                if request.headers.get('content-length') and int(request.headers['content-length'])>11*1024*1024:
                    raise ValueError('Oversized upload')
                if path.endswith('/queue/join'):
                    parts=[];size=0
                    async for chunk in request.stream():
                        size+=len(chunk)
                        if size>32768:raise ValueError('Oversized queue request')
                        parts.append(chunk)
                    request._body=b''.join(parts)
                    payload=json.loads(request._body)
                    data=payload.get('data') if isinstance(payload,dict) else None
                    if not isinstance(data,list) or len(data)!=6:raise ValueError('Invalid queue payload')
                    input_path(data[0],upload_root)
            except Exception:
                return JSONResponse({'error':'unauthorized'},status_code=401)
        if request.method=='POST' and any(marker in path for marker in ('/call/','/run/','/api/')):
            return JSONResponse({'error':'not_found'},status_code=404)
        return await call_next(request)
    @app.get('/private-videos/{job_id}.mp4')
    def private_video(job_id:str,expires:int=0,access:str=''):
        if not validate_media_capability(job_id,expires,access,secret):
            raise HTTPException(status_code=404)
        ledger.prune(output_root)
        path=ledger.completed_file(job_id)
        if path is None or path.is_symlink() or path.parent.resolve()!=output_root.resolve() or not path.is_file():
            raise HTTPException(status_code=404)
        return FileResponse(path,media_type='video/mp4',headers={'cache-control':'no-store','x-content-type-options':'nosniff'})
    return gr.mount_gradio_app(app,demo,path='/',max_file_size='10mb',blocked_paths=[str(output_root)]),gpu is not None


if __name__=='__main__':
    import uvicorn
    app,ready=build_app()
    print(json.dumps({'event':'producer_start','modelReady':ready,'gpuCalls':0}))
    # Signed download URLs and request credentials must never enter access logs.
    uvicorn.run(app,host='0.0.0.0',port=int(os.environ.get('PORT','7860')),access_log=False)
