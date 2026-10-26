import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ArchiveStatusCache, ARCHIVE_STATUS_TTL_MS } from '../../src/server/archive';
import type { GameRepository } from '../../src/database/repository';

const config = { AWS_ACCESS_KEY_ID: 'fixture', AWS_SECRET_ACCESS_KEY: 'fixture', AWS_ENDPOINT_URL_S3: 'https://storage.test' };
const key = 'videos/1234567890123-fixture.mp4';
const listing = `<ListBucketResult><IsTruncated>false</IsTruncated><Contents><Key>${key}</Key><Size>42</Size><LastModified>2026-10-26</LastModified></Contents></ListBucketResult>`;

test('display inventories coalesce and cache briefly; capacity lists are unaffected', async () => {
    const original = globalThis.fetch;
    let reads = 0, reconciles = 0;
    globalThis.fetch = async () => { reads++; return new Response(listing); };
    const cache = new ArchiveStatusCache(config);
    const database = { reconcileArchive: async () => { reconciles++; } } as unknown as GameRepository;
    try {
        const results = await Promise.all(Array.from({ length: 10 }, () => cache.read(database, 1000)));
        assert.equal(reads, 1); assert.equal(reconciles, 1);
        results[0].videoCount = 99;
        assert.equal((await cache.read(database, 1001)).videoCount, 1);
        await cache.read(database, 1000 + ARCHIVE_STATUS_TTL_MS);
        assert.equal(reads, 2); assert.equal(reconciles, 2);
        cache.invalidate(); await cache.read(database, 1000 + ARCHIVE_STATUS_TTL_MS + 1);
        assert.equal(reads, 3); assert.equal(reconciles, 3);
    } finally { globalThis.fetch = original; }
});

test('invalidated inventory cannot reconcile stale availability; failures never become empty/cache hits', async () => {
    const original = globalThis.fetch;
    let complete!: () => void, reads = 0, reconciles = 0;
    const cache = new ArchiveStatusCache(config);
    const database = { reconcileArchive: async () => { reconciles++; } } as unknown as GameRepository;
    globalThis.fetch = async () => { reads++; await new Promise<void>(resolve => { complete = resolve; }); return new Response(listing); };
    try {
        const reading = cache.read(database, 1000);
        // aws4fetch signs asynchronously before invoking fetch.
        while (!complete) await new Promise(resolve => setTimeout(resolve, 1));
        cache.invalidate(); complete();
        await assert.rejects(reading, /geändert/); assert.equal(reconciles, 0);
        globalThis.fetch = async () => { reads++; return new Response('', { status: 403 }); };
        await assert.rejects(cache.read(database, 1001)); await assert.rejects(cache.read(database, 1002));
        assert.equal(reconciles, 0); assert.equal(reads, 3);
        globalThis.fetch = async () => { reads++; return new Response(listing); };
        assert.equal((await cache.read(database, 1003)).videoCount, 1); assert.equal(reconciles, 1);
    } finally { globalThis.fetch = original; }
});

test('database failures and database identity changes require a new complete reconciliation', async () => {
    const original = globalThis.fetch;
    const cache = new ArchiveStatusCache(config);
    let reads = 0, first = true, reconciles = 0;
    globalThis.fetch = async () => { reads++; return new Response(listing); };
    const database = { reconcileArchive: async () => { if (first) { first = false; throw new Error('fixture outage'); } reconciles++; } } as unknown as GameRepository;
    const other = { reconcileArchive: async () => { reconciles++; } } as unknown as GameRepository;
    try {
        await assert.rejects(cache.read(database, 1000));
        await cache.read(database, 1001); await cache.read(other, 1002);
        assert.equal(reads, 3); assert.equal(reconciles, 2);
    } finally { globalThis.fetch = original; }
});
