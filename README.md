# Job Search Copilot

Job Search Copilot is an Apache-2.0 Codex plugin workspace for structured, privacy-conscious job-search assistance. This initial scaffold establishes the plugin contract, build tooling, and safe synthetic development data only.

## Status

The MCP server and Viewer are intentionally reserved as empty workspace packages. Their runtime behavior will be introduced in later implementation tasks.

## Requirements

- Node.js 22 or newer
- npm 10 or newer

## Install and verify

```bash
npm install
npm run build
npm test
```

`npm run validate:config` checks the Codex plugin manifest, the empty MCP manifest, the reserved skills directory, and the required markers on every JSON fixture.

## Privacy boundary

Only files in `fixtures/` are used as example data, and all are explicitly synthetic. Do not add personal resumes, application materials, credentials, or private data to this repository.

## Repository

Planned upstream: <https://github.com/kikixiong/job-search-copilot>

## License

Copyright 2026 Jiaqi Xiong.

Licensed under the [Apache License 2.0](LICENSE).
