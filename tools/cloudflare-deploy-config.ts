import { isWorldsProductionDatabase, WORLDS_PRODUCTION_VARS } from '../src/auth/worlds-production';

export const REQUIRED_WORLDS_TABLES = [
    'worlds_auth_transactions', 'worlds_auth_sessions', 'worlds_auth_replays',
    'worlds_session_revocations', 'worlds_identity_links', 'worlds_link_audit',
    'worlds_migration_approvals'
] as const;

export function deploymentMode(args: readonly string[]) {
    const allowed = new Set(['--worlds-production', '--dry-run', '--enable-worlds-legacy-password-link']);
    const unknown = args.filter(arg => !allowed.has(arg));
    if (unknown.length) throw new Error(`Unbekannte Deployment-Optionen: ${unknown.join(', ')}`);
    const production = args.includes('--worlds-production');
    const legacyPasswordLink = args.includes('--enable-worlds-legacy-password-link');
    if (legacyPasswordLink && !production) throw new Error('Die Altprofil-Übernahme setzt --worlds-production voraus.');
    return { production, dryRun: args.includes('--dry-run'), legacyPasswordLink };
}

export function productionDeployArgs(databaseUrl: string | undefined, legacyPasswordLink = false) {
    if (!isWorldsProductionDatabase(databaseUrl)) {
        throw new Error('Worlds-Produktivdeployment abgebrochen: DATABASE_URL ist nicht die geprüfte Slop-Urself-Produktionsdatenbank.');
    }
    const vars = {...WORLDS_PRODUCTION_VARS, WORLDS_LEGACY_PASSWORD_LINK_ENABLED: String(legacyPasswordLink)};
    return Object.entries(vars).flatMap(([name, value]) => ['--var', `${name}:${value}`]);
}
