const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const modulePromise = import('../../scripts/create-manifest.mjs');
const projectXml = readFileSync('Jellyfin.Plugin.HomeFusion/Jellyfin.Plugin.HomeFusion.csproj', 'utf8');
const input = {
    repository: 'MFerretti27/HomeFusion', tag: 'v1.2.3', archiveName: 'HomeFusion_1.2.3.zip',
    archiveBytes: Buffer.from('fixture archive bytes'), projectXml, now: new Date('2026-11-05T12:00:00Z')
};

test('catalog artwork is a valid 1280 by 720 PNG', async () => {
    const { default: sharp } = await import('sharp');
    const metadata = await sharp('assets/homefusion.png').metadata();
    assert.equal(metadata.format, 'png');
    assert.equal(metadata.width, 1280);
    assert.equal(metadata.height, 720);
});

test('generates a Jellyfin repository array with pinned asset URL, ABI and exact MD5', async () => {
    const { createManifest } = await modulePromise;
    const manifest = createManifest(input);
    assert.equal(manifest.length, 1);
    assert.equal(manifest[0].guid, '8c6f0a52-3b5e-4d8a-9a3e-6a1f2b7c4d10');
    assert.equal(manifest[0].imageUrl, 'https://github.com/MFerretti27/HomeFusion/releases/download/v1.2.3/homefusion.png');
    const release = manifest[0].versions[0];
    assert.equal(release.version, '1.2.3.0');
    assert.equal(release.targetAbi, '12.4.0.0');
    assert.equal(release.sourceUrl, 'https://github.com/MFerretti27/HomeFusion/releases/download/v1.2.3/HomeFusion_1.2.3.zip');
    assert.equal(release.checksum, createHash('md5').update(input.archiveBytes).digest('hex'));
    assert.match(release.checksum, /^[a-f0-9]{32}$/);
    assert.equal(release.timestamp, '2026-11-05T12:00:00.000Z');
    assert.match(release.changelog, /\[View release on GitHub\]\(https:\/\/github\.com\/MFerretti27\/HomeFusion\/releases\/tag\/v1\.2\.3\)/);
    assert.deepEqual(JSON.parse(JSON.stringify(manifest)), manifest);
});

test('recovers all published stable release metadata and links each changelog', async () => {
    const { collectReleaseHistory, createManifest } = await modulePromise;
    const prior = ['1.0.0', '1.0.1', '1.0.10'].map(version => {
        const tag = `v${version}`;
        const manifest = createManifest({
            ...input, tag, archiveName: `HomeFusion_${version}.zip`,
            now: new Date('2026-01-01T00:00:00Z')
        });
        manifest[0].versions[0].changelog = `Old release notes for ${tag}`;
        return { tag, manifest };
    });
    const releases = prior.map(({ tag }) => ({
        tag_name: tag, draft: false, prerelease: false,
        assets: [{ name: 'manifest.json' }, { name: `HomeFusion_${tag.slice(1)}.zip` }]
    }));
    releases.push({ tag_name: 'v1.2.3', draft: true, assets: [] },
        { tag_name: 'v1.1.0', prerelease: true, assets: [] },
        { tag_name: 'v1.2.0-beta', draft: false, prerelease: false, assets: [] });
    const previousVersions = collectReleaseHistory({
        repository: input.repository, currentTag: input.tag, releases,
        downloadManifest: tag => JSON.stringify(prior.find(item => item.tag === tag).manifest)
    });
    const result = createManifest({ ...input, previousVersions })[0].versions;
    assert.deepEqual(result.map(version => version.version), ['1.2.3.0', '1.0.10.0', '1.0.1.0', '1.0.0.0']);
    for (const { tag, manifest } of prior) {
        const original = manifest[0].versions[0];
        const recovered = result.find(entry => entry.version === original.version);
        assert.equal(recovered.sourceUrl, original.sourceUrl);
        assert.equal(recovered.checksum, original.checksum);
        assert.equal(recovered.targetAbi, original.targetAbi);
        assert.equal(recovered.timestamp, original.timestamp);
        assert.equal(recovered.changelog,
            `Old release notes for ${tag}\n\n[View release on GitHub](https://github.com/${input.repository}/releases/tag/${tag})`);
    }
});

