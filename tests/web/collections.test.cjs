const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');

const source = readFileSync('Jellyfin.Plugin.HomeFusion/Web/homefusion.js', 'utf8');

function setup({ enabled = true, randomize = false, collections = [], items = [], position = 'bottom', otherRows = [] } = {}) {
    const calls = [];
    const rows = [];
    const errors = [];
    const cfg = {
        Rows: [...otherRows, { Key: 'collections', Enabled: enabled, Position: position }],
        RandomizeCollections: randomize
    };
    const sections = {
        children: [],
        querySelector: selector => selector === '[data-homefusion]' ? rows[0] : {},
        appendChild: row => rows.push(row),
        insertBefore: row => rows.unshift(row)
    };
    const context = vm.createContext({
        window: {
            ApiClient: {
                getCurrentUserId: () => 'user',
                accessToken: () => 'token',
                serverId: () => 'server',
                getItems: async (user, options) => {
                    calls.push({ user, options });
                    return { Items: options.IncludeItemTypes === 'BoxSet' ? collections : items };
                },
                getScaledImageUrl: (id, options) => `${id}/${options.type}`
            }
        },
        document: {
            createElement: () => ({
                attributes: {},
                listeners: {},
                setAttribute(key, value) { this.attributes[key] = value; },
                addEventListener(key, listener) { this.listeners[key] = listener; }
            })
        },
        console: { warn: (...args) => errors.push(args) },
        setTimeout() {},
        requestAnimationFrame() {},
        Math: Object.assign(Object.create(Math), { random: () => 0 })
    });
    context.testConfig = cfg;
    context.testSections = sections;
    vm.runInContext(source.slice(0, source.indexOf('    new MutationObserver')) + `
        config = testConfig;
        findSections = function () { return testSections; };
        applyTweaks = function () {};
        injectStyles = function () {};
        globalThis.client = { loadCollections, collectionCategories, rowElement, tryInject, placeRow };
    })();`, context);
    return { client: context.client, calls, rows, errors, cfg };
}

const collections = [
    { Id: 'alpha', Name: 'Alpha & friends', ChildCount: 3, BackdropImageTags: ['tag'] },
    { Id: 'beta', Name: 'Beta', ChildCount: 0, ImageTags: { Primary: 'tag' } },
    { Id: 'gamma', Name: 'Gamma' }
];

test('loads user-visible BoxSets by name independently of movie and series filters', async () => {
    const { client, calls } = setup({ collections });
    assert.deepEqual(await client.loadCollections(), collections);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].user, 'user');
    assert.equal(calls[0].options.IncludeItemTypes, 'BoxSet');
    assert.equal(calls[0].options.SortBy, 'SortName');
    assert.equal(calls[0].options.SortOrder, 'Ascending');
    assert.equal(calls[0].options.Recursive, true);
});

test('does not request collections when the row is disabled', async () => {
    const { client, calls } = setup({ enabled: false });
    assert.equal((await client.loadCollections()).length, 0);
    assert.equal(calls.length, 0);
});

test('preserves alphabetical API order by default and shuffles only when enabled', () => {
    for (const randomize of [false, true]) {
        const { client } = setup({ randomize });
        const cats = client.collectionCategories(collections);
        assert.deepEqual(Array.from(cats, cat => cat.name), randomize ?
            ['Beta', 'Gamma', 'Alpha & friends'] : ['Alpha & friends', 'Beta', 'Gamma']);
        assert.equal(collections[0].Id, 'alpha');
    }
});

test('renders collection artwork, real child counts, placeholders and native details links', () => {
    const { client } = setup();
    const row = client.rowElement('collections', 'Collections', client.collectionCategories(collections));
    assert.match(row.innerHTML, /Alpha &amp; friends/);
    assert.match(row.innerHTML, /3 titles/);
    assert.match(row.innerHTML, /0 titles/);
    assert.match(row.innerHTML, /<bdi>Collection<\/bdi>/);
    assert.match(row.innerHTML, /alpha\/Backdrop/);
    assert.match(row.innerHTML, /beta\/Primary/);
    assert.match(row.innerHTML, /cardImageIcon/);
    assert.match(row.innerHTML, /<a href="#\/details\?id=alpha&amp;serverId=server"/);
    assert.match(row.innerHTML, /class="cardOverlayContainer" style="pointer-events:none;"/);
    row.listeners.click({
        preventDefault() { assert.fail('Collection navigation must not be prevented'); },
        stopPropagation() { assert.fail('Collection navigation must not be stopped'); }
    });
});

test('injects collections without movie or series items and applies the chosen position', async () => {
    const { client, rows, calls, errors } = setup({ collections, position: 'top' });
    client.tryInject();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(errors, []);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].attributes['data-homefusion'], 'collections');
    assert.equal(rows[0].attributes['data-hf-pos'], 'top');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.IncludeItemTypes, 'BoxSet');
});

