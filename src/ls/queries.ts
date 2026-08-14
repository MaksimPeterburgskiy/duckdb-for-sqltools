import {
  ContextValue,
  IBaseQueries,
  MConnectionExplorer,
  NSDatabase,
  QueryBuilder,
} from '@sqltools/types';
import queryFactory from '@sqltools/base-driver/dist/lib/factory';
import {
  containsLike,
  nonNegativeInteger,
  qualifiedName,
  qualifiedRelationName,
  quoteIdentifier,
  quoteStringLiteral,
} from './sql';

const typedQuery = <P, R>(
  query: ReturnType<typeof queryFactory<P>>,
): QueryBuilder<P, R> => query as unknown as QueryBuilder<P, R>;

const nameOf = (value: unknown, part: string): string => {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`Missing ${part} name`);
  }
  return value;
};

const catalogOf = (item?: { database?: unknown; label?: unknown }): string => {
  const catalog = item?.database || item?.label;
  if (typeof catalog !== 'string' || catalog.length === 0) {
    throw new TypeError('Missing catalog name');
  }
  return catalog;
};

const fetchDatabases = typedQuery<MConnectionExplorer.IChildItem, NSDatabase.IDatabase>(queryFactory<MConnectionExplorer.IChildItem>`
SELECT DISTINCT
  S.catalog_name AS database_name,
  S.catalog_name AS label,
  S.catalog_name AS database,
  '' AS schema,
  '${ContextValue.DATABASE}' AS type,
  D.readonly AS isReadOnly,
  CASE WHEN D.readonly THEN 'read-only' ELSE '' END AS detail
FROM information_schema.schemata AS S
JOIN duckdb_databases() AS D ON D.database_name = S.catalog_name
WHERE S.schema_name NOT IN ('information_schema', 'pg_catalog')
  AND (
    NOT D.internal
    OR (
      D.database_name = 'temp'
      AND EXISTS (
        SELECT 1
        FROM information_schema.tables AS TT
        WHERE TT.table_catalog = 'temp'
          AND TT.table_schema NOT IN ('information_schema', 'pg_catalog')
      )
    )
  )
ORDER BY S.catalog_name
`);

const fetchSchemas = typedQuery<NSDatabase.IDatabase, NSDatabase.ISchema>(queryFactory<NSDatabase.IDatabase>`
SELECT
  S.catalog_name AS database,
  S.schema_name AS label,
  S.schema_name AS schema,
  '${ContextValue.SCHEMA}' AS type,
  'group-by-ref-type' AS iconId,
  DS.comment,
  DS.comment AS detail
FROM information_schema.schemata AS S
LEFT JOIN duckdb_schemas() AS DS
  ON DS.database_name = S.catalog_name
  AND DS.schema_name = S.schema_name
WHERE S.catalog_name = ${p => quoteStringLiteral(catalogOf(p))}
  AND S.catalog_name <> 'system'
  AND S.schema_name NOT IN ('information_schema', 'pg_catalog')
ORDER BY S.schema_name
`);

const columnIconSql = `CASE
  WHEN C.data_type IN (
    'BIGINT', 'INT8', 'LONG', 'SMALLINT', 'INT2', 'SHORT', 'TINYINT',
    'HUGEINT', 'UBIGINT', 'UINTEGER', 'USMALLINT', 'UTINYINT',
    'INTEGER', 'INT4', 'INT', 'SIGNED', 'DOUBLE', 'FLOAT8', 'NUMERIC',
    'REAL', 'FLOAT4', 'FLOAT'
  ) OR C.data_type LIKE 'DECIMAL(%' THEN 'symbol-number'
  WHEN C.data_type IN ('BOOLEAN', 'BOOL', 'LOGICAL') THEN 'symbol-boolean'
  WHEN C.data_type IN ('BLOB', 'BYTEA', 'BINARY', 'VARBINARY') THEN 'symbol-binary'
  WHEN C.data_type IN (
    'DATE', 'TIME', 'TIME WITH TIME ZONE', 'TIMESTAMP', 'DATETIME',
    'TIMESTAMP_NS', 'TIMESTAMP WITH TIME ZONE'
  ) THEN 'calendar'
  WHEN C.data_type = 'UUID' THEN 'symbol-u'
  WHEN C.data_type IN ('BIT', 'BITSTRING', 'VARCHAR', 'CHAR', 'BPCHAR', 'TEXT', 'STRING')
    THEN 'symbol-text'
  ELSE 'symbol-constant'
END`;

