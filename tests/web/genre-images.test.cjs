const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');

function loadRenderer() {
    const source = readFileSync('Jellyfin.Plugin.HomeFusion/Web/homefusion.js', 'utf8');
    const context = vm.createContext({
        window: {
            ApiClient: {
                getScaledImageUrl: (id, options) => `${id}/${options.type}/${options.tag}`
            }
        },
        document: {
            createElement: () => ({ setAttribute() {}, addEventListener() {} })
        },
        requestAnimationFrame() {},
        // Keep candidate ordering deterministic so reassignment is exercised.
        Math: Object.assign(Object.create(Math), { random: () => 0.999 })
    });
    vm.runInContext(source.slice(0, source.indexOf('    new MutationObserver')) +
        'globalThis.rowElement = rowElement; })();', context);
    return context.rowElement;
}

function item(id, type = 'Backdrop') {
    return {
        Id: id,
        BackdropImageTags: type === 'Backdrop' ? ['tag'] : [],
        ImageTags: type && type !== 'Backdrop' ? { [type]: 'tag' } : {}
    };
}

function render(cats, key = 'genres') {
    const html = loadRenderer()(key, 'Genres', cats).innerHTML;
    return {
        images: [...html.matchAll(/background-image:url\('([^']+)'\)/g)].map(match => match[1]),
        placeholders: [...html.matchAll(/cardImageIcon/g)].length,
        html
    };
}

test('overlapping genres get unique images without changing card order or counts', () => {
    const shared = item('shared');
    const result = render([
        { name: 'Action', items: [shared, item('action')] },
        { name: 'Comedy', items: [shared] }
    ]);
    assert.deepEqual(result.images, ['action/Backdrop/tag', 'shared/Backdrop/tag']);
    assert.equal(result.placeholders, 0);
    assert.ok(result.html.indexOf('Action') < result.html.indexOf('Comedy'));
    assert.match(result.html, /2 titles/);
    assert.match(result.html, /1 titles/);
});

test('reassigns through multiple genres to find a complete unique allocation', () => {
    const a = item('a'), b = item('b'), c = item('c');
    const result = render([
        { name: 'First', items: [a, b] },
        { name: 'Second', items: [b, c] },
        { name: 'Third', items: [a] }
    ]);
    assert.deepEqual(result.images, ['b/Backdrop/tag', 'c/Backdrop/tag', 'a/Backdrop/tag']);
    assert.equal(result.placeholders, 0);
});

test('prefers backdrops but uses thumb and primary images rather than duplicates', () => {
    const shared = item('shared');
    const result = render([
        { name: 'First', items: [item('thumb', 'Thumb'), shared] },
        { name: 'Second', items: [shared] },
        { name: 'Third', items: [item('poster', 'Primary')] }
    ]);
    assert.deepEqual(result.images, ['thumb/Thumb/tag', 'shared/Backdrop/tag', 'poster/Primary/tag']);
    assert.deepEqual(render([{ name: 'Preferred', items: [
        item('thumb', 'Thumb'), item('backdrop')
    ] }]).images, ['backdrop/Backdrop/tag']);
});

test('does not reuse images when distinct artwork is exhausted or missing', () => {
    const shared = item('shared');
    const result = render([
        { name: 'First', items: [shared, shared] },
        { name: 'Second', items: [shared] },
        { name: 'Missing', items: [item('missing', null)] }
    ]);
    assert.deepEqual(result.images, ['shared/Backdrop/tag']);
    assert.equal(result.placeholders, 2);
});

test('considers artwork beyond the previous thirty-title selection limit', () => {
    const items = Array.from({ length: 31 }, (_, i) => item(`item${i}`));
    const cats = items.map((entry, i) => ({ name: `Genre ${i}`, items: [entry] }));
    cats.unshift({ name: 'Broad genre', items: [...items, item('extra')] });
    const result = render(cats);
    assert.equal(result.images.length, 32);
    assert.equal(new Set(result.images).size, 32);
    assert.equal(result.placeholders, 0);
});

test('image reservations reset for each genre row render', () => {
    const cats = [{ name: 'Action', items: [item('action')] }];
    assert.deepEqual(render(cats).images, render(cats).images);
});

test('ratings and release rows retain independent image selection', () => {
    const cats = [
        { name: 'First', items: [item('shared')] },
        { name: 'Second', items: [item('shared')] }
    ];
    for (const key of ['ratings', 'release']) {
        assert.deepEqual(render(cats, key).images, ['shared/Backdrop/tag', 'shared/Backdrop/tag']);
    }
});
