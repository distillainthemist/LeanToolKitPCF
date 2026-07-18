// Card screen (Phase 1 proof) — one board card mounted by the same
// pattern every card will use in Phase 4: editor class + object setters +
// store callbacks. Fishbone is the demonstrator.

import { FishboneEditor } from "../../../controls/Fishbone/editor";
import { emptyModel } from "../../../controls/Fishbone/model";
import { editorHost } from "../cardHost";

export function mountCard(parent: HTMLElement): () => void {
  const host = editorHost(parent);
  const editor = new FishboneEditor(host as HTMLDivElement, {
    onChange: (model) => console.log("store: save card document", model),
    onPngReady: () => undefined,
  });
  const model = emptyModel();
  model.problem = "Label misfeed on Line 1";
  editor.setModel(model);
  return () => host.remove();
}
