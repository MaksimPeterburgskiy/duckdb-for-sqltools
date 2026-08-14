import { describe, expect, it } from 'vitest';
import queries from '../src/ls/queries';
import {
  containsLike,
  escapeLikePattern,
  nonNegativeInteger,
  qualifiedName,
  qualifiedRelationName,
  quoteIdentifier,
  quoteStringLiteral,
} from '../src/ls/sql';

describe('DuckDB SQL helpers', () => {
  it('quotes each identifier part independently', () => {
    expect(quoteIdentifier('a"b')).toBe('"a""b"');
    expect(qualifiedName('attached.db', 'odd schema', 'select')).toBe(
      '"attached.db"."odd schema"."select"',
    );
    expect(qualifiedRelationName({
      database: 'attached.db',
      schema: 'odd schema',
      label: 'a"table',
    })).toBe('"attached.db"."odd schema"."a""table"');
  });

  it('quotes literals and escapes LIKE metacharacters separately', () => {
    expect(quoteStringLiteral("O'Reilly")).toBe("'O''Reilly'");
    expect(escapeLikePattern('10%!_done')).toBe('10!%!!!_done');
    expect(containsLike("x' OR 1=1 --_%")).toBe(
      "'%x'' OR 1=1 --!_!%%'",
    );
  });

  it('only permits non-negative safe pagination integers', () => {
    expect(nonNegativeInteger(undefined, 50, 'limit')).toBe(50);
    expect(nonNegativeInteger(0, 50, 'limit')).toBe(0);
    expect(nonNegativeInteger('25', 50, 'limit')).toBe(25);
    expect(() => nonNegativeInteger('1; DROP TABLE t', 50, 'limit')).toThrow(RangeError);
    expect(() => nonNegativeInteger(-1, 50, 'limit')).toThrow(RangeError);
    expect(() => nonNegativeInteger(1.5, 50, 'limit')).toThrow(RangeError);
  });

  it('rejects relations that cannot be fully qualified', () => {
    expect(() => qualifiedRelationName({ database: 'db', label: 't' })).toThrow(
      'Missing schema name',
    );
  });
});

describe('metadata query generation', () => {
  const table = {
    database: 'attached.db',
    schema: 'odd schema',
    label: 'a"table',
  } as any;

  it('fully qualifies preview and count queries', () => {
    const preview = queries.fetchRecords({ table, limit: 0, offset: 12 }).toString();
    expect(preview).toContain('FROM "attached.db"."odd schema"."a""table"');
    expect(preview).toContain('LIMIT 0');
    expect(preview).toContain('OFFSET 12');
    expect(queries.countRecords({ table })).toContain(
      'FROM "attached.db"."odd schema"."a""table"',
    );
  });

  it('uses information_schema for explorer metadata', () => {
    const columns = queries.fetchColumns(table).toString();
    expect(columns).toContain('FROM information_schema.columns AS C');
    expect(columns).toContain("C.table_catalog = 'attached.db'");
    expect(columns).toContain("C.table_schema = 'odd schema'");
    expect(columns).toContain("C.table_name = 'a\"table'");
    expect(columns).toContain("TC.constraint_type = 'PRIMARY KEY'");
    expect(columns).toContain("TC.constraint_type = 'FOREIGN KEY'");
    expect(columns).not.toContain('pragma_table_info');
  });

  it('keeps catalog and schema identity in table and column searches', () => {
    const tables = queries.searchTables({ search: "50%_off'", limit: 8 }).toString();
    expect(tables).toContain('T.table_catalog AS database');
    expect(tables).toContain('T.table_schema AS schema');
    expect(tables).toContain("'%50!%!_off''%') ESCAPE '!'");
    expect(tables).not.toContain('sqlite_master');

    const columns = queries.searchColumns({
      search: '_id',
      tables: [table],
      limit: 4,
    }).toString();
    expect(columns).toContain("C.table_catalog = 'attached.db'");
    expect(columns).toContain("C.table_schema = 'odd schema'");
    expect(columns).toContain("C.table_name = 'a\"table'");
    expect(columns).toContain("'%!_id%') ESCAPE '!'");
  });

  it('rejects injected pagination in generated queries', () => {
    expect(() => queries.fetchRecords({
      table,
      limit: '10; DROP TABLE x' as any,
      offset: 0,
    })).toThrow(RangeError);
    expect(() => queries.searchTables({ search: '', limit: -1 })).toThrow(RangeError);
  });

  it('generates fully qualified definitions and INSERT snippets', () => {
    expect(queries.fetchDefinition({ ...table, type: 'connection.view' } as any)).toContain(
      "FROM duckdb_views() WHERE database_name = 'attached.db'",
    );
    expect(queries.insertQuery(table, [
      { label: 'id', dataType: 'BIGINT' },
      { label: 'a"column', dataType: 'VARCHAR' },
    ] as any)).toBe(
      'INSERT INTO "attached.db"."odd schema"."a""table" (\n'
      + '  "id",\n'
      + '  "a""column"\n'
      + ') VALUES (\n'
      + "  '${1:id:BIGINT}',\n"
      + "  '${2:a\"column:VARCHAR}'\n"
      + ');',
    );
  });

  it('escapes VS Code snippet metacharacters in generated INSERT identifiers', () => {
    const insert = queries.insertQuery({
      database: 'catalog${1}',
      schema: 'schema\\name}',
      label: 'table$0',
    } as any, [{ label: 'column${2}\\}', dataType: 'VARCHAR' }] as any);

    const identifiers = insert.slice(0, insert.indexOf(') VALUES'));
    expect(identifiers).toContain('"catalog\\${1\\}"');
    expect(identifiers).toContain('"schema\\\\name\\}"');
    expect(identifiers).toContain('"table\\$0"');
    expect(identifiers).not.toMatch(/(?<!\\)\$/);
    expect(identifiers).not.toMatch(/(?<!\\)}/);
  });
});
