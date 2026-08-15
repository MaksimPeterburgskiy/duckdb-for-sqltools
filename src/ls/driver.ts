import { randomUUID } from 'node:crypto';
import AbstractDriver from '@sqltools/base-driver';
import {
  Arg0,
  ContextValue,
  IConnectionDriver,
  MConnectionExplorer,
  NSDatabase,
} from '@sqltools/types';
import type {
  DuckDBConnection,
  DuckDBInstance,
  DuckDBResultReader,
} from '@duckdb/node-api';
import keywordsCompletion from './keywords';
import queries from './queries';
import { qualifiedName } from './sql';
import { devDependencies } from '../../package.json';

const NODE_API_PACKAGE = '@duckdb/node-api';
// Baked in at bundle time so the installed package always matches package.json.
const NODE_API_VERSION = devDependencies[NODE_API_PACKAGE];

type AccessMode = 'Automatic' | 'Read Only' | 'Read/Write';

export interface DuckDBDriverOptions {
  accessMode?: AccessMode;
  connectionMethod?: 'Local File' | 'In-Memory' | 'MotherDuck' | 'Advanced URI';
  database?: string;
  databaseFilePath?: string;
  duckdbOptions?: Record<string, boolean | number | string>;
  initializationSql?: string;
  password?: string;
}

type DuckDBNodeApi = typeof import('@duckdb/node-api');

function replaceDefinitionIdentifier(sql: string, markerEnd: number, replacement: string): string {
  let start = markerEnd;
  while (/\s/.test(sql[start] || '')) start += 1;

  let end = start;
  let quoted = false;
  while (end < sql.length) {
    const character = sql[end];
    if (character === '"') {
      if (quoted && sql[end + 1] === '"') {
        end += 2;
        continue;
      }
      quoted = !quoted;
      end += 1;
      continue;
    }
    if (!quoted && (/\s/.test(character) || character === '(')) break;
    end += 1;
  }

  return `${sql.slice(0, start)}${replacement}${sql.slice(end)}`;
}

