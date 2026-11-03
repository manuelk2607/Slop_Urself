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
from jobs import validation_window
from jobs import validate_proxy_token, proxy_user_format, proxy_actor_relation
from app import input_path, hf_subject, validation_subjects, PUBLIC_VALIDATION_SPACE, personal_authorization

SECRET='cpu-test-producer-key-not-for-production-1234'


def permit(**overrides):
    body={'id':str(uuid.uuid4()),'modelId':official.MODEL_ID,'modelRevision':official.MODEL_REVISION,
        'subject':'account-a','imageSha256':'a'*64,'promptSha256':hashlib.sha256(b'The ball bounces.').hexdigest(),
        'seed':12,'steps':50,'expiresAt':int(time.time())+120,**overrides}
    payload=base64.urlsafe_b64encode(json.dumps(body).encode()).decode().rstrip('=')
    return payload+'.'+hmac.new(SECRET.encode(),payload.encode(),hashlib.sha256).hexdigest(),body


class OfficialTests(unittest.TestCase):
    def test_proxy_actor_relation_is_finite_and_does_not_authorize_prefixes_or_fuzzy_names(self):
        def token(user):return 'e30.'+base64.urlsafe_b64encode(json.dumps({'user':user}).encode()).decode().rstrip('=')+'.Zml4dHVyZQ'
        for value,relation in [('canonical-a','case-only-name'),('user:account-a','namespaced-subject'),
            ('user:Canonical-A','namespaced-name'),('owner:account-a','contains-subject'),
            ('prefixCanonical-Aextra','contains-name'),('unrelated-private-value','opaque-unrelated')]:
            self.assertEqual(proxy_actor_relation({'user':value},'account-a','Canonical-A'),relation)
            with self.assertRaises(ValueError):validate_proxy_token(token(value),subject='account-a',verified_username='Canonical-A')

    def test_proxy_user_diagnostics_reveal_only_structural_categories(self):
        for value,kind in [('', 'empty'),('None','anonymous-label'),('pro','role-label'),
            ('hf_private-fixture-never-output','credential-like'),('a'*24,'hex-id'),
            (str(uuid.uuid4()),'uuid'),('{"id":"private-account"}','json-object'),
            ('["private-account"]','json-array'),({'id':'private-account'},'object'),
            ('private-account','other-string'),(None,'other')]:
            self.assertEqual(proxy_user_format({'user':value}),kind)

    def test_personal_application_transport_never_accepts_conflicting_or_missing_credentials(self):
        from types import SimpleNamespace
        for headers in [{'authorization':'Bearer personal-a'}, {'x-slop-hf-authorization':'Bearer personal-a'},
            {'authorization':'Bearer personal-a','x-slop-hf-authorization':'Bearer personal-a'}]:
            self.assertEqual(personal_authorization(SimpleNamespace(headers=headers)),'Bearer personal-a')
        for headers in [{},{'authorization':'Bearer personal-a','x-slop-hf-authorization':'Bearer personal-b'},
            {'x-slop-hf-authorization':'Basic invalid'}, {'x-slop-hf-authorization':'Bearer bad\r\nheader'},
            {'authorization':'Bearer personal-a','x-slop-hf-authorization':''}]:
            with self.assertRaises(ValueError):personal_authorization(SimpleNamespace(headers=headers))

    def test_proxy_context_rejects_sdk_missing_invalid_error_and_expired_fallback_paths(self):
        def token(payload):return 'e30.'+base64.urlsafe_b64encode(json.dumps(payload).encode()).decode().rstrip('=')+'.Zml4dHVyZQ'
        validate_proxy_token(token({'exp':int(time.time())+600}))
        validate_proxy_token(token({'user':{'id':'account-a'}}),subject='account-a')
        validate_proxy_token(token({'user':'account-a'}),subject='account-a')
        validate_proxy_token(token({'user':'canonical-a'}),subject='account-a',verified_username='canonical-a')
        for payload in [{'user':'canonical-b'},{'sub':'account-b','user':'canonical-a'},{'userId':'account-b','user':'canonical-a'}]:
            with self.assertRaises(ValueError):validate_proxy_token(token(payload),subject='account-a',verified_username='canonical-a')
        for payload in [{},{'sub':'account-b'},{'exp':int(time.time())+600},{'spaceOwnerId':'account-a'},
            {'context':['account-a']},{'user':'account-b'},{'user':'unverified-username'},
            {'sub':'account-b','user':'account-a'},{'sub':'account-b','user':{'id':'account-a'}},{'exp':float('nan'),'sub':'account-a'}]:
            with self.assertRaises(ValueError):validate_proxy_token(token(payload),subject='account-a')
        for value in [None,'', 'not-a-token','e30.bm90LWpzb24.Zml4dHVyZQ',token({'error':'not-authenticated'}),token({'exp':int(time.time())-1}),token({'exp':'unknown'})]:
            with self.assertRaises(ValueError):validate_proxy_token(value)
    def test_live_window_expires_and_never_allows_private_unbounded_or_other_subject_sets(self):
        flags={'SPACE_ID':PUBLIC_VALIDATION_SPACE,'WAN_VALIDATION_ONLY':'yes','WAN_VALIDATION_SUBJECTS':'account-a,account-b',
            'WAN_VALIDATION_CAMPAIGN_ID':str(uuid.uuid4()),'WAN_VALIDATION_EXPIRES_AT':str(int(time.time())+600)}
        with patch.dict(os.environ,flags,clear=True):self.assertTrue(validation_window())
        for change in [{'SPACE_ID':'Manuel2607/SlopUrself-Wan22-GPU-Test'},{'WAN_VALIDATION_ONLY':''},
            {'WAN_VALIDATION_SUBJECTS':'account-a,account-a'},{'WAN_VALIDATION_CAMPAIGN_ID':'not-approved'},
            {'WAN_VALIDATION_EXPIRES_AT':str(int(time.time())-1)},{'WAN_VALIDATION_EXPIRES_AT':str(int(time.time())+21601)}]:
            with patch.dict(os.environ,{**flags,**change},clear=True):self.assertFalse(validation_window())

    def test_public_validation_copy_fails_closed_without_exactly_two_subjects(self):
        with patch.dict(os.environ,{'SPACE_ID':PUBLIC_VALIDATION_SPACE,'WAN_VALIDATION_ONLY':''},clear=True):
            with self.assertRaises(ValueError):validation_subjects()
        for subjects in ['', 'account-a','account-a,account-a','account-a,account-b,account-c','account-a,https://bad']:
            with patch.dict(os.environ,{'SPACE_ID':PUBLIC_VALIDATION_SPACE,'WAN_VALIDATION_ONLY':'yes','WAN_VALIDATION_SUBJECTS':subjects},clear=True):
                with self.assertRaises(ValueError):validation_subjects()
        with patch.dict(os.environ,{'SPACE_ID':PUBLIC_VALIDATION_SPACE,'WAN_VALIDATION_ONLY':'yes','WAN_VALIDATION_SUBJECTS':'account-a,account-b'},clear=True):
            self.assertEqual(validation_subjects(),frozenset(['account-a','account-b']))

    def test_public_validation_checks_verified_identity_not_supplied_account_name(self):
        from unittest.mock import MagicMock
        opener=MagicMock()
        response=opener.open.return_value.__enter__.return_value
        with patch.dict(os.environ,{'SPACE_ID':PUBLIC_VALIDATION_SPACE,'WAN_PREPARATION_ONLY':'yes','WAN_VALIDATION_ONLY':'yes','WAN_VALIDATION_SUBJECTS':'account-a,account-b'},clear=True),patch('urllib.request.build_opener',return_value=opener):
            for subject in ['account-a','account-b']:
                response.read.return_value=json.dumps({'id':subject}).encode()
                self.assertEqual(hf_subject('Bearer personal-test-access'),subject)
            response.read.return_value=json.dumps({'id':'foreign-account','name':'account-a'}).encode()
            with self.assertRaises(ValueError):hf_subject('Bearer personal-test-access')
            self.assertEqual(opener.open.call_args.args[0].full_url,'https://huggingface.co/api/whoami-v2')

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