const columnsSql = (table?: Partial<NSDatabase.ITable>): string => `
SELECT
  C.column_name AS label,
  C.table_catalog AS database,
  C.table_schema AS schema,
  C.table_name AS "table",
  C.data_type AS dataType,
  C.is_nullable = 'YES' AS isNullable,
  C.column_default AS defaultValue,
  DC.comment,
  EXISTS (
    SELECT 1
    FROM information_schema.table_constraints AS TC
    JOIN information_schema.key_column_usage AS KCU
      ON KCU.constraint_catalog = TC.constraint_catalog
      AND KCU.constraint_schema = TC.constraint_schema
      AND KCU.constraint_name = TC.constraint_name
      AND KCU.table_catalog = TC.table_catalog
      AND KCU.table_schema = TC.table_schema
      AND KCU.table_name = TC.table_name
    WHERE TC.constraint_type = 'PRIMARY KEY'
      AND KCU.table_catalog = C.table_catalog
      AND KCU.table_schema = C.table_schema
      AND KCU.table_name = C.table_name
      AND KCU.column_name = C.column_name
  ) AS isPk,
  EXISTS (
    SELECT 1
    FROM information_schema.table_constraints AS TC
    JOIN information_schema.key_column_usage AS KCU
      ON KCU.constraint_catalog = TC.constraint_catalog
      AND KCU.constraint_schema = TC.constraint_schema
      AND KCU.constraint_name = TC.constraint_name
      AND KCU.table_catalog = TC.table_catalog
      AND KCU.table_schema = TC.table_schema
      AND KCU.table_name = TC.table_name
    JOIN information_schema.referential_constraints AS RC
      ON RC.constraint_catalog = TC.constraint_catalog
      AND RC.constraint_schema = TC.constraint_schema
      AND RC.constraint_name = TC.constraint_name
    WHERE TC.constraint_type = 'FOREIGN KEY'
      AND KCU.table_catalog = C.table_catalog
      AND KCU.table_schema = C.table_schema
      AND KCU.table_name = C.table_name
      AND KCU.column_name = C.column_name
  ) AS isFk,
  '${ContextValue.NO_CHILD}' AS childType,
  ${columnIconSql} AS iconId,
  coalesce(DC.comment, C.data_type) AS detail,
  '${ContextValue.COLUMN}' AS type
FROM information_schema.columns AS C
LEFT JOIN duckdb_columns() AS DC
  ON DC.database_name = C.table_catalog
  AND DC.schema_name = C.table_schema
  AND DC.table_name = C.table_name
  AND DC.column_name = C.column_name
WHERE C.table_catalog = ${quoteStringLiteral(catalogOf(table))}
  AND C.table_schema = ${quoteStringLiteral(nameOf(table?.schema, 'schema'))}
  AND C.table_name = ${quoteStringLiteral(nameOf(table?.label, 'relation'))}
ORDER BY C.ordinal_position
`.trim();

const describeTable = typedQuery<NSDatabase.ITable, any>(queryFactory<NSDatabase.ITable>`
${p => columnsSql(p)}
`);

const fetchColumns = typedQuery<NSDatabase.ITable, NSDatabase.IColumn>(queryFactory<NSDatabase.ITable>`
${p => columnsSql(p)}
`);

