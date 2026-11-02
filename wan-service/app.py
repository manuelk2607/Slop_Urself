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
from jobs import JobLedger, validate_permit, media_capability, validate_media_capability, validation_window, validate_proxy_token, proxy_user_format

PUBLIC_VALIDATION_SPACE='Manuel2607/SlopUrself-Wan22-Validated'
CONTROLLED_SPACES={'Manuel2607/SlopUrself-Wan22-GPU-Test',PUBLIC_VALIDATION_SPACE}


def personal_authorization(request):
    # HF's edge authenticates the normal header. A separate, explicitly named
    # application header lets the controlled app verify the same credential if
    # the edge consumes Authorization. Neither identity nor quota is inferred
    # from this header: whoami and the proxy-subject check remain mandatory.
    values=[request.headers.get(key) for key in ('authorization','x-slop-hf-authorization')]
    present=[value for value in values if value is not None]
    if not present or len(set(present))!=1 or not present[0].startswith('Bearer ') or len(present[0])>4096 or re.search(r'[\r\n]',present[0]):
        raise ValueError('Missing or conflicting personal authorization')
    return present[0]


def validation_subjects():
    enabled=os.environ.get('WAN_VALIDATION_ONLY')=='yes'
    if os.environ.get('SPACE_ID')==PUBLIC_VALIDATION_SPACE and not enabled:
        raise ValueError('The public validation copy requires an explicit two-account restriction')
    if not enabled:return frozenset()
    subjects=os.environ.get('WAN_VALIDATION_SUBJECTS','').split(',')
    if len(subjects)!=2 or len(set(subjects))!=2 or any(not re.fullmatch(r'[A-Za-z0-9_-]{1,128}',s) for s in subjects):
        raise ValueError('Exactly two fixed validation subjects are required')
    return frozenset(subjects)


def hf_subject(authorization,*,include_username=False):
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
    allowed=validation_subjects()
    if allowed and subject not in allowed:raise ValueError('This HF account is not part of the approved validation')
    if os.environ.get('SPACE_ID')==PUBLIC_VALIDATION_SPACE and os.environ.get('WAN_PREPARATION_ONLY')!='yes' and not validation_window():
        raise ValueError('The bounded validation window is not active')
    if include_username:
        name=identity.get('name')
        if not isinstance(name,str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,128}',name):
            raise ValueError('Canonical personal HF name unavailable')
        return {'id':subject,'name':name}
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


class ProxyBindingError(ValueError):
    pass


def verified_proxy_payload(request,subject):
    token=request.headers.get('x-ip-token')
    payload=validate_proxy_token(token)
    try:
        validate_proxy_token(token,subject=subject)
        return payload,'subject-id'
    except ValueError:
        if not isinstance(payload.get('user'),str):raise ProxyBindingError('actor_schema_unknown') from None
        try:identity=hf_subject(personal_authorization(request),include_username=True)
        except Exception:raise ProxyBindingError('identity_lookup_unavailable') from None
        if not isinstance(identity,dict) or identity.get('id')!=subject:
            raise ProxyBindingError('identity_changed')
        try:validate_proxy_token(token,subject=subject,verified_username=identity['name'])
        except ValueError:raise ProxyBindingError('actor_mismatch') from None
        return payload,'canonical-name'


def require_personal_gpu_context(request,subject):
    # The pinned spaces SDK reads LocalContext.request, including when the GPU
    # function is nested. An injected request alone must not hide a lost context.
    from gradio.context import LocalContext
    actual=LocalContext.request.get(None)
    if actual is None or personal_authorization(actual)!=personal_authorization(request) or actual.headers.get('x-ip-token')!=request.headers.get('x-ip-token'):
        raise ValueError('Personal Gradio context missing or changed; no GPU request')
    verified_proxy_payload(actual,subject)


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


