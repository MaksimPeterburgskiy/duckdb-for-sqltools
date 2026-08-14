[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

# DuckDB driver for SQLTools

Run queries and browse [DuckDB](https://duckdb.org/) databases from [SQLTools](https://marketplace.visualstudio.com/items?itemName=mtxr.sqltools) in VS Code.

Version 2.0 uses DuckDB 1.5.5 through `@duckdb/node-api@1.5.5-r.4`, DuckDB's current Node client. The extension requires VS Code 1.87 or newer and installs the matching native DuckDB package for the SQLTools host platform.

## Install

Install [SQLTools](https://marketplace.visualstudio.com/items?itemName=mtxr.sqltools), then install the [DuckDB driver](https://marketplace.visualstudio.com/items?itemName=Evidence.sqltools-duckdb-driver). Open the SQLTools sidebar and choose **Add New Connection**, then select **DuckDB**.

## Features

- Local file, in-memory, MotherDuck, and advanced URI connections
- Automatic, read-only, and read/write access modes
- Multiple statements with one SQLTools result per statement
- Lossless display of DuckDB integers, decimals, temporal values, blobs, and nested types
- Catalog-aware explorer for attached databases, schemas, tables, views, columns, constraints, indexes, sequences, types, functions, and macros
- Fully qualified previews, counts, definitions, and INSERT snippets
- DuckDB keyword completion and catalog-aware table and column completion
- Context-aware `sql_auto_complete()` suggestions when trusted initialization SQL has already loaded DuckDB's official `autocomplete` extension
- Workspace-relative paths for database files inside the current VS Code workspace
- Optional connection settings and initialization SQL

The explorer uses `information_schema` for its portable catalog, schema, table, view, and column data. DuckDB metadata functions provide details that the information schema does not expose, including database access state, constraint expressions, indexes, sequences, macros, and user-defined types. Object names are kept as separate catalog, schema, and object parts, so names with spaces, dots, quotes, Unicode, or SQL keywords work correctly.

## Connection targets

The connection assistant offers four modes:

- **Local File** opens a `.duckdb` file. Files inside a VS Code workspace are stored as workspace-relative paths so the connection can move with the project.
- **In-Memory** opens a temporary `:memory:` database. In-memory connections are always writable and disappear when disconnected.
- **MotherDuck** opens `md:` or `md:<database>`. Supply a MotherDuck service token through SQLTools Driver Credentials, choose **Ask on connect**, or explicitly opt into storing it as plaintext.
- **Advanced URI** accepts another DuckDB-supported database path or URI.

Existing connections that use `databaseFilePath` are migrated to the `database` setting when edited or saved.

### Access modes

- **Automatic** lets DuckDB select its normal access mode.
- **Read Only** permits queries and explorer reads but rejects writes.
- **Read/Write** opens the database for writes.

DuckDB allows either one process with read/write access or multiple read-only processes for a local database file. Close other read/write DuckDB processes if the connection reports a lock conflict. See [DuckDB concurrency](https://duckdb.org/docs/current/connect/concurrency).

Within one SQLTools process, DuckDB caches file-backed instances by path. Disconnect an existing profile before opening the same file with a different access mode or different advanced instance options; DuckDB rejects conflicting configurations rather than weakening the first profile's settings.

### MotherDuck credentials

The default token mode uses SQLTools' credential prompt and optional keychain storage, then passes the token to DuckDB only while connecting. **Ask on connect** keeps it out of saved settings entirely. The extension rejects a `motherduck_token` embedded in a URI because SQLTools connection settings may be written to user or workspace JSON.

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

SQLTools results must be safe to pass through JSON. The driver uses DuckDB Node API's JSON conversion instead of converting every `bigint` to a JavaScript `number`.

Large integers, decimals, temporal values, UUIDs, blobs, and bit strings are displayed as strings when a JavaScript number or object would lose information. Lists and arrays remain arrays, structs remain objects, maps use key/value entries, and unions retain their tag and value. Empty results still include their column headers, and duplicate column names are deduplicated for the grid.

## DuckDB extensions and security

The driver does not silently install an extension or enable unsigned extensions. DuckDB may auto-install and auto-load known extensions unless you disable those behaviors in the advanced connection settings. Community extensions contain third-party code and run with the same permissions as VS Code's SQLTools process.

For connections that execute untrusted SQL, consider disabling extension auto-installation, extension auto-loading, community extensions, and external access. Disabling external access also blocks operations such as `ATTACH`, `COPY` to files, and file-reading table functions. Read the [DuckDB security guidance](https://duckdb.org/docs/current/operations_manual/securing_duckdb/overview) before choosing these restrictions.

## Current SQLTools limits

- SQLTools 0.28.6 does not expose a driver cancellation API, so DuckDB's interrupt method cannot be connected to a cancel button.
- SQLTools materializes the final result array. DuckDB can stream internally, but a large completed grid still consumes memory in the SQLTools process.
- SQLTools has explorer context values for constraints, types, and sequences, but its typed definition APIs are less complete than the table, view, function, and index APIs.

## Troubleshooting

- **The database is locked:** disconnect the process that has read/write access, or use Read Only when you only need to inspect the file.
- **A read-only connection rejects a statement:** explorer queries work in read-only mode, but DDL, DML, `ATTACH` without a compatible mode, and some extension operations require write access.
- **MotherDuck authentication fails:** edit the connection and refresh its SQLTools Driver Credential, or select Ask on connect. Do not add the token to the `md:` URI.
- **An extension or file function is blocked:** check `enable_external_access`, `autoinstall_known_extensions`, `autoload_known_extensions`, and `allow_community_extensions`. A restrictive setting must be changed by recreating the connection.
- **The native package does not load:** open the SQLTools output channel and include the reported operating system, architecture, Node version, SQLTools version, driver version, and full dependency-install error in the issue.

## Development

This repository uses pnpm. See [GETTING_STARTED.md](GETTING_STARTED.md) for setup, testing, debugging, and packaging commands.

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm test:integration
pnpm compile
pnpm package
```

Publishing remains manual. CI builds and tests the native DuckDB integration on Ubuntu x64, Ubuntu arm64, Windows x64, and Apple Silicon before producing a VSIX artifact.
