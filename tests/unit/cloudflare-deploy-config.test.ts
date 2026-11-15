import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deploymentMode, productionDeployArgs, REQUIRED_WORLDS_TABLES } from '../../tools/cloudflare-deploy-config';
import { WORLDS_PRODUCTION_VARS } from '../../src/auth/worlds-production';

const database = 'postgresql://fixture@ep-holy-voice-b1djk94x-pooler.c-5.eu-central-1.aws.neon.tech/Slop_Urself';

test('deployment mode rejects accidental options and requires explicit production activation', () => {
    assert.deepEqual(deploymentMode([]), { production: false, dryRun: false });
    assert.deepEqual(deploymentMode(['--dry-run', '--worlds-production']), { production: true, dryRun: true });
    assert.throws(() => deploymentMode(['--production']), /Unbekannte/);
});

test('production deployment accepts only the reviewed database and supplies every exact Worlds binding', () => {
    const args = productionDeployArgs(database);
    for (const [name, value] of Object.entries(WORLDS_PRODUCTION_VARS)) {
        assert.ok(args.includes(`${name}:${value}`));
    }
    assert.throws(() => productionDeployArgs('postgres://fixture@other.test/Slop_Urself'), /Produktionsdatenbank/);
    assert.throws(() => productionDeployArgs(database.replace('/Slop_Urself', '/other')), /Produktionsdatenbank/);
    assert.ok(REQUIRED_WORLDS_TABLES.includes('worlds_identity_links'));
});
