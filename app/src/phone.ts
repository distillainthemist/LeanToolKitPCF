// The phone frame's one window test (mobile review M1/M2, 2026-10-07).
// Screens that are never split — the board screen, the card walk — read
// the WINDOW; a pane that can be split (the register, the BoardGrid)
// reads its own width instead. The query matches style.css's frame
// block exactly.

export const PHONE_WINDOW_QUERY = "(max-width: 599px)";

export const isPhoneWindow = (): boolean =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia(PHONE_WINDOW_QUERY).matches;
