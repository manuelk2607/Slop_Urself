import { readFile, writeFile, mkdir, appendFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import dotenv from 'dotenv';
import { validationModerator } from '../moderation-service/src/live-validation.js';
import { createManagedEngine } from '../moderation-service/src/managed.js';
import { managedRuntimeVersion } from '../moderation-service/src/version.js';
import { ManagedRequestBudget } from '../moderation-service/src/request-budget.js';
import { VALIDATION_PAIR, type ValidationCampaign } from '../src/security/live-validation.js';
import { buildVideoPrompt } from '../src/shared/video-prompt.js';

if (!process.argv.includes('--serve-approved-fixed-pair')) throw Error('Explicit fixed-pair authorization required');
const arg = process.argv.indexOf('--campaign'), file = resolve(process.argv[arg + 1] || '');
if (arg < 0 || !file.startsWith(resolve('.local/live-validation') + '/') || !file.endsWith('/campaign.json')) throw Error('Expected a controlled local campaign file');
const campaign = JSON.parse(await readFile(file, 'utf8')) as ValidationCampaign;
if (!/^[a-f0-9-]{36}$/.test(campaign.id) || campaign.operatorApproval !== 'fixed-pair-approved-2026-11-02') throw Error('Recorded exact operator approval required');
const cwd = process.cwd(); process.chdir('moderation-service'); let base: string;
try { base = await managedRuntimeVersion('gemini-free', 'gemini-only'); } finally { process.chdir(cwd); }
const evaluation = JSON.parse(await readFile('.local/audit-tests/live-qualification-0e3aa096-b28a-495a-a802-bc213fd03e38/report.json', 'utf8')) as {
    modelVersion: string; cases: { decision: string; assessmentReason: string; promptSha256: string; imageSha256: string }[];
};
if (evaluation.modelVersion !== base || evaluation.cases.length !== 2 || evaluation.cases.some((c, i) => c.decision !== 'allow' || c.assessmentReason !== 'clear'
    || c.promptSha256 !== createHash('sha256').update(buildVideoPrompt(VALIDATION_PAIR[i].prompt)).digest('hex'))) throw Error('Exact measured input evidence no longer matches the pipeline');
for (const [i, name] of ['ball', 'cube'].entries()) {
    const bytes = await readFile(`tests/fixtures/live-validation/${name}.png`);
    if (createHash('sha256').update(bytes).digest('hex') !== evaluation.cases[i].imageSha256) throw Error('Approved image evidence changed');
}
const version = createHash('sha256').update(base).update(await readFile('moderation-service/src/live-validation.ts'))
    .update(await readFile('src/security/live-validation.ts')).update(JSON.stringify({ id: campaign.id, members: campaign.members, expiresAt: campaign.expiresAt })).digest('hex');
const env = dotenv.parse(await readFile('.env.local'));
if (!env.GEMINI_MODERATION_API_KEY) throw Error('Approved Free Gemini key required');
let secret = env.LIVE_VALIDATION_MODERATION_SECRET;
if (!secret) { secret = randomBytes(32).toString('hex'); await appendFile('.env.local', `\nLIVE_VALIDATION_MODERATION_SECRET=${secret}\n`, { mode: 0o600 }); }
const directory = resolve('.local/live-validation', campaign.id); await mkdir(directory, { recursive: true, mode: 0o700 });
const budget = new ManagedRequestBudget(join(directory, 'requests.sqlite'), 40);
const engine = createManagedEngine({ screening: 'gemini-only', contextAuthorized: false, geminiKey: env.GEMINI_MODERATION_API_KEY,
    geminiFreeProjectConfirmed: true, maxRequests: 40, reserveRequest: () => budget.reserve() });
const server = await validationModerator({ id: campaign.id, expiresAt: campaign.expiresAt, secret, version, directory,
    cases: campaign.members.map((m, i) => ({ accountId: m.accountId, pixelSha256: VALIDATION_PAIR[i].pixelSha256, prompt: buildVideoPrompt(VALIDATION_PAIR[i].prompt) })), engine });
server.listen(3406, '127.0.0.1');
server.once('listening', async () => {
    const updated = { ...campaign, moderatorVersion: version };
    await writeFile(file, JSON.stringify(updated, null, 2) + '\n', { mode: 0o600 });
    console.info(JSON.stringify({ port: 3406, campaign: campaign.id, version, qualifiedForGeneralUse: false, approvedInputCases: 2, outputOperatorReviewRequired: true, maxFreeModerationRequests: 40, gpuRequests: 0 }));
});
server.once('close', () => budget.close());
