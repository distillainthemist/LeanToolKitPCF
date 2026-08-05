// Thin helpers over the generated Dataverse services — OData string
// escaping, first-match queries, and upsert-by-column emulation (the
// generated clients expose create/update by GUID; our tables carry
// alternate keys, so the store queries by the key column then creates or
// updates).

export interface ListResult<T> {
  /** The SDK's IOperationResult flag. A REFUSED call resolves with
   *  success:false — it does not reject. */
  success?: boolean;
  data?: T[];
  error?: { message?: string };
}

export interface OneResult<T> {
  success?: boolean;
  data?: T;
  error?: { message?: string };
}

/**
 * Refuse to read failure as emptiness. A denied Dataverse call RESOLVES
 * with success:false, so `result.data ?? []` turns "permission denied"
 * into an empty table — which is how a user missing a table privilege
 * saw "Standard documents haven't been set up yet" instead of the real
 * refusal (production, 2026-08-05). Only an explicit false throws;
 * absent means a source that never reports the flag.
 */
function settle<R extends { success?: boolean; error?: { message?: string } }>(
  result: R,
  what: string
): R {
  if (result.success === false) {
    throw new Error(
      `Dataverse ${what} failed: ${result.error?.message ?? "unknown error"}`
    );
  }
  return result;
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
  const result = settle(await getAll({ filter, top: 1, select }), "read");
  return result.data?.[0] ?? null;
}

export async function allWhere<T>(
  getAll: GetAll<T>,
  filter?: string,
  select?: string[],
  orderBy?: string[]
): Promise<T[]> {
  const result = settle(await getAll({ filter, select, orderBy }), "read");
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
    settle(await service.update(id, fields as never), "update");
    return id;
  }
  const created = settle(await service.create(fields as never), "create");
  const row = created.data;
  if (!row) throw new Error(`create returned no row for filter ${filter}`);
  return idOf(row);
}
