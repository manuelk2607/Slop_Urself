import type { HfConnections } from './huggingface';

interface Participant { id: string; accountId?: string; hfConnectionId?: string }
export async function verifyHfRoster(config: { AI_PROVIDER?: string }, players: Participant[], connections: Pick<HfConnections, 'credential'>) {
    if (config.AI_PROVIDER === 'mock') return;
    if (!players.length || players.length > 10 || new Set(players.map(player => player.id)).size !== players.length) throw new Error('Ungültige Spielerliste.');
    const credentials = await Promise.all(players.map(player => connections.credential(player.hfConnectionId, player.accountId)));
    if (new Set(credentials.map(credential => credential.subject)).size !== players.length) {
        throw new Error('Jedes Hugging-Face-Konto kann pro Raum nur einen Spieler vertreten. Bitte verbinde ein eigenes Konto.');
    }
    // HF identifiers and tokens remain server-side, never part of a room snapshot.
}
