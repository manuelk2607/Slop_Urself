import base64
import copy
import hashlib
import hmac
import json
import os
from pathlib import Path
import tempfile
import time
import unittest
import uuid
from unittest.mock import patch
import official
from jobs import JobLedger, validate_permit, media_capability, validate_media_capability
from app import input_path, hf_subject

SECRET='cpu-test-producer-key-not-for-production-1234'


def permit(**overrides):
    body={'id':str(uuid.uuid4()),'modelId':official.MODEL_ID,'modelRevision':official.MODEL_REVISION,
        'subject':'account-a','imageSha256':'a'*64,'promptSha256':hashlib.sha256(b'The ball bounces.').hexdigest(),
        'seed':12,'steps':50,'expiresAt':int(time.time())+120,**overrides}
    payload=base64.urlsafe_b64encode(json.dumps(body).encode()).decode().rstrip('=')
    return payload+'.'+hmac.new(SECRET.encode(),payload.encode(),hashlib.sha256).hexdigest(),body


class OfficialTests(unittest.TestCase):
    def test_official_manifest_has_license_exact_recipe_and_complete_artifacts(self):
        lock=official.manifest()
        self.assertEqual(sum(f['bytes'] for f in lock['files']),34201418400)
        self.assertEqual(lock['declaredLicense'],'apache-2.0')
        for change in [lambda d:d.update(steps=4),lambda d:d.update(revision='main'),lambda d:d['files'][0].update(path='../escape.json'),lambda d:d['files'].append(d['files'][0])]:
            bad=copy.deepcopy(lock);change(bad)
            with tempfile.TemporaryDirectory() as directory:
                path=Path(directory)/'lock.json';path.write_text(json.dumps(bad))
                with self.assertRaises(ValueError):official.manifest(path)

    def test_official_profile_is_not_silently_four_steps_or_shorter_video(self):
        args=official.parameters('The ball bounces.',640,640,12)
        self.assertEqual((args['num_frames'],args['num_inference_steps']),(121,50))
        for steps,duration in [(4,5),(8,5),(50,2),(True,5)]:
            with self.assertRaises(ValueError):official.parameters('The ball bounces.',640,640,12,steps,duration)
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(ValueError):official.load_pipeline(directory)
        with patch.dict(os.environ,{'MODEL_ID':'unreviewed/model'}):
            with self.assertRaises(ValueError):official.load_pipeline('.')

    def test_unlisted_canonical_weights_cannot_override_the_locked_shard_index(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);(root/'transformer').mkdir();(root/'scheduler').mkdir()
            index={'_class_name':'WanPipeline','expand_timesteps':True,'boundary_ratio':None,
                'scheduler':['diffusers','UniPCMultistepScheduler'],'text_encoder':['transformers','UMT5EncoderModel'],
                'tokenizer':['transformers','T5TokenizerFast'],'transformer':['diffusers','WanTransformer3DModel'],
                'transformer_2':[None,None],'vae':['diffusers','AutoencoderKLWan']}
            contents={'model_index.json':json.dumps(index),'scheduler/scheduler_config.json':json.dumps({'_class_name':'UniPCMultistepScheduler','flow_shift':5}),
                'transformer/shard.safetensors':'cpu fixture, not actual weights'}
            lock={'files':[]}
            for name,text in contents.items():
                (root/name).write_text(text);lock['files'].append({'path':name,'bytes':len(text.encode()),'sha256':hashlib.sha256(text.encode()).hexdigest()})
            self.assertEqual(official.verify_directory(root,lock),root.resolve())
            (root/'transformer/diffusion_pytorch_model.safetensors').write_text('unreviewed canonical override')
            with self.assertRaises(ValueError):official.verify_directory(root,lock)

    def test_permit_binds_subject_image_exact_prompt_seed_model_time_and_signature(self):
        token,body=permit()
        self.assertEqual(validate_permit(token,SECRET,'account-a','a'*64,'The ball bounces.',12),body['id'])
        for subject,digest,prompt,seed in [('account-b','a'*64,'The ball bounces.',12),('account-a','b'*64,'The ball bounces.',12),('account-a','a'*64,'Different action.',12),('account-a','a'*64,'The ball bounces.',13)]:
            with self.assertRaises(ValueError):validate_permit(token,SECRET,subject,digest,prompt,seed)
        for value in [token+'x',permit(expiresAt=int(time.time())-1)[0],permit(expiresAt=int(time.time())+900)[0],permit(modelRevision='b'*40)[0]]:
            with self.assertRaises(ValueError):validate_permit(value,SECRET,'account-a','a'*64,'The ball bounces.',12)

    def test_durable_one_shot_fence_survives_uncertain_result_reopen_and_other_account(self):
        with tempfile.TemporaryDirectory() as directory:
            path=str(Path(directory)/'jobs.sqlite');job=str(uuid.uuid4())
            a=JobLedger(path);a.reserve(job,'account-a');a.close();b=JobLedger(path)
            with self.assertRaises(ValueError):b.reserve(job,'account-a')
            with self.assertRaises(ValueError):b.reserve(job,'account-b')
            with self.assertRaises(ValueError):b.complete(job,'account-b','foreign.mp4')
            b.complete(job,'account-a',Path(directory)/(job+'.mp4'))
            self.assertTrue(b.owns_file(Path(directory)/(job+'.mp4'),'account-a'))
            self.assertFalse(b.owns_file(Path(directory)/(job+'.mp4'),'account-b'))
            b.close()

    def test_private_media_capability_expires_and_cannot_select_a_different_job(self):
        job=str(uuid.uuid4());expires=int(time.time())+600;sig=media_capability(job,expires,SECRET)
        self.assertTrue(validate_media_capability(job,expires,sig,SECRET))
        self.assertFalse(validate_media_capability(str(uuid.uuid4()),expires,sig,SECRET))
        self.assertFalse(validate_media_capability(job,expires,sig,SECRET,now=expires+1))
        self.assertFalse(validate_media_capability('../escape',expires,sig,SECRET))

    def test_upload_boundary_prevents_remote_urls_external_files_and_deletion_targets(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)/'uploads';root.mkdir();path=root/'image.png';path.write_bytes(b'fixture')
            value={'path':str(path),'mime_type':'image/png'};self.assertEqual(input_path(value,root),path.resolve())
            for v in [{**value,'url':'http://internal/private'},{'path':str(root.parent/'private'),'mime_type':'image/png'}, {**value,'mime_type':'video/mp4'}]:
                with self.assertRaises((ValueError,FileNotFoundError)):input_path(v,root)
            self.assertTrue(path.exists())
            path.unlink();path.symlink_to(root.parent/'outside')
            with self.assertRaises(ValueError):input_path(value,root)
        for token in [None,'','hf_secret','Bearer a\r\nb']:
            with self.assertRaises(ValueError):hf_subject(token)


if __name__=='__main__':unittest.main()
