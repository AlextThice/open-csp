import process from 'node:process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { generateIcons } from './generate-icons.mjs';
import { generateLicenseNotices } from './generate-license-notices.mjs';

const require = createRequire(import.meta.url);
const { createPackageConfig } = require('./package-config.cjs');
const { build, Platform, Arch } = require('electron-builder');
const argumentsList = process.argv.slice(2);
if (argumentsList.some((value) => !['--win', '--linux', '--mac', '--signed'].includes(value)))
  throw new Error('Usage: node scripts/package.mjs [--win|--linux|--mac] [--signed]');
const targets = argumentsList.filter((value) => value !== '--signed');
if (targets.length > 1) throw new Error('Select exactly one target platform.');
const selected =
  targets[0] ?? { win32: '--win', linux: '--linux', darwin: '--mac' }[process.platform];
const targetPlatform = { '--win': 'win32', '--linux': 'linux', '--mac': 'darwin' }[selected];
if (!targetPlatform) throw new Error('Unsupported packaging platform.');
const signed = argumentsList.includes('--signed');
if ((signed || targetPlatform === 'darwin') && targetPlatform !== process.platform)
  throw new Error('macOS and signed packages must be built on their native OS.');
if (targetPlatform === 'darwin' && process.arch !== 'arm64')
  throw new Error('macOS packaging/smoke requires an Apple Silicon arm64 host.');
process.env.OPENSCP_SIGNED_BUILD = signed ? '1' : '0';
if (!signed) {
  process.env.CSC_IDENTITY_AUTO_DISCOVERY = 'false';
  // Prevent accidentally signing a development artifact with ambient credentials.
  for (const name of [
    'CSC_LINK',
    'CSC_NAME',
    'CSC_KEY_PASSWORD',
    'WIN_CSC_LINK',
    'WIN_CSC_KEY_PASSWORD',
  ])
    Reflect.deleteProperty(process.env, name);
}
createPackageConfig(process.env, targetPlatform);
await generateIcons();
await generateLicenseNotices();
const vite = join(dirname(require.resolve('electron-vite/package.json')), 'bin/electron-vite.js');
const result = spawnSync(process.execPath, [vite, 'build'], {
  stdio: 'inherit',
  windowsHide: true,
});
if (result.status !== 0) throw new Error('Application build failed.');
const platform = { win32: Platform.WINDOWS, linux: Platform.LINUX, darwin: Platform.MAC }[
  targetPlatform
];
await build({
  // Load once: merging the same config twice duplicates extraResources copy jobs.
  config: 'electron-builder.cjs',
  targets: platform.createTarget(undefined, targetPlatform === 'darwin' ? Arch.arm64 : Arch.x64),
  publish: 'never',
});
