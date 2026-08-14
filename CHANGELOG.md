# Change Log

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

## 1.3.2

- v1.3.2 DuckDB Support

## 1.0.0

- v1.0.0 DuckDB Support

## 0.10.2

- v0.10.2 DuckDB support
- Changed semantic versioning to follow DuckDB's

## 0.10.0

- v0.10.0 DuckDB support
- Changed semantic versioning to follow DuckDB's

## 0.0.5

- v0.9.1 DuckDB support

## 0.0.3

- Add support for Read/Write connections
- Minor improvements to output messages

## 0.0.2

- Minor fixes to docs

## 0.0.1

- v0.8.1 DuckDB support
- Connect to DuckDB instance
- Run queries against DuckDB instance
- Explore tables and columns in the sidebar
- Autocomplete for common keywords, and database tables (N.B. column autocomplete is not yet supported)
