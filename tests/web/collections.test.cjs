const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');

const source = readFileSync('Jellyfin.Plugin.HomeFusion/Web/homefusion.js', 'utf8');
const controller = readFileSync('Jellyfin.Plugin.HomeFusion/Api/HomeFusionController.cs', 'utf8');
const configuredRowOrder = [...controller.matchAll(/new \{ Key = "([^"]+)", Enabled = c\.\w+, Position = c\.\w+ \}/g)]
    .map(match => match[1]);

function setup({ enabled = true, randomize = false, collections = [], items = [], position = 'bottom', otherRows = [] } = {}) {
    const calls = [];
    const rows = [];
    const overlays = [];
    const errors = [];
    const timers = [];
    const windowListeners = new Map();
    const configuredRows = [{ Key: 'collections', Enabled: enabled, Position: position }, ...otherRows];
    const cfg = {
        Rows: configuredRowOrder.map(key => configuredRows.find(row => row.Key === key)).filter(Boolean),
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
            addEventListener(event, listener) { windowListeners.set(event, listener); },
            removeEventListener(event, listener) {
                if (windowListeners.get(event) === listener) windowListeners.delete(event);
            },
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
            body: { appendChild: element => overlays.push(element) },
            createElement: () => ({
                attributes: {},
                listeners: {},
                removed: false,
                remove() { this.removed = true; },
                setAttribute(key, value) { this.attributes[key] = value; },
                addEventListener(key, listener) { this.listeners[key] = listener; },
                querySelector(selector) {
                    if (selector === '.hf-close') return { addEventListener() {} };
                    if (selector === '.hf-grid') return { addEventListener: (key, listener) => { this.gridListener = listener; } };
                    return null;
                }
            })
        },
        console: { warn: (...args) => errors.push(args) },
        setTimeout(callback) { timers.push(callback); },
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
        globalThis.client = { loadCollections, collectionCategories, rowElement, openCategory, tryInject, placeRow };
    })();`, context);
    return { client: context.client, calls, rows, overlays, errors, cfg, timers, windowListeners };
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

test('collections heading button opens a grid containing all collection cards', () => {
    const { client, overlays } = setup();
    const cats = client.collectionCategories(collections);
    const row = client.rowElement('collections', 'Collections', cats);
    assert.match(row.innerHTML, /<button type="button" is="emby-button" class="button-flat button-flat-mini sectionTitleTextButton hf-view-all" title="View all collections" aria-label="View all collections">/);
    assert.match(row.innerHTML, /<h2 class="sectionTitle sectionTitle-cards">Collections<\/h2><span class="material-icons chevron_right"/);
    let prevented = false;
    let stopped = false;
    row.listeners.click({
        target: { closest: selector => selector === '.hf-view-all' ? {} : null },
        preventDefault() { prevented = true; },
        stopPropagation() { stopped = true; }
    });
    assert.equal(prevented, true);
    assert.equal(stopped, true);
    assert.match(overlays[0].innerHTML, /hf-header[\s\S]*Collections/);
    assert.match(overlays[0].innerHTML, /Alpha &amp; friends/);
    assert.match(overlays[0].innerHTML, /Beta/);
    assert.match(overlays[0].innerHTML, /Gamma/);
    assert.equal((overlays[0].innerHTML.match(/overflowPortraitCard/g) || []).length, collections.length);
});

test('limits only the home collections row, preserving order and all cards in View all', () => {
    for (const randomize of [false, true]) {
        for (const limit of [undefined, 0, 1, 2, 3, 10]) {
            const { client, cfg, overlays } = setup({ randomize });
            cfg.MaxCollections = limit;
            const cats = client.collectionCategories(collections);
            const row = client.rowElement('collections', 'Collections', cats);
            const expected = limit > 0 ? Math.min(limit, cats.length) : cats.length;
            assert.equal((row.innerHTML.match(/overflowPortraitCard/g) || []).length, expected);
            cats.forEach((cat, index) => {
                const name = cat.name.replace('&', '&amp;');
                assert.equal(row.innerHTML.includes('<bdi>' + name + '</bdi>'), index < expected);
            });
            row.listeners.click({
                target: { closest: selector => selector === '.hf-view-all' ? {} : null },
                preventDefault() {}, stopPropagation() {}
            });
            assert.equal((overlays[0].innerHTML.match(/overflowPortraitCard/g) || []).length, cats.length);
            assert.match(overlays[0].innerHTML, /alpha\/Backdrop/);
            assert.match(overlays[0].innerHTML, /beta\/Primary/);
            assert.match(overlays[0].innerHTML, /Gamma/);
            const genreRow = client.rowElement('genres', 'Genres', cats);
            assert.equal((genreRow.innerHTML.match(/overflowBackdropCard/g) || []).length, cats.length);
        }
    }
});

test('configured collection limit is applied during home injection', async () => {
    const { client, cfg, rows, overlays, errors } = setup({ collections });
    cfg.MaxCollections = 1;
    client.tryInject();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(errors, []);
    assert.equal((rows[0].innerHTML.match(/overflowPortraitCard/g) || []).length, 1);
    rows[0].listeners.click({
        target: { closest: selector => selector === '.hf-view-all' ? {} : null },
        preventDefault() {}, stopPropagation() {}
    });
    assert.equal((overlays[0].innerHTML.match(/overflowPortraitCard/g) || []).length, collections.length);
});

test('renders collection names below the artwork with child counts and native details links', () => {
    const { client } = setup();
    const row = client.rowElement('collections', 'Collections', client.collectionCategories(collections));
    assert.doesNotMatch(row.innerHTML, /class="hf-label"/);
    assert.match(row.innerHTML, /cardText-first hf-collection-name"><bdi>Alpha &amp; friends<\/bdi>/);
    assert.match(row.innerHTML, /cardText-secondary"><bdi>3 titles<\/bdi>/);
    assert.match(row.innerHTML, /cardText-first hf-collection-name"><bdi>Beta<\/bdi>/);
    assert.match(row.innerHTML, /cardText-secondary"><bdi>0 titles<\/bdi>/);
    assert.match(row.innerHTML, /<bdi>Collection<\/bdi>/);
    assert.match(row.innerHTML, /alpha\/Backdrop/);
    assert.match(row.innerHTML, /beta\/Primary/);
    assert.match(row.innerHTML, /card overflowPortraitCard card-hoverable/);
    assert.match(row.innerHTML, /cardPadder cardPadder-portrait/);
    assert.doesNotMatch(row.innerHTML, /overflowBackdropCard|cardPadder-overflowBackdrop/);
    assert.match(row.innerHTML, /cardImageIcon/);
    assert.match(row.innerHTML, /<a href="#\/details\?id=alpha&amp;serverId=server"/);
    assert.match(row.innerHTML, /class="cardOverlayContainer" style="pointer-events:none;"/);
    row.listeners.click({
        target: { closest() { return null; } },
        preventDefault() { assert.fail('Collection navigation must not be prevented'); },
        stopPropagation() { assert.fail('Collection navigation must not be stopped'); }
    });
});

test('collections prefer posters over backdrops while other rows stay landscape', () => {
    const { client } = setup();
    const item = { Id: 'poster', Name: 'Poster collection', BackdropImageTags: ['backdrop'], ImageTags: { Primary: 'primary' } };
    const row = client.rowElement('collections', 'Collections', client.collectionCategories([item]));
    assert.match(row.innerHTML, /poster\/Primary/);
    assert.doesNotMatch(row.innerHTML, /poster\/Backdrop/);
    for (const key of ['genres', 'ratings', 'release']) {
        const landscape = client.rowElement(key, key, [{ name: 'Category', items: [item] }]);
        assert.match(landscape.innerHTML, /card overflowBackdropCard card-hoverable/);
        assert.match(landscape.innerHTML, /cardPadder cardPadder-overflowBackdrop/);
        assert.match(landscape.innerHTML, /poster\/Backdrop/);
        assert.doesNotMatch(landscape.innerHTML, /overflowPortraitCard/);
    }
});

test('title count setting applies to every row and the collections grid', () => {
    for (const hideCounts of [false, true]) {
        const { client, cfg, overlays } = setup();
        cfg.HideTitleCounts = hideCounts;
        const cats = client.collectionCategories(collections);
        const row = client.rowElement('collections', 'Collections', cats);
        assert.equal(row.innerHTML.includes('<bdi>3 titles</bdi>'), !hideCounts);
        assert.equal(row.innerHTML.includes('<bdi>0 titles</bdi>'), !hideCounts);
        assert.match(row.innerHTML, /<bdi>Alpha &amp; friends<\/bdi>/);
        assert.match(row.innerHTML, /<bdi>Collection<\/bdi>/);
        cfg.HideTitleCounts = !hideCounts;
        row.listeners.click({
            target: { closest: selector => selector === '.hf-view-all' ? {} : null },
            preventDefault() {}, stopPropagation() {}
        });
        assert.equal(overlays[0].innerHTML.includes('<bdi>3 titles</bdi>'), !hideCounts);
        assert.match(overlays[0].innerHTML, /<bdi>Alpha &amp; friends<\/bdi>/);
        for (const key of ['genres', 'ratings', 'release']) {
            cfg.HideTitleCounts = hideCounts;
            const html = client.rowElement(key, key, [{ name: 'Category', items: [collections[0]] }]).innerHTML;
            assert.equal(html.includes('<bdi>1 titles</bdi>'), !hideCounts);
            assert.match(html, /class="hf-label">Category<\/div>/);
        }
    }
});

test('title count setting defaults to false and is exposed by the client configuration API', () => {
    const configuration = readFileSync('Jellyfin.Plugin.HomeFusion/Configuration/PluginConfiguration.cs', 'utf8');
    assert.match(configuration, /public bool HideTitleCounts \{ get; set; \}/);
    assert.match(controller, /c\.HideTitleCounts/);
    const { client } = setup();
    const row = client.rowElement('genres', 'Genres', [{ name: 'Action', items: [collections[0]] }]);
    assert.match(row.innerHTML, /<bdi>1 titles<\/bdi>/);
});

test('collection limit defaults to unlimited and is exposed by the client configuration API', () => {
    const configuration = readFileSync('Jellyfin.Plugin.HomeFusion/Configuration/PluginConfiguration.cs', 'utf8');
    assert.match(configuration, /public int MaxCollections \{ get; set; \}/);
    assert.match(controller, /c\.MaxCollections/);
});

test('play buttons include playback position for native Jellyfin resume handling', () => {
    const { client, overlays } = setup();
    client.openCategory('Action', [{
        Id: 'movie', Name: 'Movie', Type: 'Movie',
        UserData: { PlaybackPositionTicks: 12345 }
    }]);
    assert.match(overlays[0].innerHTML, /data-positionticks="12345"/);
    assert.match(overlays[0].innerHTML, /data-action="resume" title="Play"/);
});

test('play and resume dismiss the category overlay after native click handling, while More keeps it open', () => {
    for (const action of ['resume', 'play', 'menu']) {
        const { client, overlays, timers, windowListeners } = setup();
        client.openCategory('Genres: Action', [{ Id: 'movie', Name: 'Movie', Type: 'Movie' }]);
        const overlay = overlays[0];
        const card = { getAttribute: () => 'movie' };
        const button = {
            getAttribute: name => name === 'data-action' ? action : null,
            hasAttribute: () => false
        };
        // A click on the inner play icon must resolve to the containing button.
        overlay.gridListener({
            target: { closest: selector => selector === '[data-hf-item]' ? card : selector === 'button' ? button : null },
            preventDefault() { assert.fail('Native action must not be prevented'); },
            stopImmediatePropagation() { assert.fail('Native action must receive the click'); }
        });
        assert.equal(overlay.removed, false, 'Keep the grid attached during native click handling');
        assert.equal(windowListeners.has('hashchange'), true);
        assert.equal(timers.length, action === 'menu' ? 0 : 1);
        timers.forEach(callback => callback());
        assert.equal(overlay.removed, action !== 'menu');
        assert.equal(windowListeners.has('hashchange'), action === 'menu');
    }
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
    assert.deepEqual(configuredRowOrder, ['collections', 'genres', 'ratings', 'release']);
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
    assert.deepEqual(rows.map(row => row.attributes['data-homefusion']), ['collections', 'genres', 'ratings', 'release']);
    const images = rows.flatMap(row =>
        [...row.innerHTML.matchAll(/background-image:url\('([^']+)'\)/g)].map(match => match[1]));
    assert.equal(images.length, 6);
    assert.equal(new Set(images).size, 6);
    assert.match(rows[0].innerHTML, /movie0\/Backdrop/);
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
        _value: '', get value() { return this._value; }, set value(value) { this._value = String(value); },
        checked: false, addEventListener(event, listener) { this[event] = listener; },
        focus() {},
        append() {}, querySelectorAll: () => []
    }]));
    const form = { addEventListener(event, listener) { this[event] = listener; } };
    const page = elements.get('HomeFusionConfigPage');
    page.querySelector = selector => selector === 'form' ? form : elements.get(selector.slice(1));
    page.querySelectorAll = () => [];
    const cfg = { ShowCollections: true, RandomizeCollections: false, CollectionsPosition: 'after-next-up', IncludeMovies: true, HideTitleCounts: true, MaxCollections: 2, HideCardSecondaryText: true, HideMyMediaCardText: true };
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
    assert.equal(elements.get('HideTitleCounts').checked, true);
    assert.equal(elements.get('HideCardSecondaryText').checked, true);
    assert.equal(elements.get('HideMyMediaCardText').checked, true);
    assert.equal(elements.get('MaxCollections').value, '2');
    elements.get('RandomizeCollections').checked = true;
    elements.get('CollectionsPosition').value = 'after-my-media';
    elements.get('HideTitleCounts').checked = false;
    elements.get('HideCardSecondaryText').checked = false;
    elements.get('HideMyMediaCardText').checked = false;
    elements.get('MaxCollections').value = '1';
    form.submit({ preventDefault() {} });
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(errors, []);
    assert.equal(saved.ShowCollections, true);
    assert.equal(saved.RandomizeCollections, true);
    assert.equal(saved.CollectionsPosition, 'after-my-media');
    assert.equal(saved.HideTitleCounts, false);
    assert.equal(saved.HideCardSecondaryText, false);
    assert.equal(saved.HideMyMediaCardText, false);
    assert.equal(saved.MaxCollections, 1);
    for (const invalid of ['', '-1', '1.5', '2147483648']) {
        saved = undefined;
        elements.get('MaxCollections').value = invalid;
        form.submit({ preventDefault() {} });
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(saved, undefined);
        assert.match(errors.pop(), /whole number/);
    }
    elements.get('MaxCollections').value = '0';
    form.submit({ preventDefault() {} });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(saved.MaxCollections, 0);
});

test('card text tweaks apply only when enabled', async () => {
    const configuration = readFileSync('Jellyfin.Plugin.HomeFusion/Configuration/PluginConfiguration.cs', 'utf8');
    for (const [key, css] of [
        ['HideCardSecondaryText', '.hf-native-movie-year,.hf-movie-year{display:none !important;}'],
        ['HideMyMediaTitle', '.hf-my-media > .sectionTitle,.hf-my-media > .verticalSection > .sectionTitle{visibility:hidden !important;}'],
        ['HideMyMediaCardText', '.hf-my-media .cardText{visibility:hidden !important;}']
    ]) {
        assert.match(configuration, new RegExp(`public bool ${key} \\{ get; set; \\}`));
        assert.match(controller, new RegExp(`c\\.${key}`));
        for (const enabled of [undefined, false, true]) {
            let style;
            const context = vm.createContext({
                document: {
                    getElementById: () => null,
                    createElement: () => ({}),
                    querySelector: () => null,
                    querySelectorAll: () => [],
                    head: { appendChild(element) { style = element; } }
                }
            });

            context.testConfig = { [key]: enabled };
            vm.runInContext(source.slice(0, source.indexOf('    new MutationObserver')) + `
                config = testConfig;
                globalThis.applyTweaks = applyTweaks;
            })();`, context);
            context.applyTweaks();
            await new Promise(resolve => setImmediate(resolve));
            assert.equal(style.textContent, enabled ? css : '');
        }
    }
});

test('movie year detection only marks standalone years on native movie cards', () => {
    function text(value) {
        const classes = new Set();
        return {
            textContent: value, classes,
            classList: {
                contains: name => classes.has(name),
                add: name => classes.add(name),
                remove: name => classes.delete(name)
            }
        };
    }
    const movieYear = text('2024');
    const localizedYear = text('٢٠٢٤');
    const movieDetails = text('2024 • 8.2');
    const selectors = [];
    const context = vm.createContext({
        document: { querySelectorAll(selector) {
            selectors.push(selector);
            return [movieYear, localizedYear, movieDetails];
        } }
    });
    vm.runInContext(source.slice(0, source.indexOf('    new MutationObserver')) + `
        hideMovieYears = true;
        globalThis.markMovieYears = markMovieYears;
    })();`, context);
    context.markMovieYears();
    assert.deepEqual(selectors, ['.card[data-type="Movie"] .cardText.cardText-secondary']);
    assert.equal(movieYear.classes.has('hf-native-movie-year'), true);
    assert.equal(localizedYear.classes.has('hf-native-movie-year'), true);
    assert.equal(movieDetails.classes.has('hf-native-movie-year'), false);
    movieYear.textContent = 'New details';
    context.markMovieYears();
    assert.equal(movieYear.classes.has('hf-native-movie-year'), false);
});

test('HomeFusion grid marks movie years without hiding ratings or TV years', () => {
    const { client, overlays } = setup();
    client.openCategory('Titles', [
        { Id: 'movie', Name: 'Movie', Type: 'Movie', ProductionYear: 2024, CommunityRating: 8.5 },
        { Id: 'tv', Name: 'Show', Type: 'Series', ProductionYear: 2023, CommunityRating: 7.5 }
    ]);
    assert.match(overlays[0].innerHTML, /<span class="hf-movie-year">2024 • <\/span>★ 8\.5/);
    assert.match(overlays[0].innerHTML, /<span>2023 • <\/span>★ 7\.5/);
});

test('My Media targeting follows library content instead of row position and survives rerendering', () => {
    function section({ title, library = false, plugin = false }) {
        const classes = new Set();
        return {
            title, library, plugin, classes,
            classList: {
                contains: name => classes.has(name),
                add: name => classes.add(name),
                remove: name => classes.delete(name)
            },
            hasAttribute: () => plugin,
            querySelector(selector) {
                if (selector === '.sectionTitle') return this.title ? { textContent: this.title } : null;
                return this.library && selector.includes(this.library) ? {} : null;
            }
        };
    }
    const context = vm.createContext({
        window: { Globalize: { translate: key => key === 'HeaderMyMedia' ? 'Mes médias' : key } }
    });
    vm.runInContext(source.slice(0, source.indexOf('    new MutationObserver')) + `
        myMediaTweaksEnabled = true;
        globalThis.markMyMediaSections = markMyMediaSections;
    })();`, context);
    const first = section({ title: 'Continue Watching' });
    const library = section({ title: 'Bibliothèque', library: '.homeLibraryButtonContainer' });
    const plugin = section({ title: 'My Media', plugin: true });
    const sections = { children: [first, library, plugin] };
    context.markMyMediaSections(sections);
    assert.equal(first.classes.has('hf-my-media'), false);
    assert.equal(library.classes.has('hf-my-media'), true);
    assert.equal(plugin.classes.has('hf-my-media'), false);

    library.library = false;
    library.title = 'Latest Movies';
    const replaced = section({ title: 'Mes médias' });
    sections.children = [replaced, library, first, plugin];
    context.markMyMediaSections(sections);
    assert.equal(replaced.classes.has('hf-my-media'), true);
    assert.equal(library.classes.has('hf-my-media'), false);
    replaced.title = 'Bibliothèque';
    replaced.library = '.card[data-type="CollectionFolder"]';
    context.markMyMediaSections(sections);
    assert.equal(replaced.classes.has('hf-my-media'), true);
    replaced.library = '.card[data-type="UserView"]';
    context.markMyMediaSections(sections);
    assert.equal(replaced.classes.has('hf-my-media'), true);
});
