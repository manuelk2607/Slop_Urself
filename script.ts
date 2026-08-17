declare const io: () => any;
const socket = io();

// Lobby-Elemente
const lobbySection = document.getElementById('lobbySection') as HTMLDivElement;
const usernameInput = document.getElementById('usernameInput') as HTMLInputElement;
const createRoomButton = document.getElementById('createRoomButton') as HTMLButtonElement;
const joinRoomButton = document.getElementById('joinRoomButton') as HTMLButtonElement;
const roomCodeInput = document.getElementById('roomCodeInput') as HTMLInputElement;
const lobbyError = document.getElementById('lobbyError') as HTMLParagraphElement;

// Spiel-Elemente
const gameSection = document.getElementById('gameSection') as HTMLDivElement;
const displayRoomCode = document.getElementById('displayRoomCode') as HTMLElement;
const playerCount = document.getElementById('playerCount') as HTMLElement;
const scoreList = document.getElementById('scoreList') as HTMLUListElement;

// Upload- & Prompt-Elemente
const imageInput = document.getElementById('imageInput') as HTMLInputElement;
const imagePreview = document.getElementById('imagePreview') as HTMLImageElement;
const promptInput = document.getElementById('promptInput') as HTMLInputElement;
const uploadButton = document.getElementById('uploadButton') as HTMLButtonElement;
const loadingSection = document.getElementById('loadingSection') as HTMLDivElement;
const loadingText = document.getElementById('loadingText') as HTMLParagraphElement;
const videoPlayer = document.getElementById('videoPlayer') as HTMLVideoElement;
const customButton = document.querySelector('.custom-file-btn') as HTMLLabelElement;

// Voting-Elemente
const votingSection = document.getElementById('votingSection') as HTMLDivElement;
const votingText = document.getElementById('votingText') as HTMLParagraphElement;
const voteButtons = document.querySelectorAll('.voteButton') as NodeListOf<HTMLButtonElement>;

// --- LOBBY ACTIONS ---

createRoomButton.addEventListener('click', () => {
    const username = usernameInput.value.trim();
    if (!username) {
        lobbyError.innerText = 'Bitte gib zuerst einen Spielernamen ein!';
        usernameInput.focus();
        return;
    }
    socket.emit('createRoom', { username });
});

joinRoomButton.addEventListener('click', () => {
    const username = usernameInput.value.trim();
    const code = roomCodeInput.value.trim();

    if (!username) {
        lobbyError.innerText = 'Bitte gib zuerst einen Spielernamen ein!';
        usernameInput.focus();
        return;
    }
    if (!code) {
        lobbyError.innerText = 'Bitte gib einen 4-stelligen Code ein!';
        roomCodeInput.focus();
        return;
    }
    socket.emit('joinRoom', { roomId: code, username });
});

// --- SERVER EVENTS ---

socket.on('roomCreated', (data: { roomId: string }) => enterRoom(data.roomId));
socket.on('joinedSuccess', (data: { roomId: string }) => enterRoom(data.roomId));

socket.on('roomDataUpdate', (data: { playerCount: number; players: { id: string; name: string; score: number }[] }) => {
    playerCount.innerText = data.playerCount.toString();

    // Bestenliste sortieren (Höchste Punktzahl oben)
    data.players.sort((a, b) => b.score - a.score);

    scoreList.innerHTML = '';
    data.players.forEach(p => {
        const li = document.createElement('li');
        li.innerText = `${p.name}: ${p.score} Pkt.`;
        scoreList.appendChild(li);
    });
});

socket.on('errorMsg', (msg: string) => {
    if (lobbySection.style.display !== 'none') {
        lobbyError.innerText = msg;
    } else {
        alert(msg);
        uploadButton.disabled = false;
        uploadButton.innerText = 'KI-Video generieren';
        loadingSection.style.display = 'none';
    }
});

function enterRoom(roomId: string) {
    lobbyError.innerText = '';
    lobbySection.style.display = 'none';
    gameSection.style.display = 'block';
    displayRoomCode.innerText = roomId;
}

// --- UPLOAD LOGIK ---

