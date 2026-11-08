import { describe, expect, it } from 'vitest';
import { devDependencies } from '../package.json';
import DuckDBDriver from '../src/ls/driver';

describe('DuckDB native dependency declaration', () => {
  it('asks SQLTools for the exact @duckdb/node-api version pinned in package.json', () => {
    const version = devDependencies['@duckdb/node-api'];
    // SQLTools installs this version and compares it with `!==`, so a range such
    // as ^1.5.6 would never match an installed package and prompt on every connect.
    expect(version).toMatch(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);

    const driver = new DuckDBDriver({
      id: 'dependency-test',
      name: 'DuckDB dependency test',
      driver: 'DuckDB',
      username: '',
      database: ':memory:',
      isConnected: false,
      isActive: false,
    }, async () => []);

    expect(driver.deps).toEqual([{ type: 'package', name: '@duckdb/node-api', version }]);
  });
});