test('handles first releases, current draft reruns and previously linked changelogs', async () => {
    const { collectReleaseHistory, createManifest } = await modulePromise;
    assert.deepEqual(collectReleaseHistory({
        repository: input.repository, currentTag: input.tag,
        releases: [{ tag_name: input.tag, draft: true, assets: [] }],
        downloadManifest: () => assert.fail('No published history to download')
    }), []);
    const release = { tag_name: 'v1.0.1', assets: [{ name: 'manifest.json' }, { name: 'HomeFusion_1.0.1.zip' }] };
    const manifest = createManifest({ ...input, tag: release.tag_name, archiveName: 'HomeFusion_1.0.1.zip' });
    const history = collectReleaseHistory({
        repository: input.repository, currentTag: input.tag, releases: [release],
        downloadManifest: () => JSON.stringify(manifest)
    });
    assert.equal(history[0].changelog, manifest[0].versions[0].changelog);
});

test('fails instead of silently publishing incomplete or invalid release history', async () => {
    const { collectReleaseHistory, createManifest } = await modulePromise;
    const release = { tag_name: 'v1.0.1', assets: [{ name: 'manifest.json' }, { name: 'HomeFusion_1.0.1.zip' }] };
    const manifest = createManifest({ ...input, tag: release.tag_name, archiveName: 'HomeFusion_1.0.1.zip' });
    const options = { repository: input.repository, currentTag: input.tag, releases: [release],
        downloadManifest: () => JSON.stringify(manifest) };
    assert.throws(() => collectReleaseHistory({ ...options, releases: [{ ...release, assets: [] }] }), /missing/);
    assert.throws(() => collectReleaseHistory({ ...options, downloadManifest: () => 'not JSON' }));
    assert.throws(() => collectReleaseHistory({ ...options, downloadManifest: () => '[]' }), /Invalid version metadata/);
    const wrongUrl = structuredClone(manifest);
    wrongUrl[0].versions[0].sourceUrl = 'https://example.com/archive.zip';
    assert.throws(() => collectReleaseHistory({ ...options, downloadManifest: () => JSON.stringify(wrongUrl) }), /Invalid version metadata/);
    assert.throws(() => collectReleaseHistory({ ...options, releases: [release, release] }), /Duplicate/);
    assert.throws(() => createManifest({ ...input, previousVersions: [manifest[0].versions[0], manifest[0].versions[0]] }), /distinct/);
    assert.throws(() => createManifest({ ...input, previousVersions: [createManifest(input)[0].versions[0]] }), /distinct/);
});

test('only stable canonical version tags are accepted', async () => {
    const { parseReleaseTag } = await modulePromise;
    assert.deepEqual(parseReleaseTag('v1.2.3'), { version: '1.2.3', manifestVersion: '1.2.3.0' });
    for (const tag of ['1.2.3', 'v1.2', 'v1.2.3.4', 'v1.2.3-beta', 'v01.2.3', 'v65535.0.0', 'v1.2.3\n']) {
        assert.throws(() => parseReleaseTag(tag));
    }
});

test('resolves the next stable release tag or validates an explicit version', async () => {
    const { getLatestReleaseTag, resolveReleaseTag } = await modulePromise;
    assert.equal(resolveReleaseTag([]), 'v1.0.0');
    assert.equal(resolveReleaseTag(['v1.0.9', 'v1.0.10', 'not-a-release']), 'v1.0.11');
    assert.equal(getLatestReleaseTag(['v1.0.9', 'v1.0.10', 'not-a-release']), 'v1.0.10');
    assert.equal(resolveReleaseTag(['v1.2.3'], '1.3.0'), 'v1.3.0');
    assert.equal(resolveReleaseTag(['v1.2.3'], 'v1.2.4'), 'v1.2.4');
    assert.equal(resolveReleaseTag(['v1.2.3', 'v1.2.4'], '', 'v1.2.4'), 'v1.2.4');
    assert.equal(resolveReleaseTag(['v1.2.65534']), 'v1.3.0');
    assert.throws(() => resolveReleaseTag(['v1.2.3'], '1.2.3'), /already exists/);
    assert.throws(() => resolveReleaseTag(['v1.2.3'], '1.2.2'), /greater than the latest/);
    assert.throws(() => resolveReleaseTag([], '1.2'), /Release tags must be/);
});

test('rejects mismatched archives, invalid repository names and inconsistent server packages', async () => {
    const { createManifest } = await modulePromise;
    assert.throws(() => createManifest({ ...input, archiveName: 'HomeFusion_1.0.0.zip' }));
    assert.throws(() => createManifest({ ...input, archiveBytes: Buffer.alloc(0) }));
    assert.throws(() => createManifest({ ...input, repository: 'https://github.com/owner/repo' }));
    assert.throws(() => createManifest({ ...input, projectXml: '' }));
    assert.throws(() => createManifest({ ...input,
        projectXml: projectXml.replace('Include="Jellyfin.Model" Version="12.4.0"', 'Include="Jellyfin.Model" Version="12.3.0"') }));
});