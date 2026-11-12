import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function parseReleaseTag(tag) {
    const match = /^v(\d+)\.(\d+)\.(\d+)$/.exec(tag);
    if (!match || match[0] !== tag || match.slice(1).some(part => Number(part) > 65534 || String(Number(part)) !== part)) {
        throw new Error('Release tags must be vMAJOR.MINOR.PATCH with canonical numeric components from 0 to 65534.');
    }
    return { version: match.slice(1).join('.'), manifestVersion: `${match.slice(1).join('.')}.0` };
}

export function getLatestReleaseTag(existingTags) {
    const parsedTags = existingTags.flatMap(tag => {
        try {
            return [{ tag, parts: parseReleaseTag(tag).version.split('.').map(Number) }];
        } catch {
            return [];
        }
    });
    const compareParts = (left, right) => {
        for (let index = 0; index < left.length; index += 1) {
            if (left[index] !== right[index]) return left[index] - right[index];
        }
        return 0;
    };
    const latest = parsedTags.reduce((current, candidate) =>
        !current || compareParts(candidate.parts, current.parts) > 0 ? candidate : current, undefined);
    return latest?.tag;
}

export function resolveReleaseTag(existingTags, requestedVersion = '', resumeTag = '') {
    const latestTag = getLatestReleaseTag(existingTags);
    const parseParts = tag => parseReleaseTag(tag).version.split('.').map(Number);
    const compareParts = (left, right) => {
        for (let index = 0; index < left.length; index += 1) {
            if (left[index] !== right[index]) return left[index] - right[index];
        }
        return 0;
    };
    const latestParts = latestTag ? parseParts(latestTag) : undefined;

    const input = requestedVersion.trim();
    if (input) {
        const tag = input.startsWith('v') ? input : `v${input}`;
        const requestedParts = parseParts(tag);
        if (existingTags.includes(tag)) {
            throw new Error(`Release tag ${tag} already exists.`);
        }
        if (latestTag && compareParts(requestedParts, latestParts) <= 0) {
            throw new Error(`Release version ${tag} must be greater than the latest tag ${latestTag}.`);
        }
        return tag;
    }

    if (resumeTag) {
        if (!existingTags.includes(resumeTag)) {
            throw new Error(`Cannot resume release because tag ${resumeTag} does not exist.`);
        }
        parseReleaseTag(resumeTag);
        return resumeTag;
    }

    if (!latestTag) return 'v1.0.0';

    const [major, minor, patch] = latestParts;
    if (patch < 65534) return `v${major}.${minor}.${patch + 1}`;
    if (minor < 65534) return `v${major}.${minor + 1}.0`;
    if (major < 65534) return `v${major + 1}.0.0`;
    throw new Error('Cannot automatically increment the release version beyond v65534.65534.65534.');
}

function releaseLink(repository, tag) {
    return `[View release on GitHub](https://github.com/${repository}/releases/tag/${tag})`;
}

export function collectReleaseHistory({ repository, currentTag, releases, downloadManifest }) {
    const history = [];
    for (const release of releases) {
        if (release.draft || release.prerelease || release.tag_name === currentTag) continue;
        let parsed;
        try {
            parsed = parseReleaseTag(release.tag_name);
        } catch {
            continue;
        }
        const archive = `HomeFusion_${parsed.version}.zip`;
        if (!release.assets.some(asset => asset.name === 'manifest.json') ||
            !release.assets.some(asset => asset.name === archive)) {
            throw new Error(`Published release ${release.tag_name} is missing its manifest or plugin ZIP.`);
        }
        const manifest = JSON.parse(downloadManifest(release.tag_name));
        if (!Array.isArray(manifest)) throw new Error(`Invalid manifest for ${release.tag_name}.`);
        const plugin = manifest.find(entry => entry.guid === '8c6f0a52-3b5e-4d8a-9a3e-6a1f2b7c4d10');
        const matches = Array.isArray(plugin?.versions)
            ? plugin.versions.filter(entry => entry.version === parsed.manifestVersion) : [];
        const entry = matches[0];
        const expectedUrl = `https://github.com/${repository}/releases/download/${release.tag_name}/${archive}`;
        if (matches.length !== 1 || entry.sourceUrl !== expectedUrl ||
            !/^[a-f0-9]{32}$/i.test(entry.checksum) ||
            !/^\d+\.\d+\.\d+\.\d+$/.test(entry.targetAbi) ||
            !entry.timestamp || Number.isNaN(Date.parse(entry.timestamp)) ||
            (entry.changelog != null && typeof entry.changelog !== 'string')) {
            throw new Error(`Invalid version metadata in manifest for ${release.tag_name}.`);
        }
        if (history.some(previous => previous.version === entry.version)) {
            throw new Error(`Duplicate published release version ${entry.version}.`);
        }
        const link = releaseLink(repository, release.tag_name);
        const changelog = entry.changelog || '';
        history.push({ ...entry, changelog: changelog.includes(link) ? changelog : [changelog, link].filter(Boolean).join('\n\n') });
    }
    return history;
}

