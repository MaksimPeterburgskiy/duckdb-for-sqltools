import { describe, expect, it, vi } from 'vitest';
import {
  CONFLICTING_DUCKDB_EXTENSION_ID,
  DUCKDB_EXTENSION_CONFLICT_MESSAGE,
  hasConflictingDuckDBExtension,
} from './extension-conflict';

describe('DuckDB extension conflict detection', () => {
  it('checks the Evidence extension identity', () => {
    const getExtension = vi.fn(() => undefined);

    expect(hasConflictingDuckDBExtension(getExtension)).toBe(false);
    expect(getExtension).toHaveBeenCalledWith(CONFLICTING_DUCKDB_EXTENSION_ID);
  });

  it('detects the Evidence extension when it is enabled', () => {
    expect(hasConflictingDuckDBExtension(() => ({ id: CONFLICTING_DUCKDB_EXTENSION_ID })))
      .toBe(true);
    expect(DUCKDB_EXTENSION_CONFLICT_MESSAGE).toContain('Disable the Evidence extension');
  });
});
