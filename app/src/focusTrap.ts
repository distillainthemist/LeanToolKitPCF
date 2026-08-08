// Moved to shared/ui so the toolkit's dialog can trap focus too
// (Ben, 2026-08-08: dialogs must not dismiss on a stray click). This
// shim keeps the app's existing importers working unchanged.

export { markDialog, trapFocus } from "../../shared/ui/focusTrap";
