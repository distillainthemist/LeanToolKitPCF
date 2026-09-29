// Where the action dialog learns what an action may be linked to. The
// host registers ONE provider at boot (the app: rituals and initiatives
// the viewer may see); every dialog — a card's, the hub's, quick add's —
// reads it, so no control needs the list handed to it. No provider (a
// standalone control): the dialog shows no link field. Tiny on purpose —
// the shell imports it without pulling the dialog in.

import { LinkTarget } from "../schema/actionLinks";
import type { EndorseContext } from "../schema/actionEndorsement";

export interface ActionLinkContext {
  targets: LinkTarget[];
  /** The viewer — an unlinked action returns to their personal channel. */
  personalWho: string;
  /** The board on screen, null off the boards. */
  openBoardId: string | null;
  /** The card on screen as an instance key ("board:card"), "" when none —
   *  the home of an action raised there that carries no key yet. */
  openHome: string;
}

let provider: (() => Promise<ActionLinkContext>) | null = null;

export function setActionLinkProvider(p: (() => Promise<ActionLinkContext>) | null): void {
  provider = p;
}

export function actionLinkProvider(): (() => Promise<ActionLinkContext>) | null {
  return provider;
}

/** Fired after a save that moved an action to another home — the host
 *  showing the list it left refreshes. */
export const ACTION_MOVED_EVENT = "ltk-action-moved";

/** Who is using the app — the author of a comment written in the action
 *  dialog. The host registers it once; a standalone control passes
 *  `viewer` to the dialog instead, or comments are read-only there. */
let viewerProvider: (() => { whoId: string; who: string } | null) | null = null;

export function setActionViewerProvider(p: (() => { whoId: string; who: string } | null) | null): void {
  viewerProvider = p;
}

export function actionViewer(): { whoId: string; who: string } | null {
  try {
    return viewerProvider ? viewerProvider() : null;
  } catch {
    return null;
  }
}

/** Does closing this action need an endorsement, and may the viewer give
 *  it? Answered at once from what the host already knows (null = not on
 *  an initiative, or not known yet — the store applies the rule again at
 *  the write, so nothing slips through). */
let endorsementLookup: ((a: { initiativeId?: string; instanceId: string }) => EndorseContext | null) | null = null;

export function setEndorsementLookup(f: ((a: { initiativeId?: string; instanceId: string }) => EndorseContext | null) | null): void {
  endorsementLookup = f;
}

export function endorsementFor(a: { initiativeId?: string; instanceId: string }): EndorseContext | null {
  try {
    return endorsementLookup ? endorsementLookup(a) : null;
  } catch {
    return null;
  }
}

/** Fired when the endorsement rule changed an action at the write (a
 *  closing road that could not apply it itself) — open lists refresh. */
export const ACTION_RULED_EVENT = "ltk-action-ruled";