function keywordOutsideQuotes(sql: string, keyword: string): number {
  let quoted = false;
  for (let index = 0; index <= sql.length - keyword.length; index += 1) {
    if (sql[index] === '"') {
      if (quoted && sql[index + 1] === '"') {
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (quoted || sql.slice(index, index + keyword.length).toUpperCase() !== keyword) continue;
    const before = sql[index - 1];
    const after = sql[index + keyword.length];
    if ((!before || /\s/.test(before)) && (!after || /\s/.test(after))) return index;
  }
  return -1;
}

function fullyQualifyDefinition(item: NSDatabase.DefinableItem, sql: string): string {
  if (!sql) return sql;
  const metadata = item as NSDatabase.DefinableItem & {
    database?: string;
    schema?: string;
    label?: string;
    parent?: { database?: string; schema?: string; label?: string };
  };
  const owner = item.type === ContextValue.INDEX ? metadata.parent : metadata;
  if (!owner?.database || !owner.schema || !owner.label) return sql;
  const replacement = qualifiedName(owner.database, owner.schema, owner.label);

  if (item.type === ContextValue.TABLE || item.type === ContextValue.VIEW) {
    const marker = /^CREATE\s+(?:OR\s+REPLACE\s+)?(?:TABLE|VIEW)\b/i.exec(sql);
    return marker ? replaceDefinitionIdentifier(sql, marker[0].length, replacement) : sql;
  }

  if (item.type === ContextValue.INDEX) {
    const on = keywordOutsideQuotes(sql, 'ON');
    return on >= 0 ? replaceDefinitionIdentifier(sql, on + 2, replacement) : sql;
  }

  return sql;
}

function positionAt(text: string, offset: number): { line: number; character: number } {
  const prefix = text.slice(0, Math.max(0, Math.min(offset, text.length)));
  const lines = prefix.split(/\r\n|\r|\n/);
  return { line: lines.length - 1, character: lines[lines.length - 1].length };
}

function utf8ByteOffsetToUtf16(text: string, byteOffset: number): number {
  let bytes = 0;
  let codeUnits = 0;
  for (const character of text) {
    const width = Buffer.byteLength(character, 'utf8');
    if (bytes + width > byteOffset) break;
    bytes += width;
    codeUnits += character.length;
  }
  return codeUnits;
}

export default class DuckDBDriver
  extends AbstractDriver<DuckDBConnection, DuckDBDriverOptions>
  implements IConnectionDriver {
  public readonly deps: typeof AbstractDriver.prototype.deps = [{
    type: AbstractDriver.CONSTANTS.DEPENDENCY_PACKAGE,
    name: NODE_API_PACKAGE,
    version: NODE_API_VERSION,
  }];

  public readonly queries = queries;

  private instance?: DuckDBInstance;
  private closePromise?: Promise<void>;
  private operationTail: Promise<void> = Promise.resolve();
  private keywordCompletions?: { [word: string]: NSDatabase.IStaticCompletion };

  private get nodeApi(): DuckDBNodeApi {
    return this.requireDep(NODE_API_PACKAGE) as DuckDBNodeApi;
  }

  private get configuredDatabase(): string {
    if (this.credentials.connectionMethod === 'In-Memory') {
      return ':memory:';
    }

    if (this.credentials.connectionMethod === 'MotherDuck') {
      const configured = this.credentials.database?.trim();
      return configured?.startsWith('md:') ? configured : `md:${configured || ''}`;
    }

    return this.credentials.database || this.credentials.databaseFilePath || ':memory:';
  }

  private async resolveDatabase(): Promise<string> {
    const database = this.configuredDatabase;
    if (
      database === ':memory:'
      || database.startsWith('md:')
      || (/^[a-z][a-z0-9+.-]*:/i.test(database) && !/^[a-z]:[\\/]/i.test(database))
    ) {
      return database;
    }
    return this.toAbsolutePath(database);
  }

  private instanceOptions(): Record<string, string> {
    const options = Object.fromEntries(
      Object.entries(this.credentials.duckdbOptions || {})
        .filter(([, value]) => value !== undefined && value !== null && value !== '')
        .map(([key, value]) => [key, String(value)]),
    );

    if (this.configuredDatabase === ':memory:') {
      options.access_mode = 'READ_WRITE';
    } else if (this.credentials.accessMode === 'Read Only' || !this.credentials.accessMode) {
      options.access_mode = 'READ_ONLY';
    } else if (this.credentials.accessMode === 'Read/Write') {
      options.access_mode = 'READ_WRITE';
    } else {
      options.access_mode = 'AUTOMATIC';
    }

    if (this.configuredDatabase.startsWith('md:') && this.credentials.password) {
      options.motherduck_token = this.credentials.password;
    }

    return options;
  }

  private async createConnection(): Promise<DuckDBConnection> {
    const database = await this.resolveDatabase();
    const instance = database === ':memory:'
      ? await this.nodeApi.DuckDBInstance.create(database, this.instanceOptions())
      : await this.nodeApi.DuckDBInstance.fromCache(database, this.instanceOptions());
    let connection: DuckDBConnection | undefined;

    try {
      connection = await instance.connect();
      this.instance = instance;

      const initializationSql = this.credentials.initializationSql?.trim();
      if (initializationSql) {
        await connection.run(initializationSql);
      }

      return connection;
    } catch (error) {
      try {
        connection?.closeSync();
      } finally {
        instance.closeSync();
      }
      throw error;
    }
  }

  public async open(): Promise<DuckDBConnection> {
    if (this.closePromise) {
      await this.closePromise;
    }

    if (!this.connection) {
      const connection = this.createConnection();
      this.connection = connection;
      connection.catch(() => {
        if (this.connection === connection) {
          this.connection = undefined as unknown as Promise<DuckDBConnection>;
          this.instance = undefined;
        }
      });
    }

    return this.connection;
  }

  private runExclusive<T>(operation: (connection: DuckDBConnection) => Promise<T>): Promise<T> {
    if (this.closePromise) {
      return Promise.reject(new Error('DuckDB connection is closing.'));
    }

    // Capture the connection before queueing. If close starts while this operation
    // is waiting its turn, calling open from inside the queue would create a cycle:
    // close -> operationTail -> open -> close.
    const connection = this.open();
    const result = this.operationTail.then(async () => operation(await connection));
    this.operationTail = result.then(() => undefined, () => undefined);
    return result;
  }

  public async close(): Promise<void> {
    if (this.closePromise) {
      return this.closePromise;
    }

    this.closePromise = (async () => {
      await this.operationTail;
      const connectionPromise = this.connection;
      this.connection = undefined as unknown as Promise<DuckDBConnection>;

      if (connectionPromise) {
        try {
          const connection = await connectionPromise;
          const instance = this.instance;
          this.instance = undefined;
          try {
            connection.closeSync();
          } finally {
            instance?.closeSync();
          }
        } catch (error) {
          this.log.warn(`Error while closing DuckDB connection: ${String(error)}`);
        }
      } else if (this.instance) {
        this.instance.closeSync();
        this.instance = undefined;
      }
    })();

    try {
      await this.closePromise;
    } finally {
      this.closePromise = undefined;
    }
  }

  private resultFromReader<Q>(
    reader: DuckDBResultReader,
    query: Q,
    requestId?: string,
  ): NSDatabase.IResult {
    const rows = reader.getRowObjectsJson();
    const affected = reader.rowsChanged;
    const messages = rows.length
      ? [`Successfully returned ${rows.length} row${rows.length === 1 ? '' : 's'}.`]
      : affected > 0
        ? [`Query executed successfully; ${affected} row${affected === 1 ? '' : 's'} changed.`]
        : ['Query executed successfully; no rows returned.'];

    return {
      requestId,
      resultId: randomUUID(),
      connId: this.getId(),
      cols: reader.deduplicatedColumnNames(),
      messages,
      query,
      results: rows,
    } as NSDatabase.IResult;
  }

  private async executeStatements<Q>(
    connection: DuckDBConnection,
    query: Q,
    sql: string,
    requestId?: string,
  ): Promise<NSDatabase.IResult[]> {
    const extracted = await connection.extractStatements(sql);
    const results: NSDatabase.IResult[] = [];

    for (let index = 0; index < extracted.count; index += 1) {
      const statement = await extracted.prepare(index);
      try {
        const reader = await statement.runAndReadAll();
        results.push(this.resultFromReader(reader, query, requestId));
      } finally {
        statement.destroySync();
      }
    }

    return results;
  }

  public query: typeof AbstractDriver.prototype.query = async (query, opt = {}) => {
    const sql = String(query);
    return this.runExclusive(connection => this.executeStatements(
      connection,
      query,
      sql,
      opt.requestId,
    ));
  };

  public async testConnection(): Promise<void> {
    await this.runExclusive(async connection => {
      await connection.run('SELECT 1');
    });
  }

  public async getChildrenForItem({ item, parent }: Arg0<IConnectionDriver['getChildrenForItem']>) {
    switch (item.type) {
      case ContextValue.CONNECTION:
      case ContextValue.CONNECTED_CONNECTION:
        return this.queryResults(this.queries.fetchDatabases());
      case ContextValue.DATABASE:
        return this.queryResults(this.queries.fetchSchemas(item as NSDatabase.IDatabase));
      case ContextValue.SCHEMA:
        return [
          { label: 'Tables', type: ContextValue.RESOURCE_GROUP, iconId: 'folder', childType: ContextValue.TABLE },
          { label: 'Views', type: ContextValue.RESOURCE_GROUP, iconId: 'folder', childType: ContextValue.VIEW },
          { label: 'Functions and macros', type: ContextValue.RESOURCE_GROUP, iconId: 'folder', childType: ContextValue.FUNCTION },
          { label: 'Types', type: ContextValue.RESOURCE_GROUP, iconId: 'folder', childType: ContextValue.TYPE },
          { label: 'Sequences', type: ContextValue.RESOURCE_GROUP, iconId: 'folder', childType: ContextValue.SEQUENCE },
        ] as MConnectionExplorer.IChildItem[];
      case ContextValue.TABLE:
        return [
          { label: 'Columns', type: ContextValue.RESOURCE_GROUP, iconId: 'folder', childType: ContextValue.COLUMN },
          { label: 'Constraints', type: ContextValue.RESOURCE_GROUP, iconId: 'folder', childType: ContextValue.CONSTRAINT },
          { label: 'Indexes', type: ContextValue.RESOURCE_GROUP, iconId: 'folder', childType: ContextValue.INDEX },
        ] as MConnectionExplorer.IChildItem[];
      case ContextValue.VIEW:
        return [
          { label: 'Columns', type: ContextValue.RESOURCE_GROUP, iconId: 'folder', childType: ContextValue.COLUMN },
        ] as MConnectionExplorer.IChildItem[];
      case ContextValue.RESOURCE_GROUP:
        return this.getChildrenForGroup({ item, parent });
      default:
        return [];
    }
  }

  private async getChildrenForGroup({ parent, item }: Arg0<IConnectionDriver['getChildrenForItem']>) {
    switch (item.childType) {
      case ContextValue.TABLE:
        return this.queryResults(this.queries.fetchTables(parent as NSDatabase.ISchema));
      case ContextValue.VIEW:
        return this.queryResults(this.queries.fetchViews(parent as NSDatabase.ISchema));
      case ContextValue.COLUMN:
        return this.queryResults(this.queries.fetchColumns(parent as NSDatabase.ITable));
      case ContextValue.CONSTRAINT:
        return this.queryResults(this.queries.fetchConstraints(parent as NSDatabase.ITable));
      case ContextValue.INDEX:
        return this.queryResults(this.queries.fetchIndexes(parent as NSDatabase.ITable));
      case ContextValue.FUNCTION:
        return this.queryResults(this.queries.fetchFunctions(parent as NSDatabase.ISchema));
      case ContextValue.TYPE:
        return this.queryResults(this.queries.fetchTypes(parent as NSDatabase.ISchema));
      case ContextValue.SEQUENCE:
        return this.queryResults(this.queries.fetchSequences(parent as NSDatabase.ISchema));
      default:
        return [];
    }
  }

  public searchItems(
    itemType: ContextValue,
    search: string,
    extraParams: Record<string, unknown> = {},
  ): Promise<NSDatabase.SearchableItem[]> {
    switch (itemType) {
      case ContextValue.DATABASE:
        return this.queryResults<NSDatabase.IDatabase>(this.queries.fetchDatabases())
          .then(items => items.filter(item => item.label.toLowerCase().includes(search.toLowerCase())));
      case ContextValue.TABLE:
      case ContextValue.VIEW:
        return this.queryResults(this.queries.searchTables({ search, ...extraParams }));
      case ContextValue.COLUMN:
        return this.queryResults(this.queries.searchColumns({ tables: [], search, ...extraParams }));
      case ContextValue.FUNCTION:
        return this.queryResults(this.queries.searchFunctions({ search, ...extraParams }));
      case ContextValue.INDEX:
        return this.queryResults(this.queries.searchIndexes({ search, ...extraParams }));
      default:
        return Promise.resolve([]);
    }
  }

  public getDefinitionForItem({ item }: Arg0<IConnectionDriver['getDefinitionForItem']>): Promise<string> {
    return this.queryResults<{ sql: string }>(this.queries.fetchDefinition(item))
      .then(rows => fullyQualifyDefinition(item, rows[0]?.sql || ''));
  }

  public getCompletionsForRawQuery = async (
    text: string,
    currentOffset: number,
  ): Promise<any[]> => this.runExclusive(async connection => {
    const extensionReader = await connection.runAndReadAll(`
      SELECT loaded
      FROM duckdb_extensions()
      WHERE extension_name = 'autocomplete'
    `);
    const extension = extensionReader.getRowObjectsJson()[0];
    // SQLTools' runtime uses null to select its generic completion fallback,
    // although @sqltools/types 0.2.1 has not added null to this return type.
    if (!extension?.loaded) return null as unknown as any[];

    const queryText = text.slice(0, Math.max(0, Math.min(currentOffset, text.length)));
    const reader = await connection.runAndReadAll(
      `SELECT suggestion, suggestion_start FROM sql_auto_complete($query_text)`,
      { query_text: queryText },
    );
    const end = positionAt(text, currentOffset);
    return reader.getRowObjectsJson().flatMap(row => {
      if (typeof row.suggestion !== 'string') return [];
      const suggestionStart = typeof row.suggestion_start === 'number'
        ? row.suggestion_start
        : Number(row.suggestion_start);
      const startOffset = Number.isSafeInteger(suggestionStart)
        ? utf8ByteOffsetToUtf16(queryText, Math.max(0, suggestionStart))
        : currentOffset;
      return [{
        label: row.suggestion.trimEnd() || row.suggestion,
        textEdit: {
          range: { start: positionAt(text, startOffset), end },
          newText: row.suggestion,
        },
      }];
    });
  });

  public async getInsertQuery({
    item,
    columns,
  }: Arg0<IConnectionDriver['getInsertQuery']>): Promise<string> {
    return this.queries.insertQuery(item, columns);
  }

  public getStaticCompletions = async () => {
    if (this.keywordCompletions) {
      return this.keywordCompletions || keywordsCompletion;
    }

    try {
      const keywords = await this.queryResults<{ label: string; detail: string }>(
        this.queries.fetchKeywords(),
      );
      this.keywordCompletions = Object.fromEntries(keywords.map(keyword => [keyword.label, {
        label: keyword.label,
        detail: keyword.detail,
        filterText: keyword.label,
        sortText: `${['SELECT', 'CREATE', 'UPDATE', 'DELETE'].includes(keyword.label) ? '2:' : ''}${keyword.label}`,
        documentation: {
          value: `\`\`\`yaml\nWORD: ${keyword.label}\nTYPE: ${keyword.detail}\n\`\`\``,
          kind: 'markdown',
        },
      }]));
      return this.keywordCompletions || keywordsCompletion;
    } catch (error) {
      this.log.warn(`Could not load DuckDB keywords; using the bundled fallback: ${String(error)}`);
      return keywordsCompletion;
    }
  };
}
