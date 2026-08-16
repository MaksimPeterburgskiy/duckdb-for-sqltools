import path from 'node:path';

export const CONNECTION_METHODS = {
  localFile: 'Local File',
  inMemory: 'In-Memory',
  motherDuck: 'MotherDuck',
  advancedUri: 'Advanced URI',
} as const;

export const TOKEN_MODES = {
  credentials: 'SQLTools Driver Credentials',
  ask: 'Ask on connect',
  plaintext: 'Save as plaintext in settings',
} as const;

export const ACCESS_MODES = {
  automatic: 'Automatic',
  readOnly: 'Read Only',
  readWrite: 'Read/Write',
} as const;

export interface WorkspaceFolderPath {
  name: string;
  fsPath: string;
}

export interface ConnectionParserContext {
  workspaceFolders?: readonly WorkspaceFolderPath[];
}

export interface DuckDBConnectionInfo {
  [key: string]: any;
  name?: string;
  connectionMethod?: string;
  database?: string;
  databaseFilePath?: string;
  databaseUri?: string;
  motherDuckDatabase?: string;
  accessMode?: string;
  useToken?: string;
  password?: string;
  askForPassword?: boolean;
  duckdbOptions?: Record<string, unknown>;
  initializationSql?: string;
}

const WORKSPACE_PATH = /^\$\{workspaceFolder:([^}]+)\}(?:[\\/](.*))?$/;
const MOTHERDUCK_TOKEN_IN_URI = /[?&]motherduck_token=/i;
const WORKSPACE_OPTION_PATHS = ['temp_directory', 'extension_directory'] as const;

function copyConnection(connInfo: DuckDBConnectionInfo): DuckDBConnectionInfo {
  return {
    ...connInfo,
    ...(connInfo.duckdbOptions ? { duckdbOptions: { ...connInfo.duckdbOptions } } : {}),
  };
}

function workspaceFolders(context?: ConnectionParserContext): readonly WorkspaceFolderPath[] {
  return context?.workspaceFolders ?? [];
}

