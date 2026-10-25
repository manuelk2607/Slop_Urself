import { test } from 'node:test';
import assert from 'node:assert/strict';
import { archiveVideo } from '../../src/storage/archive';
import { archiveStatus } from '../../src/server/archive';
import type { GameRepository } from '../../src/database/repository';

const config = { AI_PROVIDER: 'mock', AWS_ACCESS_KEY_ID: 'test', AWS_SECRET_ACCESS_KEY: 'test', AWS_ENDPOINT_URL_S3: 'https://storage.test', VIDEO_ARCHIVE_MB: '20' };
const oldKey = 'videos/1234567890123-old.mp4';
const listing = `<ListBucketResult><IsTruncated>false</IsTruncated><Contents><Key>${oldKey}</Key><Size>${20 * 1024 * 1024}</Size><LastModified>2026-10-01T00:00:00Z</LastModified></Contents></ListBucketResult>`;

test('eviction synchronizes missing files and removes each successfully evicted file from availability', async () => {
    const original = globalThis.fetch, calls: string[] = [], snapshots: string[][] = [];
    globalThis.fetch = async (input, init) => {
        const request = input instanceof Request ? input : new Request(input, init);
        if (request.url.includes('.hf.space')) return new Response(Uint8Array.from([0,0,0,16,102,116,121,112,109,112,52,50,0,0,0,0]));
        if (request.url.includes('list-type')) return new Response(listing);
        calls.push(request.method); return new Response(null, { status: 200 });
    };
    try {
        await archiveVideo('https://demo.hf.space/video.mp4', config, [], async urls => { calls.push('reconcile'); snapshots.push(urls); });
        assert.deepEqual(calls, ['reconcile', 'DELETE', 'reconcile', 'PUT']);
        assert.deepEqual(snapshots, [[`/api/videos/${oldKey}`], []]);
    } finally { globalThis.fetch = original; }
});

test('archive status reconciles storage inventory but never treats an outage, truncated list or missing configuration as empty storage', async () => {
    const original = globalThis.fetch, snapshots: string[][] = [];
    const database = { reconcileArchive: async (urls: string[]) => { snapshots.push(urls); } } as unknown as GameRepository;
    try {
        await archiveStatus({}, database); assert.equal(snapshots.length, 0);
        globalThis.fetch = async () => new Response(null, { status: 403 });
        await assert.rejects(archiveStatus(config, database)); assert.equal(snapshots.length, 0);
        globalThis.fetch = async () => new Response('<ListBucketResult><IsTruncated>true</IsTruncated></ListBucketResult>');
        await assert.rejects(archiveStatus(config, database)); assert.equal(snapshots.length, 0);
        globalThis.fetch = async () => new Response('<ListBucketResult/>');
        await assert.rejects(archiveStatus(config, database)); assert.equal(snapshots.length, 0);
        globalThis.fetch = async () => new Response(listing);
        assert.equal((await archiveStatus(config, database)).videoCount, 1);
        assert.deepEqual(snapshots, [[`/api/videos/${oldKey}`]]);
        globalThis.fetch = async () => new Response('<ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>');
        await archiveStatus(config, database); assert.deepEqual(snapshots.at(-1), []);
    } finally { globalThis.fetch = original; }
});

test('a database failure after physical eviction is repaired by the next complete inventory', async () => {
    const original = globalThis.fetch, snapshots: string[][] = [];
    let exists = true, uploads = 0;
    globalThis.fetch = async (input, init) => {
        const request = input instanceof Request ? input : new Request(input, init);
        if (request.url.includes('.hf.space')) return new Response(Uint8Array.from([0,0,0,16,102,116,121,112,109,112,52,50,0,0,0,0]));
        if (request.url.includes('list-type')) return new Response(exists ? listing : '<ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>');
        if (request.method === 'DELETE') exists = false;
        if (request.method === 'PUT') uploads++;
        return new Response(null, { status: 200 });
    };
    try {
        await assert.rejects(archiveVideo('https://demo.hf.space/video.mp4', config, [], async urls => {
            if (!urls.length) throw new Error('Temporary database outage');
        }), /database outage/);
        assert.equal(exists, false); assert.equal(uploads, 0);
        await archiveStatus(config, { reconcileArchive: async (urls: string[]) => { snapshots.push(urls); } } as unknown as GameRepository);
        assert.deepEqual(snapshots, [[]]);
    } finally { globalThis.fetch = original; }
});
