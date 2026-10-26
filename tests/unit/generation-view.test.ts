import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generationView, roomSnapshot, type Room } from '../../src/game/rules';
import { generationElapsed, generationMessage } from '../../src/shared/generation';

test('generation snapshot reconstructs elapsed stage after reload without revealing provider/credential data', () => {
    const room = { code: 'TEST', hostId: 'a', state: 'GENERATING', players: [{ id: 'a', name: 'A', score: 0, connected: true, sessionId: 'private-session', hfConnectionId: 'private-connection' }],
        activeCreatorIndex: 0, currentVotes: {}, currentRound: 1, maxRounds: 1, currentPrompt: 'private-prompt', currentVideoUrl: '',
        generationId: 'random-generation', generationStartedAt: 1000, generationStage: 'queue',
        generationJob: { submittedAt: 2000, status: 'running', root: 'https://private-provider.hf.space', eventId: 'private-event' } } as Room;
    assert.deepEqual(generationView(room), { id: 'random-generation', startedAt: 1000, stage: 'queue' });
    const publicData = roomSnapshot(room, 'a');
    assert.doesNotMatch(JSON.stringify(publicData), /private-/);
    assert.match(generationElapsed(publicData.generation!, 66_000), /1:05/);
    assert.equal(generationElapsed(publicData.generation!, 0), 'Vergangen: 0:00 Min.');
    room.generationJob!.status = 'complete';
    assert.equal(generationView(room)?.stage, 'archive');
    assert.match(generationMessage(generationView(room)!), /bestehende Auftrag/);
    room.generationStartedAt = undefined;
    assert.equal(generationView(room)?.startedAt, 2000, 'Legacy jobs can use their durable submission timestamp.');
    room.state = 'VOTING'; assert.equal(generationView(room), undefined);
});
