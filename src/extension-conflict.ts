export const CONFLICTING_DUCKDB_EXTENSION_ID = 'Evidence.sqltools-duckdb-driver';

export const DUCKDB_EXTENSION_CONFLICT_MESSAGE =
  'DuckDB for SQLTools and the Evidence DuckDB driver both register the SQLTools DuckDB driver. ' +
  'Disable the Evidence extension in this VS Code profile, then reload the window.';

export function hasConflictingDuckDBExtension(
  getExtension: (extensionId: string) => unknown,
): boolean {
  return getExtension(CONFLICTING_DUCKDB_EXTENSION_ID) !== undefined;
}
