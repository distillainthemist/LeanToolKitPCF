// Shared card-save plumbing: latest svg from onPngReady rides every save.
// Editors snapshot AFTER they emit the change, so a fresh svg arriving
// once the debounced save has fired would otherwise be lost (the tile
// stayed one edit behind) — it reschedules a save with the latest
// document instead. Lives in its own module (not cardRegistry) so tests
// can import it without dragging the Power Apps SDK into node.

export function saver(opts: {
  onSave: (outputJson: string, tileSvg: string) => void;
}) {
  let svg = "";
  let latestJson: string | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const fire = () => {
    if (latestJson !== null) opts.onSave(latestJson, svg);
  };
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(fire, 400);
  };
  return {
    onPng: (_uri: string, svgMarkup?: string) => {
      if (svgMarkup && svgMarkup !== svg) {
        svg = svgMarkup;
        if (latestJson !== null) schedule(); // freshest snapshot always lands
      }
    },
    save: (outputJson: string) => {
      latestJson = outputJson;
      schedule();
    },
  };
}
