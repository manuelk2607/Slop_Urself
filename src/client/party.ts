import { createElement, SkipForward } from 'lucide';
import type { GameOptions } from '../game/options';

export interface PartySnapshot {
    hostId: string; gameState: string; phaseKey?: string; phaseDeadline?: number; serverTime?: number; options?: GameOptions;
    archiveResults?: { id: string; creatorName: string; points: number; votes: number; prompt: string }[];
}
export function partyControls(playerId: () => string, emit: (payload: Record<string, unknown>) => void) {
    const bar = document.getElementById('phaseToolbar')!, countdown = document.getElementById('phaseCountdown')!;
    const close = document.getElementById('closePhaseButton') as HTMLButtonElement;
    close.prepend(createElement(SkipForward, { width: 18, height: 18, 'aria-hidden': 'true' }));
    let snapshot: PartySnapshot | undefined, clockOffset = 0;
    close.addEventListener('click', () => {
        if (snapshot && confirm('Diese Phase jetzt abschließen? Fehlende Bewertungen zählen nicht; offene Rateversuche erhalten keine Bonuspunkte.')) emit({ phaseKey: snapshot.phaseKey });
    });
    function tick() {
        countdown.textContent = snapshot?.phaseDeadline ? `Noch ${Math.max(0, Math.ceil((snapshot.phaseDeadline - Date.now() - clockOffset) / 1000))} s` : '';
    }
    window.setInterval(tick, 250);
    return {
        clear() { snapshot = undefined; bar.hidden = true; },
        render(data: PartySnapshot) {
            snapshot = data; clockOffset = (data.serverTime || Date.now()) - Date.now();
            close.hidden = data.hostId !== playerId() || !['IDLE', 'VOTING', 'GUESS_REVIEW'].includes(data.gameState);
            bar.hidden = close.hidden && !data.phaseDeadline; tick();
            const list = document.getElementById('archiveRanking')!;
            list.hidden = !data.archiveResults?.length || data.gameState !== 'GAME_OVER'; list.replaceChildren();
            if (!list.hidden) for (const clip of [...data.archiveResults!].sort((a, b) => b.points / (b.votes || 1) - a.points / (a.votes || 1))) {
                const li = document.createElement('li'); li.className = 'score-item';
                li.textContent = `${clip.creatorName}: ${clip.prompt} · ${clip.votes ? (clip.points / clip.votes).toFixed(1) : '0'} / 5 (${clip.votes} Stimmen)`; list.append(li);
            }
        }
    };
}
