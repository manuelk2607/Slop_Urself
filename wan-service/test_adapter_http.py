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
    def test_disabled_http_adapter_has_schema_but_never_advertises_a_loaded_model(self):
        import app
        from fastapi.testclient import TestClient
        with tempfile.TemporaryDirectory() as root,patch.dict(os.environ,{'WAN_PRODUCER_SECRET':SECRET,'WAN_OUTPUT_DIR':root+'/private','WAN_JOB_DB':root+'/jobs.sqlite','GRADIO_TEMP_DIR':root+'/uploads','WAN_ENABLE_MODEL_LOADING':'no','GRADIO_ANALYTICS_ENABLED':'False'}):
            api,ready=app.build_app()
            with TestClient(api) as client:
                self.assertFalse(ready);self.assertNotIn('slop_model',client.get('/config').json())
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
            result=function(*args,token,gr.Request(headers={'authorization':'Bearer fixture'}))
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
