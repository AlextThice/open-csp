import { writeFile, unlink } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import process from 'node:process';

const directory = process.env.RUNNER_TEMP;
if (!directory || !isAbsolute(directory)) throw new Error('Requires an absolute CI RUNNER_TEMP.');
const path = join(directory, 'openscp-notary-key.p8');
if (process.argv[2] === '--remove') {
  try {
    await unlink(path);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
} else {
  const content = process.env.APPLE_API_KEY_CONTENT;
  if (!content?.includes('BEGIN PRIVATE KEY'))
    throw new Error('Missing notarization API key secret.');
  await writeFile(path, content, { mode: 0o600, flag: 'wx' });
}
