const startupScreen = document.getElementById('screenStartup')!;
const startupStatus = document.getElementById('startupStatus')!;
function startupError(message: string) {
    if (startupScreen.style.display !== 'none') startupStatus.innerText = message;
}
if (location.protocol === 'file:') {
    startupError('Bitte öffne das Spiel über den laufenden Server oder den Cloudflare-Link, nicht als HTML-Datei.');
} else {
    window.addEventListener('error', () => startupError('Das Spiel konnte nicht geladen werden. Bitte lade die Seite erneut.'), true);
    window.addEventListener('unhandledrejection', () => startupError('Das Spiel konnte nicht gestartet werden. Bitte lade die Seite erneut.'));
    window.setTimeout(() => startupError('Keine Verbindung zum Spiel. Bitte prüfe die Server-Adresse und lade die Seite erneut.'), 15_000);
}
