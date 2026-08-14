import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DuckDBInstance } from '@duckdb/node-api';
import { ContextValue } from '@sqltools/types';
import { afterEach, describe, expect, it, vi } from 'vitest';
import DuckDBDriver from '../../src/ls/driver';

const drivers: DuckDBDriver[] = [];
const temporaryDirectories: string[] = [];

function createDriver(database: string, options: Record<string, unknown> = {}): DuckDBDriver {
  const driver = new DuckDBDriver({
    id: `test-${drivers.length}`,
    name: 'DuckDB test',
    driver: 'DuckDB',
    username: '',
    database,
    accessMode: 'Automatic',
    isConnected: false,
    isActive: false,
    ...options,
  }, async () => []);

  // SQLTools normally installs and resolves driver dependencies in its data directory.
  // Integration tests deliberately use this workspace's pinned package instead.
  driver.requireDep = (name: string) => {
    if (name !== '@duckdb/node-api') throw new Error(`Unexpected dependency: ${name}`);
    return require('@duckdb/node-api');
  };
  drivers.push(driver);
  return driver;
}

afterEach(async () => {
  await Promise.all(drivers.splice(0).map(driver => driver.close()));
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, {
    recursive: true,
    force: true,
  })));
});

describe('DuckDBDriver native lifecycle and results', () => {
  it('preserves integers and decimals that JavaScript Number cannot represent safely', async () => {
    const driver = createDriver(':memory:');
    const [result] = await driver.query(`
      SELECT
        9223372036854775807::BIGINT AS max_bigint,
        170141183460469231731687303715884105727::HUGEINT AS max_hugeint,
        12345678901234567890.1234::DECIMAL(24, 4) AS exact_decimal,
        [9223372036854775807::BIGINT] AS nested_bigint
    `);

    expect(result.results).toEqual([{
      max_bigint: '9223372036854775807',
      max_hugeint: '170141183460469231731687303715884105727',
      exact_decimal: '12345678901234567890.1234',
      nested_bigint: ['9223372036854775807'],
    }]);
  });

  it('serializes DuckDB full-type values without losing nested or scalar data', async () => {
    const driver = createDriver(':memory:');
    const [result] = await driver.query('SELECT * FROM test_all_types()');
    const row = result.results[0];

    expect(() => JSON.stringify(result.results)).not.toThrow();
    expect(row.bigint).toBe('-9223372036854775808');
    expect(row.hugeint).toBe('-170141183460469231731687303715884105728');
    expect(row.dec38_10).toBe('-9999999999999999999999999999.9999999999');
    expect(row.interval).toEqual({ months: 0, days: 0, micros: '0' });
    expect(row.fixed_struct_array).toEqual(expect.arrayContaining([
      expect.objectContaining({ a: 42 }),
    ]));
    expect(row.union).toEqual({ tag: 'name', value: 'Frank' });
    expect(row.blob).toEqual(expect.any(String));
    expect(row.timestamp_ns).toEqual(expect.any(String));
  });

  it('keeps empty-result columns and deduplicates repeated result names', async () => {
    const driver = createDriver(':memory:');
    const [empty] = await driver.query('SELECT 1 AS present WHERE FALSE');
    const [duplicates] = await driver.query('SELECT 1 AS repeated, 2 AS repeated');

    expect(empty.cols).toEqual(['present']);
    expect(empty.results).toEqual([]);
    expect(duplicates.cols).toEqual(['repeated', 'repeated:1']);
    expect(duplicates.results).toEqual([{ repeated: 1, 'repeated:1': 2 }]);
  });

  it('returns a separate result for every statement and serializes concurrent operations', async () => {
    const driver = createDriver(':memory:');
    const results = await driver.query('SELECT 1 AS first; SELECT 2 AS second;');
    expect(results).toHaveLength(2);
    expect(results[0].results).toEqual([{ first: 1 }]);
    expect(results[1].results).toEqual([{ second: 2 }]);

    await Promise.all([
      driver.query('CREATE TABLE queued (id INTEGER);'),
      driver.query('INSERT INTO queued VALUES (1);'),
      driver.query('INSERT INTO queued VALUES (2);'),
    ]);
    const [count] = await driver.query('SELECT count(*) AS total FROM queued;');
    expect(count.results).toEqual([{ total: '2' }]);
  });

  it('keeps separate in-memory connection profiles isolated', async () => {
    const first = createDriver(':memory:');
    const second = createDriver(':memory:');
    await first.query('CREATE TABLE only_in_first (id INTEGER)');

    await expect(second.query('SELECT * FROM only_in_first')).rejects.toThrow(/does not exist/i);
  });

  it('closes the connection before its retained instance and can reopen cleanly', async () => {
    const driver = createDriver(':memory:');
    const [connection, concurrentConnection] = await Promise.all([driver.open(), driver.open()]);
    expect(concurrentConnection).toBe(connection);
    const instance = (driver as any).instance as DuckDBInstance;
    const closeOrder: string[] = [];
    const closeConnection = connection.closeSync.bind(connection);
    const closeInstance = instance.closeSync.bind(instance);

    vi.spyOn(connection, 'closeSync').mockImplementation(() => {
      closeOrder.push('connection');
      closeConnection();
    });
    vi.spyOn(instance, 'closeSync').mockImplementation(() => {
      closeOrder.push('instance');
      closeInstance();
    });

    await Promise.all([driver.close(), driver.close()]);
    expect(closeOrder).toEqual(['connection', 'instance']);
    await expect(driver.query('SELECT 42 AS answer')).resolves.toEqual([
      expect.objectContaining({ results: [{ answer: 42 }] }),
    ]);
  });

  it('does not deadlock when close starts with operations waiting in the queue', async () => {
    const driver = createDriver(':memory:');
    await driver.open();
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>(resolve => { releaseFirst = resolve; });
    const order: string[] = [];
    const runExclusive = (driver as any).runExclusive.bind(driver) as (
      operation: () => Promise<void>,
    ) => Promise<void>;
    const first = runExclusive(async () => {
      order.push('first:start');
      await firstGate;
      order.push('first:end');
    });
    const second = runExclusive(async () => {
      order.push('second');
    });

    await vi.waitFor(() => expect(order).toEqual(['first:start']));
    const closing = driver.close();
    releaseFirst();
    await Promise.race([
      Promise.all([first, second, closing]),
      new Promise((_, reject) => setTimeout(() => reject(new Error('close deadlocked')), 1_000)),
    ]);
    expect(order).toEqual(['first:start', 'first:end', 'second']);
  });

  it('opens an existing database read-only and releases its file lock on close', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'sqltools-duckdb-'));
    temporaryDirectories.push(directory);
    const database = path.join(directory, 'readonly.duckdb');
    const setupInstance = await DuckDBInstance.create(database);
    const setupConnection = await setupInstance.connect();
    await setupConnection.run('CREATE TABLE data AS SELECT 7 AS value');
    setupConnection.closeSync();
    setupInstance.closeSync();

    const driver = createDriver(database, { accessMode: 'Read Only' });
    const [read] = await driver.query('SELECT * FROM data');
    expect(read.results).toEqual([{ value: 7 }]);
    const catalogs = await driver.getChildrenForItem({
      item: { type: ContextValue.CONNECTION } as any,
    });
    expect(catalogs).toHaveLength(1);
    await expect(driver.getChildrenForItem({ item: catalogs[0] as any })).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ label: 'main' })]),
    );
    await expect(driver.query('CREATE TABLE forbidden (id INTEGER)')).rejects.toThrow(/read-only/i);
    await driver.close();

    const writeInstance = await DuckDBInstance.create(database, { access_mode: 'READ_WRITE' });
    const writeConnection = await writeInstance.connect();
    await expect(writeConnection.run('INSERT INTO data VALUES (8)')).resolves.toBeDefined();
    writeConnection.closeSync();
    writeInstance.closeSync();
  });

  it('releases both native handles when initialization SQL fails', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'sqltools-duckdb-init-'));
    temporaryDirectories.push(directory);
    const database = path.join(directory, 'initialization.duckdb');
    const driver = createDriver(database, {
      initializationSql: 'THIS IS NOT VALID DUCKDB SQL',
    });

    await expect(driver.open()).rejects.toThrow(/syntax error/i);

    const replacement = await DuckDBInstance.create(database, { access_mode: 'READ_WRITE' });
    const replacementConnection = await replacement.connect();
    await expect(replacementConnection.run('CREATE TABLE recovered (id INTEGER)')).resolves.toBeDefined();
    replacementConnection.closeSync();
    replacement.closeSync();
  });

  it('maps DuckDB metadata, definitions, snippets, and keywords into SQLTools', async () => {
    const driver = createDriver(':memory:', {
      initializationSql: `
        CREATE SCHEMA analytics;
        CREATE TABLE analytics.events (id BIGINT PRIMARY KEY, payload VARCHAR);
        CREATE VIEW analytics.event_view AS SELECT * FROM analytics.events;
        CREATE INDEX event_payload_idx ON analytics.events(payload);
        CREATE SEQUENCE analytics.event_seq;
        CREATE TYPE analytics.event_kind AS ENUM ('open', 'close');
        CREATE MACRO analytics.twice(x) AS x * 2;
      `,
    });
    const [database] = await driver.getChildrenForItem({
      item: { type: ContextValue.CONNECTION } as any,
    });
    const schemas = await driver.getChildrenForItem({ item: database as any });
    const schema = schemas.find(item => item.label === 'analytics');
    expect(schema).toBeDefined();

    const groups = await driver.getChildrenForItem({ item: schema as any });
    expect(groups.map(group => group.childType)).toEqual([
      ContextValue.TABLE,
      ContextValue.VIEW,
      ContextValue.FUNCTION,
      ContextValue.TYPE,
      ContextValue.SEQUENCE,
    ]);
    const tableGroup = groups.find(group => group.childType === ContextValue.TABLE)!;
    const viewGroup = groups.find(group => group.childType === ContextValue.VIEW)!;
    const tables = await driver.getChildrenForItem({ item: tableGroup as any, parent: schema as any });
    const views = await driver.getChildrenForItem({ item: viewGroup as any, parent: schema as any });
    const table = tables.find(item => item.label === 'events')!;
    const view = views.find(item => item.label === 'event_view')!;
    const tableGroups = await driver.getChildrenForItem({ item: table as any });
    expect(tableGroups.map(group => group.childType)).toEqual([
      ContextValue.COLUMN,
      ContextValue.CONSTRAINT,
      ContextValue.INDEX,
    ]);

    const columnGroup = tableGroups.find(group => group.childType === ContextValue.COLUMN)!;
    const indexGroup = tableGroups.find(group => group.childType === ContextValue.INDEX)!;
    const columns = await driver.getChildrenForItem({ item: columnGroup as any, parent: table as any });
    const indexes = await driver.getChildrenForItem({ item: indexGroup as any, parent: table as any });
    const index = indexes.find(item => item.label === 'event_payload_idx')!;
    const definition = await driver.getDefinitionForItem({ item: table as any });
    const viewDefinition = await driver.getDefinitionForItem({ item: view as any });
    const indexDefinition = await driver.getDefinitionForItem({ item: index as any });
    const insert = await driver.getInsertQuery({ item: table as any, columns: columns as any });
    expect(definition).toContain('CREATE TABLE "memory"."analytics"."events"');
    expect(viewDefinition).toContain('CREATE VIEW "memory"."analytics"."event_view"');
    expect(indexDefinition).toContain('ON "memory"."analytics"."events"');
    expect(insert).toContain('INSERT INTO "memory"."analytics"."events"');
    expect(insert).toContain('"payload"');

    const completions = await driver.getStaticCompletions();
    expect(completions.SELECT).toEqual(expect.objectContaining({
      label: 'SELECT',
      detail: 'reserved',
    }));

    await expect(driver.getCompletionsForRawQuery('SEL', 3)).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({
        label: 'SELECT',
        textEdit: expect.objectContaining({ newText: 'SELECT ' }),
      })]),
    );
    await expect(driver.getCompletionsForRawQuery('-- 🦆\nSEL', 9)).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({
        label: 'SELECT',
        textEdit: expect.objectContaining({
          range: {
            start: { line: 1, character: 0 },
            end: { line: 1, character: 3 },
          },
        }),
      })]),
    );
    const [autocompleteState] = await driver.query(`
      SELECT installed, loaded
      FROM duckdb_extensions()
      WHERE extension_name = 'autocomplete'
    `);
    expect(autocompleteState.results).toEqual([{ installed: true, loaded: true }]);
  });
});
