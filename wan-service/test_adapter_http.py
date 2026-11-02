"""Real Gradio/FastAPI HTTP contract; all identity/model/GPU calls are fixtures."""
import hashlib
import importlib.util
import os
from pathlib import Path
import sys
import tempfile
import time
import types
import unittest
from unittest.mock import patch
from test_official import SECRET,permit

AVAILABLE=importlib.util.find_spec('gradio') is not None


@unittest.skipUnless(AVAILABLE,'Install the pinned adapter CPU test dependencies; no models are required')
class AdapterTests(unittest.TestCase):
    def test_read_only_identity_diagnostics_and_application_header_do_not_weaken_proxy_binding(self):
        import app,base64,json,io
        from contextlib import redirect_stdout
        from fastapi.testclient import TestClient
        import gradio as gr
        from gradio.context import LocalContext
        def proxy(subject):return 'e30.'+base64.urlsafe_b64encode(json.dumps({'exp':int(time.time())+600,'sub':subject}).encode()).decode().rstrip('=')+'.Zml4dHVyZQ'
        with tempfile.TemporaryDirectory() as root,patch.dict(os.environ,{'WAN_PRODUCER_SECRET':SECRET,'WAN_OUTPUT_DIR':root+'/private','WAN_JOB_DB':root+'/jobs.sqlite','GRADIO_TEMP_DIR':root+'/uploads','WAN_ENABLE_MODEL_LOADING':'no','GRADIO_ANALYTICS_ENABLED':'False'}),patch.object(app,'hf_subject',return_value='account-a') as identity,patch.object(app,'infer') as infer:
            api,_=app.build_app();logs=io.StringIO()
            with TestClient(api) as client,redirect_stdout(logs):
                self.assertEqual(client.get('/identity').json()['error'],'personal_authorization_unavailable')
                identity.assert_not_called()
                headers={'x-slop-hf-authorization':'Bearer private-fixture-never-log','x-ip-token':proxy('account-a')}
                result=client.get('/identity',headers=headers)
                self.assertEqual(result.status_code,200);self.assertTrue(result.json()['proxySubjectMatches'])
                self.assertFalse(result.json()['billingVerified']);self.assertEqual(result.json()['gpuCalls'],0)
                identity.assert_called_with('Bearer private-fixture-never-log')
                self.assertEqual(client.get('/identity',headers={**headers,'authorization':'Bearer other-fixture'}).status_code,403)
                self.assertEqual(client.get('/identity',headers={'x-slop-hf-authorization':headers['x-slop-hf-authorization']}).json()['error'],'personal_proxy_context_unavailable')
                self.assertFalse(client.get('/identity',headers={**headers,'x-ip-token':proxy('account-b')}).json()['proxySubjectMatches'])
                infer.assert_not_called()
            self.assertNotIn('private-fixture-never-log',logs.getvalue());self.assertNotIn(headers['x-ip-token'],logs.getvalue())
            request=gr.Request(headers=headers);context=LocalContext.request.set(request)
            try:
                app.require_personal_gpu_context(request,'account-a')
                with self.assertRaises(ValueError):app.require_personal_gpu_context(request,'account-b')
                with self.assertRaises(ValueError):app.require_personal_gpu_context(gr.Request(headers={**headers,'x-slop-hf-authorization':'Bearer other-fixture'}),'account-a')
            finally:LocalContext.request.reset(context)

    def test_space_startup_uses_public_loopback_sdk_hook_without_a_generation_endpoint(self):
        import app
        import gradio as gr
        with patch.dict(os.environ,{'SPACE_ID':'Manuel2607/SlopUrself-Wan22-GPU-Test'}),patch.object(gr.Blocks,'launch') as launch,patch.object(gr.Blocks,'close') as close:
            app.initialize_space_runtime(gr)
            launch.assert_called_once();close.assert_called_once()
            settings=launch.call_args.kwargs
            self.assertEqual(settings['server_name'],'127.0.0.1');self.assertGreater(settings['server_port'],0)
            self.assertFalse(settings['share']);self.assertFalse(settings['ssr_mode'])
            self.assertTrue(settings['prevent_thread_lock'])
        with patch.dict(os.environ,{'SPACE_ID':''}),patch.object(gr.Blocks,'launch') as launch:
            app.initialize_space_runtime(gr);launch.assert_not_called()

    def test_preparation_registers_for_zerogpu_startup_but_never_routes_or_calls_gpu(self):
        import app
        import prepare_official
        import gradio as gr
        from fastapi.testclient import TestClient
        registrations=[]
        def register(**kwargs):
            registrations.append(kwargs)
            return lambda fn:lambda *args,**kw:self.fail('Preparation must never call the registered GPU function')
        spaces=types.SimpleNamespace(GPU=register)
        with tempfile.TemporaryDirectory() as root,patch.dict(os.environ,{'WAN_PRODUCER_SECRET':SECRET,'WAN_OUTPUT_DIR':root+'/private','WAN_JOB_DB':root+'/jobs.sqlite','GRADIO_TEMP_DIR':root+'/uploads','WAN_ENABLE_MODEL_LOADING':'yes','WAN_PREPARE_PUBLIC_WEIGHTS':'yes','WAN_PREPARATION_ONLY':'yes','SPACE_HOST':'fixture.hf.space','GRADIO_ANALYTICS_ENABLED':'False'}),patch.dict(sys.modules,{'spaces':spaces}),patch.object(app,'load_pipeline',return_value=object()) as load,patch.object(prepare_official,'prepare_on_space') as prepare:
            api,ready=app.build_app();self.assertFalse(ready)
            self.assertEqual(registrations,[{'duration':120,'size':'large'}])
            prepare.assert_called_once();load.assert_called_once()
            mounted=next(route.app for route in api.routes if hasattr(route,'app') and hasattr(route.app,'get_blocks'))
            function=next(f.fn for f in mounted.get_blocks().fns.values() if f.api_name=='generate_video')
            with self.assertRaises(gr.Error):function({},'The ball bounces.',1,50,5,'invalid',gr.Request())
            with TestClient(api) as client:
                health=client.get('/healthz').json()
                self.assertTrue(health['modelLoaded']);self.assertTrue(health['preparationOnly'])
                self.assertFalse(health['generationAvailable']);self.assertNotIn('slop_model',client.get('/config').json())

    def test_expired_public_window_hides_readiness_and_rejects_before_identity_or_gpu(self):
        import app,uuid
        import gradio as gr
        from fastapi.testclient import TestClient
        spaces=types.SimpleNamespace(GPU=lambda **kwargs:lambda fn:fn)
        with tempfile.TemporaryDirectory() as root,patch.dict(os.environ,{'SPACE_ID':app.PUBLIC_VALIDATION_SPACE,'WAN_VALIDATION_ONLY':'yes',
            'WAN_VALIDATION_SUBJECTS':'account-a,account-b','WAN_VALIDATION_CAMPAIGN_ID':str(uuid.uuid4()),
            'WAN_VALIDATION_EXPIRES_AT':str(int(time.time())+600),'WAN_PREPARATION_ONLY':'no','WAN_PRODUCER_SECRET':SECRET,
            'WAN_OUTPUT_DIR':root+'/private','WAN_JOB_DB':root+'/jobs.sqlite','GRADIO_TEMP_DIR':root+'/uploads',
            'WAN_ENABLE_MODEL_LOADING':'yes','SPACE_HOST':'fixture.hf.space','GRADIO_ANALYTICS_ENABLED':'False'}),patch.dict(sys.modules,{'spaces':spaces}),patch.object(app,'load_pipeline',return_value=object()),patch.object(app,'infer') as infer,patch.object(app,'hf_subject') as identity:
            api,ready=app.build_app();self.assertTrue(ready)
            mounted=next(route.app for route in api.routes if hasattr(route,'app') and hasattr(route.app,'get_blocks'))
            function=next(f.fn for f in mounted.get_blocks().fns.values() if f.api_name=='generate_video')
            with TestClient(api) as client:
                self.assertTrue(client.get('/healthz').json()['generationAvailable'])
                with patch.dict(os.environ,{'WAN_VALIDATION_EXPIRES_AT':'1'}):
                    self.assertFalse(client.get('/healthz').json()['generationAvailable'])
                    self.assertNotIn('slop_model',client.get('/config').json())
                    with self.assertRaises(gr.Error):function({},'The ball bounces.',1,50,5,'invalid',gr.Request())
                    infer.assert_not_called();identity.assert_not_called()

    def test_disabled_http_adapter_has_schema_but_never_advertises_a_loaded_model(self):
        import app
        from fastapi.testclient import TestClient
        with tempfile.TemporaryDirectory() as root,patch.dict(os.environ,{'WAN_PRODUCER_SECRET':SECRET,'WAN_OUTPUT_DIR':root+'/private','WAN_JOB_DB':root+'/jobs.sqlite','GRADIO_TEMP_DIR':root+'/uploads','WAN_ENABLE_MODEL_LOADING':'no','GRADIO_ANALYTICS_ENABLED':'False'}):
            api,ready=app.build_app()
            with TestClient(api) as client:
                self.assertFalse(ready);self.assertNotIn('slop_model',client.get('/config').json())
                mounted=next(route.app for route in api.routes if hasattr(route,'app') and hasattr(route.app,'get_blocks'))
                self.assertFalse(mounted.get_blocks().ssr_mode)
                info=client.get('/gradio_api/info').json()['named_endpoints']['/generate_video']['parameters']
                self.assertEqual([p['parameter_name'] for p in info],['input_image','prompt','seed','steps','duration_seconds','permit'])
                self.assertEqual(client.get('/gradio_api/file=/etc/passwd').status_code,404)
                self.assertEqual(client.post('/gradio_api/call/generate_video',json={}).status_code,404)
                self.assertEqual(client.post('/gradio_api/upload',files={'files':('a.png',b'fixture','image/png')}).status_code,401)

    def test_real_http_private_media_range_and_durable_replay_fence_with_synthetic_encoder(self):
        import app
        import gradio as gr
        from fastapi.testclient import TestClient
        from PIL import Image
        from jobs import media_capability
        calls=[]
        def fake_infer(*args):
            calls.append('fixture-inference');return [Image.new('RGB',(640,640),'yellow')]*121
        spaces=types.SimpleNamespace(GPU=lambda **kwargs:lambda fn:fn)
        with tempfile.TemporaryDirectory() as root,patch.dict(os.environ,{'WAN_PRODUCER_SECRET':SECRET,'WAN_OUTPUT_DIR':root+'/private','WAN_JOB_DB':root+'/jobs.sqlite','GRADIO_TEMP_DIR':root+'/uploads','WAN_ENABLE_MODEL_LOADING':'yes','SPACE_HOST':'fixture.hf.space','GRADIO_ANALYTICS_ENABLED':'False'}),patch.dict(sys.modules,{'spaces':spaces}),patch.object(app,'load_pipeline',return_value=object()),patch.object(app,'infer',side_effect=fake_infer),patch.object(app,'hf_subject',return_value='account-a'),patch.object(app,'claim_on_game') as claim:
            upload=Path(root)/'uploads';upload.mkdir();image=upload/'image.png';Image.new('RGB',(640,640),'yellow').save(image)
            digest=hashlib.sha256(image.read_bytes()).hexdigest();token,body=permit(imageSha256=digest)
            api,ready=app.build_app()
            mounted=next(route.app for route in api.routes if hasattr(route,'app') and hasattr(route.app,'get_blocks'))
            function=next(f.fn for f in mounted.get_blocks().fns.values() if f.api_name=='generate_video')
            args=({'path':str(image),'mime_type':'image/png'},'The ball bounces.',12,50,5)
            with self.assertRaises(gr.Error):function(*args,'invalid',gr.Request(headers={'authorization':'Bearer fixture'}))
            self.assertTrue(image.exists());self.assertEqual(calls,[])
            from gradio.context import LocalContext
            import base64,json
            proxy='e30.'+base64.urlsafe_b64encode(json.dumps({'exp':int(time.time())+600,'sub':'account-a'}).encode()).decode().rstrip('=')+'.Zml4dHVyZQ'
            request=gr.Request(headers={'authorization':'Bearer fixture','x-ip-token':proxy})
            context=LocalContext.request.set(request)
            try:result=function(*args,token,request)
            finally:LocalContext.request.reset(context)
            self.assertEqual(calls,['fixture-inference']);self.assertFalse(image.exists())
            self.assertEqual(claim.call_count,1)
            Image.new('RGB',(640,640),'yellow').save(image)
            with self.assertRaises(gr.Error):function(*args,token,gr.Request(headers={'authorization':'Bearer fixture'}))
            self.assertEqual(calls,['fixture-inference'])
            from urllib.parse import urlsplit
            url=urlsplit(result['url'])
            with TestClient(api) as client:
                self.assertTrue(ready)
                self.assertEqual(client.get('/config').json()['slop_model']['revision'],app.manifest()['revision'])
                valid=client.get(url.path+'?'+url.query,headers={'range':'bytes=0-63'})
                self.assertEqual(valid.status_code,206);self.assertEqual(valid.content[4:8],b'ftyp')
                self.assertEqual(client.get(url.path).status_code,404)
                self.assertEqual(client.get(url.path+'?expires=1&access=invalid').status_code,404)
                self.assertEqual(valid.headers['cache-control'],'no-store')


if __name__=='__main__':unittest.main()
