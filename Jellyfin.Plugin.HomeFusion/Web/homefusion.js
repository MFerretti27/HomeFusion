/* HomeFusion - adds Genres, Ratings and Release Date rows to the Jellyfin home screen. */
(function () {
    'use strict';

    var ROW_ATTR = 'data-homefusion';
    var cache = null;
    var config = null;

    function api() { return window.ApiClient; }

    function esc(s) {
        return String(s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    function loadConfig() {
        if (config) return Promise.resolve(config);
        return api().ajax({ type: 'GET', url: api().getUrl('HomeFusion/Config'), dataType: 'json' })
            .then(function (c) { config = c; setTimeout(function () { config = null; }, 60 * 1000); return c; });
    }

    function loadItems() {
        if (cache) return Promise.resolve(cache);
        var c = api();
        return c.getItems(c.getCurrentUserId(), {
            Recursive: true,
            IncludeItemTypes: [config.IncludeMovies ? 'Movie' : null, config.IncludeSeries ? 'Series' : null].filter(Boolean).join(',') || 'Movie',
            Fields: 'Genres,CommunityRating,PremiereDate,ProductionYear',
            EnableImageTypes: 'Backdrop,Primary,Thumb',
            ImageTypeLimit: 1,
            EnableUserData: true,
            EnableTotalRecordCount: false
        }).then(function (res) {
            cache = res.Items || [];
            setTimeout(function () { cache = null; }, 10 * 60 * 1000);
            return cache;
        });
    }

    function shuffle(a) {
        a = a.slice();
        for (var i = a.length - 1; i > 0; i--) {
            var j = Math.floor(Math.random() * (i + 1));
            var t = a[i]; a[i] = a[j]; a[j] = t;
        }
        return a;
    }

    function landscapeImage(item, width) {
        var c = api();
        if (item.BackdropImageTags && item.BackdropImageTags.length) {
            return c.getScaledImageUrl(item.Id, { type: 'Backdrop', maxWidth: width, tag: item.BackdropImageTags[0] });
        }
        if (item.ImageTags && item.ImageTags.Thumb) {
            return c.getScaledImageUrl(item.Id, { type: 'Thumb', maxWidth: width, tag: item.ImageTags.Thumb });
        }
        if (item.ImageTags && item.ImageTags.Primary) {
            return c.getScaledImageUrl(item.Id, { type: 'Primary', maxWidth: width, tag: item.ImageTags.Primary });
        }
        return null;
    }

    function posterImage(item, width) {
        if (item.ImageTags && item.ImageTags.Primary) {
            return api().getScaledImageUrl(item.Id, { type: 'Primary', maxWidth: width, tag: item.ImageTags.Primary });
        }
        return null;
    }

    function pickImage(items) {
        var withBackdrop = items.filter(function (i) { return i.BackdropImageTags && i.BackdropImageTags.length; });
        var pool = withBackdrop.length ? withBackdrop : items;
        var pick = shuffle(pool.slice(0, 30))[0];
        return pick ? landscapeImage(pick, 600) : null;
    }

    function year(i) {
        if (i.ProductionYear) return i.ProductionYear;
        if (i.PremiereDate) return new Date(i.PremiereDate).getFullYear();
        return null;
    }

    function byRatingDesc(a, b) { return (b.CommunityRating || 0) - (a.CommunityRating || 0); }
    function byDateDesc(a, b) {
        return (b.PremiereDate ? Date.parse(b.PremiereDate) : (year(b) || 0) * 3e10) -
            (a.PremiereDate ? Date.parse(a.PremiereDate) : (year(a) || 0) * 3e10);
    }

    // ---- Category builders: each returns [{ name, items }] ----

    function genreCategories(items) {
        var map = {};
        items.forEach(function (i) {
            (i.Genres || []).filter(function (g, n, a) { return a.indexOf(g) === n; })
                .forEach(function (g) { (map[g] = map[g] || []).push(i); });
        });
        var hidden = (config.HiddenGenres || '').toLowerCase().split('|').filter(Boolean);
        var names = Object.keys(map)
            .filter(function (g) { return hidden.indexOf(g.toLowerCase()) < 0; })
            .sort(function (a, b) { return map[b].length - map[a].length || a.localeCompare(b); });
        if (config.RandomizeGenres) names = shuffle(names);
        return names.map(function (g) { return { name: g, items: map[g].sort(byRatingDesc) }; });
    }

    function ratingCategories(items) {
        var rated = items.filter(function (i) { return i.CommunityRating; }).sort(byRatingDesc);
        var cats = [{ name: 'Top 50', items: rated.slice(0, 50) }];
        cats.push({ name: '8 - 10 Stars', items: rated.filter(function (i) { return i.CommunityRating >= 8; }) });
        for (var s = 7; s >= 4; s--) {
            (function (s) {
                cats.push({
                    name: s + ' Stars',
                    items: rated.filter(function (i) { return i.CommunityRating >= s && i.CommunityRating < s + 1; })
                });
            })(s);
        }
        cats.push({ name: '1 - 3 Stars', items: rated.filter(function (i) { return i.CommunityRating < 4; }) });
        return cats;
    }

    function releaseCategories(items) {
        var dated = items.filter(function (i) { return year(i); }).sort(byDateDesc);
        var cats = [{ name: 'Top 50 Latest', items: dated.slice(0, 50) }];
        if (!dated.length) return cats;
        var oldest = Math.floor(Math.min.apply(null, dated.map(year)) / 10) * 10;
        var current = Math.floor(new Date().getFullYear() / 10) * 10;
        for (var d = current; d >= oldest; d -= 10) {
            (function (d) {
                cats.push({ name: d + "'s", items: dated.filter(function (i) { var y = year(i); return y >= d && y < d + 10; }) });
            })(d);
        }
        return cats;
    }

    // ---- Rendering (matches Jellyfin's native overflowBackdropCard markup) ----

    function cardHtml(cat, idx) {
        var img = pickImage(cat.items);
        var style = img ? ' style="background-image:url(\'' + img + '\');"' : '';
        return '<div class="card overflowBackdropCard card-hoverable" data-hf-index="' + idx + '">' +
            '<div class="cardBox cardBox-bottompadded">' +
            '<div class="cardScalable">' +
            '<div class="cardPadder cardPadder-overflowBackdrop"></div>' +
            '<button type="button" class="cardImageContainer coveredImage cardContent itemAction hf-card"' + style + '>' +
            (img ? '' : '<span class="cardImageIcon material-icons folder" aria-hidden="true"></span>') +
            '<div class="hf-label">' + esc(cat.name) + '</div>' +
            '</button>' +
            '<div class="cardOverlayContainer"></div>' +
            '</div>' +
            '<div class="cardText cardTextCentered cardText-first"><bdi>' + cat.items.length + ' titles</bdi></div>' +
            '</div></div>';
    }

    function rowElement(key, title, cats) {
        var section = document.createElement('div');
        section.className = 'verticalSection hf-section';
        section.setAttribute(ROW_ATTR, key);
        section.innerHTML =
            '<div class="sectionTitleContainer sectionTitleContainer-cards padded-left">' +
            '<h2 class="sectionTitle sectionTitle-cards">' + esc(title) + '</h2></div>' +
            '<div is="emby-scroller" class="padded-top-focusscale padded-bottom-focusscale" data-centerfocus="true">' +
            '<div is="emby-itemscontainer" class="itemsContainer scrollSlider focuscontainer-x">' +
            cats.map(cardHtml).join('') +
            '</div></div>';
        section.addEventListener('click', function (e) {
            var card = e.target.closest('[data-hf-index]');
            if (!card) return;
            e.preventDefault();
            e.stopPropagation();
            var cat = cats[parseInt(card.getAttribute('data-hf-index'), 10)];
            openCategory(title + ': ' + cat.name, cat.items);
        }, true);
        requestAnimationFrame(function () { addScrollButtons(section); });
        return section;
    }

    // Mirror Jellyfin's emby-scrollbuttons (chevrons beside the row title) unless the
    // native scroller already created them.
    function addScrollButtons(section) {
        if (section.querySelector('.emby-scrollbuttons')) return;
        var scroller = section.querySelector('[is="emby-scroller"]');
        var slider = section.querySelector('.scrollSlider');
        if (!scroller || !slider) return;
        function scrollable(el) {
            var o = getComputedStyle(el).overflowX;
            return o === 'auto' || o === 'scroll' || o === 'hidden';
        }
        function target() {
            if (scrollable(scroller)) return scroller;
            if (scrollable(slider)) return slider;
            scroller.classList.add('hf-scroll');
            return scroller;
        }
        var wrap = document.createElement('div');
        wrap.className = 'emby-scrollbuttons padded-right hf-scrollbuttons';
        wrap.innerHTML = ['left', 'right'].map(function (dir) {
            return '<button type="button" is="paper-icon-button-light" data-ripple="false" data-direction="' + dir + '"' +
                ' title="' + (dir === 'left' ? 'Previous' : 'Next') + '" class="emby-scrollbuttons-button paper-icon-button-light">' +
                '<span class="material-icons chevron_' + dir + '" aria-hidden="true"></span></button>';
        }).join('');
        section.querySelector('.sectionTitleContainer').appendChild(wrap);
        var prev = wrap.children[0], next = wrap.children[1];
        function update() {
            var t = target();
            var max = t.scrollWidth - t.clientWidth;
            prev.disabled = t.scrollLeft <= 1;
            next.disabled = t.scrollLeft >= max - 1;
            wrap.style.visibility = max > 1 ? '' : 'hidden';
        }
        wrap.addEventListener('click', function (e) {
            var btn = e.target.closest('button');
            if (!btn) return;
            var t = target();
            var step = Math.max(t.clientWidth * 0.9, 200);
            t.scrollBy({ left: btn.getAttribute('data-direction') === 'left' ? -step : step, behavior: 'smooth' });
        });
        scroller.addEventListener('scroll', update, { passive: true, capture: true });
        window.addEventListener('resize', update);
        setTimeout(update, 50);
    }

    // Jellyfin's own itemscontainer/playstate/rating elements wire up play, watched,
    // favorite and the context menu when they are registered (they are in Jellyfin Web).
    function nativeCards() {
        return !!(window.customElements && customElements.get('emby-itemscontainer') &&
            customElements.get('emby-playstatebutton') && customElements.get('emby-ratingbutton'));
    }

    function syncUserData(btn, item, card) {
        item.UserData = item.UserData || {};
        if (btn.hasAttribute('data-played')) {
            item.UserData.Played = btn.getAttribute('data-played') === 'true';
            var ind = card.querySelector('.cardIndicators');
            if (item.UserData.Played && !ind) {
                card.querySelector('.cardContent').insertAdjacentHTML('beforeend',
                    '<div class="cardIndicators"><div class="playedIndicator indicator"><span class="material-icons indicatorIcon check" aria-hidden="true"></span></div></div>');
            } else if (!item.UserData.Played && ind) {
                ind.remove();
            }
        }
        if (btn.hasAttribute('data-isfavorite')) item.UserData.IsFavorite = btn.getAttribute('data-isfavorite') === 'true';
    }

    function fallbackAction(btn, item, card) {
        var c = api();
        var uid = c.getCurrentUserId();
        if (btn.hasAttribute('data-played')) {
            var played = btn.getAttribute('data-played') !== 'true';
            btn.setAttribute('data-played', String(played));
            btn.classList.toggle('playstatebutton-played', played);
            (played ? c.markPlayed(uid, item.Id, new Date()) : c.markUnplayed(uid, item.Id));
        } else if (btn.hasAttribute('data-isfavorite')) {
            var fav = btn.getAttribute('data-isfavorite') !== 'true';
            btn.setAttribute('data-isfavorite', String(fav));
            btn.classList.toggle('ratingbutton-withrating', fav);
            c.updateFavoriteStatus(uid, item.Id, fav);
        } else {
            window.location.hash = '#/details?id=' + item.Id + '&serverId=' + c.serverId();
        }
    }

    function openCategory(title, items) {
        var c = api();
        var serverId = c.serverId();
        var overlay = document.createElement('div');
        overlay.className = 'hf-overlay';
        overlay.innerHTML =
            '<div class="hf-header"><button is="paper-icon-button-light" class="hf-close paper-icon-button-light" title="Close">' +
            '<span class="material-icons arrow_back" aria-hidden="true"></span></button>' +
            '<h2 class="sectionTitle">' + esc(title) + '</h2></div>' +
            '<div is="emby-itemscontainer" class="hf-grid itemsContainer vertical-wrap padded-left padded-right" data-hf-native="' + (nativeCards() ? '1' : '') + '">' +
            items.map(function (i) {
                var img = posterImage(i, 400);
                var sub = [year(i), i.CommunityRating ? '\u2605 ' + i.CommunityRating.toFixed(1) : ''].filter(Boolean).join(' \u2022 ');
                var ud = i.UserData || {};
                var href = '#/details?id=' + i.Id + '&serverId=' + serverId;
                var attrs = ' data-id="' + i.Id + '" data-serverid="' + serverId + '" data-itemtype="' + i.Type + '"';
                var played = ud.Played ? ' playstatebutton-played' : '';
                var fav = ud.IsFavorite ? ' ratingbutton-withrating' : '';
                return '<div class="card portraitCard card-hoverable card-withuserdata" data-hf-item="' + i.Id + '" data-id="' + i.Id + '"' +
                    ' data-serverid="' + serverId + '" data-type="' + i.Type + '" data-mediatype="Video" data-isfolder="' + (i.Type === 'Series') + '" data-action="link">' +
                    '<div class="cardBox cardBox-bottompadded"><div class="cardScalable">' +
                    '<div class="cardPadder cardPadder-portrait"></div>' +
                    '<a class="cardImageContainer coveredImage cardContent itemAction" data-action="link" href="' + href + '"' +
                    (img ? ' style="background-image:url(\'' + img + '\');"' : '') + '>' +
                    (img ? '' : '<span class="cardImageIcon material-icons movie" aria-hidden="true"></span>') +
                    (ud.Played ? '<div class="cardIndicators"><div class="playedIndicator indicator"><span class="material-icons indicatorIcon check" aria-hidden="true"></span></div></div>' : '') +
                    '</a>' +
                    '<div class="cardOverlayContainer itemAction" data-action="link">' +
                    '<a class="cardImageContainer" href="' + href + '"></a>' +
                    '<button is="paper-icon-button-light" type="button" class="cardOverlayButton cardOverlayButton-hover itemAction paper-icon-button-light cardOverlayFab-primary" data-action="resume" title="Play">' +
                    '<span class="material-icons cardOverlayButton-icon play_arrow" aria-hidden="true"></span></button>' +
                    '<div class="cardOverlayButton-br flex">' +
                    '<button is="emby-playstatebutton" type="button" data-action="none" class="cardOverlayButton cardOverlayButton-hover itemAction paper-icon-button-light emby-button' + played + '"' + attrs + ' data-played="' + !!ud.Played + '" title="Mark played">' +
                    '<span class="material-icons cardOverlayButton-icon check" aria-hidden="true"></span></button>' +
                    '<button is="emby-ratingbutton" type="button" data-action="none" class="cardOverlayButton cardOverlayButton-hover itemAction paper-icon-button-light emby-button' + fav + '"' + attrs + ' data-likes="" data-isfavorite="' + !!ud.IsFavorite + '" title="Favorite">' +
                    '<span class="material-icons cardOverlayButton-icon favorite" aria-hidden="true"></span></button>' +
                    '<button is="paper-icon-button-light" type="button" class="cardOverlayButton cardOverlayButton-hover itemAction paper-icon-button-light" data-action="menu" title="More">' +
                    '<span class="material-icons cardOverlayButton-icon more_vert" aria-hidden="true"></span></button>' +
                    '</div></div>' +
                    '</div><div class="cardText cardTextCentered cardText-first"><bdi>' + esc(i.Name) + '</bdi></div>' +
                    '<div class="cardText cardTextCentered cardText-secondary"><bdi>' + esc(sub) + '</bdi></div>' +
                    '</div></div>';
            }).join('') +
            '</div>';
        function close() { overlay.remove(); window.removeEventListener('hashchange', close); }
        overlay.querySelector('.hf-close').addEventListener('click', close);
        var grid = overlay.querySelector('.hf-grid');
        var byId = {};
        items.forEach(function (i) { byId[i.Id] = i; });
        grid.addEventListener('click', function (e) {
            var card = e.target.closest('[data-hf-item]');
            var item = card && byId[card.getAttribute('data-hf-item')];
            var btn = e.target.closest('button');
            if (item && btn) {
                if (!grid.getAttribute('data-hf-native')) fallbackAction(btn, item, card);
                // Keep the cached item in sync with the native buttons' new state.
                setTimeout(function () { syncUserData(btn, item, card); }, 600);
                return;
            }
            if (e.target.closest('a')) setTimeout(close, 0);
        });
        window.addEventListener('hashchange', close);
        document.body.appendChild(overlay);
        if (window.CustomElements && window.CustomElements.upgradeSubtree) window.CustomElements.upgradeSubtree(overlay);
    }

    function injectStyles() {
        if (document.getElementById('hf-styles')) return;
        var s = document.createElement('style');
        s.id = 'hf-styles';
        s.textContent =
            '.hf-card{border:0;padding:0;cursor:pointer;width:100%;}' +
            '.hf-card .hf-label{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;' +
            'background:linear-gradient(rgba(0,0,0,.25),rgba(0,0,0,.55));color:#fff;font-size:clamp(1em,1.6vw,1.6em);font-weight:600;overflow-wrap:anywhere;line-height:1.15;' +
            'text-shadow:0 2px 6px rgba(0,0,0,.8);text-align:center;padding:0 .5em;}' +
            '.hf-overlay{position:fixed;inset:0;z-index:1000;overflow-y:auto;background:var(--theme-body-background,#101010);' +
            'background-color:#101010;padding-bottom:2em;}' +
            '.hf-header{display:flex;align-items:center;gap:.5em;padding:1em 3.3%;position:sticky;top:0;z-index:1;background:inherit;}' +
            '.hf-header h2{margin:0;}' +
            '.hf-grid{display:flex;flex-wrap:wrap;}' +
            '.hf-grid .playstatebutton-played .cardOverlayButton-icon{color:#00a4dc;}' +
            '.hf-grid .ratingbutton-withrating .cardOverlayButton-icon{color:#c33;}' +
            '.hf-section .sectionTitleContainer{display:flex;align-items:center;}' +
            '.hf-scrollbuttons{margin-left:auto;display:flex;}' +
            '.hf-scroll{overflow-x:auto;scrollbar-width:none;}.hf-scroll::-webkit-scrollbar{display:none;}' +
            '.layout-tv .hf-scrollbuttons,.layout-mobile .hf-scrollbuttons{display:none;}';
        document.head.appendChild(s);
    }

    // ---- Home page injection & placement ----

    var positionTitles = {
        'after-my-media': { keys: ['HeaderMyMedia', 'HeaderMyMediaSmall'], fallbacks: ['My Media'] },
        'after-continue-watching': { keys: ['HeaderContinueWatching'], fallbacks: ['Continue Watching'] },
        'after-latest-media': {
            keys: ['HeaderLatestMovies', 'HeaderLatestEpisodes', 'HeaderLatestMedia', 'HeaderLatest'],
            prefixKeys: ['LatestFromLibrary'],
            fallbacks: ['Latest Movies', 'Latest TV Shows', 'Latest Episodes', 'Latest Media'],
            prefixFallbacks: ['Latest from']
        },
        'after-next-up': { keys: ['NextUp', 'HeaderNextUp'], fallbacks: ['Next Up'] },
        'after-continue-listening': { keys: ['HeaderContinueListening'], fallbacks: ['Continue Listening'] },
        'after-continue-reading': { keys: ['HeaderContinueReading'], fallbacks: ['Continue Reading'] },
        'after-live-tv': { keys: ['LiveTV', 'HeaderLiveTV'], fallbacks: ['Live TV'] },
        'after-active-recordings': { keys: ['HeaderActiveRecordings'], fallbacks: ['Active Recordings'] }
    };

    function translated(keys, arg) {
        return (keys || []).map(function (k) {
            var t = window.Globalize && window.Globalize.translate ? window.Globalize.translate(k, arg) : null;
            return t && t !== k ? t : null;
        }).filter(Boolean);
    }

    // Returns the native section the row should follow; the last HomeFusion row already
    // placed after the same anchor is used so rows sharing a position keep their order.
    function findPositionTarget(sections, position) {
        var native = Array.prototype.filter.call(sections.children, function (c) { return !c.hasAttribute(ROW_ATTR); });
        var configured = positionTitles[position];
        if (!configured) return null;
        if (position === 'after-my-media') {
            var lib = native.find(function (c) { return c.querySelector('.homeLibraryButtonContainer'); });
            if (lib) return lib;
        }
        var titles = translated(configured.keys).concat(configured.fallbacks)
            .map(function (t) { return t.trim().toLowerCase(); });
        var prefixes = translated(configured.prefixKeys, '').concat(configured.prefixFallbacks || [])
            .map(function (t) { return t.trim().toLowerCase(); });
        return native.find(function (c) {
            var el = c.querySelector('.sectionTitle');
            var t = el ? el.textContent.trim().toLowerCase() : '';
            return t && (titles.indexOf(t) >= 0 || prefixes.some(function (p) { return t.indexOf(p) === 0; }));
        }) || null;
    }

    function placeRow(row, sections, position) {
        if (position === 'top') {
            var firstNative = Array.prototype.find.call(sections.children, function (c) { return !c.hasAttribute(ROW_ATTR) || c.getAttribute('data-hf-pos') !== 'top'; });
            sections.insertBefore(row, firstNative || null);
            return;
        }
        var target = position === 'bottom' ? null : findPositionTarget(sections, position);
        if (!target) { sections.appendChild(row); return; }
        var after = target;
        while (after.nextElementSibling && after.nextElementSibling.getAttribute('data-hf-pos') === position) {
            after = after.nextElementSibling;
        }
        after.insertAdjacentElement('afterend', row);
    }

    var building = false;

    function findSections() {
        var home = document.querySelector('#indexPage:not(.hide) #homeTab:not(.hide)') ||
            document.querySelector('.homePage:not(.hide)');
        return home ? home.querySelector('.sections, .homeSectionsContainer') : null;
    }

    var builders = {
        genres: { title: 'Genres', build: genreCategories },
        ratings: { title: 'Ratings', build: ratingCategories },
        release: { title: 'Release Date', build: releaseCategories }
    };

    function tryInject() {
        var c = api();
        if (building || !c || !c.getCurrentUserId || !c.getCurrentUserId() || !c.accessToken || !c.accessToken()) return;
        var sections = findSections();
        if (!sections || sections.querySelector('[' + ROW_ATTR + ']')) return;
        // Wait until Jellyfin has rendered its own sections so positions can be resolved.
        if (!sections.querySelector('.verticalSection, .homeLibraryButtonContainer')) return;

        building = true;
        injectStyles();
        loadConfig().then(loadItems).then(function (items) {
            if (sections.querySelector('[' + ROW_ATTR + ']') || !items.length) return;
            config.Rows.forEach(function (r) {
                var b = builders[r.Key];
                if (!r.Enabled || !b) return;
                var cats = b.build(items).filter(function (cat) { return cat.items.length; });
                if (!cats.length) return;
                var row = rowElement(r.Key, b.title, cats);
                row.setAttribute('data-hf-pos', r.Position || 'bottom');
                placeRow(row, sections, r.Position || 'bottom');
                if (window.CustomElements && window.CustomElements.upgradeSubtree) window.CustomElements.upgradeSubtree(row);
            });
        }).catch(function (err) {
            console.warn('HomeFusion: unable to build rows.', err);
        }).then(function () { building = false; });
    }

    new MutationObserver(function () { tryInject(); })
        .observe(document.documentElement, { childList: true, subtree: true });
    document.addEventListener('viewshow', tryInject);
})();
