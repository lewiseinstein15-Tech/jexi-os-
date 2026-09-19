# DATA_SOURCES.md — External Data Source Licenses (Phase 9 F)

**GEV pattern: the code license and the data license are deliberately
separated.** Code in this repository is MIT (see `LICENSE`). Data obtained
from the external sources below is **NOT** covered by MIT — each source
carries its own license and terms.

Verification method: license statements were verified against the
provider's own pages where marked **VERIFIED** (live HTTP fetch on
2026-09-19 from the build sandbox; evidence URL given per row). Where a
license could not be verified — blocked, failed, or absent — the row is
marked **UNVERIFIED** with a specific note: check the provider's current
terms before redistribution.

## Main table — OSINT layers + registered URL sources

| Source | Layer | License | Commercial Use | Attribution Required |
|--------|-------|---------|----------------|----------------------|
| OpenSky Network (`opensky-network.org`) | flights | OpenSky General Terms of Use & Data License Agreement — grant limited to **non-profit research and non-profit education** (VERIFIED 2026-09-19, https://opensky-network.org/about/terms-of-use) | **NO** — any for-profit/commercial entity, and any operational REST-API use in a live product, requires a written license from OpenSky | Yes |
| adsb.lol (`api.adsb.lol`) | flights | ODbL v1.0 — Open Data Commons Open Database License (VERIFIED 2026-09-19, verbatim in https://api.adsb.lol/api/openapi.json: "The license for the API as well as all data ADSB.lol makes public is ODbL") | Yes, under ODbL (share-alike applies to derived databases) | Yes (ODbL attribution + database notice) |
| CelesTrak (`celestrak.org`) | satellites | **UNVERIFIED — check provider ToS before redistribution.** GP/TLE element sets originate from U.S. Government sources (public-domain origin), but CelesTrak's own redistribution terms could not be fetched from the build sandbox (connection failed, 2 attempts + archive route) — see https://celestrak.org/data.php | UNVERIFIED — check provider | Check provider (do not imply endorsement) |
| USGS (`earthquake.usgs.gov`) | earthquakes | Public domain — U.S. Government work (17 U.S.C. § 105). Policy page fetch was blocked from the sandbox (HTTP 202 challenge) — statutory basis, not provider-invented text; behavioral evidence: feeds served keyless in Phase 9 A/B probes. Confirm at https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits | Yes | Requested, not legally required (cite USGS) |
| NASA FIRMS (`firms.modaps.eosdis.nasa.gov`) | fires | Public domain — NASA is a U.S. federal agency (17 U.S.C. § 105). Exact policy text UNVERIFIED from sandbox (fetch failed); NASA Earth science data policy is open access. MAP_KEY required for the area API (registration, not payment) | Yes | Requested (cite NASA FIRMS / LANCE) |
| Radio Browser (`all.api.radio-browser.info`, `de1.api.radio-browser.info`, `de2.api.radio-browser.info`) | radio | **UNVERIFIED — check provider ToS before redistribution.** Project states the data is freely licensed (README fetched 2026-09-19: "I licenced it freely, you could also start your own server"); the exact database license text could not be retrieved from the sandbox — see https://www.radio-browser.info/ | UNVERIFIED — check provider | Yes (project requests crediting the community) |
| GBFS / NABSA (`gbfs.github.io/gbfs`) | bikeshare | Specification: Creative Commons license (VERIFIED 2026-09-19, `LICENSE` file in MobilityData/gbfs). **Feed DATA: per-operator** — each GBFS publisher chooses its own license (README "Common Data Licenses" section, fetched) | Per feed — varies by operator | Per feed — varies by operator |
| Launch Library 2 / The Space Devs (`ll.thespacedevs.com`) | launches | **UNVERIFIED — check provider ToS before redistribution.** Free anonymous tier confirmed live (HTTP 200, 2026-09-19), but no license statement was retrievable from the sandbox — see https://thespacedevs.com/llapi. Attribution to The Space Devs is expected by the project | UNVERIFIED — check provider | Yes (project expects credit) |
| OpenStreetMap / Overpass API (`overpass-api.de`) | traffic | ODbL v1.0 — Open Data Commons Open Database License (VERIFIED 2026-09-19, https://www.openstreetmap.org/copyright) | Yes, under ODbL (share-alike applies to derived databases) | Yes (ODbL attribution © OpenStreetMap contributors) |
| TomTom (`api.tomtom.com`) | traffic | Proprietary — TomTom Terms and Conditions (page live 2026-09-19, https://docs.tomtom.com/legal/terms-and-conditions/). Keyed API | Per TomTom agreement — check current terms before redistribution | Yes |
| Google Map Tiles (`tile.googleapis.com`) | map-stack | Proprietary — Google Maps Platform Terms of Service (page live 2026-09-19, https://cloud.google.com/maps-platform/terms). Keyed, metered | Per Google agreement — check current terms before redistribution | Yes (Google attribution/display requirements) |
| AISStream (`stream.aisstream.io`, WSS — deliberately NOT in the HTTP URL registry) | ships | **UNVERIFIED — check provider ToS before redistribution.** Service advertises free access; no license or terms page was retrievable from the sandbox (landing page fetched; /terms, /terms-of-service, /terms-and-conditions all 404) | UNVERIFIED — check provider | UNVERIFIED — check provider |

## Other external data sources used in the codebase (surveyed 2026-09-19)

Survey method: host extraction across tracked runtime sources
(`*.js`, `*.mjs`, `*.py`, `*.yaml`); model-provider API hosts are governed
by their own service agreements and are not data sources in this sense;
test doubles (`*.example`, `*.test`, `localhost`) excluded.

| Source | Used by | License | Commercial Use | Attribution Required |
|--------|---------|---------|----------------|----------------------|
| Wikipedia REST (`en.wikipedia.org`) | `server/src/services/WebSearch.js`, `TrustedLibrary.js`, `ComputerUseTraining.js` | Text: CC BY-SA 4.0 (VERIFIED 2026-09-19, license link live on Wikipedia pages) | Yes, under CC BY-SA 4.0 (share-alike) | Yes (CC BY-SA attribution) |
| BBC News RSS (`feeds.bbci.co.uk`) | `server/src/services/NewsAgent.js`, `TrustedLibrary.js` | Proprietary — BBC Terms of Use (terms page live 2026-09-19, https://www.bbc.co.uk/usingthebbc/terms-of-use/). RSS feeds are for personal/non-commercial use per BBC terms | NO (non-commercial per BBC terms) — check current terms | Yes (BBC sourcing rules) |
| Google News RSS (`news.google.com`) | `server/src/services/NewsAgent.js`, `WebSearch.js`, `TrustedLibrary.js` | Proprietary — Google Terms of Service; RSS usage subject to Google ToS | Check current Google ToS | Yes (Google sourcing requirements) |
| Pollinations AI (`image.pollinations.ai`) | `server/src/services/ImageSearch.js` | Software MIT (VERIFIED 2026-09-19, project README: "open-source software licensed under the MIT license"). Service/output terms: **UNVERIFIED — check provider ToS before commercial use** | UNVERIFIED — check provider | Check provider |

## Redistribution check (P6 summary)

Redistributable / Attribution / Commercial at a glance — full evidence
above. Any row marked CHECK must be resolved against the provider's
current terms before redistribution.

| Source | Redistributable? | Attribution required? | Commercial use allowed? |
|--------|------------------|-----------------------|-------------------------|
| OpenSky Network | Limited — non-profit research/education purposes only | Yes | NO without written license |
| adsb.lol | Yes (ODbL, share-alike on derived DBs) | Yes | Yes (ODbL) |
| CelesTrak | CHECK — UNVERIFIED | Check provider | CHECK — UNVERIFIED |
| USGS | Yes (public domain, U.S. Government work) | Requested, not required | Yes |
| NASA FIRMS | Yes (public domain, U.S. federal data) | Requested | Yes |
| Radio Browser | CHECK — UNVERIFIED | Yes (community credit) | CHECK — UNVERIFIED |
| GBFS | Per feed — varies by operator | Per feed | Per feed |
| Launch Library 2 | CHECK — UNVERIFIED | Yes (expected) | CHECK — UNVERIFIED |
| OpenStreetMap | Yes (ODbL, share-alike on derived DBs) | Yes | Yes (ODbL) |
| TomTom | NO (proprietary, keyed) | Yes | Per TomTom agreement |
| Google Map Tiles | NO (proprietary, keyed; ToS restricts caching/redistribution) | Yes | Per Google agreement |
| AISStream | CHECK — UNVERIFIED | CHECK — UNVERIFIED | CHECK — UNVERIFIED |
| Wikipedia | Yes (CC BY-SA 4.0, share-alike) | Yes | Yes (CC BY-SA 4.0) |
| BBC News RSS | Limited — per BBC terms | Yes | NO (non-commercial per BBC terms) |
| Google News RSS | Check Google ToS | Yes | Check Google ToS |
| Pollinations AI | Check provider ToS (software is MIT; output terms UNVERIFIED) | Check provider | CHECK — UNVERIFIED |
