// Host detection + viewer identity. Inside Power Apps the SDK context
// carries the signed-in user's Entra object id (= ben_ltkpeople.whoid);
// on a bare dev server there is no host, and the app runs in demo mode.

import { getContext } from "@microsoft/power-apps/app";
import { setAppHost } from "./links";

export interface Viewer {
  objectId: string;
  name: string;
  email: string;
}

let hosted: boolean | null = null;
let viewer: Viewer | null = null;

export async function detectHost(): Promise<boolean> {
  if (hosted !== null) return hosted;
  try {
    const context = await Promise.race([
      getContext(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 2500)),
    ]);
    const user = context.user;
    if (user?.objectId) {
      // the shareable-link builder needs the app's own identity
      setAppHost({
        appId: context.app?.appId ?? "",
        environmentId: context.app?.environmentId ?? "",
        tenantId: user.tenantId ?? "",
        queryParams: context.app?.queryParams ?? {},
      });
      viewer = {
        objectId: user.objectId,
        name: user.fullName ?? user.userPrincipalName ?? "Me",
        email: user.userPrincipalName ?? "",
      };
      hosted = true;
      return true;
    }
  } catch {
    /* no host — demo mode */
  }
  hosted = false;
  return false;
}

export function currentViewer(): Viewer | null {
  return viewer;
}

/**
 * Re-read the host context's launch parameters (5I resume): a deep link
 * into an ALREADY-RUNNING mobile app foregrounds it without a boot, so
 * the only chance of seeing the new scan is asking the host again when
 * visibility returns. Harmless when the host answers with stale
 * parameters — the caller dedupes against what it already handled.
 */
export async function refreshHostParams(): Promise<void> {
  if (hosted !== true) return;
  try {
    const context = await Promise.race([
      getContext(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 2500)),
    ]);
    const user = context.user;
    if (user?.objectId) {
      setAppHost({
        appId: context.app?.appId ?? "",
        environmentId: context.app?.environmentId ?? "",
        tenantId: user.tenantId ?? "",
        queryParams: context.app?.queryParams ?? {},
      });
    }
  } catch {
    /* keep the params we had */
  }
}
