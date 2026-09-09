// A KPI card's value-driver link (P9e): on an `init-` board, the slot's
// metric key → the initiative's metric → a DRIVES link → the driver. The
// card then reads/writes the driver's ONE series at the driver's cadence.

import { listInitiatives } from "../../store/initiatives";
import { listDrivers } from "../../store/valueDrivers";
import { Aggregate, Cadence, CADENCE_LABELS, DriverTracking, NodeFormat } from "./model";

export interface CardDriverLink {
  driverId: string;
  name: string;
  unit: string;
  cadence: Cadence;
  cadenceLabel: string;
  /** What the grid needs of the driver (grid entry, 2026-09-08). */
  node: { id: string; cadence: Cadence; aggregate: Aggregate; unit: string; format: NodeFormat; tracking: DriverTracking };
}

/** A card's own link, saved in its slot settings (any board, Ben
 *  2026-09-08: a meeting-board KPI card as a window onto a driver). */
export interface SlotDriverLink {
  site: string;
  driverId: string;
}

export function slotDriverLink(settings: Record<string, unknown>): SlotDriverLink | null {
  const d = settings.driver;
  if (!d || typeof d !== "object") return null;
  const o = d as Record<string, unknown>;
  return typeof o.driverId === "string" && o.driverId !== "" && typeof o.site === "string" ? { site: o.site, driverId: o.driverId } : null;
}

function linkOf(n: { id: string; name: string; unit: string; cadence: Cadence; aggregate: Aggregate; format: NodeFormat; tracking: DriverTracking }): CardDriverLink {
  return { driverId: n.id, name: n.name, unit: n.unit, cadence: n.cadence, cadenceLabel: CADENCE_LABELS[n.cadence], node: { id: n.id, cadence: n.cadence, aggregate: n.aggregate, unit: n.unit, format: n.format, tracking: n.tracking } };
}

/** The driver a KPI card shows: its slot's own link first, else (on an
 *  initiative board) the metric's DRIVES link. */
export async function driverLinkForCard(boardId: string, metricKey: string, settings: Record<string, unknown> = {}): Promise<CardDriverLink | null> {
  const own = slotDriverLink(settings);
  if (own) {
    const n = (await listDrivers(own.site)).find((x) => x.id === own.driverId) ?? null;
    return n ? linkOf(n) : null;
  }
  if (!boardId.startsWith("init-") || metricKey === "") return null;
  const i = (await listInitiatives()).find((x) => x.boardId === boardId) ?? null;
  const m = i?.metrics.find((x) => x.key === metricKey) ?? null;
  if (!i || !m || !m.driverId || m.driverLink === "leads") return null;
  const n = (await listDrivers(i.org.site)).find((x) => x.id === m.driverId) ?? null;
  return n ? linkOf(n) : null;
}
