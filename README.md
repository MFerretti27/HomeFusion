# HomeFusion

Jellyfin 12.4 plugin that adds three rows of landscape cards to the Jellyfin Web home screen:

- **Genres** – one card per genre (Action, Comedy, Romance, …), sorted by item count.
- **Ratings** – Top 50, 8–10 Stars, 7 Stars, 6 Stars, 5 Stars, … (community rating).
- **Release Date** – Top 50 Latest, 2020's, 2010's, 2000's, 1990's, … 

Cards use Jellyfin's native `overflowBackdropCard` markup so they match the built-in landscape rows. Clicking a card opens a grid of the matching titles.

## Install

Add this repository URL under **Dashboard → Plugins → Repositories**:

```
https://github.com/MFerretti27/HomeFusion/releases/latest/download/manifest.json
```

Install **HomeFusion** from the catalog and restart Jellyfin. The client script is injected into the web client's `index.html` response automatically (no file writes needed).

## Settings

Open **Dashboard → Home Fusion** (sidebar shortcut under Plugins). For each row you can:

- enable or disable it, and
- choose where it appears: top of Home, after My Media / Continue Watching / Latest Media / Next Up / Continue Listening / Continue Reading / Live TV / Active Recordings, or bottom of Home.

You can also hide specific genres (e.g. Documentary or TV Movie) from the Genres row, randomize the order of the genre cards (shuffled on each Home load), include movies and/or series.

**Interface tweaks** (all off by default): hide the SyncPlay button, hide the Cast / Play On button, round poster and card corners, and hide the "My Media" section title.

## Development

```sh
npm ci
npm run build:plugin            # tests + versioned ZIP + manifest preview in artifacts/
dotnet test tests/HomeFusion.Tests/HomeFusion.Tests.csproj
```

## Releasing

Push a `vX.Y.Z` tag, or run the **Publish Jellyfin plugin** workflow manually (optionally with a version; otherwise the patch version is bumped). The workflow tests, builds `HomeFusion_X.Y.Z.zip`, generates `manifest.json` and publishes a GitHub release.
