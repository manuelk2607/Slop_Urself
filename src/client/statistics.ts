import type { PlayerStats, StatsOverview, VideoStats, RoomStats, VideoCreator } from '../database/types';
import { videoPlayback } from './video';
import { historySelection, type HistoryKind } from './history-selection';

interface StatisticsElements {
    statsOverview: HTMLDivElement;
    statsList: HTMLUListElement;
    statsNotice: HTMLParagraphElement;
    videoStatsList: HTMLUListElement;
    videoStatsNotice: HTMLParagraphElement;
    roomStatsList: HTMLUListElement;
    roomStatsNotice: HTMLElement;
    playerFilter: HTMLSelectElement;
    selectCreator(id: string): void;
    deleteItems(urls: string[], kind: HistoryKind): Promise<string[]>;
}
export function statisticsView({ statsOverview, statsList, statsNotice, videoStatsList, videoStatsNotice,
    roomStatsList, roomStatsNotice, playerFilter, selectCreator, deleteItems }: StatisticsElements) {
    const videoSelection = historySelection({ kind: 'videos', list: videoStatsList,
        remove: urls => deleteItems(urls, 'videos'),
        confirmation: count => `${count} ${count === 1 ? 'ausgewähltes Video' : 'ausgewählte Videos'} wirklich löschen? Du kannst dies 30 Sekunden lang rückgängig machen. Punkte und Bewertungen bleiben erhalten.` });
    const roomSelection = historySelection({ kind: 'rooms', list: roomStatsList,
        remove: urls => deleteItems(urls, 'rooms'),
        confirmation: count => `${count} ${count === 1 ? 'ausgewählten Raum' : 'ausgewählte Räume'} wirklich löschen? Runden, Bewertungen und Spielpunkte dieser ${count === 1 ? 'Partie' : 'Partien'} werden dauerhaft gelöscht. Videos und Benutzerkonten bleiben erhalten.` });
    const videoUrl = (video: VideoStats) => `/api/stats/videos/${video.id}`;
    function resetEditing() { videoSelection.reset(); roomSelection.reset(); }
    function renderStatsOverview(overview: StatsOverview) {
        statsOverview.innerHTML = '';

        const items = [
            { label: 'Spiele', value: overview.gamesPlayed },
            { label: 'Beendet', value: overview.completedGames },
            { label: 'Erstellte Videos', value: overview.roundsPlayed },
            { label: 'Bewertungen', value: overview.votesCast },
            { label: 'Videos', value: overview.videosArchived },
            { label: 'Höchstpunktzahl', value: overview.highestScore }
        ];

        items.forEach(item => {
            const card = document.createElement('div');
            card.className = 'stat-card';

            const value = document.createElement('strong');
            value.innerText = String(item.value);

            const label = document.createElement('span');
            label.innerText = item.label;

            card.append(value, label);
            statsOverview.appendChild(card);
        });
    }

    function renderStats(players: PlayerStats[], creators: VideoCreator[] = []) {
        statsList.innerHTML = '';
        const selected = playerFilter.value;
        const selectedName = playerFilter.selectedOptions[0]?.textContent || 'Unbekannt';
        playerFilter.replaceChildren(new Option('Alle Spieler', ''));
        const choices = new Map(players.map(player => [player.id || `legacy:${player.name.toLowerCase()}`, player.name]));
        creators.forEach(creator => choices.set(creator.id, creator.name));
        if (selected && !choices.has(selected)) choices.set(selected, selectedName);
        choices.forEach((name, id) => playerFilter.add(new Option(name, id)));
        playerFilter.value = selected;

        if (players.length === 0) {
            statsNotice.innerText = 'Noch keine gespeicherten Runden vorhanden.';
            return;
        }

        statsNotice.innerText = 'Gespeicherte Gesamtwertung über alle Spiele.';
        players.forEach((player, index) => {
            const li = document.createElement('li');
            li.className = `score-item ${index === 0 ? 'leader' : ''}`;

            const playerInfo = document.createElement('div');
            playerInfo.className = 'player-info';

            const rankBadge = document.createElement('span');
            rankBadge.className = 'rank-badge';
            rankBadge.innerText = `#${index + 1}`;

            const name = document.createElement('button');
            name.type = 'button';
            name.className = 'player-name player-video-filter';
            name.title = `Videos von ${player.name} ansehen`;
            name.innerText = player.name;
            name.addEventListener('click', () => selectCreator(player.id || `legacy:${player.name.toLowerCase()}`));

            const details = document.createElement('span');
            playerInfo.classList.add('stats-player-info');
            details.className = 'stat-details';
            details.innerText = `${player.gamesPlayed} ${player.gamesPlayed === 1 ? 'Spiel' : 'Spiele'} · ${player.wins} ${player.wins === 1 ? 'Sieg' : 'Siege'} · ${player.roundsCreated} ${player.roundsCreated === 1 ? 'Video' : 'Videos'} · Ø ${player.averageReceivedPoints} Pkt./Video · Ø Bewertung ${player.averageVoteGiven}`;

            const score = document.createElement('span');
            score.className = 'score-badge';
            score.innerText = `${player.totalScore} Pkt.`;

            playerInfo.append(rankBadge, name, details);
            li.append(playerInfo, score);
            statsList.appendChild(li);
        });
    }

    function renderVideoStats(videos: VideoStats[], videoStorageMode: string) {
        videoStatsList.innerHTML = '';

        if (videos.length === 0) {
            videoStatsNotice.innerText = playerFilter.value ? 'Keine Videos für diesen Spieler gespeichert.' : 'Noch keine Videos gespeichert.';
            videoSelection.update();
            return;
        }

        videoStatsNotice.innerText = videoStorageMode === 'url'
            ? 'Video-Links zu gespielten Runden. Die Links können später ablaufen.'
            : 'Gespeicherte Videos aus den letzten Runden.';

        videos.forEach(video => {
            const li = document.createElement('li');
            li.className = 'video-stat-item';

            const videoElement = document.createElement('video');
            videoElement.controls = true;
            videoElement.preload = 'none';
            videoElement.playsInline = true;
            const notice = document.createElement('small');
            notice.className = 'error-msg';
            notice.setAttribute('role', 'alert');
            const retry = document.createElement('button');
            retry.type = 'button';
            retry.className = 'btn-muted';
            retry.textContent = 'Video erneut laden';
            const playback = videoPlayback({ video: videoElement, notice, retry });
            playback.load(video.videoUrl);
            const media = document.createElement('div');
            media.className = 'video-stat-media';
            media.append(videoElement, notice, retry);

            const meta = document.createElement('div');
            meta.className = 'video-stat-meta';

            const title = document.createElement('strong');
            title.innerText = `${video.creatorName} · ${video.roomDeleted ? 'Gelöschter Raum' : 'Raum'} ${video.roomCode} · Video ${video.roundNumber}`;

            const prompt = document.createElement('span');
            prompt.innerText = video.prompt;

            const points = document.createElement('small');
            points.innerText = `${video.roundPoints} Punkte · ${new Date(video.createdAt).toLocaleDateString('de-DE')}`;

            const selection = videoSelection.checkbox(videoUrl(video), `Video ${video.roundNumber} von ${video.creatorName} in Raum ${video.roomCode} auswählen`);
            meta.append(title, prompt, points, selection);
            li.append(media, meta);
            videoStatsList.appendChild(li);
        });
        videoSelection.update();
    }
    function renderRooms(rooms: RoomStats[]) {
        roomStatsList.replaceChildren();
        roomStatsNotice.textContent = rooms.length ? '' : 'Noch keine gespeicherten Räume vorhanden.';
        rooms.forEach(room => {
            const li = document.createElement('li');
            li.className = 'score-item room-stat-item';
            const meta = document.createElement('div');
            meta.className = 'video-stat-meta';
            const title = document.createElement('strong');
            title.textContent = `Raum ${room.code}`;
            const detail = document.createElement('small');
            detail.textContent = `${room.playerCount} Spieler · ${room.videoCount} ${room.videoCount === 1 ? 'Video' : 'Videos'} · ${room.totalPoints} Punkte · ${new Date(room.createdAt).toLocaleDateString('de-DE')}`;
            const result = document.createElement('small');
            result.textContent = room.status === 'GAME_OVER' ? `Beendet${room.winnerName ? ` · Gewinner: ${room.winnerName}` : ''}`
                : room.status === 'LOBBY' ? 'Nicht gestartet' : 'Partie begonnen';
            meta.append(title, detail, result);
            li.append(meta, roomSelection.checkbox(`/api/stats/rooms/${room.code}`, `Raum ${room.code} auswählen`));
            roomStatsList.append(li);
        });
        roomSelection.update();
    }
    return { renderStatsOverview, renderStats, renderVideoStats, renderRooms, resetEditing };
}
