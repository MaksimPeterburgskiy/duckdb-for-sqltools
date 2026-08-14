import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ACCESS_MODES,
  CONNECTION_METHODS,
  TOKEN_MODES,
  collapseWorkspacePath,
  expandWorkspacePath,
  parseBeforeEditConnection,
  parseBeforeSaveConnection,
  resolveConnectionPaths,
} from './connection-parser';

const workspaceRoot = path.join(path.parse(process.cwd()).root, 'workspaces', 'analytics');
const context = {
  workspaceFolders: [{ name: 'analytics', fsPath: workspaceRoot }],
};

describe('workspace paths', () => {
  it('stores and expands paths inside a workspace', () => {
    const database = path.join(workspaceRoot, 'data', 'warehouse.duckdb');
    const stored = '${workspaceFolder:analytics}/data/warehouse.duckdb';

    expect(collapseWorkspacePath(database, context)).toBe(stored);
    expect(expandWorkspacePath(stored, context)).toBe(database);
  });

  it('does not rewrite paths outside a workspace', () => {
    const database = path.join(path.parse(workspaceRoot).root, 'data', 'warehouse.duckdb');
    expect(collapseWorkspacePath(database, context)).toBe(database);
  });

  it('reports a saved workspace that is not open', () => {
    expect(() => expandWorkspacePath('${workspaceFolder:missing}/warehouse.duckdb', context))
      .toThrow('Workspace folder "missing" is not open.');
  });
});

describe('parseBeforeSaveConnection', () => {
  it('migrates legacy databaseFilePath connections', () => {
    const result = parseBeforeSaveConnection({
      connInfo: {
        name: 'Legacy',
        databaseFilePath: '/tmp/legacy.duckdb',
        accessMode: ACCESS_MODES.readOnly,
      },
    });

    expect(result.database).toBe('/tmp/legacy.duckdb');
    expect(result.databaseFilePath).toBeUndefined();
    expect(result.accessMode).toBe(ACCESS_MODES.readOnly);
  });

  it('preserves the old read-only default when a legacy connection omitted accessMode', () => {
    const saved = parseBeforeSaveConnection({
      connInfo: { databaseFilePath: '/tmp/legacy-default.duckdb' },
    });
    const resolved = resolveConnectionPaths({
      databaseFilePath: '/tmp/legacy-default.duckdb',
    });

    expect(saved.accessMode).toBe(ACCESS_MODES.readOnly);
    expect(resolved.accessMode).toBe(ACCESS_MODES.readOnly);
  });

  it('stores local files and option directories relative to the workspace', () => {
    const result = parseBeforeSaveConnection({
      connInfo: {
        connectionMethod: CONNECTION_METHODS.localFile,
        database: path.join(workspaceRoot, 'data', 'warehouse.duckdb'),
        duckdbOptions: {
          threads: 4,
          temp_directory: path.join(workspaceRoot, '.tmp'),
          extension_directory: '',
        },
      },
    }, context);

    expect(result).toMatchObject({
      database: '${workspaceFolder:analytics}/data/warehouse.duckdb',
      accessMode: ACCESS_MODES.automatic,
      duckdbOptions: {
        threads: 4,
        temp_directory: '${workspaceFolder:analytics}/.tmp',
      },
    });
    expect(result.connectionMethod).toBeUndefined();
  });

  it('normalizes in-memory connections and removes stale credentials', () => {
    const result = parseBeforeSaveConnection({
      connInfo: {
        connectionMethod: CONNECTION_METHODS.inMemory,
        database: '/tmp/stale.duckdb',
        password: 'stale-token',
        askForPassword: true,
      },
    });

    expect(result.database).toBe(':memory:');
    expect(result.password).toBeUndefined();
    expect(result.askForPassword).toBeUndefined();
  });

  it('uses SQLTools Driver Credentials for MotherDuck by default', () => {
    const result = parseBeforeSaveConnection({
      connInfo: {
        connectionMethod: CONNECTION_METHODS.motherDuck,
        motherDuckDatabase: 'analytics',
        useToken: TOKEN_MODES.credentials,
        password: 'stale-token',
      },
    });

    expect(result.database).toBe('md:analytics');
    expect(result.password).toBeUndefined();
    expect(result.askForPassword).toBeUndefined();
  });

  it('sets askForPassword for an ask-on-connect MotherDuck token', () => {
    const result = parseBeforeSaveConnection({
      connInfo: {
        connectionMethod: CONNECTION_METHODS.motherDuck,
        motherDuckDatabase: '',
        useToken: TOKEN_MODES.ask,
      },
    });

    expect(result.database).toBe('md:');
    expect(result.askForPassword).toBe(true);
    expect(result.password).toBeUndefined();
  });

  it('keeps a plaintext token only when explicitly selected', () => {
    const result = parseBeforeSaveConnection({
      connInfo: {
        connectionMethod: CONNECTION_METHODS.motherDuck,
        useToken: TOKEN_MODES.plaintext,
        password: 'secret',
      },
    });

    expect(result.password).toBe('secret');
    expect(result.askForPassword).toBe(false);
  });

  it('stores advanced DuckDB targets', () => {
    const result = parseBeforeSaveConnection({
      connInfo: {
        connectionMethod: CONNECTION_METHODS.advancedUri,
        databaseUri: 'file:/tmp/warehouse.duckdb',
        initializationSql: 'SET threads = 2;',
      },
    });

    expect(result.database).toBe('file:/tmp/warehouse.duckdb');
    expect(result.initializationSql).toBe('SET threads = 2;');
  });

  it('rejects plaintext MotherDuck tokens embedded in URIs', () => {
    expect(() => parseBeforeSaveConnection({
      connInfo: {
        connectionMethod: CONNECTION_METHODS.advancedUri,
        databaseUri: 'md:analytics?motherduck_token=secret',
      },
    })).toThrow('Do not put motherduck_token in the database URI.');
  });
});

