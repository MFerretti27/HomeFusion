# HomeFusion

<p align="center">
	<img src="assets/homefusion.png" alt="HomeFusion — Jellyfin home screen rows" width="600">
</p>

<p align="center">
	<a href="https://github.com/MFerretti27/HomeFusion/actions/workflows/ci.yml">
		<img src="https://github.com/MFerretti27/HomeFusion/actions/workflows/ci.yml/badge.svg" alt="Build and test status">
	</a>
	<a href="https://github.com/MFerretti27/HomeFusion/releases">
		<img src="https://img.shields.io/github/downloads/MFerretti27/HomeFusion/total?label=release%20downloads&amp;color=00a4dc" alt="Total GitHub release asset downloads">
	</a>
</p>

Jellyfin 12.4 plugin that adds four configurable card rows to the Jellyfin Web home screen:

- **Genres** – one card per genre (Action, Comedy, Romance, …), sorted by item count.
- **Ratings** – Top 50, 8–10 Stars, 7 Stars, 6 Stars, 5 Stars, … (community rating).
- **Release Date** – Latest, 2020's, 2010's, 2000's, 1990's, … 
- **Collections** – one card per collection, sorted by name, opening its Jellyfin details page (off by default).

Cards use Jellyfin's native overflow card markup: portrait cards for Collections, landscape cards for Genres, Ratings and Release Date. Collection cards prefer poster artwork, falling back to other collection artwork when no poster exists. Clicking a genre, rating or release date card opens a grid of the matching titles; collection cards open Jellyfin's collection details page.

Cards across all enabled HomeFusion rows coordinate artwork selection to maximize unique images, preferring backdrops from matching titles (or the collection's own artwork). When distinct artwork runs out, images can repeat; folder placeholders are only used when a card has no artwork available.

## Install

Add this repository URL under **Dashboard → Plugins → Repositories**:

```
https://github.com/MFerretti27/HomeFusion/releases/latest/download/manifest.json
```

Install **HomeFusion** from the catalog and restart Jellyfin. The client script is injected into the web client's `index.html` response automatically (no file writes needed).

## Screenshots
<p align="center">
<img width="600" height="300" alt="Screenshot 2026-11-10 at 8 47 10 PM" src="https://github.com/user-attachments/assets/b7d1a66e-9d8e-435d-8f82-5c315a8ce70f" />
</p>


## Settings

Open **Dashboard → Home Fusion** (sidebar shortcut under Plugins). For each row you can:

- enable or disable it, and
- choose where it appears: top of Home, after My Media / Continue Watching / Latest Media / Next Up / Continue Listening / Continue Reading / Live TV / Active Recordings, or bottom of Home.

You can also hide specific genres (e.g. Documentary or TV Movie) from the Genres row, randomize the order of the genre cards (shuffled on each Home load), include movies and/or series.

Enable the Collections row to show the current user's collections, independently of the movie/series filters. Its settings include a row position and a separate option to randomize collection order each time Home loads.

Rows sharing a position appear in this order: Collections, Genres, Ratings, Release Date.

**Interface tweaks** (all off by default): hide the SyncPlay button, hide the Cast / Play On button, round poster and card corners, and hide the "My Media" section title.

## Development

```sh
npm ci
npm run build:plugin            # tests + versioned ZIP + manifest preview in artifacts/
dotnet test tests/HomeFusion.Tests/HomeFusion.Tests.csproj
```

## Releasing

Push a `vX.Y.Z` tag, or run the **Publish Jellyfin plugin** workflow manually (optionally with a version; otherwise the patch version is bumped). The workflow tests, builds `HomeFusion_X.Y.Z.zip`, generates `manifest.json` and publishes a GitHub release.
