# SQLTools DuckDB driver 2.0 plan

Last researched: 2026-08-13

Status: implemented and verified locally on Darwin arm64. The checked-in CI matrix performs the remaining Ubuntu and Windows runs when the branch is pushed; publishing remains manual.

## Target versions and constraints

- Replace `duckdb-async` with `@duckdb/node-api@1.5.5-r.4`, which embeds DuckDB 1.5.5.
- Pin `@sqltools/base-driver@0.2.4` and `@sqltools/types@0.2.1` instead of using mutable `latest` tags.
- Use pnpm for local development, CI, packaging, and the checked-in lockfile.
- Keep VS Code 1.87 as the minimum unless a required API forces a higher baseline. Keep `@types/vscode` aligned with that minimum.
- Release the completed migration as version 2.0.0. Preserve existing connection definitions where possible.

## Phase 1: package manager, build, and test baseline

1. Remove `duckdb-async`, Babel, `@mapbox/node-pre-gyp`, `uuid`, and unused direct build dependencies.
2. Add the Node Neo API for development types and declare its exact version in the SQLTools dynamic dependency list.
3. Pin the SQLTools API packages and current compatible build/test tools.
4. Replace `yarn.lock` with `pnpm-lock.yaml` and add the `packageManager` field.
5. Add scripts for clean builds, typechecking, unit tests, integration tests, watch mode, VS Code prepublish, and VSIX packaging.
6. Repair the VS Code build task and make packaging compile before creating the VSIX.

Acceptance:

- `pnpm install --frozen-lockfile`, typecheck, test, compile, and package all pass from a clean checkout.
- The VSIX does not bundle a host-specific DuckDB native binary. SQLTools installs the correct Node API package for the user's runtime and architecture.

## Phase 2: Node API adapter, lifecycle, and result values

1. Replace `Database.create()` with a retained `DuckDBInstance` and `DuckDBConnection`.
2. Use the DuckDB instance cache to prevent duplicate instances for the same path in one SQLTools process.
3. Make opening race-safe and closing idempotent. Close the connection before the instance and clear handles after failures.
4. Serialize operations on the single connection so explorer refreshes and user queries cannot overlap native connection work.
5. Map access modes to `AUTOMATIC`, `READ_ONLY`, and `READ_WRITE`; keep in-memory databases writable.
6. Replace `db.all()` with `runAndReadAll()`. Use `getRowObjectsJson()` and deduplicated column names.
7. Delete recursive BigInt-to-Number conversion. Use `rowsChanged` for DML messages and retain columns for empty results.
8. Return one SQLTools result per statement when DuckDB's extracted-statement API can safely do so.
9. Keep normal SQLTools connections open after `testConnection()`; let SQLTools close its temporary test driver.

Acceptance:

- Large integers and decimals are never converted to unsafe JavaScript numbers.
- File handles are released after disconnect, including failed opens and queries.
- Empty results retain columns, duplicate columns are usable in the grid, and nested DuckDB values are JSON-safe.

## Phase 3: metadata, qualification, and search

1. Add separate helpers for quoted identifiers, string literals, LIKE patterns, numeric limits, and fully qualified names.
2. Use `information_schema.schemata`, `tables`, `columns`, `table_constraints`, `key_column_usage`, and `referential_constraints` for the portable explorer baseline.
3. Use `duckdb_databases()`, `duckdb_constraints()`, `duckdb_indexes()`, `duckdb_sequences()`, `duckdb_functions()`, and `duckdb_types()` where the information schema has no equivalent detail.
4. Preserve raw catalog, schema, and object names on every explorer item.
5. Use three-part quoted names for preview, count, insert, definition, and describe actions.
6. Remove `sqlite_master` and unqualified `pragma_table_info()` calls.
7. Bind metadata predicates and user search strings where the SQLTools path permits it. Escape all remaining generated literals.
8. Hide internal system objects by default while retaining ordinary attached catalogs and their implicit `main` schemas.

Acceptance:

- Multiple schemas and attached databases can contain objects with the same name without collisions.
- Spaces, dots, reserved words, Unicode, single quotes, and double quotes in object names work.
- Explorer refreshes succeed on read-only connections and do not modify database state.