def initialize_space_runtime(gr):
    # The pinned spaces SDK runs CUDA packing/startup_report through its public
    # Gradio launch hook. Mounting FastAPI alone does not run that hook. A short
    # loopback-only, empty Gradio app performs SDK initialization, then closes;
    # it exposes no generation function and never requests GPU allocation.
    if os.environ.get('SPACE_ID') not in CONTROLLED_SPACES:return
    import socket
    with socket.socket() as reservation:
        reservation.bind(('127.0.0.1',0));port=reservation.getsockname()[1]
    with gr.Blocks(analytics_enabled=False) as handshake:
        gr.Markdown('Controlled runtime initialization; no generation endpoint.')
    try:
        handshake.launch(server_name='127.0.0.1',server_port=port,share=False,
            prevent_thread_lock=True,ssr_mode=False,quiet=True,show_error=False)
    finally:
        handshake.close()
    print(json.dumps({'event':'native_runtime_registered','gpuCalls':0}),flush=True)


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
    validation_subjects()
    lock=manifest()
    upload_root=Path(os.environ.get('GRADIO_TEMP_DIR','/tmp/slop-wan/uploads'))
    os.environ['GRADIO_TEMP_DIR']=str(upload_root)
    output_root=Path(os.environ.get('WAN_OUTPUT_DIR','/tmp/slop-wan/private'))
    output_root.mkdir(parents=True,exist_ok=True,mode=0o700)
    ledger=JobLedger(os.environ.get('WAN_JOB_DB','/tmp/slop-wan/jobs.sqlite'))
    gpu=None;registered_gpu=None;model_loaded=False
    preparation_only=os.environ.get('WAN_PREPARATION_ONLY')=='yes'
    if os.environ.get('SPACE_ID')==PUBLIC_VALIDATION_SPACE and not preparation_only and not validation_window():
        raise ValueError('A finite approved validation window is required before activation')
    if os.environ.get('WAN_ENABLE_MODEL_LOADING')=='yes':
        if not re.fullmatch(r'[a-z0-9-]+\.hf\.space',os.environ.get('SPACE_HOST','')):
            raise ValueError('Expected explicit HF Space host before model loading')
        import spaces
        directory=os.environ.get('WAN_MODEL_DIRECTORY','models/official')
        if os.environ.get('WAN_PREPARE_PUBLIC_WEIGHTS')=='yes':
            from prepare_official import prepare_on_space
            prepare_on_space(directory)
        print(json.dumps({'event':'native_model_initializing','revision':lock['revision'],'gpuCalls':0}),flush=True)
        pipe=load_pipeline(directory);model_loaded=True
        print(json.dumps({'event':'native_model_initialized','revision':lock['revision'],
            'preparationOnly':preparation_only,'gpuCalls':0}),flush=True)
        # ZeroGPU rejects startup without a registered GPU function. Definition
        # alone allocates nothing. Preparation never routes a request to it.
        @spaces.GPU(duration=120,size='large')
        def allocate(image,prompt,seed,steps,duration_seconds):
            return infer(pipe,image,prompt,seed,steps,duration_seconds)
        registered_gpu=allocate
        if not preparation_only:gpu=allocate
    def generation_available():
        return gpu is not None and (os.environ.get('SPACE_ID')!=PUBLIC_VALIDATION_SPACE or validation_window())
    # Typed request must be injected by Gradio rather than becoming an API input.
    def generate_video(input_image: dict, prompt: str, seed: int, steps: int, duration_seconds: float, permit: str, request: gr.Request):
        if preparation_only or not generation_available():
            raise gr.Error('Producer not ready; no GPU request started')
        path=None;consumed=False
        try:
            subject=hf_subject(personal_authorization(request))
            require_personal_gpu_context(request,subject)
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
            if os.environ.get('SPACE_ID')==PUBLIC_VALIDATION_SPACE and not validation_window():raise ValueError('Validation window expired before allocation')
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
    # Retain initialized tensors on the controlled host even while the private
    # function is disconnected from every preparation-mode API/queue path.
    app.state._controlled_gpu_function=registered_gpu
    @app.get('/healthz')
    def health():
        return JSONResponse({'modelLoaded':model_loaded,'preparationOnly':preparation_only,
            'generationAvailable':generation_available(),'revision':lock['revision'] if model_loaded else None},
            headers={'cache-control':'no-store'})
    @app.get('/identity')
    def identity_probe(request: HttpRequest):
        # Free, read-only preflight. No proxy JWT, claims or credentials leave
        # this host. Presence/binding is not an external billing receipt.
        received={'authorizationReceived':bool(request.headers.get('authorization')),
            'applicationAuthorizationReceived':bool(request.headers.get('x-slop-hf-authorization')),
            'proxyTokenReceived':bool(request.headers.get('x-ip-token'))}
        stage='personal_authorization_unavailable'
        try:
            authorization=personal_authorization(request)
            stage='personal_identity_unavailable'
            subject=hf_subject(authorization)
            stage='personal_proxy_context_unavailable'
            payload=validate_proxy_token(request.headers.get('x-ip-token'))
            failure=None
            try:_,binding=verified_proxy_payload(request,subject);bound=True
            except ProxyBindingError as error:bound=False;binding='unverified';failure=str(error)
            except Exception:bound=False;binding='unverified';failure='context_unavailable'
            keys=[k for k in payload if re.fullmatch(r'[A-Za-z0-9_]{1,64}',k)][:20]
            user=payload.get('user')
            print(json.dumps({'event':'identity_preflight','proxySubjectMatches':bound,'proxyClaimKeys':keys,
                'proxyUserScalarMatchesSubject':isinstance(user,str) and user==subject,
                'proxyUserType':'string' if isinstance(user,str) else 'object' if isinstance(user,dict) else 'other',
                'proxyBinding':binding,
                'proxyUserFormat':proxy_user_format(payload),'proxyBindingFailure':failure,
                **received,'gpuCalls':0}),flush=True)
            return JSONResponse({'personalIdentityVerified':True,'proxySubjectMatches':bound,'proxyClaimKeys':keys,
                'proxyUserFormat':proxy_user_format(payload),'proxyBindingFailure':failure,
                'billingVerified':False,'gpuCalls':0},headers={'cache-control':'no-store'})
        except Exception:
            print(json.dumps({'event':'identity_preflight_rejected','code':stage,**received,'gpuCalls':0}),flush=True)
            return JSONResponse({'error':stage,'gpuCalls':0},status_code=403,headers={'cache-control':'no-store'})
    @app.get('/config')
    def pinned_config():
        # Gradio rebuilds its config during queue/mount setup. Inject the
        # verified identity at response time, never from an unverified env var.
        config=dict(demo.config)
        config.pop('slop_model',None)
        if generation_available():
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
                await run_in_threadpool(hf_subject,personal_authorization(request))
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
    if model_loaded:initialize_space_runtime(gr)
    app.state._controlled_gradio=demo
    # Gradio's Space-default SSR Node server otherwise takes port7860 before
    # our protected ASGI server. This is an API producer, not the public site.
    return gr.mount_gradio_app(app,demo,path='/',max_file_size='10mb',blocked_paths=[str(output_root)],
        ssr_mode=False,mcp_server=False,run_history=False),gpu is not None


if __name__=='__main__':
    import uvicorn
    app,ready=build_app()
    print(json.dumps({'event':'producer_start','modelReady':ready,'gpuCalls':0}))
    # Signed download URLs and request credentials must never enter access logs.
    server=uvicorn.Server(uvicorn.Config(app,host='0.0.0.0',port=int(os.environ.get('PORT','7860')),access_log=False))
    # The pinned spaces SDK reads blocks.server.config.port when isolating the
    # queue's HTTP descriptors. Preserve that contract for the mounted app.
    app.state._controlled_gradio.server=server
    server.run()
