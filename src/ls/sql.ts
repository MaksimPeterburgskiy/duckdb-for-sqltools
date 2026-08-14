type RelationIdentity = {
  database?: unknown;
  schema?: unknown;
  label?: unknown;
};

function requireName(value: unknown, part: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`Missing ${part} name`);
  }

  return value;
}

/** Quote a DuckDB identifier, including embedded double quotes. */
export function quoteIdentifier(identifier: string): string {
  return `"${requireName(identifier, 'identifier').replace(/"/g, '""')}"`;
}

/** Quote a SQL string literal, including embedded single quotes. */
export function quoteStringLiteral(value: string): string {
  if (typeof value !== 'string') {
    throw new TypeError('SQL string literal values must be strings');
  }

  return `'${value.replace(/'/g, "''")}'`;
}

/** Escape text used inside LIKE with `!` as the explicit escape character. */
export function escapeLikePattern(value: string): string {
  if (typeof value !== 'string') {
    throw new TypeError('LIKE pattern values must be strings');
  }

  return value.replace(/!/g, '!!').replace(/%/g, '!%').replace(/_/g, '!_');
}

/** Build the quoted pattern for a literal substring match. Add `ESCAPE '!'` after LIKE. */
export function containsLike(value: string): string {
  return quoteStringLiteral(`%${escapeLikePattern(value)}%`);
}

/** Validate LIMIT/OFFSET values before interpolating them into SQL. */
export function nonNegativeInteger(
  value: unknown,
  fallback: number,
  name = 'value',
): number {
  const candidate = value ?? fallback;
  const numeric = typeof candidate === 'string' && /^\d+$/.test(candidate)
    ? Number(candidate)
    : candidate;

  if (
    typeof numeric !== 'number'
    || !Number.isSafeInteger(numeric)
    || numeric < 0
  ) {
    throw new RangeError(`${name} must be a non-negative safe integer`);
  }

  return numeric;
}

/** Build a fully qualified DuckDB catalog.schema.object identifier. */
export function qualifiedName(catalog: string, schema: string, object: string): string {
  return [catalog, schema, object].map(quoteIdentifier).join('.');
}

/** Read SQLTools' relation identity and require all three qualification parts. */
export function qualifiedRelationName(relation?: RelationIdentity): string {
  if (!relation || typeof relation !== 'object') {
    throw new TypeError('A catalog-qualified SQLTools relation is required');
  }

  return qualifiedName(
    requireName(relation.database, 'catalog'),
    requireName(relation.schema, 'schema'),
    requireName(relation.label, 'relation'),
  );
}