type FetchRecordsParams = { limit: number; offset: number; table: NSDatabase.ITable };
const fetchRecords = typedQuery<FetchRecordsParams, any>(queryFactory<FetchRecordsParams>`
SELECT *
FROM ${p => qualifiedRelationName(p.table)}
LIMIT ${p => nonNegativeInteger(p.limit, 50, 'limit')}
OFFSET ${p => nonNegativeInteger(p.offset, 0, 'offset')}
`);

type CountRecordsParams = { table: NSDatabase.ITable };
const countRecords = typedQuery<CountRecordsParams, { total: number }>(queryFactory<CountRecordsParams>`
SELECT count(*) AS total
FROM ${p => qualifiedRelationName(p.table)}
`);

const qualifiedIdentifierSql = `concat(
  '"', replace(T.table_catalog, '"', '""'),
  '"."', replace(T.table_schema, '"', '""'),
  '"."', replace(T.table_name, '"', '""'), '"'
)`;
const qualifiedSnippetSql = `replace(
  replace(
    replace(${qualifiedIdentifierSql}, chr(92), chr(92) || chr(92)),
    '$', chr(92) || '$'
  ),
  '}', chr(92) || '}'
)`;

const relationMetadataSql = `
  SELECT database_name, schema_name, table_name AS object_name, comment
  FROM duckdb_tables()
  UNION ALL
  SELECT database_name, schema_name, view_name AS object_name, comment
  FROM duckdb_views()
`;

const fetchTablesAndViews = (
  type: ContextValue.TABLE | ContextValue.VIEW,
  tableTypes: readonly string[],
): IBaseQueries['fetchTables'] => typedQuery<NSDatabase.ISchema, NSDatabase.ITable>(queryFactory<NSDatabase.ISchema>`
SELECT
  T.table_name AS label,
  T.table_catalog AS database,
  T.table_schema AS schema,
  '${type}' AS type,
  ${type === ContextValue.VIEW ? 'TRUE' : 'FALSE'} AS isView,
  ${qualifiedSnippetSql} AS snippet,
  RM.comment,
  RM.comment AS detail
FROM information_schema.tables AS T
LEFT JOIN (${relationMetadataSql}) AS RM
  ON RM.database_name = T.table_catalog
  AND RM.schema_name = T.table_schema
  AND RM.object_name = T.table_name
WHERE T.table_catalog = ${p => quoteStringLiteral(catalogOf(p))}
  AND T.table_schema = ${p => quoteStringLiteral(nameOf(p.schema, 'schema'))}
  AND T.table_type IN (${tableTypes.map(quoteStringLiteral).join(', ')})
ORDER BY T.table_name
`);

const fetchTables: IBaseQueries['fetchTables'] = fetchTablesAndViews(
  ContextValue.TABLE,
  ['BASE TABLE', 'LOCAL TEMPORARY'],
);
const fetchViews: IBaseQueries['fetchTables'] = fetchTablesAndViews(
  ContextValue.VIEW,
  ['VIEW'],
);

type SearchTablesParams = { search: string; limit?: number };
const searchTables = typedQuery<SearchTablesParams, NSDatabase.ITable>(queryFactory<SearchTablesParams>`
SELECT
  T.table_name AS label,
  T.table_catalog AS database,
  T.table_schema AS schema,
  CASE WHEN T.table_type = 'VIEW'
    THEN '${ContextValue.VIEW}'
    ELSE '${ContextValue.TABLE}'
  END AS type,
  T.table_type = 'VIEW' AS isView,
  ${qualifiedSnippetSql} AS snippet,
  RM.comment,
  RM.comment AS detail
FROM information_schema.tables AS T
LEFT JOIN (${relationMetadataSql}) AS RM
  ON RM.database_name = T.table_catalog
  AND RM.schema_name = T.table_schema
  AND RM.object_name = T.table_name
WHERE T.table_schema NOT IN ('information_schema', 'pg_catalog')
  AND T.table_catalog <> 'system'
${p => typeof p.search === 'string' && p.search.length > 0
    ? `AND lower(T.table_name) LIKE lower(${containsLike(p.search)}) ESCAPE '!'`
    : ''}
ORDER BY T.table_catalog, T.table_schema, T.table_name
LIMIT ${p => nonNegativeInteger(p.limit, 100, 'limit')}
`);

