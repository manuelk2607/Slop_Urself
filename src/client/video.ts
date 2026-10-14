interface PlaybackElements {
    video: HTMLVideoElement;
    notice: HTMLElement;
    retry: HTMLButtonElement;
}

export function videoPlayback({ video, notice, retry }: PlaybackElements) {
    let revision = 0;
    let loaded = false;

    function clear() {
        notice.hidden = true;
        notice.textContent = '';
        retry.hidden = true;
    }

    function report(message: string, canRetry = true) {
        notice.textContent = message;
        notice.hidden = false;
        retry.hidden = !canRetry;
    }

    async function diagnose() {
        const current = revision;
        let message = video.error?.code === 3
            ? 'Das Video konnte nicht decodiert werden. Die Datei kann beschädigt sein.'
            : 'Das Video konnte nicht geladen werden. Der Link ist nicht erreichbar oder das Format wird nicht unterstützt.';
        const source = new URL(video.getAttribute('src') || '', location.href);
        if (source.origin === location.origin && source.pathname.startsWith('/api/videos/')) {
            try {
                const response = await fetch(source, { headers: { range: 'bytes=0-1' }, cache: 'no-store', signal: AbortSignal.timeout(10_000) });
                await response.body?.cancel();
                if (response.status === 401) message = 'Deine Sitzung ist abgelaufen. Bitte melde dich erneut an.';
                else if (response.status === 404 || response.status === 410) message = 'Dieses Video ist nicht mehr im Archiv vorhanden.';
                else if (!response.ok) message = 'Das Videoarchiv ist gerade nicht erreichbar. Versuche es erneut.';
            } catch { message = 'Das Videoarchiv konnte nicht erreicht werden. Prüfe deine Verbindung und versuche es erneut.'; }
        }
        if (revision === current && !loaded) report(message);
    }

    async function play() {
        const current = revision;
        try { await video.play(); }
        catch (error) {
            if (revision !== current || (error instanceof DOMException && error.name === 'AbortError')) return;
            if (error instanceof DOMException && error.name === 'NotAllowedError') report('Bitte starte das Video mit dem Play-Button.');
            else { report('Das Video konnte nicht gestartet werden.'); void diagnose(); }
        }
    }

    function load(url: string, autoplay = false) {
        revision++;
        loaded = false;
        clear();
        video.src = url;
        video.load();
        if (autoplay) void play();
    }

    video.addEventListener('loadeddata', () => { loaded = true; clear(); });
    video.addEventListener('playing', clear);
    video.addEventListener('error', () => {
        loaded = false;
        report('Das Video konnte nicht geladen werden.');
        void diagnose();
    });
    retry.addEventListener('click', () => {
        const url = video.getAttribute('src');
        if (url) load(url, true);
    });
    return { load, play };
}
