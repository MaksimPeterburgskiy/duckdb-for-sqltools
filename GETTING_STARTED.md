# Developing DuckDB for SQLTools

This extension has two entry points. `src/extension.ts` runs in the VS Code extension host and registers the driver with SQLTools. `src/ls/plugin.ts` runs in the SQLTools language-server process and loads the DuckDB driver.

DuckDB is a native dependency. SQLTools installs the exact `@duckdb/node-api` version declared by the driver into its own dependency directory, using the language-server runtime and machine architecture. Keep the development dependency and the driver's dynamic dependency declaration on the same exact version.

## Requirements

- VS Code 1.87 or newer
- Node.js 22
- Corepack and the pnpm version declared in `package.json`
- SQLTools installed in the VS Code profile used for extension debugging

## Install

```sh
corepack enable
pnpm install --frozen-lockfile
```

Use `pnpm install` without `--frozen-lockfile` only when intentionally changing dependencies and regenerating `pnpm-lock.yaml`. Do not check in a Yarn or npm lockfile.

## Common commands

```sh
pnpm clean
pnpm typecheck
pnpm test
pnpm test:integration
pnpm compile
pnpm watch
pnpm package
```

`pnpm test` runs the unit suite. `pnpm test:integration` opens real DuckDB memory and file databases and exercises the native Node API. `pnpm package` compiles the extension before creating a VSIX.

Run every check used by CI before submitting a change:

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm test:integration
pnpm compile
pnpm package
```

## Debug in VS Code

Open the repository in VS Code and run the **Run Driver Extension** launch configuration. Its pre-launch task runs `pnpm compile`. Use the **pnpm: watch** task when you want the bundles rebuilt after each source change.

The Extension Development Host needs SQLTools. Add a DuckDB connection there and inspect the **SQLTools** output channel for driver logs. The launch configuration sets `SQLTOOLS_DEBUG_PORT_LS=6099` for language-server debugging.

## Code map

- `src/extension.ts`: SQLTools registration, connection migration, workspace path conversion, and credential resolution
- `src/ls/driver.ts`: SQLTools driver contract, `DuckDBInstance` and `DuckDBConnection` lifecycle, result conversion, explorer mapping, completion, and definitions
- `src/ls/queries.ts`: metadata queries and fully qualified generated SQL
- `connection.schema.json` and `ui.schema.json`: SQLTools Connection Assistant fields
- `test/`: unit and native integration coverage

Keep identifier handling separate from value handling. Generated relation names must quote the catalog, schema, and object independently. Metadata predicate values should use parameters where the SQLTools call path permits them. Never build an identifier from an explorer label alone.

## Test expectations

Changes to connection or query code should cover the relevant cases below:

- repeated and concurrent open/close calls
- connection-before-instance shutdown and reuse of a closed database file
- read-only rejection and writable in-memory databases
- multiple schemas and attached catalogs with duplicate object names
- tables, views, temporary objects, indexes, constraints, sequences, macros, and custom types
- names containing spaces, dots, SQL keywords, Unicode, single quotes, and double quotes
- empty and duplicate-name result columns
- `test_all_types()` values, especially BIGINT, HUGEINT, DECIMAL, BLOB, temporal, LIST, ARRAY, STRUCT, MAP, UNION, ENUM, UUID, BIT, and VARIANT values

CI runs these checks on Ubuntu x64, Ubuntu arm64, Windows x64, and macOS arm64. The Apple Silicon job must load the published native binding without compiling DuckDB from source.

## Connection changes

The canonical saved target is `database`. Keep reading `databaseFilePath` so connections from pre-2.0 releases continue to work. Do not persist a MotherDuck token in a database URI. Use the SQLTools credential resolver or ask for the token when connecting.

DuckDB options that restrict extensions or external access must be applied while creating the instance. Security settings cannot always be loosened after the instance starts. Tests that share the same cached database path must therefore use compatible instance options or close the prior instance first.

The driver uses `sql_auto_complete()` only when the official `autocomplete` extension is already loaded, for example by trusted `initializationSql`. Merely requesting SQLTools completions never installs or loads that extension.

## Packaging and release

`pnpm package` creates a VSIX without bundling a host-specific DuckDB binary. CI uploads the VSIX after the complete platform matrix passes.

GitHub releases are created with the manual **Release** workflow on `main`. Select a patch, minor, or major bump. The workflow commits the version, reruns the complete platform matrix, packages and verifies the VSIX, attaches it and its SHA-256 checksum to a draft, then publishes the release and tag. A failed run leaves the draft in place and can be resumed by dispatching the same bump again.

The release job uses the protected `release` environment and its repository-scoped `RELEASE_TOKEN`. It does not publish to the Visual Studio Marketplace or Open VSX.

Before approving a release, install the CI artifact on each supported platform, connect SQLTools to a temporary database, run `SELECT 1`, browse a table and view, disconnect, and confirm the file can be reopened by another process.

See the [VS Code extension publishing guide](https://code.visualstudio.com/api/working-with-extensions/publishing-extension) and the [SQLTools driver source](https://github.com/mtxr/vscode-sqltools) for the host contracts.
