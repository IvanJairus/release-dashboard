const NS = "http://www.w3.org/2000/svg";

const PATHS = {
  grid: ["M4 5h6v6H4z", "M14 5h6v6h-6z", "M4 13h6v6H4z", "M14 13h6v6h-6z"],
  board: ["M4 5h4v14H4z", "M10 5h4v10h-4z", "M16 5h4v7h-4z"],
  bolt: ["M13 3 5 13h6l-1 8 8-10h-6z"],
  box: ["M12 3 4 7v10l8 4 8-4V7z", "M4 7l8 4 8-4", "M12 11v10"],
  shield: ["M12 3 5 6v6c0 4 3 7 7 9 4-2 7-5 7-9V6z", "M9 12l2 2 4-4"],
  check: ["M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z", "M8 12l3 3 5-6"],
  key: ["M16 5a3 3 0 1 1 0 6 3 3 0 0 1 0-6z", "M13.8 10.2 4 20", "M7 17l2 2", "M9.5 14.5l2 2"],
  gear: ["M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z", "M12 8.5V4", "M12 20v-4.5", "M8.5 12H4", "M20 12h-4.5", "M14.5 9.5l2.8-2.8", "M6.7 17.3l2.8-2.8", "M9.5 14.5l-2.8 2.8", "M17.3 6.7l-2.8 2.8"],
  refresh: ["M20 12a8 8 0 1 1-2.4-5.7", "M20 4v4h-4"],
  chevron: ["M6 9l6 6 6-6"],
  clock: ["M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z", "M12 8v4.5l3 1.8"],
  info: ["M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z", "M12 11v5", "M12 7.6v.01"],
  alert: ["M12 4l9 16H3z", "M12 10v4", "M12 16.9v.01"],
  play: ["M8 5l11 7-11 7z"],
  up: ["M12 19V5", "M6 11l6-6 6 6"],
  user: ["M12 4a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7z", "M5 20c0-3.6 3.1-5.6 7-5.6s7 2 7 5.6"],
  inbox: ["M4 13h4l1 3h6l1-3h4", "M4 13l2.6-8h10.8L20 13v6H4z"],
  logout: ["M10 5H5v14h5", "M16 12H10", "M13 9l3 3-3 3"],
  plus: ["M12 5v14", "M5 12h14"],
  filter: ["M4 5h16l-6 7v6l-4 2v-8z"],
};

export function icon(name, size = 16) {
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.7");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  for (const d of PATHS[name] || []) {
    const path = document.createElementNS(NS, "path");
    path.setAttribute("d", d);
    svg.appendChild(path);
  }
  return svg;
}

export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

// One place decides that a node gets children, so a view never builds markup
// out of strings - the CSP forbids inline script, and textContent everywhere
// is what makes that rule easy to keep.
export function fill(node, ...children) {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) fill(node, ...child);
    else node.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function make(tag, className, children, attrs) {
  const node = el(tag, className);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v === true) node.setAttribute(k, "");
    else if (v !== false && v !== undefined) node.setAttribute(k, String(v));
  }
  return fill(node, children);
}

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function stamp(iso) {
  if (!iso) return "never";
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]}, ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

export function ago(iso, now = Date.now()) {
  if (!iso) return "never";
  const mins = Math.max(0, Math.round((now - Date.parse(iso)) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function duration(seconds) {
  if (seconds === null || seconds === undefined) return "n/a";
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}

export const BADGE = {
  passed: "ok", success: "ok", ready: "ok", ok: "ok", same: "ok", healthy: "ok",
  warn: "warn", diff: "warn", due: "warn", pending: "warn", draft: "warn",
  failed: "bad", blocked: "bad", overdue: "bad", refused: "bad",
  new: "info", merged: "info", deployed: "info",
};

export function badge(value, kind) {
  return make("span", `badge ${kind || BADGE[value] || ""}`, String(value));
}

export function panel(title, { sub, right, body, flush, note } = {}) {
  const head = make("div", "panel-head", [
    make("h2", null, title),
    sub && make("span", "sub", sub),
    right && fill(make("span", "spacer"), right),
  ]);
  return make("section", "panel", [
    (title || right) && head,
    body && make("div", `panel-body${flush ? " flush" : ""}`, body),
    note && make("div", "panel-body", make("p", "dim", note)),
  ]);
}

export function callout(kind, iconName, content) {
  return make("p", `callout${kind ? ` ${kind}` : ""}`, [icon(iconName), make("span", null, content)]);
}

export function metric(k, n, d, cls) {
  return make("div", "metric", [
    make("div", "k", k),
    make("div", `n${cls ? ` ${cls}` : ""}`, n),
    d && make("div", "d", d),
  ]);
}

export function empty(iconName, title, hint) {
  return make("div", "empty", [icon(iconName, 26), make("p", "n", title), hint && make("p", "dim", hint)]);
}

export function button(label, { kind = "", small, iconName, onClick, type = "button", disabled, title } = {}) {
  const node = make("button", `btn${kind ? ` ${kind}` : ""}${small ? " small" : ""}`, [
    iconName && icon(iconName), label && document.createTextNode(label),
  ], { type, title: title || undefined });
  if (onClick) node.addEventListener("click", onClick);
  node.disabled = !!disabled;
  return node;
}

export function tabs(items, active, onSelect) {
  const list = make("div", "tabs", null, { role: "tablist" });
  for (const [id, label] of items) {
    const tab = make("button", "tab", label, { type: "button", role: "tab", "aria-selected": String(id === active) });
    tab.addEventListener("click", () => onSelect(id));
    list.appendChild(tab);
  }
  return list;
}

export function select(labelText, options, value, onChange, attrs = {}) {
  const node = make("select", null, options.map(([v, t]) => make("option", null, t, { value: v })), attrs);
  node.value = value;
  node.addEventListener("change", () => onChange(node.value));
  if (!labelText) return node;
  return make("label", "field", [make("span", null, labelText), node]);
}

/*
  Tables are built from a column spec rather than hand-written per view: every
  column declares how it renders, so alignment, empty cells and the accessible
  header text cannot drift apart between views.
*/
export function table(columns, rows, { onRow, scroll } = {}) {
  const head = make("tr", null, columns.map((c) =>
    make("th", c.num ? "num" : null, c.head)));
  const body = make("tbody", null, rows.map((row) => {
    const tr = make("tr", onRow ? "row-toggle" : null, columns.map((c) => {
      const value = c.render(row);
      const td = make("td", c.className);
      if (value instanceof Node) td.appendChild(value);
      else if (value === undefined || value === null) td.textContent = "n/a";
      else td.textContent = String(value);
      return td;
    }), onRow ? { "aria-expanded": "false", tabindex: "0" } : undefined);
    if (onRow) {
      tr.addEventListener("click", () => onRow(row, tr));
      tr.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onRow(row, tr); } });
    }
    return tr;
  }));
  return make("div", `table-wrap${scroll ? " scroll-y" : ""}`, make("table", "data", [make("thead", null, head), body]));
}

export function detailRow(cols) {
  return make("tr", "detail", make("td", null, make("dl", null, cols.flatMap(([k, v]) => [
    make("dt", null, k), make("dd", null, v ?? "n/a"),
  ]))));
}

export function toast(host, message, kind = "") {
  const node = make("div", `toast${kind ? ` ${kind}` : ""}`, message, { role: "status" });
  host.appendChild(node);
  setTimeout(() => {
    node.classList.add("out");
    setTimeout(() => node.remove(), 320);
  }, 3600);
}
