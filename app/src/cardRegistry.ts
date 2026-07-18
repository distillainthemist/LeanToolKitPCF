// Card registry — cardType → mount adapter. Each adapter is the CardHost
// pattern for one editor: parse the stored envelope, mount, and save
// (document + freshest tile svg) through the provided callback. The
// starter set covers the build-kit's prove-the-loop requirement; the
// remaining card types follow the same ~25-line shape.

import { Person } from "../../shared/schema/people";
import { Theme } from "../../shared/tokens";

import { KpiTrendEditor } from "../../controls/KpiTrendCard/editor";
import { parseKpiTrend, serializeKpiTrend } from "../../controls/KpiTrendCard/types";
import { SqdpcEditor } from "../../controls/SqdpcCard/editor";
import { parseSqdpc, serializeSqdpc } from "../../controls/SqdpcCard/types";
import { ConditionsEditor } from "../../controls/ConditionsCard/editor";
import { parseConditions, serializeConditions } from "../../controls/ConditionsCard/types";
import { FiveWhysEditor } from "../../controls/FiveWhys/editor";
import { parseFiveWhys, serializeFiveWhys } from "../../controls/FiveWhys/types";

export interface CardMount {
  host: HTMLElement;
  title: string;
  outputJson: string;
  people: Person[];
  theme: Theme;
  readOnly: boolean;
  /** Save the document + the freshest tile svg (debounced by the caller). */
  onSave: (outputJson: string, tileSvg: string) => void;
}

export type CardMounter = (opts: CardMount) => () => void;

/** Shared save plumbing: latest svg from onPngReady rides every save. */
function saver(opts: CardMount) {
  let svg = "";
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    onPng: (_uri: string, svgMarkup?: string) => {
      if (svgMarkup) svg = svgMarkup;
    },
    save: (outputJson: string) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => opts.onSave(outputJson, svg), 400);
    },
  };
}

const REGISTRY: Record<string, CardMounter> = {
  KpiTrendCard: (opts) => {
    const s = saver(opts);
    const editor = new KpiTrendEditor(opts.host, {
      onChange: (env) => s.save(serializeKpiTrend(env)),
      onPngReady: s.onPng,
    });
    editor.setTheme(opts.theme);
    editor.setChrome(opts.title, "");
    editor.setReadOnly(opts.readOnly);
    editor.setEnvelope(parseKpiTrend(opts.outputJson).envelope);
    return () => opts.host.replaceChildren();
  },
  SqdpcCard: (opts) => {
    const s = saver(opts);
    const editor = new SqdpcEditor(opts.host, {
      onChange: (env) => s.save(serializeSqdpc(env)),
      onPngReady: s.onPng,
    });
    editor.setTheme(opts.theme);
    editor.setChrome(opts.title, "");
    editor.setPeople(opts.people);
    editor.setReadOnly(opts.readOnly);
    editor.setEnvelope(parseSqdpc(opts.outputJson).envelope, []);
    return () => opts.host.replaceChildren();
  },
  ConditionsCard: (opts) => {
    const s = saver(opts);
    const editor = new ConditionsEditor(opts.host, {
      onChange: (env) => s.save(serializeConditions(env)),
      onPngReady: s.onPng,
    });
    editor.setTheme(opts.theme);
    editor.setChrome(opts.title, "");
    editor.setReadOnly(opts.readOnly);
    editor.setEnvelope(parseConditions(opts.outputJson).envelope, []);
    return () => opts.host.replaceChildren();
  },
  FiveWhys: (opts) => {
    const s = saver(opts);
    const editor = new FiveWhysEditor(opts.host, {
      onChange: (env) => s.save(serializeFiveWhys(env)),
      onPngReady: s.onPng,
    });
    editor.setTheme(opts.theme);
    editor.setChrome(opts.title, "");
    editor.setReadOnly(opts.readOnly);
    editor.setEnvelope(parseFiveWhys(opts.outputJson).envelope, []);
    return () => opts.host.replaceChildren();
  },
};

export function cardMounter(cardType: string): CardMounter | null {
  return REGISTRY[cardType] ?? null;
}

export function supportedCardTypes(): string[] {
  return Object.keys(REGISTRY);
}
