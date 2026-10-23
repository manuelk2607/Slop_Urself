import assert from 'node:assert/strict';
import type { Page } from 'playwright';

// Used only with isolated servers whose HF endpoints are fully stubbed.
export async function connectTestHf(page: Page, base: string) {
    const start = await page.request.post(`${base}/api/hf/connect`, { headers: { origin: base } });
    assert.equal(start.status(), 200);
    const authorization = new URL((await start.json()).url);
    const callback = await page.request.get(`${base}/api/hf/callback?state=${authorization.searchParams.get('state')}&code=test-code`, { maxRedirects: 0 });
    assert.equal(callback.status(), 303);
    assert.equal(callback.headers().location, '/?hf=connected');
    await page.reload();
    await page.locator('#screenLobby').waitFor({ state: 'visible' });
}
