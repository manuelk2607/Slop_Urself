import { test } from 'node:test';
import assert from 'node:assert/strict';
import { personalHfHeaders } from '../../src/ai/personal-headers';

test('only reviewed controlled hosts receive identical caller application credentials', () => {
    for (const host of ['manuel2607-slopurself-wan22-validated.hf.space', 'manuel2607-slopurself-wan22-gpu-test.hf.space']) {
        for (const path of ['/identity', '/--replicas/fixture/gradio_api/queue/join']) {
            const headers = personalHfHeaders(`https://${host}${path}`, 'personal-fixture-a');
            assert.deepEqual(headers, { Authorization: 'Bearer personal-fixture-a', 'X-HF-Authorization': 'Bearer personal-fixture-a', 'X-Slop-HF-Authorization': 'Bearer personal-fixture-a' });
        }
    }
    for (const url of ['https://huggingface.co/api/whoami-v2', 'https://other.hf.space/identity',
        'https://manuel2607-slopurself-wan22-validated.hf.space.evil.test/identity',
        'http://manuel2607-slopurself-wan22-validated.hf.space/identity',
        'https://manuel2607-slopurself-wan22-validated.hf.space:8443/identity']) {
        assert.deepEqual(personalHfHeaders(url, 'personal-fixture-b'), { Authorization: 'Bearer personal-fixture-b' });
    }
    assert.deepEqual(personalHfHeaders('https://manuel2607-slopurself-wan22-validated.hf.space/identity'), {});
    assert.throws(() => personalHfHeaders('https://huggingface.co/', 'bad\r\nheader'));
});
