export const WORLDS_PRODUCTION_VARS = Object.freeze({
    WORLDS_PRODUCTION_ENABLED: 'true',
    WORLDS_ISSUER: 'https://ep-bold-boat-batl101c.neonauth.c-8.eu-central-1.aws.neon.tech/worlds_identity/auth',
    WORLDS_CLIENT_ID: 'BBHPxFFlfMahuTkpeBpLeUfkqjVGYfPO',
    WORLDS_RESOURCE: 'https://slopurself.maki26.workers.dev/api'
} as const);

export const WORLDS_PRODUCTION_ORIGIN = 'https://slopurself.maki26.workers.dev';
export const WORLDS_PRODUCTION_DATABASE_HOST = 'ep-holy-voice-b1djk94x.c-5.eu-central-1.aws.neon.tech';
export const WORLDS_PRODUCTION_DATABASE_NAME = 'Slop_Urself';

export function isWorldsProductionDatabase(value: string | undefined) {
    if (!value) return false;
    try {
        const database = new URL(value);
        return ['postgres:', 'postgresql:'].includes(database.protocol) &&
            database.hostname.replace(/-pooler\./, '.') === WORLDS_PRODUCTION_DATABASE_HOST &&
            decodeURIComponent(database.pathname) === '/' + WORLDS_PRODUCTION_DATABASE_NAME;
    } catch { return false; }
}
