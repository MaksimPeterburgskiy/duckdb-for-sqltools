# Changelog

Release notes for each published version also appear on [GitHub Releases](https://github.com/MaksimPeterburgskiy/duckdb-for-sqltools/releases).

## 2.0.2

- Point install instructions at the marketplace listings (#7)
- Stop exposing MotherDuck tokens through resolveConnection (#5)

## Unreleased

- Security: stopped resolving MotherDuck credentials through the public `resolveConnection` extension API. Ask on connect is now the default, and existing credential-backed profiles prompt for a token instead of returning one to the API caller.

## 2.0.1

- Publish releases to VS Code Marketplace and Open VSX (#6)
- Clean up public-facing docs and repo assets (#4)

## 2.0.0

- Replaced `duckdb-async` with `@duckdb/node-api@1.5.5-r.4`, backed by DuckDB 1.5.5.
- Retained separate DuckDB instance and connection handles, with ordered shutdown and race-safe lifecycle handling.
- Preserved large integers, decimals, temporal values, blobs, and nested values through DuckDB's JSON-safe result conversion.
- Preserved columns for empty results and deduplicated duplicate result-column names.
- Rebuilt the explorer around `information_schema` and catalog-aware DuckDB metadata functions.
- Added fully qualified, correctly quoted catalog, schema, and object names to previews, counts, definitions, and INSERT snippets.
- Added explorer support for attached catalogs, multiple schemas, views, constraints, indexes, sequences, functions, macros, and custom types where SQLTools can display them.
- Added DuckDB keyword completion, context-aware `sql_auto_complete()` support, and catalog-aware object search.
- Added local file, in-memory, MotherDuck, and advanced URI connection modes, plus Automatic, Read Only, and Read/Write access modes.
- Added credential-backed and ask-on-connect MotherDuck token handling. Tokens embedded in connection URIs are rejected.
- Added workspace-relative database paths, advanced instance options, and trusted initialization SQL.
- Replaced Yarn with pnpm and added typecheck, unit, native integration, compile, and VSIX packaging checks.
- Added CI coverage for Ubuntu x64, Ubuntu arm64, Windows x64, and macOS arm64.

## 1.0.0

- First standalone release as DuckDB for SQLTools.
- Moved distribution to versioned VSIX files on GitHub Releases.
