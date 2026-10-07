import { tmpdir } from 'node:os';
import path from 'node:path';

export const artifactPath = (name: string) => path.join(process.env.TEST_ARTIFACT_DIR || tmpdir(), name);
