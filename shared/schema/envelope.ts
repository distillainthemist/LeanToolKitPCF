// The LeanToolKit envelope — the shape of every inputJSON / outputJSON:
//
//   { "schema": "ltk/<component>@1",
//     "meta": { "title": "...", "updated": "<iso>" },
//     "data": { ...component specific... } }
//
// Actions travel on their OWN channel (actionsInputJSON / actionsOutputJSON,
// see actions.ts) so they can feed a central Dataverse actions table keyed by
// instanceId — the card document stays a layout/content blob. For migration,
// parseEnvelope still ACCEPTS a legacy embedded `actions` array and hands it
// back separately; serializeEnvelope never emits one.
//
// serializeEnvelope is deterministic (meta.updated is emitted verbatim, the
// editor stamps it on each edit) so loaded state can be string-compared
// against emitted state — that comparison is the echo-loop guard.
//
// Parsers are defensive and never throw.

import { LtkAction, parseActions } from "./actions";

export interface EnvelopeMeta {
  title: string;
  updated: string;
}

export interface Envelope<TData> {
  schema: string;
  meta: EnvelopeMeta;
  data: TData;
}

export interface ParsedEnvelope<TData> {
  envelope: Envelope<TData>;
  /** Actions found embedded in a legacy combined document, if any. */
  embeddedActions: LtkAction[];
}

/**
 * Parse an envelope. `parseData` turns the raw data value (or, for forgiving
 * migration, the whole raw document when no envelope wrapper is present) into
 * the component's model — it must itself be defensive.
 */
export function parseEnvelope<TData>(
  raw: string | null | undefined,
  schemaId: string,
  parseData: (data: unknown) => TData
): ParsedEnvelope<TData> {
  const empty: ParsedEnvelope<TData> = {
    envelope: {
      schema: schemaId,
      meta: { title: "", updated: "" },
      data: parseData(undefined),
    },
    embeddedActions: [],
  };
  const t = (raw ?? "").trim();
  if (t === "") return empty;
  try {
    const doc = JSON.parse(t) as unknown;
    if (!doc || typeof doc !== "object") return empty;
    const d = doc as {
      schema?: unknown;
      meta?: unknown;
      data?: unknown;
      actions?: unknown;
    };
    // Enveloped document
    if (typeof d.schema === "string" && "data" in d) {
      const meta = (d.meta ?? {}) as Partial<EnvelopeMeta>;
      return {
        envelope: {
          schema: schemaId, // always emit our own current schema id
          meta: {
            title: typeof meta.title === "string" ? meta.title : "",
            updated: typeof meta.updated === "string" ? meta.updated : "",
          },
          data: parseData(d.data),
        },
        embeddedActions: parseActions(d.actions),
      };
    }
    // Bare document (no wrapper) — treat the whole thing as data.
    return {
      envelope: { ...empty.envelope, data: parseData(doc) },
      embeddedActions: parseActions(d.actions),
    };
  } catch {
    return empty;
  }
}

export function serializeEnvelope<TData>(env: Envelope<TData>): string {
  return JSON.stringify({
    schema: env.schema,
    meta: { title: env.meta.title, updated: env.meta.updated },
    data: env.data,
  });
}
