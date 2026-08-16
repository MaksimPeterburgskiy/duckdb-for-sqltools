<div align="center">

<img src="icons/duckdb-logo.png" alt="DuckDB for SQLTools" width="96" height="96" />

# DuckDB for SQLTools

**Query and explore DuckDB and MotherDuck databases without leaving VS Code.**

[![CI](https://github.com/MaksimPeterburgskiy/duckdb-for-sqltools/actions/workflows/ci.yml/badge.svg)](https://github.com/MaksimPeterburgskiy/duckdb-for-sqltools/actions/workflows/ci.yml)
[![Latest release](https://img.shields.io/github/v/release/MaksimPeterburgskiy/duckdb-for-sqltools?label=download&color=fff100&labelColor=444)](https://github.com/MaksimPeterburgskiy/duckdb-for-sqltools/releases/latest)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE.md)

A [SQLTools](https://marketplace.visualstudio.com/items?itemName=mtxr.sqltools) driver for [DuckDB](https://duckdb.org/), built on the official [DuckDB Node API](https://duckdb.org/docs/stable/clients/node_neo/overview).

[Install](#install) ·
[Features](#features) ·
[Connections](#connection-targets) ·
[Security](#duckdb-extensions-and-security) ·
[Troubleshooting](#troubleshooting) ·
[Development](#development)

</div>

---

## Install

1. Install [SQLTools](https://marketplace.visualstudio.com/items?itemName=mtxr.sqltools) from the marketplace.
2. Download the VSIX from the [latest release](https://github.com/MaksimPeterburgskiy/duckdb-for-sqltools/releases/latest).
3. Install it with **Extensions: Install from VSIX...** in VS Code, or from a terminal:

```sh
code --install-extension duckdb-for-sqltools-<version>.vsix
```

Then open the SQLTools sidebar, choose **Add New Connection**, and select **DuckDB**.

> **Requirements:** VS Code 1.87 or newer. The extension installs the matching native DuckDB package for your platform on first connect.

## Features

### Connections
- Local file, in-memory, MotherDuck, and advanced URI connection modes
- Automatic, read-only, and read/write access modes
- Workspace-relative paths for database files, so connections move with the project
- Optional instance settings (`threads`, `memory_limit`, external-access and extension controls) and trusted initialization SQL

### Explorer
- Catalog-aware browsing of attached databases, schemas, tables, views, columns, constraints, indexes, sequences, types, functions, and macros
- Fully qualified previews, row counts, definitions, and INSERT snippets
- Correct handling of names with spaces, dots, quotes, Unicode, and SQL keywords

### Queries and results
- Multiple statements per run, with one SQLTools result grid per statement
- Lossless display of DuckDB integers, decimals, temporal values, blobs, and nested types
- Empty results keep their column headers; duplicate column names are deduplicated

### Autocomplete
- DuckDB keyword completion plus catalog-aware table and column completion
- Context-aware `sql_auto_complete()` suggestions when trusted initialization SQL has loaded DuckDB's official `autocomplete` extension

The explorer uses `information_schema` for portable catalog data and DuckDB's metadata functions for everything the information schema does not expose: database access state, constraint expressions, indexes, sequences, macros, and user-defined types.

## Connection targets

The connection assistant offers four modes:

- **Local File** opens a `.duckdb` file. Files inside a VS Code workspace are stored as workspace-relative paths so the connection can move with the project.
- **In-Memory** opens a temporary `:memory:` database. In-memory connections are always writable and disappear when disconnected.
- **MotherDuck** opens `md:` or `md:<database>`. The default **Ask on connect** mode prompts for a MotherDuck service token each time it is needed. You can explicitly opt into storing it as plaintext.
- **Advanced URI** accepts any other DuckDB-supported database path or URI.

Existing connections that use `databaseFilePath` are migrated to the `database` setting when edited or saved.

### Access modes

- **Automatic** lets DuckDB select its normal access mode.
- **Read Only** permits queries and explorer reads but rejects writes.
- **Read/Write** opens the database for writes.

DuckDB allows either one process with read/write access or multiple read-only processes for a local database file. Close other read/write DuckDB processes if the connection reports a lock conflict. See [DuckDB concurrency](https://duckdb.org/docs/current/connect/concurrency).

Within one SQLTools process, DuckDB caches file-backed instances by path. Disconnect an existing profile before opening the same file with a different access mode or different advanced instance options; DuckDB rejects conflicting configurations rather than weakening the first profile's settings.

### MotherDuck credentials

The default **Ask on connect** mode keeps the token out of saved settings. The plaintext option is available for unattended connections, but stores the token in SQLTools user or workspace JSON. The extension rejects a `motherduck_token` embedded in a URI.

Create and manage tokens using the [MotherDuck authentication guide](https://motherduck.com/docs/key-tasks/authenticating-and-connecting-to-motherduck/).

### Advanced options

Advanced connection settings map to DuckDB instance options:

- `threads`
- `memory_limit`
- `temp_directory`
- `extension_directory`
- `enable_external_access`
- `autoinstall_known_extensions`
- `autoload_known_extensions`
- `allow_community_extensions`

`initializationSql` runs after the connection opens. Use it only for SQL you trust, such as required `SET`, `ATTACH`, `LOAD`, or `CREATE SECRET` statements. If initialization fails, the connection is closed and SQLTools reports the error.

## Value display

SQLTools results must be safe to pass through JSON. The driver uses the DuckDB Node API's JSON conversion instead of converting every `bigint` to a JavaScript `number`.

Large integers, decimals, temporal values, UUIDs, blobs, and bit strings are displayed as strings when a JavaScript number or object would lose information. Lists and arrays remain arrays, structs remain objects, maps use key/value entries, and unions retain their tag and value.

## DuckDB extensions and security

The driver never silently installs an extension or enables unsigned extensions. DuckDB may auto-install and auto-load known extensions unless you disable those behaviors in the advanced connection settings. Community extensions contain third-party code and run with the same permissions as VS Code's SQLTools process.

For connections that execute untrusted SQL, consider disabling extension auto-installation, extension auto-loading, community extensions, and external access. Disabling external access also blocks operations such as `ATTACH`, `COPY` to files, and file-reading table functions. Read the [DuckDB security guidance](https://duckdb.org/docs/current/operations_manual/securing_duckdb/overview) before choosing these restrictions.

## Current SQLTools limits

- SQLTools does not expose a driver cancellation API, so DuckDB's interrupt method cannot be connected to a cancel button.
- SQLTools materializes the final result array. DuckDB can stream internally, but a large completed grid still consumes memory in the SQLTools process.
- SQLTools has explorer context values for constraints, types, and sequences, but its typed definition APIs are less complete than the table, view, function, and index APIs.

## Troubleshooting

- **The database is locked:** disconnect the process that has read/write access, or use Read Only when you only need to inspect the file.
- **A read-only connection rejects a statement:** explorer queries work in read-only mode, but DDL, DML, `ATTACH` without a compatible mode, and some extension operations require write access.
- **MotherDuck authentication fails:** reconnect and enter a current token, or edit the connection to replace its plaintext token. Do not add the token to the `md:` URI.
- **An extension or file function is blocked:** check `enable_external_access`, `autoinstall_known_extensions`, `autoload_known_extensions`, and `allow_community_extensions`. A restrictive setting must be changed by recreating the connection.
- **The native package does not load:** open the SQLTools output channel and [file an issue](https://github.com/MaksimPeterburgskiy/duckdb-for-sqltools/issues) with the reported operating system, architecture, Node version, SQLTools version, driver version, and full dependency-install error.

## Development

This repository uses pnpm. See [GETTING_STARTED.md](GETTING_STARTED.md) for setup, testing, debugging, and packaging details.

```sh
corepack enable
pnpm install --frozen-lockfile
```

| Command | What it does |
| --- | --- |
| `pnpm typecheck` | Type-check with `tsc` |
| `pnpm test` | Run the unit tests |
| `pnpm test:integration` | Exercise real DuckDB databases through the native Node API |
| `pnpm compile` | Bundle the extension entry points |
| `pnpm package` | Build a VSIX |

CI builds and tests the native DuckDB integration on Ubuntu x64, Ubuntu arm64, Windows x64, and Apple Silicon before producing a VSIX artifact. Maintainers publish tested artifacts through the manual GitHub Release workflow described in [GETTING_STARTED.md](GETTING_STARTED.md).

## License

[MIT](LICENSE.md)