const tableFilterSql = (tables: NSDatabase.ITable[]): string => {
  if (!Array.isArray(tables) || tables.length === 0) {
    return '';
  }

  const filters = tables.map(table => `(
    C.table_catalog = ${quoteStringLiteral(catalogOf(table))}
    AND C.table_schema = ${quoteStringLiteral(table.schema)}
    AND C.table_name = ${quoteStringLiteral(table.label)}
  )`);
  return `AND (${filters.join(' OR ')})`;
};

type SearchColumnsParams = { search: string; tables: NSDatabase.ITable[]; limit?: number };
const searchColumns = typedQuery<SearchColumnsParams, NSDatabase.IColumn>(queryFactory<SearchColumnsParams>`
SELECT
  C.column_name AS label,
  C.table_catalog AS database,
  C.table_schema AS schema,
  C.table_name AS "table",
  C.data_type AS dataType,
  C.is_nullable = 'YES' AS isNullable,
  C.column_default AS defaultValue,
  DC.comment,
  '${ContextValue.COLUMN}' AS type,
  '${ContextValue.NO_CHILD}' AS childType,
  ${columnIconSql} AS iconId,
  coalesce(DC.comment, C.data_type) AS detail
FROM information_schema.columns AS C
LEFT JOIN duckdb_columns() AS DC
  ON DC.database_name = C.table_catalog
  AND DC.schema_name = C.table_schema
  AND DC.table_name = C.table_name
  AND DC.column_name = C.column_name
WHERE C.table_schema NOT IN ('information_schema', 'pg_catalog')
  AND C.table_catalog <> 'system'
${p => tableFilterSql(p.tables || [])}
${p => typeof p.search === 'string' && p.search.length > 0 ? `AND (
  lower(C.table_name || '.' || C.column_name) LIKE lower(${containsLike(p.search)}) ESCAPE '!'
  OR lower(C.column_name) LIKE lower(${containsLike(p.search)}) ESCAPE '!'
)` : ''}
ORDER BY C.table_catalog, C.table_schema, C.table_name, C.ordinal_position
LIMIT ${p => nonNegativeInteger(p.limit, 100, 'limit')}
`);

type MetadataChild = MConnectionExplorer.IChildItem & Record<string, unknown>;

const fetchConstraints = typedQuery<NSDatabase.ITable, MetadataChild>(queryFactory<NSDatabase.ITable>`
SELECT
  DC.constraint_name AS label,
  DC.database_name AS database,
  DC.schema_name AS schema,
  DC.table_name AS "table",
  '${ContextValue.CONSTRAINT}' AS type,
  '${ContextValue.NO_CHILD}' AS childType,
  'symbol-structure' AS iconId,
  DC.constraint_type || ': ' || DC.constraint_text AS detail,
  DC.constraint_type AS constraintType,
  DC.constraint_text AS constraintText,
  DC.expression,
  DC.constraint_column_names AS columns,
  DC.referenced_table AS referencedTable,
  DC.referenced_column_names AS referencedColumns
FROM duckdb_constraints() AS DC
WHERE DC.database_name = ${p => quoteStringLiteral(catalogOf(p))}
  AND DC.schema_name = ${p => quoteStringLiteral(nameOf(p.schema, 'schema'))}
  AND DC.table_name = ${p => quoteStringLiteral(nameOf(p.label, 'relation'))}
ORDER BY DC.constraint_index
`);