function isInside(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

export function collapseWorkspacePath(value: string, context?: ConnectionParserContext): string {
  if (!path.isAbsolute(value)) return value;

  const folder = workspaceFolders(context)
    .filter(({ fsPath }) => isInside(fsPath, value))
    .sort((left, right) => right.fsPath.length - left.fsPath.length)[0];
  if (!folder) return value;

  const relative = path.relative(folder.fsPath, value).split(path.sep).join('/');
  return relative
    ? `\${workspaceFolder:${folder.name}}/${relative}`
    : `\${workspaceFolder:${folder.name}}`;
}

export function expandWorkspacePath(value: string, context?: ConnectionParserContext): string {
  const match = WORKSPACE_PATH.exec(value);
  if (!match) return value;

  const folder = workspaceFolders(context).find(({ name }) => name === match[1]);
  if (!folder) {
    throw new Error(`Workspace folder "${match[1]}" is not open.`);
  }
  return match[2] ? path.resolve(folder.fsPath, match[2]) : folder.fsPath;
}

function assertNoMotherDuckToken(database: string): void {
  if (MOTHERDUCK_TOKEN_IN_URI.test(database)) {
    throw new Error(
      'Do not put motherduck_token in the database URI. Use MotherDuck mode and choose a token storage option.',
    );
  }
}

function isMotherDuckDatabase(database: unknown): database is string {
  return typeof database === 'string' && database.toLowerCase().startsWith('md:');
}

function inferConnectionMethod(connInfo: DuckDBConnectionInfo): string {
  const database = connInfo.database ?? connInfo.databaseFilePath;
  if (database === ':memory:') return CONNECTION_METHODS.inMemory;
  if (isMotherDuckDatabase(database)) return CONNECTION_METHODS.motherDuck;
  if (typeof database === 'string' && /^[a-z][a-z\d+.-]*:/i.test(database) && !/^[a-z]:[\\/]/i.test(database)) {
    return CONNECTION_METHODS.advancedUri;
  }
  return CONNECTION_METHODS.localFile;
}

function normalizeAccessMode(value: unknown): string {
  return Object.values(ACCESS_MODES).includes(value as any) ? value as string : ACCESS_MODES.automatic;
}

function normalizeMotherDuckTarget(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') return 'md:';
  const target = value.trim();
  return isMotherDuckDatabase(target) ? target : `md:${target}`;
}

function cleanDuckDBOptions(
  options: Record<string, unknown> | undefined,
  transformPath: (value: string) => string,
): Record<string, unknown> | undefined {
  if (!options) return undefined;

  const cleaned = { ...options };
  for (const key of Object.keys(cleaned)) {
    if (cleaned[key] === undefined || cleaned[key] === null || cleaned[key] === '') delete cleaned[key];
  }
  for (const key of WORKSPACE_OPTION_PATHS) {
    if (typeof cleaned[key] === 'string') cleaned[key] = transformPath(cleaned[key] as string);
  }
  return Object.keys(cleaned).length > 0 ? cleaned : undefined;
}

export function parseBeforeSaveConnection<T extends DuckDBConnectionInfo>(
  { connInfo }: { connInfo: T },
  context?: ConnectionParserContext,
): T & DuckDBConnectionInfo {
  const saved = copyConnection(connInfo);
  const isLegacyConnection = saved.database === undefined && saved.databaseFilePath !== undefined;
  const method = saved.connectionMethod ?? inferConnectionMethod(saved);

  if (method === CONNECTION_METHODS.inMemory) {
    saved.database = ':memory:';
  } else if (method === CONNECTION_METHODS.motherDuck) {
    saved.database = normalizeMotherDuckTarget(saved.motherDuckDatabase ?? saved.database);
  } else if (method === CONNECTION_METHODS.advancedUri) {
    if (typeof saved.databaseUri !== 'string' || saved.databaseUri.trim() === '') {
      throw new Error('DuckDB URI is required.');
    }
    saved.database = saved.databaseUri;
  } else {
    const database = saved.database ?? saved.databaseFilePath;
    if (typeof database !== 'string' || database.trim() === '') {
      throw new Error('Database file is required.');
    }
    saved.database = collapseWorkspacePath(database, context);
  }

  assertNoMotherDuckToken(saved.database);
  saved.accessMode = saved.accessMode === undefined && isLegacyConnection
    ? ACCESS_MODES.readOnly
    : normalizeAccessMode(saved.accessMode);
  saved.duckdbOptions = cleanDuckDBOptions(
    saved.duckdbOptions,
    value => collapseWorkspacePath(value, context),
  );
  if (!saved.duckdbOptions) delete saved.duckdbOptions;
  if (typeof saved.initializationSql !== 'string' || saved.initializationSql.trim() === '') {
    delete saved.initializationSql;
  }

  if (method === CONNECTION_METHODS.motherDuck) {
    if (saved.useToken === TOKEN_MODES.plaintext) {
      saved.askForPassword = false;
      if (typeof saved.password !== 'string' || saved.password.length === 0) {
        throw new Error('MotherDuck token is required when saving it in settings.');
      }
    } else {
      saved.askForPassword = true;
      delete saved.password;
    }
  } else {
    delete saved.askForPassword;
    delete saved.password;
  }

  for (const property of [
    'connectionMethod',
    'databaseFilePath',
    'databaseUri',
    'motherDuckDatabase',
    'useToken',
    'id',
  ]) {
    delete saved[property];
  }

  return saved as T & DuckDBConnectionInfo;
}

export function parseBeforeEditConnection<T extends DuckDBConnectionInfo>(
  { connInfo }: { connInfo: T },
  context?: ConnectionParserContext,
): T & DuckDBConnectionInfo {
  const formData = copyConnection(connInfo);
  const storedDatabase = formData.database ?? formData.databaseFilePath;
  const isLegacyConnection = formData.database === undefined && formData.databaseFilePath !== undefined;
  formData.connectionMethod = inferConnectionMethod(formData);
  formData.accessMode = formData.accessMode === undefined && isLegacyConnection
    ? ACCESS_MODES.readOnly
    : normalizeAccessMode(formData.accessMode);

  if (formData.connectionMethod === CONNECTION_METHODS.localFile && typeof storedDatabase === 'string') {
    formData.database = expandWorkspacePath(storedDatabase, context);
  } else if (formData.connectionMethod === CONNECTION_METHODS.motherDuck && typeof storedDatabase === 'string') {
    assertNoMotherDuckToken(storedDatabase);
    formData.motherDuckDatabase = storedDatabase.slice(3);
    if (typeof formData.password === 'string' && formData.password.length > 0) {
      formData.useToken = TOKEN_MODES.plaintext;
    } else {
      formData.useToken = TOKEN_MODES.ask;
    }
  } else if (formData.connectionMethod === CONNECTION_METHODS.advancedUri && typeof storedDatabase === 'string') {
    assertNoMotherDuckToken(storedDatabase);
    formData.databaseUri = storedDatabase;
  }

  formData.duckdbOptions = cleanDuckDBOptions(
    formData.duckdbOptions,
    value => expandWorkspacePath(value, context),
  );
  if (!formData.duckdbOptions) delete formData.duckdbOptions;
  delete formData.databaseFilePath;
  return formData as T & DuckDBConnectionInfo;
}

export function resolveConnectionPaths<T extends DuckDBConnectionInfo>(
  connInfo: T,
  context?: ConnectionParserContext,
): T & DuckDBConnectionInfo {
  const resolved = copyConnection(connInfo);
  const isLegacyConnection = resolved.database === undefined && resolved.databaseFilePath !== undefined;
  const database = resolved.database ?? resolved.databaseFilePath;
  if (typeof database !== 'string' || database.trim() === '') {
    throw new Error('Database is required.');
  }
  assertNoMotherDuckToken(database);
  resolved.database = expandWorkspacePath(database, context);
  resolved.databaseFilePath = resolved.database;
  resolved.accessMode = resolved.accessMode === undefined && isLegacyConnection
    ? ACCESS_MODES.readOnly
    : normalizeAccessMode(resolved.accessMode);
  resolved.duckdbOptions = cleanDuckDBOptions(
    resolved.duckdbOptions,
    value => expandWorkspacePath(value, context),
  );
  if (!resolved.duckdbOptions) delete resolved.duckdbOptions;
  return resolved as T & DuckDBConnectionInfo;
}

export function isMotherDuckConnection(connInfo: DuckDBConnectionInfo): boolean {
  return isMotherDuckDatabase(connInfo.database ?? connInfo.databaseFilePath);
}