test('empty or disabled collections do not create an empty section', async () => {
    for (const options of [{ collections: [] }, { enabled: false, collections }]) {
        const { client, rows, errors } = setup(options);
        client.tryInject();
        await new Promise(resolve => setImmediate(resolve));
        assert.deepEqual(errors, []);
        assert.equal(rows.length, 0);
    }
});

test('other rows still render when the user has no collections', async () => {
    const { client, rows, errors } = setup({
        items: [{ Id: 'movie', CommunityRating: 9, BackdropImageTags: ['tag'] }],
        otherRows: [{ Key: 'ratings', Enabled: true, Position: 'bottom' }]
    });
    client.tryInject();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(errors, []);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].attributes['data-homefusion'], 'ratings');
});

test('coordinates unique images across genres, ratings, release dates and collections', async () => {
    const items = Array.from({ length: 8 }, (_, index) => ({
        Id: `movie${index}`, Genres: ['Action'], CommunityRating: 9,
        ProductionYear: 2020, BackdropImageTags: ['tag']
    }));
    const { client, rows, errors } = setup({
        items,
        collections: [{ ...items[0], Name: 'Collection', ChildCount: 2 }],
        otherRows: ['genres', 'ratings', 'release'].map(Key => ({ Key, Enabled: true, Position: 'bottom' }))
    });
    client.tryInject();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(errors, []);
    assert.deepEqual(rows.map(row => row.attributes['data-homefusion']), ['genres', 'ratings', 'release', 'collections']);
    const images = rows.flatMap(row =>
        [...row.innerHTML.matchAll(/background-image:url\('([^']+)'\)/g)].map(match => match[1]));
    assert.equal(images.length, 6);
    assert.equal(new Set(images).size, 6);
    assert.match(rows[3].innerHTML, /movie0\/Backdrop/);
});

test('repeats across rows only when the matching library has too few images', async () => {
    const { client, rows, errors } = setup({
        items: [{ Id: 'only', Genres: ['Action'], CommunityRating: 9, ProductionYear: 2020, BackdropImageTags: ['tag'] }],
        otherRows: ['genres', 'ratings', 'release'].map(Key => ({ Key, Enabled: true, Position: 'bottom' }))
    });
    client.tryInject();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(errors, []);
    assert.equal(rows.length, 3);
    const html = rows.map(row => row.innerHTML).join('');
    assert.equal([...html.matchAll(/background-image:url/g)].length, 5);
    assert.doesNotMatch(html, /cardImageIcon/);
});

test('collection rows use existing native section placement and fall back to bottom', () => {
    const { client } = setup();
    const row = {};
    let placedAfter;
    let appended;
    const anchor = {
        hasAttribute: () => false,
        querySelector: selector => selector === '.homeLibraryButtonContainer' ? {} : null,
        insertAdjacentElement: (position, element) => { placedAfter = { position, element }; }
    };
    const sections = { children: [anchor], appendChild: element => { appended = element; } };
    client.placeRow(row, sections, 'after-my-media');
    assert.deepEqual(placedAfter, { position: 'afterend', element: row });
    client.placeRow(row, sections, 'after-next-up');
    assert.equal(appended, row);
});

test('collection settings load and save through the dashboard form', async () => {
    const html = readFileSync('Jellyfin.Plugin.HomeFusion/Configuration/configPage.html', 'utf8');
    const elements = new Map([...html.matchAll(/id="([^"]+)"/g)].map(match => [match[1], {
        value: '', checked: false, addEventListener(event, listener) { this[event] = listener; },
        append() {}, querySelectorAll: () => []
    }]));
    const form = { addEventListener(event, listener) { this[event] = listener; } };
    const page = elements.get('HomeFusionConfigPage');
    page.querySelector = selector => selector === 'form' ? form : elements.get(selector.slice(1));
    page.querySelectorAll = () => [];
    const cfg = { ShowCollections: true, RandomizeCollections: false, CollectionsPosition: 'after-next-up', IncludeMovies: true };
    let saved;
    const errors = [];
    vm.runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], {
        document: { querySelector: () => page },
        Dashboard: {
            showLoadingMsg() {}, hideLoadingMsg() {}, processPluginConfigurationUpdateResult() {},
            alert: message => errors.push(message)
        },
        ApiClient: {
            getPluginConfiguration: async () => ({ ...cfg }),
            getCurrentUserId: () => 'user', getUrl: () => 'Genres',
            getJSON: async () => ({ Items: [] }),
            updatePluginConfiguration: async (id, config) => { saved = config; }
        }
    });
    page.pageshow();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(elements.get('ShowCollections').checked, true);
    assert.equal(elements.get('RandomizeCollections').checked, false);
    assert.equal(elements.get('CollectionsPosition').value, 'after-next-up');
    elements.get('RandomizeCollections').checked = true;
    elements.get('CollectionsPosition').value = 'after-my-media';
    form.submit({ preventDefault() {} });
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(errors, []);
    assert.equal(saved.ShowCollections, true);
    assert.equal(saved.RandomizeCollections, true);
    assert.equal(saved.CollectionsPosition, 'after-my-media');
});