## Phase 4: SQLTools feature coverage

1. Provide catalog, schema, table, view, column, index, constraint, function/macro, type, and sequence nodes where SQLTools supports them.
2. Add complete database/table/column search for SQLTools completion.
3. Add table, view, macro, and index definitions.
4. Generate fully qualified INSERT snippets.
5. Replace the copied SQLite keyword list with completions from `duckdb_keywords()`.
6. Add optional context-aware completion through `sql_auto_complete()` when the user has enabled the DuckDB autocomplete extension.
7. Show comments, read-only catalog state, data types, defaults, PK/FK badges, and index/constraint details.

Known SQLTools limits:

- SQLTools 0.28.6 has no driver cancellation method, so DuckDB interrupt cannot be connected to a cancel button without an upstream API change.
- SQLTools materializes result arrays, so streaming cannot remove the final in-memory result cost.
- Constraint, type, and sequence explorer contracts are less complete than table/view/function contracts.

## Phase 5: connection assistant and compatibility

1. Support local files, in-memory databases, MotherDuck, and advanced DuckDB paths.
2. Migrate `databaseFilePath` to SQLTools' `database` property while continuing to read old settings.
3. Resolve workspace-relative local paths on connect and preserve them on save/edit.
4. Store MotherDuck tokens through SQLTools Driver Credentials or ask-on-connect. Never require a token in saved connection strings or logs.
5. Add advanced instance settings for access mode, threads, memory limit, temp/extension directories, and trusted initialization SQL.
6. Do not enable unsigned extensions or install extensions silently. Offer explicit restricted settings for users who want extension auto-installation, community extensions, or external access disabled.

Acceptance:

- Existing `databaseFilePath` configurations still connect.
- MotherDuck credentials are not persisted in plaintext by default.
- Initialization failures close both native handles and return an actionable connection error.

## Phase 6: tests, CI, packaging, and documentation

1. Add unit tests for SQL generation, quoting, connection parsing, result shaping, lifecycle ordering, and open/close races.
2. Add integration tests for memory and file databases, read-only mode, views, multiple schemas, attached databases, temporary objects, definitions, search, and DuckDB's full type set.
3. Add regression tests for composite keys, checks, foreign keys, explicit indexes, macros, enums, sequences, and unusual identifiers.
4. Run native integration tests on Ubuntu x64/arm64, Windows x64, and macOS arm64. Exercise SQLTools' dependency-install directory, not only the development dependency.
5. Smoke-install the packaged VSIX with SQLTools and run `SELECT 1`.
6. Update the README, getting-started guide, changelog, support matrix, extension documentation, and troubleshooting notes.
7. Keep publishing manual until all platform jobs pass. The same tested artifact can later be sent to the VS Code Marketplace and Open VSX.

## Definition of done

- No use of `duckdb-async`, `Database.create()`, `db.all()`, `sqlite_master`, unqualified table previews, or unconditional BigInt-to-Number conversion remains.
- All generated relation references use quoted catalog, schema, and object names.
- The explorer and completion paths work with attached catalogs, multiple schemas, views, read-only connections, and unusual identifiers.
- Lifecycle tests demonstrate connection-before-instance shutdown and file reuse after disconnect.
- Apple Silicon installs and runs the published Node API package without a source build.
- `pnpm install --frozen-lockfile`, typecheck, all tests, compile, and VSIX packaging pass.

## Primary references

- DuckDB Node Neo: <https://duckdb.org/docs/current/clients/node_neo/overview>
- DuckDB information schema: <https://duckdb.org/docs/current/sql/meta/information_schema>
- DuckDB metadata functions: <https://duckdb.org/docs/current/sql/meta/duckdb_table_functions>
- DuckDB identifier rules: <https://duckdb.org/docs/stable/sql/dialect/keywords_and_identifiers>
- DuckDB extension security: <https://duckdb.org/docs/current/operations_manual/securing_duckdb/securing_extensions>
- SQLTools source and driver contracts: <https://github.com/mtxr/vscode-sqltools>
- SQLTools 0.28.6: <https://github.com/mtxr/vscode-sqltools/releases/tag/v0.28.6>