describe('parseBeforeEditConnection', () => {
  it('opens legacy local file connections in the new assistant', () => {
    const result = parseBeforeEditConnection({
      connInfo: {
        databaseFilePath: '${workspaceFolder:analytics}/legacy.duckdb',
        accessMode: 'Read/Write',
      },
    }, context);

    expect(result.connectionMethod).toBe(CONNECTION_METHODS.localFile);
    expect(result.database).toBe(path.join(workspaceRoot, 'legacy.duckdb'));
    expect(result.databaseFilePath).toBeUndefined();
  });

  it('shows the old read-only default when editing a legacy connection without accessMode', () => {
    const result = parseBeforeEditConnection({
      connInfo: { databaseFilePath: '/tmp/legacy-default.duckdb' },
    });

    expect(result.accessMode).toBe(ACCESS_MODES.readOnly);
  });

  it('restores MotherDuck form fields and token mode', () => {
    const result = parseBeforeEditConnection({
      connInfo: {
        database: 'md:analytics',
        askForPassword: true,
      },
    });

    expect(result.connectionMethod).toBe(CONNECTION_METHODS.motherDuck);
    expect(result.motherDuckDatabase).toBe('analytics');
    expect(result.useToken).toBe(TOKEN_MODES.ask);
  });

  it('recognizes advanced URIs', () => {
    const result = parseBeforeEditConnection({
      connInfo: { database: 'file:/tmp/warehouse.duckdb' },
    });

    expect(result.connectionMethod).toBe(CONNECTION_METHODS.advancedUri);
    expect(result.databaseUri).toBe('file:/tmp/warehouse.duckdb');
  });
});

describe('resolveConnectionPaths', () => {
  it('expands workspace paths and supplies the legacy alias at runtime', () => {
    const result = resolveConnectionPaths({
      database: '${workspaceFolder:analytics}/warehouse.duckdb',
      duckdbOptions: {
        extension_directory: '${workspaceFolder:analytics}/.duckdb/extensions',
      },
    }, context);

    expect(result.database).toBe(path.join(workspaceRoot, 'warehouse.duckdb'));
    expect(result.databaseFilePath).toBe(result.database);
    expect(result.duckdbOptions?.extension_directory)
      .toBe(path.join(workspaceRoot, '.duckdb', 'extensions'));
  });
});