const fetchIndexes = typedQuery<NSDatabase.ITable, NSDatabase.IIndex>(queryFactory<NSDatabase.ITable>`
SELECT
  DI.index_name AS label,
  DI.index_name AS name,
  DI.database_name AS database,
  DI.schema_name AS schema,
  DI.table_name AS "table",
  struct_pack(
    label := DI.table_name,
    database := DI.database_name,
    schema := DI.schema_name,
    type := '${ContextValue.TABLE}',
    isView := FALSE
  ) AS parent,
  '${ContextValue.INDEX}' AS type,
  '${ContextValue.NO_CHILD}' AS childType,
  'symbol-key' AS iconId,
  coalesce(DI.comment, CASE WHEN DI.is_unique THEN 'UNIQUE INDEX' ELSE 'INDEX' END) AS detail,
  DI.comment,
  DI.is_unique AS isUnique,
  DI.expressions,
  DI.sql
FROM duckdb_indexes() AS DI
WHERE DI.database_name = ${p => quoteStringLiteral(catalogOf(p))}
  AND DI.schema_name = ${p => quoteStringLiteral(nameOf(p.schema, 'schema'))}
  AND DI.table_name = ${p => quoteStringLiteral(nameOf(p.label, 'relation'))}
ORDER BY DI.index_name
`);

const fetchSequences = typedQuery<NSDatabase.ISchema, MetadataChild>(queryFactory<NSDatabase.ISchema>`
SELECT
  DS.sequence_name AS label,
  DS.sequence_name AS name,
  DS.database_name AS database,
  DS.schema_name AS schema,
  '${ContextValue.SEQUENCE}' AS type,
  '${ContextValue.NO_CHILD}' AS childType,
  'list-ordered' AS iconId,
  concat('start ', DS.start_value, ', increment ', DS.increment_by) AS detail,
  DS.temporary,
  DS.start_value AS startValue,
  DS.min_value AS minValue,
  DS.max_value AS maxValue,
  DS.increment_by AS incrementBy,
  DS.cycle,
  DS.comment,
  DS.sql
FROM duckdb_sequences() AS DS
WHERE DS.database_name = ${p => quoteStringLiteral(catalogOf(p))}
  AND DS.schema_name = ${p => quoteStringLiteral(nameOf(p.schema, 'schema'))}
ORDER BY DS.sequence_name
`);

const fetchTypes = typedQuery<NSDatabase.ISchema, MetadataChild>(queryFactory<NSDatabase.ISchema>`
SELECT
  DT.type_name AS label,
  DT.type_name AS name,
  DT.database_name AS database,
  DT.schema_name AS schema,
  '${ContextValue.TYPE}' AS type,
  '${ContextValue.NO_CHILD}' AS childType,
  'symbol-enum' AS iconId,
  coalesce(DT.comment, DT.logical_type) AS detail,
  DT.logical_type AS logicalType,
  DT.type_category AS typeCategory,
  DT.labels
FROM duckdb_types() AS DT
WHERE NOT DT.internal
  AND DT.database_name = ${p => quoteStringLiteral(catalogOf(p))}
  AND DT.schema_name = ${p => quoteStringLiteral(nameOf(p.schema, 'schema'))}
ORDER BY DT.type_name
`);

const functionSelectSql = `
SELECT
  DF.function_name AS label,
  DF.function_name AS name,
  DF.database_name AS database,
  DF.schema_name AS schema,
  '${ContextValue.FUNCTION}' AS type,
  '${ContextValue.NO_CHILD}' AS childType,
  'symbol-function' AS iconId,
  coalesce(DF.parameters, []::VARCHAR[]) AS args,
  coalesce(DF.return_type, CASE WHEN DF.function_type = 'table_macro' THEN 'TABLE' ELSE '' END) AS resultType,
  concat(
    DF.function_name,
    '(',
    CASE WHEN DF.function_type IN ('macro', 'table_macro')
      THEN array_to_string(coalesce(DF.parameters, []::VARCHAR[]), ', ')
      ELSE array_to_string(coalesce(DF.parameter_types, []::VARCHAR[]), ', ')
    END,
    CASE WHEN DF.varargs IS NULL THEN '' ELSE concat(
      CASE WHEN length(coalesce(DF.parameter_types, []::VARCHAR[])) > 0 THEN ', ' ELSE '' END,
      '...',
      DF.varargs
    ) END,
    ')'
  ) AS signature,
  DF.function_type AS functionType,
  coalesce(DF.comment, DF.description) AS detail,
  DF.macro_definition AS source
FROM duckdb_functions() AS DF`;