imageInput.addEventListener('change', (event: Event) => {
    const target = event.target as HTMLInputElement;
    const file = target.files?.[0];

    if (file) {
        imagePreview.src = URL.createObjectURL(file);
        imagePreview.style.display = 'block';
        if (customButton) customButton.innerText = '📸 Anderes Bild auswählen';
    } else {
        imagePreview.style.display = 'none';
        imagePreview.src = '';
        if (customButton) customButton.innerText = '📸 Bild auswählen';
    }
});

uploadButton.addEventListener('click', () => {
    const file = imageInput.files?.[0];
    const promptText = promptInput.value.trim();

    if (!file) {
        alert('Bitte wähle zuerst ein Bild aus!');
        return;
    }
    if (!promptText) {
        alert('Bitte gib eine Anweisung (Prompt) ein!');
        promptInput.focus();
        return;
    }

    const currentRoomId = displayRoomCode.innerText;
    const reader = new FileReader();
    reader.readAsDataURL(file);

    reader.onload = () => {
        socket.emit('sendImage', {
            roomId: currentRoomId,
            imageBase64: reader.result as string,
            prompt: promptText
        });
    };
});

// Fortschrittsanzeige während der 2 Stufen
socket.on('generationStarted', (data: { step?: string }) => {
    uploadButton.disabled = true;
    uploadButton.innerText = 'KI arbeitet...';
    loadingSection.style.display = 'flex';
    if (loadingText) loadingText.innerText = data?.step || 'Stufe 1: Transformiere Bild...';
    videoPlayer.style.display = 'none';
    votingSection.style.display = 'none';
});

socket.on('generationProgress', (data: { step: string }) => {
    if (loadingText) loadingText.innerText = data.step;
});

// Video fertig -> Voting anzeigen
socket.on('videoGenerated', (data: { videoUrl: string; authorId: string; authorName: string }) => {
    loadingSection.style.display = 'none';
    uploadButton.disabled = false;
    uploadButton.innerText = 'KI-Video generieren';

    videoPlayer.src = data.videoUrl;
    videoPlayer.style.display = 'block';

    // Voting-Leiste einblenden
    votingSection.style.display = 'block';

    if (socket.id === data.authorId) {
        votingText.innerText = 'Das ist dein Video! Die anderen Spieler bewerten jetzt...';
        voteButtons.forEach(btn => btn.style.display = 'none');
    } else {
        votingText.innerText = `Bewerte das Video von ${data.authorName}:`;
        voteButtons.forEach(btn => {
            btn.style.display = 'inline-block';
            btn.disabled = false;
        });
    }
});

// Voting-Klick verarbeiten
voteButtons.forEach(button => {
    button.addEventListener('click', () => {
        const points = parseInt(button.getAttribute('data-points') || '0', 10);
        const currentRoomId = displayRoomCode.innerText;

        socket.emit('submitVote', { roomId: currentRoomId, points });

        // Buttons nach Stimmabgabe deaktivieren
        voteButtons.forEach(btn => btn.disabled = true);
        votingText.innerText = `Danke für deine Bewertung (${points} Sterne)!`;
    });
});

// Funktion für Namensfehler
function triggerNameError() {
    lobbyError.innerText = '⚠️ Bitte gib zuerst einen Spielernamen ein!';
    usernameInput.classList.add('input-error');
    usernameInput.focus();
}

// Fehler zurücksetzen, sobald der Spieler zu tippen beginnt
usernameInput.addEventListener('input', () => {
    if (usernameInput.value.trim().length > 0) {
        lobbyError.innerText = '';
        usernameInput.classList.remove('input-error');
    }
});

// Bei Raum-Erstellung prüfen
createRoomButton.addEventListener('click', () => {
    const username = usernameInput.value.trim();
    if (!username) {
        triggerNameError();
        return;
    }
    socket.emit('createRoom', { username });
});

// Bei Raum-Beitritt prüfen
joinRoomButton.addEventListener('click', () => {
    const username = usernameInput.value.trim();
    const code = roomCodeInput.value.trim();

    if (!username) {
        triggerNameError();
        return;
    }
    if (!code) {
        lobbyError.innerText = '⚠️ Bitte gib einen 4-stelligen Raumcode ein!';
        roomCodeInput.classList.add('input-error');
        roomCodeInput.focus();
        return;
    }
    socket.emit('joinRoom', { roomId: code, username });
});

