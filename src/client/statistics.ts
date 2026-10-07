import type { PlayerStats, StatsOverview, VideoStats } from '../database/types';

interface StatisticsElements {
    statsOverview: HTMLDivElement;
    statsList: HTMLUListElement;
    statsNotice: HTMLParagraphElement;
    videoStatsList: HTMLUListElement;
    videoStatsNotice: HTMLParagraphElement;
}
export function statisticsView({ statsOverview, statsList, statsNotice, videoStatsList, videoStatsNotice }: StatisticsElements) {
    function renderStatsOverview(overview: StatsOverview) {
        statsOverview.innerHTML = '';

        const items = [
            { label: 'Spiele', value: overview.gamesPlayed },
            { label: 'Beendet', value: overview.completedGames },
            { label: 'Erstellte Videos', value: overview.roundsPlayed },
            { label: 'Votes', value: overview.votesCast },
            { label: 'Videos', value: overview.videosArchived },
            { label: 'Topscore', value: overview.highestScore }
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

    function renderStats(players: PlayerStats[]) {
        statsList.innerHTML = '';

        if (players.length === 0) {
            statsNotice.innerText = 'Noch keine gespeicherten Runden vorhanden.';
            return;
        }

        statsNotice.innerText = 'Gespeicherte Gesamtwertung ueber alle Spiele.';
        players.forEach((player, index) => {
            const li = document.createElement('li');
            li.className = `score-item ${index === 0 ? 'leader' : ''}`;

            const playerInfo = document.createElement('div');
            playerInfo.className = 'player-info';

            const rankBadge = document.createElement('span');
            rankBadge.className = 'rank-badge';
            rankBadge.innerText = `#${index + 1}`;

            const name = document.createElement('span');
            name.className = 'player-name';
            name.innerText = player.name;

            const details = document.createElement('span');
            playerInfo.classList.add('stats-player-info');
            details.className = 'stat-details';
            details.innerText = `${player.gamesPlayed} Spiele · ${player.wins} Siege · ${player.roundsCreated} Videos · Ø ${player.averageReceivedPoints} Pkt./Video · Ø Vote ${player.averageVoteGiven}`;

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
            videoStatsNotice.innerText = 'Noch keine Videos gespeichert.';
            return;
        }

        videoStatsNotice.innerText = videoStorageMode === 'url'
            ? 'Video-Links zu gespielten Runden. Die Links koennen spaeter ablaufen.'
            : 'Gespeicherte Videos aus den letzten Runden.';

        videos.forEach(video => {
            const li = document.createElement('li');
            li.className = 'video-stat-item';

            const videoElement = document.createElement('video');
            videoElement.controls = true;
            videoElement.preload = 'none';
            videoElement.playsInline = true;
            videoElement.addEventListener('error', () => {
                const unavailable = document.createElement('small');
                unavailable.innerText = videoStorageMode === 'archive' ? 'Video wurde aus dem Archiv entfernt oder ist vorübergehend nicht erreichbar.' : 'Video-Link ist nicht mehr verfuegbar.';
                li.appendChild(unavailable);
            }, { once: true });
            videoElement.src = video.videoUrl;

            const meta = document.createElement('div');
            meta.className = 'video-stat-meta';

            const title = document.createElement('strong');
            title.innerText = `${video.creatorName} · Raum ${video.roomCode} · Video ${video.roundNumber}`;

            const prompt = document.createElement('span');
            prompt.innerText = video.prompt;

            const points = document.createElement('small');
            points.innerText = `${video.roundPoints} Punkte · ${new Date(video.createdAt).toLocaleDateString('de-DE')}`;

            meta.append(title, prompt, points);
            li.append(videoElement, meta);
            videoStatsList.appendChild(li);
        });
    }
    return { renderStatsOverview, renderStats, renderVideoStats };
}
