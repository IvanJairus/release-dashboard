import { make, icon } from "./ui.js";

export const LAYERS = ["team", "business", "product", "architecture", "engineering"];

export function kv(pairs) {
  const dl = make("dl", "kv");
  for (const [k, v] of pairs) {
    dl.append(make("dt", null, k), make("dd", null, v === null || v === undefined ? "n/a" : v));
  }
  return dl;
}

export function feed(items, emptyText) {
  const list = make("ul", "feed");
  if (!items.length) { list.appendChild(make("li", "dim", emptyText)); return list; }
  for (const { at, kind, actor, detail } of items) {
    list.appendChild(make("li", null, [
      make("span", "at", at),
      make("span", null, [make("b", null, kind), " ", make("span", "who", actor || "system"), detail ? `: ${detail}` : ""]),
    ]));
  }
  return list;
}

export function filters(items) {
  return make("div", "filters", [icon("filter"), ...items]);
}

export function label(text, control) {
  return make("label", "field", [make("span", null, text), control]);
}
