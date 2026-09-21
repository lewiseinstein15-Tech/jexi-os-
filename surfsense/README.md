# JEXI OS — surfsense (Phase 19)

Live research + synthesis layer, NotebookLM-class, modeled on
[MODSetter/SurfSense](https://github.com/MODSetter/SurfSense) at source level
(researched from a shallow clone; connector pattern in
`surfsense_backend/app/connectors/`).

## Scope A — connector framework

Uniform interface (see `connectors/_connector.js`):

    connector.name          -> string
    connector.capabilities  -> { live: bool, auth: 'none'|'oauth'|'token' }
    connector.fetch(query, opts) -> { documents[] }
    connector.assert()      -> throws E_CONNECTOR_INCOMPLETE if shape invalid

Registry (`connectors/index.js`): `list()` (name-ascending, deterministic),
`get(name)` (unknown -> `E_UNKNOWN_CONNECTOR`), `fetch(name, query, opts)`
(validates provenance documents, deterministic ordering by source/url/text).
`assert()` is enforced at registry load — a malformed connector cannot
register.

Documents carry provenance `{ source, url?, fetchedAt, text }`.

## Truthfulness policy

Every connector declares `capabilities.live` truthfully for THIS sandbox:

- 15 connectors require live network credentials unavailable here — they are
  `live: false`, declare their auth mode and required credential env vars, and
  `fetch()` throws `E_LIVE_UNAVAILABLE`. No live response is ever faked.
- `local-search` is the one `live: true` connector (auth: `none`): it needs no
  credentials and no network because it runs real BM25 ranking over a real
  shipped local index of public documents (`connectors/_local-index.js` —
  RFCs, public-domain texts, each entry with its real canonical URL). This is
  the sandbox-verifiable member of the "search engines" category.

## Connector set (16)

| name          | auth  | live | required credentials (env)                        |
| ------------- | ----- | ---- | ------------------------------------------------- |
| clickup       | token | no   | CLICKUP_TOKEN                                     |
| confluence    | token | no   | CONFLUENCE_SITE, CONFLUENCE_EMAIL, CONFLUENCE_API_TOKEN |
| discord       | token | no   | DISCORD_BOT_TOKEN                                 |
| github        | token | no   | GITHUB_TOKEN                                      |
| google-search | token | no   | GOOGLE_SEARCH_API_KEY                             |
| indeed        | token | no   | INDEED_API_KEY                                    |
| instagram     | token | no   | INSTAGRAM_ACCESS_TOKEN                            |
| jira          | token | no   | JIRA_SITE, JIRA_EMAIL, JIRA_API_TOKEN             |
| linear        | oauth | no   | LINEAR_ACCESS_TOKEN                               |
| local-search  | none  | yes  | none (shipped local index)                        |
| maps          | token | no   | GOOGLE_MAPS_API_KEY                               |
| notion        | oauth | no   | NOTION_ACCESS_TOKEN                               |
| reddit        | oauth | no   | REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET            |
| slack         | oauth | no   | SLACK_BOT_TOKEN                                   |
| tiktok        | token | no   | TIKTOK_ACCESS_TOKEN                               |
| youtube       | token | no   | YOUTUBE_API_KEY                                   |

`confluence` and `local-search` are the two extra connectors beyond the 14
prescribed ones; confluence is taken from SurfSense's own connector set, and
local-search is SurfSense's local-documents retrieval concept realized over a
shipped index.
