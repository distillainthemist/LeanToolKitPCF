// Where the action dialog learns what an action may be linked to. The
// host registers ONE provider at boot (the app: rituals and initiatives
// the viewer may see); every dialog — a card's, the hub's, quick add's —
// reads it, so no control needs the list handed to it. No provider (a
// standalone control): the dialog shows no link field. Tiny on purpose —
// the shell imports it without pulling the dialog in.

import { LinkTarget } from "../schema/actionLinks";

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
