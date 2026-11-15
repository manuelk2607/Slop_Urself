import { isWorldsProductionDatabase, WORLDS_PRODUCTION_VARS } from '../src/auth/worlds-production';

export const REQUIRED_WORLDS_TABLES = [
    'worlds_auth_transactions', 'worlds_auth_sessions', 'worlds_auth_replays',
    'worlds_session_revocations', 'worlds_identity_links', 'worlds_link_audit',
    'worlds_migration_approvals'
] as const;

export function deploymentMode(args: readonly string[]) {
    const allowed = new Set(['--worlds-production', '--dry-run']);
    const unknown = args.filter(arg => !allowed.has(arg));
    if (unknown.length) throw new Error(`Unbekannte Deployment-Optionen: ${unknown.join(', ')}`);
    return { production: args.includes('--worlds-production'), dryRun: args.includes('--dry-run') };
}

export function productionDeployArgs(databaseUrl: string | undefined) {
    if (!isWorldsProductionDatabase(databaseUrl)) {
        throw new Error('Worlds-Produktivdeployment abgebrochen: DATABASE_URL ist nicht die geprüfte Slop-Urself-Produktionsdatenbank.');
    }
    return Object.entries(WORLDS_PRODUCTION_VARS).flatMap(([name, value]) => ['--var', `${name}:${value}`]);
}
