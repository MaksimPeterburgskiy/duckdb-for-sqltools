import { DuckDBConnection, DuckDBInstance } from '@duckdb/node-api';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import queries from '../../src/ls/queries';

describe('DuckDB metadata queries', () => {
  let instance: DuckDBInstance;
  let connection: DuckDBConnection;

  const rows = async (sql: string) => {
    const reader = await connection.runAndReadAll(sql);
    return reader.getRowObjectsJson();
  };

  beforeAll(async () => {
    instance = await DuckDBInstance.create(':memory:');
    connection = await instance.connect();
    await connection.run(`
      ATTACH ':memory:' AS "attached.db";
      CREATE SCHEMA "attached.db"."odd schema";
      CREATE SCHEMA "attached.db"."second schema";
      CREATE TABLE "attached.db"."second schema"."50%_off'" ("id" BIGINT);
      INSERT INTO "attached.db"."second schema"."50%_off'" VALUES (2);
      USE "attached.db"."odd schema";
      CREATE TABLE "parent" (
        "id" BIGINT PRIMARY KEY
      );
      CREATE TABLE "composite parent" (
        "left id" INTEGER,
        "right id" INTEGER,
        CONSTRAINT "composite pk" PRIMARY KEY ("left id", "right id"),
        CONSTRAINT "positive ids" CHECK ("left id" >= 0 AND "right id" >= 0)
      );
      CREATE TABLE "composite child" (
        "left id" INTEGER,
        "right id" INTEGER,
        FOREIGN KEY ("left id", "right id")
          REFERENCES "composite parent" ("left id", "right id")
      );
      CREATE TABLE "50%_off'" (
        "id" BIGINT PRIMARY KEY,
        "parent_id" BIGINT REFERENCES "parent"("id"),
        "display name" VARCHAR DEFAULT 'unknown'
      );
      COMMENT ON TABLE "50%_off'" IS 'promotion facts';
      COMMENT ON COLUMN "50%_off'"."display name" IS 'customer-facing label';
      INSERT INTO "attached.db"."odd schema"."50%_off'" ("id") VALUES (1);
      CREATE VIEW "attached.db"."odd schema"."order summary" AS
        SELECT * FROM "attached.db"."odd schema"."50%_off'";
      CREATE INDEX "idx display" ON "50%_off'" ("display name");
      CREATE SEQUENCE "invoice seq" START 10 INCREMENT 5;
      CREATE TYPE "mood type" AS ENUM ('happy', 'sad');
      CREATE MACRO "double it"(x) AS x * 2;
      CREATE MACRO "with defaults"(x, y := 2) AS x + y;
      CREATE TABLE "dollar\${1}\\name}" ("column\${2}\\}" INTEGER);
      CREATE TEMP TABLE "temporary table" ("id" INTEGER);
      CREATE TEMP VIEW "temporary view" AS SELECT * FROM "temporary table";
    `);
  });

  afterAll(() => {
    connection.closeSync();
    instance.closeSync();
  });

  it('discovers attached catalogs and schemas', async () => {
    const databases = await rows(queries.fetchDatabases().toString());
    expect(databases).toContainEqual(expect.objectContaining({
      label: 'attached.db',
      database: 'attached.db',
    }));
    expect(databases.map(row => row.label)).toContain('temp');
    expect(databases.map(row => row.label)).not.toContain('system');

    const schemas = await rows(queries.fetchSchemas({
      database: 'attached.db',
    } as any).toString());
    expect(schemas).toContainEqual(expect.objectContaining({
      database: 'attached.db',
      schema: 'odd schema',
      label: 'odd schema',
    }));
    expect(schemas).toContainEqual(expect.objectContaining({
      database: 'attached.db',
      schema: 'second schema',
    }));

    const tempSchema = { database: 'temp', schema: 'main' } as any;
    await expect(rows(queries.fetchTables(tempSchema).toString())).resolves.toContainEqual(
      expect.objectContaining({ label: 'temporary table', isView: false }),
    );
    await expect(rows(queries.fetchViews(tempSchema).toString())).resolves.toContainEqual(
      expect.objectContaining({ label: 'temporary view', isView: true }),
    );
  });

  it('separates fully identified tables and views', async () => {
    const schema = { database: 'attached.db', schema: 'odd schema' } as any;
    const tables = await rows(queries.fetchTables(schema).toString());
    const views = await rows(queries.fetchViews(schema).toString());

    expect(tables).toContainEqual(expect.objectContaining({
      label: "50%_off'",
      database: 'attached.db',
      schema: 'odd schema',
      isView: false,
      snippet: '"attached.db"."odd schema"."50%_off\'"',
      comment: 'promotion facts',
      detail: 'promotion facts',
    }));
    expect(views).toContainEqual(expect.objectContaining({
      label: 'order summary',
      database: 'attached.db',
      schema: 'odd schema',
      isView: true,
    }));
    expect(tables).toContainEqual(expect.objectContaining({
      label: 'dollar${1}\\name}',
      snippet: '"attached.db"."odd schema"."dollar\\${1\\}\\\\name\\}"',
    }));
  });

  it('reports column identity, nullability, defaults, and key flags', async () => {
    const table = {
      database: 'attached.db',
      schema: 'odd schema',
      label: "50%_off'",
    } as any;
    const columns = await rows(queries.fetchColumns(table).toString());

    expect(columns).toContainEqual(expect.objectContaining({
      label: 'id',
      database: 'attached.db',
      schema: 'odd schema',
      table: "50%_off'",
      isNullable: false,
      isPk: true,
      isFk: false,
    }));
    expect(columns).toContainEqual(expect.objectContaining({
      label: 'parent_id',
      isFk: true,
    }));
    expect(columns).toContainEqual(expect.objectContaining({
      label: 'display name',
      defaultValue: "'unknown'",
      isNullable: true,
      comment: 'customer-facing label',
      detail: 'customer-facing label',
    }));
  });

  it('treats LIKE metacharacters literally and previews qualified tables', async () => {
    const matches = await rows(queries.searchTables({
      search: "%_off'",
      limit: 10,
    }).toString());
    expect(matches).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "50%_off'", schema: 'odd schema' }),
      expect.objectContaining({ label: "50%_off'", schema: 'second schema' }),
    ]));

    const preview = await rows(queries.fetchRecords({
      table: {
        database: 'attached.db',
        schema: 'odd schema',
        label: "50%_off'",
      } as any,
      limit: 5,
      offset: 0,
    }).toString());
    expect(preview).toEqual([expect.objectContaining({ id: '1' })]);
  });

  it('exposes DuckDB-specific metadata and definitions', async () => {
    const schema = { database: 'attached.db', schema: 'odd schema' } as any;
    const table = { ...schema, label: "50%_off'" } as any;

    await expect(rows(queries.fetchConstraints(table).toString())).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ constraintType: 'PRIMARY KEY' }),
        expect.objectContaining({ constraintType: 'FOREIGN KEY' }),
      ]),
    );
    await expect(rows(queries.fetchConstraints({
      ...schema,
      label: 'composite parent',
    } as any).toString())).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({
        constraintType: 'PRIMARY KEY',
        columns: ['left id', 'right id'],
      }),
      expect.objectContaining({ constraintType: 'CHECK' }),
    ]));
    await expect(rows(queries.fetchConstraints({
      ...schema,
      label: 'composite child',
    } as any).toString())).resolves.toContainEqual(expect.objectContaining({
      constraintType: 'FOREIGN KEY',
      columns: ['left id', 'right id'],
      referencedTable: 'composite parent',
      referencedColumns: ['left id', 'right id'],
    }));
    await expect(rows(queries.fetchIndexes(table).toString())).resolves.toContainEqual(
      expect.objectContaining({ label: 'idx display', table: "50%_off'" }),
    );
    await expect(rows(queries.fetchSequences(schema).toString())).resolves.toContainEqual(
      expect.objectContaining({ label: 'invoice seq', incrementBy: '5' }),
    );
    await expect(rows(queries.fetchTypes(schema).toString())).resolves.toContainEqual(
      expect.objectContaining({ label: 'mood type', logicalType: 'ENUM' }),
    );
    await expect(rows(queries.fetchFunctions(schema).toString())).resolves.toContainEqual(
      expect.objectContaining({ label: 'double it', functionType: 'macro' }),
    );
    await expect(rows(queries.fetchFunctions(schema).toString())).resolves.toContainEqual(
      expect.objectContaining({ label: 'with defaults', signature: 'with defaults(x, y)' }),
    );
    await expect(rows(queries.searchFunctions({
      search: 'abs',
      limit: 100,
    }).toString())).resolves.toEqual([]);
    await expect(rows(queries.searchIndexes({
      search: 'display',
      parent: table,
      limit: 10,
    }).toString())).resolves.toHaveLength(1);
    await expect(rows(queries.searchFunctions({
      search: 'double',
      parent: schema,
      limit: 10,
    }).toString())).resolves.toHaveLength(1);

    const tableDefinition = await rows(queries.fetchDefinition({
      ...table,
      type: 'connection.table',
    } as any));
    expect(tableDefinition[0]?.sql).toContain('CREATE TABLE');
    const indexDefinition = await rows(queries.fetchDefinition({
      ...table,
      label: 'idx display',
      name: 'idx display',
      type: 'connection.index',
      parent: table,
    } as any));
    expect(indexDefinition[0]?.sql).toContain('CREATE INDEX');
    const macroDefinition = await rows(queries.fetchDefinition({
      ...schema,
      label: 'double it',
      name: 'double it',
      type: 'connection.function',
    } as any));
    expect(macroDefinition[0]?.sql).toContain(
      'CREATE MACRO "attached.db"."odd schema"."double it"(x) AS',
    );

    const keywords = await rows(queries.fetchKeywords().toString());
    expect(keywords).toContainEqual(expect.objectContaining({
      label: 'SELECT',
      category: 'reserved',
    }));
  });
});
