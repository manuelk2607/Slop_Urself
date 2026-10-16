export {};
// Isolated UI fixtures: no real database, storage or GPU calls are permitted.
const database = require('../../dist/database/node.js');
database.getDatabase = () => ({ playableArchive: async () => ['1', '2', '3', '4'].map(id => ({ id, creatorId: `creator-${id}`,
    creatorName: `Archivspieler ${id}`, prompt: `Public test prompt ${id}`, videoUrl: `/assets/mock-video.mp4?clip=${id}` })) });
for (const name of ['saveRoom', 'saveScores', 'saveRound', 'markRoomStarted', 'markRoomFinished', 'reopenRoom']) {
    database[name] = async () => { throw new Error('Archive games must not write creation statistics.'); };
}
globalThis.fetch = async input => {
    if (String(input).endsWith('/zero-gpu/quota')) return Response.json({ base: 300, current: 0, resetsAt: null, runs: { remaining: 0 } });
    throw new Error('External calls are disabled in archive tests.');
};
require('../../dist/server/node.js');
