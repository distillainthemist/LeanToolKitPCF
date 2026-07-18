// Thin helpers over the generated Dataverse services — OData string
// escaping, first-match queries, and upsert-by-column emulation (the
// generated clients expose create/update by GUID; our tables carry
// alternate keys, so the store queries by the key column then creates or
// updates).

export interface ListResult<T> {
  data?: T[];
}

export interface OneResult<T> {
  data?: T;
}

/** Escape a value for an OData string literal. */
export function odata(value: string): string {
  return value.replace(/'/g, "''");
}

export function eq(column: string, value: string): string {
  return `${column} eq '${odata(value)}'`;
}

type GetAll<T> = (options?: {
  filter?: string;
  select?: string[];
  orderBy?: string[];
  top?: number;
}) => Promise<ListResult<T>>;

export async function firstWhere<T>(
  getAll: GetAll<T>,
  filter: string,
  select?: string[]
): Promise<T | null> {
  const result = await getAll({ filter, top: 1, select });
  return result.data?.[0] ?? null;
}

export async function allWhere<T>(
  getAll: GetAll<T>,
  filter?: string,
  select?: string[],
  orderBy?: string[]
): Promise<T[]> {
  const result = await getAll({ filter, select, orderBy });
  return result.data ?? [];
}

/**
 * Upsert emulation: find by filter; update the matched row's GUID or
 * create. Returns the row's GUID.
 */
export async function upsertWhere<TFields extends object, TRow>(
  // the generated services require FULL base types on create (statecode
  // etc. are marked required); never-typed params keep this helper
  // assignable while callers pass their typed sparse field objects
  service: {
    getAll: GetAll<TRow>;
    create: (record: never) => Promise<OneResult<TRow>>;
    update: (id: string, fields: never) => Promise<OneResult<TRow>>;
  },
  filter: string,
  idOf: (row: TRow) => string,
  fields: TFields
): Promise<string> {
  const existing = await firstWhere(service.getAll, filter);
  if (existing) {
    const id = idOf(existing);
    await service.update(id, fields as never);
    return id;
  }
  const created = await service.create(fields as never);
  const row = created.data;
  if (!row) throw new Error(`create returned no row for filter ${filter}`);
  return idOf(row);
}
