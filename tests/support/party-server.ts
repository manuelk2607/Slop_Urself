export {};
// Isolated UI fixtures: no real database, storage or GPU calls are permitted.
const database = require('../../dist/database/node.js');
database.getDatabase = () => ({ playableArchive: async () => ['1', '2', '3', '4'].map(id => ({ id, creatorId: `creator-${id}`,
    creatorName: `Archivspieler ${id}`, prompt: `Public test prompt ${id}`, videoUrl: `/api/videos/videos/1792000000000-party-${id}.mp4` })) });
const bytes = require('node:fs').readFileSync('public/assets/mock-video.mp4');
// Safari requests byte ranges even for this local fixture. Match the real
// archive's range contract rather than silently returning a chunked 200.
require('../../dist/storage/archive.js').serveVideo = async (request: Request) => {
    const headers = new Headers({ 'content-type': 'video/mp4', 'accept-ranges': 'bytes', 'cache-control': 'no-store' });
    const range = request.headers.get('range');
    const match = range && /^bytes=(\d+)-(\d*)$/.exec(range);
    const start = match ? Number(match[1]) : 0, end = match?.[2] ? Math.min(Number(match[2]), bytes.length - 1) : bytes.length - 1;
    if (range && (!match || start > end || start >= bytes.length)) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${bytes.length}` } });
    const body = bytes.subarray(start, end + 1);
    headers.set('content-length', String(body.length));
    if (range) headers.set('content-range', `bytes ${start}-${end}/${bytes.length}`);
    return new Response(request.method === 'HEAD' ? null : body, { status: range ? 206 : 200, headers });
};
for (const name of ['saveRoom', 'saveScores', 'saveRound', 'markRoomStarted', 'markRoomFinished', 'reopenRoom']) {
    database[name] = async () => { throw new Error('Archive games must not write creation statistics.'); };
}
globalThis.fetch = async (input, options) => {
    const url = String(input);
    if (url.endsWith('/oauth/token')) return Response.json({ access_token: new URLSearchParams(String(options?.body)).get('code'), token_type: 'Bearer', expires_in: 28800 });
    const token = new Headers(options?.headers).get('authorization')?.replace('Bearer ', '');
    if (!token?.startsWith('fixture-')) throw new Error('The server token must never be used');
    if (url.endsWith('/oauth/userinfo')) return Response.json({ sub: token, preferred_username: 'ArchiveTest' });
    if (url.endsWith('/api/whoami-v2')) return Response.json({ id: token, name: 'ArchiveTest' });
    if (url.endsWith('/zero-gpu/quota')) return Response.json({ base: 300, current: 0, resetsAt: null, runs: { remaining: 0 } });
    throw new Error('External calls are disabled in archive tests.');
};
require('../../dist/server/node.js');
