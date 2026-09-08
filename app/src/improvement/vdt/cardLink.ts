// A KPI card's value-driver link (P9e): on an `init-` board, the slot's
// metric key → the initiative's metric → a DRIVES link → the driver. The
// card then reads/writes the driver's ONE series at the driver's cadence.

import { listInitiatives } from "../../store/initiatives";
import { listDrivers } from "../../store/valueDrivers";
import { Aggregate, Cadence, CADENCE_LABELS, NodeFormat } from "./model";

export interface CardDriverLink {
  driverId: string;
  name: string;
  unit: string;
  cadence: Cadence;
  cadenceLabel: string;
  /** What the grid needs of the driver (grid entry, 2026-09-08). */
  node: { id: string; cadence: Cadence; aggregate: Aggregate; unit: string; format: NodeFormat };
}

export async function driverLinkForCard(boardId: string, metricKey: string): Promise<CardDriverLink | null> {
  if (!boardId.startsWith("init-") || metricKey === "") return null;
  const i = (await listInitiatives()).find((x) => x.boardId === boardId) ?? null;
  const m = i?.metrics.find((x) => x.key === metricKey) ?? null;
  if (!i || !m || !m.driverId || m.driverLink === "leads") return null;
  const n = (await listDrivers(i.org.site)).find((x) => x.id === m.driverId) ?? null;
  if (!n) return null;
  return { driverId: n.id, name: n.name, unit: n.unit, cadence: n.cadence, cadenceLabel: CADENCE_LABELS[n.cadence], node: { id: n.id, cadence: n.cadence, aggregate: n.aggregate, unit: n.unit, format: n.format } };
}