const fetchFunctions = typedQuery<NSDatabase.ISchema, NSDatabase.IFunction>(queryFactory<NSDatabase.ISchema>`
${functionSelectSql}
WHERE NOT DF.internal
  AND DF.database_name = ${p => quoteStringLiteral(catalogOf(p))}
  AND DF.schema_name = ${p => quoteStringLiteral(nameOf(p.schema, 'schema'))}
ORDER BY DF.function_name, DF.function_oid
`);

type SearchFunctionsParams = {
  search: string;
  parent?: NSDatabase.ParentItem;
  limit?: number;
};
const searchFunctions = typedQuery<SearchFunctionsParams, NSDatabase.IFunction>(queryFactory<SearchFunctionsParams>`
${functionSelectSql}
WHERE NOT DF.internal
${p => p.parent ? `AND DF.database_name = ${quoteStringLiteral(catalogOf(p.parent))}
  AND DF.schema_name = ${quoteStringLiteral(nameOf(p.parent.schema, 'schema'))}` : ''}
${p => typeof p.search === 'string' && p.search.length > 0
    ? `AND lower(DF.function_name) LIKE lower(${containsLike(p.search)}) ESCAPE '!'`
    : ''}
ORDER BY DF.function_name, DF.function_oid
LIMIT ${p => nonNegativeInteger(p.limit, 100, 'limit')}
`);

type SearchIndexesParams = {
  search: string;
  parent?: NSDatabase.ITable;
  limit?: number;
};
const searchIndexes = typedQuery<SearchIndexesParams, NSDatabase.IIndex>(queryFactory<SearchIndexesParams>`
SELECT
  DI.index_name AS label,
  DI.index_name AS name,
  DI.database_name AS database,
  DI.schema_name AS schema,
  DI.table_name AS "table",
  struct_pack(
    label := DI.table_name,
    database := DI.database_name,
    schema := DI.schema_name,
    type := '${ContextValue.TABLE}',
    isView := FALSE
  ) AS parent,
  '${ContextValue.INDEX}' AS type,
  '${ContextValue.NO_CHILD}' AS childType,
  'symbol-key' AS iconId,
  coalesce(DI.comment, CASE WHEN DI.is_unique THEN 'UNIQUE INDEX' ELSE 'INDEX' END) AS detail,
  DI.comment,
  DI.is_unique AS isUnique,
  DI.expressions,
  DI.sql
FROM duckdb_indexes() AS DI
WHERE 1 = 1
${p => p.parent ? `AND DI.database_name = ${quoteStringLiteral(catalogOf(p.parent))}
  AND DI.schema_name = ${quoteStringLiteral(nameOf(p.parent.schema, 'schema'))}
  AND DI.table_name = ${quoteStringLiteral(nameOf(p.parent.label, 'relation'))}` : ''}
${p => typeof p.search === 'string' && p.search.length > 0
    ? `AND lower(DI.index_name) LIKE lower(${containsLike(p.search)}) ESCAPE '!'`
    : ''}
ORDER BY DI.database_name, DI.schema_name, DI.index_name
LIMIT ${p => nonNegativeInteger(p.limit, 100, 'limit')}
`);

const fetchKeywords = typedQuery<Record<string, never>, MetadataChild>(queryFactory<Record<string, never>>`
SELECT
  upper(keyword_name) AS label,
  keyword_category AS detail,
  keyword_category AS category,
  '${ContextValue.KEYWORDS}' AS type
FROM duckdb_keywords()
ORDER BY keyword_name
`);

