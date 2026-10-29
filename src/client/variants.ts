import { createElement, ImagePlus, RotateCcw } from 'lucide';
import { gameOptions, type GameOptions } from '../game/options';
import { prepareImage } from './images';

interface Guess { playerId: string; name: string; text: string; correct?: boolean; points: number }
export interface VariantSnapshot {
    roomId?: string; hostId: string; activeCreatorId?: string; gameState: string; videoNumber?: number; currentRound?: number; ballotId?: string; role?: string;
    options?: GameOptions; sharedImageUrl?: string; sharedImagePending?: boolean; ownTask?: string; ownGuess?: string; task?: string;
    reviewPrompt?: string; reviewGuesses?: Guess[]; votedPlayerIds?: string[];
    playerCount?: number; players?: { id: string }[]; previewDeadline?: number; previewConfirmed?: boolean; hasAbstained?: boolean;
    reveal?: { prompt: string; task?: string; guesses: Guess[] };
}
const element = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
export function gameVariants(roomId: () => string, playerId: () => string, emit: (event: string, payload: Record<string, unknown>) => void) {
    let snapshot: VariantSnapshot | undefined, pendingOptions: GameOptions | undefined, turn = '', reviewKey = '', sharedUrl = '', uploading = false, settingsRoom = '';
    let previewSent = '';
    const controls = element<HTMLFieldSetElement>('gameOptions');
    const settings = element<HTMLDetailsElement>('variantSettings'), classic = element<HTMLButtonElement>('classicModeButton');
    const shared = element<HTMLInputElement>('sharedImageOption'), tasks = element<HTMLInputElement>('secretTasksOption'), guessing = element<HTMLInputElement>('guessPromptOption');
    const quality = element<HTMLSelectElement>('generationQuality'), imageInput = element<HTMLInputElement>('sharedImageInput');
    const mode = element<HTMLSelectElement>('gameMode'), timer = element<HTMLSelectElement>('phaseSeconds');
    const requireReady = element<HTMLInputElement>('requireReadyOption');
    const imageButton = element<HTMLButtonElement>('chooseSharedImage'), imageStatus = element('sharedImageStatus');
    imageButton.prepend(createElement(ImagePlus, { width: 18, height: 18, 'aria-hidden': 'true' }));
    classic.append(createElement(RotateCcw, { width: 18, height: 18, 'aria-hidden': 'true' }));
    classic.addEventListener('click', () => {
        pendingOptions = gameOptions({ quality: quality.value, phaseSeconds: Number(timer.value) });
        settings.open = false;
        emit('setGameOptions', { options: pendingOptions });
    });
    for (const control of [shared, tasks, guessing, quality, mode, timer, requireReady]) control.addEventListener('change', () => {
        pendingOptions = gameOptions({ sharedImage: shared.checked, secretTasks: tasks.checked, guessPrompt: guessing.checked, requireReady: requireReady.checked, quality: quality.value, mode: mode.value, phaseSeconds: Number(timer.value) });
        emit('setGameOptions', { options: pendingOptions });
    });
    imageButton.addEventListener('click', () => imageInput.click());
    imageInput.addEventListener('change', async () => {
        const file = imageInput.files?.[0], code = roomId();
        if (!file || uploading) return;
        uploading = true; imageButton.disabled = true; imageStatus.textContent = 'Bild wird vorbereitet …';
        try {
            const imageBase64 = await prepareImage(file);
            if (roomId() !== code) return;
            emit('setSharedImage', { imageBase64 }); imageStatus.textContent = 'Bild wird übertragen …';
        } catch (error) { imageStatus.textContent = (error as Error).message; }
        finally { uploading = false; imageButton.disabled = false; imageInput.value = ''; }
    });
    function vote(points?: number, abstain = false) {
        if (!snapshot?.ballotId || snapshot.gameState !== 'VOTING') return;
        const options = gameOptions(snapshot?.options);
        emit('submitVote', { ballotId: snapshot.ballotId, videoNumber: snapshot.videoNumber, currentRound: snapshot.currentRound,
            ...abstain ? { abstain: true } : { points,
            ...(options.secretTasks ? { taskPoints: Number(element<HTMLInputElement>('taskRating').value), funPoints: Number(element<HTMLInputElement>('funRating').value) } : {}),
            ...(options.guessPrompt ? { guess: element<HTMLInputElement>('guessInput').value.trim() } : {}) } });
        element<HTMLButtonElement>('submitTaskVote').disabled = true;
        element<HTMLButtonElement>('abstainVoteButton').disabled = true;
    }
    element('abstainVoteButton').addEventListener('click', () => vote(undefined, true));
    function preview(manual = true) {
        if (!snapshot?.ballotId || snapshot.gameState !== 'VOTING' || snapshot.activeCreatorId !== playerId() || snapshot.role === 'spectator') return;
        if (!manual && previewSent === snapshot.ballotId) return;
        previewSent = snapshot.ballotId;
        emit('finishPreview', { ballotId: snapshot.ballotId, currentRound: snapshot.currentRound, videoNumber: snapshot.videoNumber });
    }
    function previewPlayed(video: HTMLVideoElement) {
        if (!snapshot?.previewDeadline || snapshot.previewConfirmed || !Number.isFinite(video.duration) || video.duration <= 0) return;
        let played = 0; for (let i = 0; i < video.played.length; i++) played += video.played.end(i) - video.played.start(i);
        if (played >= Math.min(9, video.duration) - 0.2) preview(false);
    }
    element('submitTaskVote').addEventListener('click', () => vote());
    function rating() {
        const task = element<HTMLInputElement>('taskRating').value, fun = element<HTMLInputElement>('funRating').value;
        element('taskRatingValue').textContent = task; element('funRatingValue').textContent = fun;
        element('combinedRating').textContent = `${Math.round((Number(task) + Number(fun)) / 2)} Punkte`;
    }
    element('taskRating').addEventListener('input', rating); element('funRating').addEventListener('input', rating);
    element('confirmGuesses').addEventListener('click', () => {
        emit('judgeGuesses', { videoNumber: snapshot?.videoNumber,
            correctPlayerIds: [...document.querySelectorAll<HTMLInputElement>('#guessReviewList input:checked')].map(input => input.value) });
    });
    function reveal(id: string, data: VariantSnapshot['reveal']) {
        const target = element(id); target.replaceChildren(); target.hidden = !data;
        if (!data) return;
        for (const [name, value] of [['Prompt', data.prompt], ['Auftrag', data.task]]) if (value) {
            const line = document.createElement('p'), label = document.createElement('strong'); label.textContent = `${name}: `;
            line.append(label, document.createTextNode(value)); target.append(line);
        }
        for (const guess of data.guesses) {
            const line = document.createElement('p'); line.textContent = `${guess.name}: ${guess.text} · ${guess.correct ? '+2 Ratepunkte' : 'kein Treffer'}`; target.append(line);
        }
    }
    function render(data: VariantSnapshot) {
        snapshot = data;
        const host = data.hostId === playerId(), creator = data.activeCreatorId === playerId();
        const newRoom = settingsRoom !== roomId();
        if (newRoom || !host || data.gameState !== 'LOBBY' || JSON.stringify(gameOptions(data.options)) === JSON.stringify(pendingOptions)) pendingOptions = undefined;
        const options = pendingOptions || gameOptions(data.options);
        const key = `${roomId()}:${data.videoNumber}`;
        if (turn !== key) {
            turn = key; element<HTMLInputElement>('guessInput').value = '';
            element<HTMLInputElement>('taskRating').value = '3'; element<HTMLInputElement>('funRating').value = '3'; rating(); reviewKey = '';
        }
        controls.disabled = !host || data.gameState !== 'LOBBY';
        requireReady.disabled = controls.disabled; requireReady.checked = options.requireReady;
        quality.disabled = controls.disabled || options.mode !== 'classic'; mode.disabled = controls.disabled; timer.disabled = controls.disabled;
        settings.hidden = options.mode !== 'classic';
        const activeOptions = Number(options.sharedImage) + Number(options.secretTasks) + Number(options.guessPrompt);
        element('gameModeName').textContent = options.mode === 'archive-vote' ? 'Archiv · Best-of' : options.mode === 'archive-guess' ? 'Archiv · Prompt erraten' : activeOptions ? 'Mit Zusatzregeln' : 'Klassisch';
        element('variantSettingsLabel').textContent = activeOptions ? `Zusatzregeln (${activeOptions} aktiv)` : 'Optionale Zusatzregeln';
        classic.hidden = (!activeOptions && options.mode === 'classic') || !host; classic.disabled = controls.disabled;
        if (newRoom) { settingsRoom = roomId(); settings.open = activeOptions > 0; }
        shared.checked = options.sharedImage; tasks.checked = options.secretTasks; guessing.checked = options.guessPrompt; quality.value = options.quality;
        mode.value = options.mode; timer.value = String(options.phaseSeconds);
        const panel = element('sharedImagePanel');
        const missingImage = options.sharedImage && !data.sharedImageUrl && data.gameState === 'IDLE';
        element(missingImage ? 'sharedImageCreateSlot' : data.gameState === 'GAME_OVER' ? 'sharedImageFinalSlot' : 'sharedImageLobbySlot').append(panel);
        panel.hidden = !options.sharedImage;
        imageButton.hidden = !host; imageButton.disabled = uploading || Boolean(data.sharedImagePending);
        if (data.sharedImageUrl !== sharedUrl) {
            sharedUrl = data.sharedImageUrl || '';
            const preview = element<HTMLImageElement>('sharedImagePreview'); preview.hidden = !sharedUrl;
            if (sharedUrl) preview.src = sharedUrl; else preview.removeAttribute('src');
            imageStatus.textContent = sharedUrl ? 'Bild bereit.' : 'Noch kein gemeinsames Bild vorhanden.';
        }
        if (!uploading) imageStatus.textContent = data.sharedImagePending ? 'Das gemeinsame Bild wird geprüft …' : sharedUrl ? 'Bild bereit.' : 'Noch kein gemeinsames Bild vorhanden.';
        if (data.sharedImagePending) element<HTMLButtonElement>('startGameButton').disabled = true;
        element('personalImagePicker').hidden = options.sharedImage;
        if (options.sharedImage && creator && data.gameState === 'IDLE') element<HTMLButtonElement>('uploadButton').disabled = missingImage || Boolean(data.sharedImagePending);
        const common = element<HTMLImageElement>('sharedCreationImage'); common.hidden = !options.sharedImage || !sharedUrl;
        if (sharedUrl && common.getAttribute('src') !== sharedUrl) common.src = sharedUrl;
        element('secretTask').hidden = !data.ownTask; element('secretTask').textContent = data.ownTask ? `Dein geheimer Auftrag: ${data.ownTask}` : '';
        element('votingTask').hidden = !data.task; element('votingTask').textContent = data.task ? `Auftrag: ${data.task}` : '';
        element('guessEntry').hidden = data.role === 'spectator' || !options.guessPrompt || creator || data.gameState !== 'VOTING' || Boolean(data.votedPlayerIds?.includes(playerId()));
        if (data.ownGuess) element<HTMLInputElement>('guessInput').value = data.ownGuess;
        element('taskVoteControls').hidden = !options.secretTasks;
        document.querySelector<HTMLElement>('.vote-buttons')!.hidden = options.secretTasks;
        element<HTMLButtonElement>('submitTaskVote').disabled = Boolean(data.votedPlayerIds?.includes(playerId()));
        element<HTMLButtonElement>('abstainVoteButton').disabled = Boolean(data.votedPlayerIds?.includes(playerId()));
        const reviewing = data.gameState === 'GUESS_REVIEW';
        element('guessReview').hidden = !reviewing || !creator;
        if (reviewing) {
            element('votingActionBox').style.display = 'none';
            element('votingWaitingBox').style.display = creator ? 'none' : 'block';
            element('votingStatusText').textContent = 'Der Ersteller bewertet die Rateversuche.';
            element('reviewPrompt').textContent = `Dein Prompt: ${data.reviewPrompt || ''}`;
        }
        const nextReviewKey = `${key}:${JSON.stringify(data.reviewGuesses || [])}`;
        if (reviewKey !== nextReviewKey) {
            reviewKey = nextReviewKey; const list = element('guessReviewList'); list.replaceChildren();
            for (const guess of data.reviewGuesses || []) {
                const li = document.createElement('li'), label = document.createElement('label'), input = document.createElement('input');
                input.type = 'checkbox'; input.value = guess.playerId; input.setAttribute('aria-label', `Treffer von ${guess.name}`);
                label.append(input, document.createTextNode(`${guess.name}: ${guess.text}`)); li.append(label); list.append(li);
            }
        }
        reveal('roundReveal', data.reveal); reveal('finalReveal', data.reveal);
        if (data.role === 'spectator') { element('votingActionBox').style.display = 'none'; element('guessReview').hidden = true; }
    }
    return { render, vote, preview, previewPlayed, shared: () => gameOptions(snapshot?.options).sharedImage };
}