export function createManifest({ repository, tag, archiveName, archiveBytes, projectXml, now = new Date(), previousVersions = [] }) {
    const { version, manifestVersion } = parseReleaseTag(tag);
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
        throw new Error('Repository must be GitHub OWNER/REPOSITORY.');
    }
    if (archiveName !== `HomeFusion_${version}.zip` || !archiveBytes.length) {
        throw new Error('Archive must be a nonempty HomeFusion_VERSION.zip matching the release tag.');
    }
    const controllerVersion = /<PackageReference\s+Include="Jellyfin.Controller"\s+Version="(\d+\.\d+\.\d+)"/.exec(projectXml)?.[1];
    const modelVersion = /<PackageReference\s+Include="Jellyfin.Model"\s+Version="(\d+\.\d+\.\d+)"/.exec(projectXml)?.[1];
    if (!controllerVersion || controllerVersion !== modelVersion) {
        throw new Error('Expected matching pinned Jellyfin.Controller and Jellyfin.Model package versions.');
    }
    if (!Array.isArray(previousVersions) || previousVersions.some(entry =>
        !entry || !/^\d+\.\d+\.\d+\.\d+$/.test(entry.version) || entry.version === manifestVersion)) {
        throw new Error('Previous versions must have valid, distinct version numbers.');
    }
    if (new Set(previousVersions.map(entry => entry.version)).size !== previousVersions.length) {
        throw new Error('Previous versions must have valid, distinct version numbers.');
    }
    const versions = [{
        version: manifestVersion,
        changelog: `HomeFusion ${version}.\n\n${releaseLink(repository, tag)}`,
        targetAbi: `${controllerVersion}.0`,
        sourceUrl: `https://github.com/${repository}/releases/download/${tag}/${archiveName}`,
        // Jellyfin's plugin installer expects MD5, not SHA-256. Hash the exact uploaded ZIP bytes.
        checksum: createHash('md5').update(archiveBytes).digest('hex'),
        timestamp: now.toISOString()
    }, ...previousVersions];
    versions.sort((left, right) => {
        const a = left.version.split('.').map(Number), b = right.version.split('.').map(Number);
        for (let i = 0; i < 4; i += 1) if (a[i] !== b[i]) return b[i] - a[i];
        return 0;
    });
    return [{
        guid: '8c6f0a52-3b5e-4d8a-9a3e-6a1f2b7c4d10',
        name: 'HomeFusion',
        description: 'Adds Genres, Ratings and Release Date rows of landscape cards to the Jellyfin Web home screen, with per-row visibility and placement settings. Native clients are not modified.',
        overview: 'Browse your library by genre, rating and release date from Home.',
        owner: repository.split('/')[0],
        category: 'General',
        imageUrl: `https://github.com/${repository}/releases/download/${tag}/homefusion.png`,
        versions
    }];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const [repository, tag, archivePath, outputPath, historyFlag] = process.argv.slice(2);
    if (!repository || !tag || !archivePath || !outputPath ||
        (historyFlag && historyFlag !== '--include-release-history') || process.argv.length > 7) {
        throw new Error('Usage: node scripts/create-manifest.mjs OWNER/REPO vX.Y.Z ARCHIVE_PATH OUTPUT_PATH [--include-release-history]');
    }
    const projectXml = readFileSync(new URL('../Jellyfin.Plugin.HomeFusion/Jellyfin.Plugin.HomeFusion.csproj', import.meta.url), 'utf8');
    let previousVersions = [];
    if (historyFlag) {
        if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
            throw new Error('Repository must be GitHub OWNER/REPOSITORY.');
        }
        const pages = JSON.parse(execFileSync('gh', ['api', '--paginate', '--slurp',
            `repos/${repository}/releases?per_page=100`], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }));
        previousVersions = collectReleaseHistory({
            repository, currentTag: tag, releases: pages.flat(),
            downloadManifest: releaseTag => execFileSync('gh', ['release', 'download', releaseTag,
                '--repo', repository, '--pattern', 'manifest.json', '--output', '-'], { encoding: 'utf8' })
        });
    }
    const manifest = createManifest({ repository, tag, archiveName: basename(archivePath),
        archiveBytes: readFileSync(archivePath), projectXml, previousVersions });
    writeFileSync(outputPath, JSON.stringify(manifest, null, 2) + '\n');
    console.log(`Created ${outputPath} for ${tag}, with ${manifest[0].versions.length} release(s).`);
}