type DefinitionItem = {
  type: ContextValue;
  database?: string;
  schema?: string;
  label?: string;
  name?: string;
  parent?: {
    database?: unknown;
    schema?: unknown;
    label?: unknown;
  };
};

const definitionIdentity = (item: DefinitionItem) => {
  const parent = item.parent;
  return {
    database: catalogOf(parent || item),
    schema: nameOf(parent?.schema || item.schema, 'schema'),
    name: nameOf(item.name || item.label, 'object'),
  };
};

const fetchDefinition = (item: DefinitionItem): string => {
  const identity = definitionIdentity(item);
  const predicates = `database_name = ${quoteStringLiteral(identity.database)}
    AND schema_name = ${quoteStringLiteral(identity.schema)}`;

  switch (item.type) {
    case ContextValue.TABLE:
      return `SELECT sql FROM duckdb_tables() WHERE ${predicates}
        AND table_name = ${quoteStringLiteral(identity.name)} LIMIT 1`;
    case ContextValue.VIEW:
      return `SELECT sql FROM duckdb_views() WHERE ${predicates}
        AND view_name = ${quoteStringLiteral(identity.name)} LIMIT 1`;
    case ContextValue.INDEX:
      return `SELECT sql FROM duckdb_indexes() WHERE ${predicates}
        AND index_name = ${quoteStringLiteral(identity.name)} LIMIT 1`;
    case ContextValue.FUNCTION:
      return `SELECT CASE
          WHEN function_type IN ('macro', 'table_macro') THEN concat(
            'CREATE MACRO ',
            ${quoteStringLiteral(qualifiedName(identity.database, identity.schema, identity.name))},
            '(', array_to_string(coalesce(parameters, []::VARCHAR[]), ', '), ') AS ',
            CASE WHEN function_type = 'table_macro' THEN 'TABLE ' ELSE '' END,
            macro_definition,
            ';'
          )
          ELSE coalesce(macro_definition, concat(function_name, ' ', function_type))
        END AS sql
        FROM duckdb_functions()
        WHERE ${predicates}
          AND function_name = ${quoteStringLiteral(identity.name)}
        ORDER BY internal, function_oid
        LIMIT 1`;
    default:
      return 'SELECT NULL::VARCHAR AS sql WHERE FALSE';
  }
};

const snippetText = (value: string): string => value
  .replace(/\\/g, '\\\\')
  .replace(/\$/g, '\\$')
  .replace(/}/g, '\\}');

const insertQuery = (item: NSDatabase.ITable, columns: NSDatabase.IColumn[] = []): string => {
  const relation = snippetText(qualifiedRelationName(item));
  const selectedColumns = Array.isArray(columns) ? columns : [];
  if (selectedColumns.length === 0) {
    return `INSERT INTO ${relation} DEFAULT VALUES;`;
  }

  const names = selectedColumns.map(column => `  ${snippetText(quoteIdentifier(nameOf(column.label, 'column')))}`);
  const values = selectedColumns.map((column, index) => {
    const hint = snippetText(`${column.label}:${column.dataType}`);
    return `  '\${${index + 1}:${hint}}'`;
  });
  return `INSERT INTO ${relation} (\n${names.join(',\n')}\n) VALUES (\n${values.join(',\n')}\n);`;
};

export default {
  describeTable,
  countRecords,
  fetchColumns,
  fetchRecords,
  fetchTables,
  fetchViews,
  fetchSchemas,
  fetchDatabases,
  searchTables,
  searchColumns,
  fetchConstraints,
  fetchIndexes,
  fetchSequences,
  fetchTypes,
  fetchFunctions,
  searchFunctions,
  searchIndexes,
  fetchKeywords,
  fetchDefinition,
  insertQuery,
};
