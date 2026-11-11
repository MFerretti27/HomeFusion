import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createManifest, parseReleaseTag, resolveReleaseTag } from './create-manifest.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function parseOptions(args) {
    const options = {};
    for (let index = 0; index < args.length; index += 1) {
        const name = args[index];
        if (name === '--help' || name === '-h') {
            console.log('Usage: npm run build:plugin [-- --version X.Y.Z] [--repository OWNER/REPO]');
            process.exit(0);
        }
        if (name !== '--version' && name !== '--repository') {
            throw new Error(`Unknown option: ${name}`);
        }
        const value = args[index + 1];
        if (!value || value.startsWith('--')) {
            throw new Error(`Expected a value after ${name}.`);
        }
        options[name.slice(2)] = value;
        index += 1;
    }
    return options;
}

function getRepository(explicitRepository) {
    if (explicitRepository) return explicitRepository;
    if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY;

    let remote;
    try {
        remote = execFileSync('git', ['config', '--get', 'remote.origin.url'], {
            cwd: repositoryRoot,
            encoding: 'utf8'
        }).trim();
    } catch {
        throw new Error('Cannot determine the GitHub repository. Pass --repository OWNER/REPO.');
    }

    const match = /github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/i.exec(remote);
    if (!match) {
        throw new Error('The origin remote is not a GitHub URL. Pass --repository OWNER/REPO.');
    }
    return match[1];
}

function run(command, args) {
    console.log(`\n> ${command} ${args.join(' ')}`);
    const result = spawnSync(command, args, { cwd: repositoryRoot, stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) {
        throw new Error(`${command} exited with status ${result.status ?? 'unknown'}.`);
    }
}

const options = parseOptions(process.argv.slice(2));
const tags = execFileSync('git', ['tag', '--list', 'v*'], {
    cwd: repositoryRoot,
    encoding: 'utf8'
}).trim().split(/\s+/).filter(Boolean);
const tag = resolveReleaseTag(tags, options.version ?? '');
const { version } = parseReleaseTag(tag);
const repository = getRepository(options.repository);
const archiveName = `HomeFusion_${version}.zip`;
const archivePath = resolve(repositoryRoot, 'artifacts', archiveName);
const manifestPath = resolve(repositoryRoot, 'artifacts', 'manifest.json');

run('npm', ['ci']);
run('dotnet', [
    'test', 'tests/HomeFusion.Tests/HomeFusion.Tests.csproj',
    '-c', 'Release', `-p:Version=${version}`
]);
run('npm', ['run', 'check']);
run('npm', ['test']);
run('dotnet', [
    'build', 'Jellyfin.Plugin.HomeFusion/Jellyfin.Plugin.HomeFusion.csproj',
    '-c', 'Release', '-t:PackagePlugin', `-p:Version=${version}`
]);

const projectXml = readFileSync(resolve(repositoryRoot,
    'Jellyfin.Plugin.HomeFusion/Jellyfin.Plugin.HomeFusion.csproj'), 'utf8');
const manifest = createManifest({
    repository,
    tag,
    archiveName,
    archiveBytes: readFileSync(archivePath),
    projectXml
});
mkdirSync(dirname(manifestPath), { recursive: true });
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

console.log(`\nPrepared HomeFusion ${version}.`);
console.log(`Plugin ZIP: ${archivePath}`);
console.log(`Repository manifest preview: ${manifestPath}`);
console.log(`The manifest points to the future ${tag} GitHub release; this script does not create or push a tag or release.`);
