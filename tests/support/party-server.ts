export {};
// Isolated UI fixtures: no real database, storage or GPU calls are permitted.
const database = require('../../dist/database/node.js');
database.getDatabase = () => ({ playableArchive: async () => ['1', '2', '3', '4'].map(id => ({ id, creatorId: `creator-${id}`,
    creatorName: `Archivspieler ${id}`, prompt: `Public test prompt ${id}`, videoUrl: `/api/videos/videos/1792000000000-party-${id}.mp4` })) });
const bytes = require('node:fs').readFileSync('public/assets/mock-video.mp4');
require('../../dist/storage/archive.js').serveVideo = async () => new Response(bytes, { headers: { 'content-type': 'video/mp4' } });
for (const name of ['saveRoom', 'saveScores', 'saveRound', 'markRoomStarted', 'markRoomFinished', 'reopenRoom']) {
    database[name] = async () => { throw new Error('Archive games must not write creation statistics.'); };
}
globalThis.fetch = async (input, options) => {
    const url = String(input);
    if (url.endsWith('/oauth/token')) return Response.json({ access_token: 'personal-test', token_type: 'Bearer', expires_in: 28800 });
    if (new Headers(options?.headers).get('authorization') !== 'Bearer personal-test') throw new Error('The server token must never be used');
    if (url.endsWith('/oauth/userinfo')) return Response.json({ sub: 'shared-test', preferred_username: 'SharedTest' });
    if (url.endsWith('/api/whoami-v2')) return Response.json({ id: 'shared-test', name: 'SharedTest' });
    if (url.endsWith('/zero-gpu/quota')) return Response.json({ base: 300, current: 0, resetsAt: null, runs: { remaining: 0 } });
    throw new Error('External calls are disabled in archive tests.');
};
require('../../dist/server/node.js');
