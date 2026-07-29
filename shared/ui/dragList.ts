// HTML5 drag-to-reorder for one list — extracted from the settings
// screen's org editor so the Documents column chooser reorders the same
// way the org tree does.

/**
 * The row only becomes draggable while the pointer is on its handle (so
 * text/inputs inside stay selectable), `group` isolates lists from each
 * other, and the drop reorders `list` in place before `onDone` repaints.
 * Nested lists work because dragstart stops propagating at the row that
 * owns it.
 */
let dragState: { group: string; index: number } | null = null;

export function draggableRow(
  rowEl: HTMLElement,
  handle: HTMLElement,
  group: string,
  index: number,
  list: unknown[],
  onDone: () => void
): void {
  handle.addEventListener("pointerdown", () => {
    rowEl.draggable = true;
  });
  handle.addEventListener("pointerup", () => {
    rowEl.draggable = false;
  });
  rowEl.addEventListener("dragstart", (e) => {
    e.stopPropagation();
    dragState = { group, index };
    rowEl.classList.add("app-dragging");
    e.dataTransfer?.setData("text/plain", group); // Firefox needs payload
    if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
  });
  rowEl.addEventListener("dragend", () => {
    dragState = null;
    rowEl.draggable = false;
    rowEl.classList.remove("app-dragging");
  });
  const clearMarks = () => rowEl.classList.remove("app-drop-before", "app-drop-after");
  rowEl.addEventListener("dragover", (e) => {
    if (dragState === null || dragState.group !== group || dragState.index === index) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = rowEl.getBoundingClientRect();
    const after = e.clientY > rect.top + rect.height / 2;
    rowEl.classList.toggle("app-drop-after", after);
    rowEl.classList.toggle("app-drop-before", !after);
  });
  rowEl.addEventListener("dragleave", clearMarks);
  rowEl.addEventListener("drop", (e) => {
    if (dragState === null || dragState.group !== group) return;
    e.preventDefault();
    e.stopPropagation();
    clearMarks();
    const rect = rowEl.getBoundingClientRect();
    const after = e.clientY > rect.top + rect.height / 2;
    const from = dragState.index;
    let to = index + (after ? 1 : 0);
    if (from < to) to -= 1;
    dragState = null;
    if (from === to) return;
    const [moved] = list.splice(from, 1);
    list.splice(to, 0, moved);
    onDone();
  });
}
