// Host detection + viewer identity. Inside Power Apps the SDK context
// carries the signed-in user's Entra object id (= ben_ltkpeople.whoid);
// on a bare dev server there is no host, and the app runs in demo mode.

import { getContext } from "@microsoft/power-apps/app";

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
