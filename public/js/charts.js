import { el, icon } from "./ui.js";

const NS = "http://www.w3.org/2000/svg";

const svg = (name, attrs = {}) => {
  const node = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
};
const text = (x, y, content, cls) => {
  const node = svg("text", { x, y, class: cls });
  node.textContent = content;
  return node;
};

/*
  Charts are drawn here rather than pulled from a chart library: the server
  keeps one runtime dependency, and a bar chart is forty lines of SVG. The
  viewBox is fixed and the element scales, so a narrow phone gets the same
  proportions instead of a horizontally scrolling canvas.
*/
export function frequencyChart(buckets) {
  const W = 640, H = 200, padL = 30, padB = 26, padT = 14;
  const max = Math.max(1, ...buckets.map((b) => b.total));
  const step = (W - padL - 8) / buckets.length;
  const plot = H - padB;
  const node = svg("svg", { viewBox: `0 0 ${W} ${H}`, class: "chart", role: "img",
    "aria-label": `Deployment frequency by week, peak ${max} deploys` });

  for (const t of [0, 0.5, 1]) {
    const y = plot - t * (plot - padT);
    node.appendChild(svg("line", { x1: padL, x2: W - 4, y1: y, y2: y, class: t === 0 ? "axis" : "grid" }));
    node.appendChild(text(padL - 7, y + 3, String(Math.round(t * max)), "lbl"));
  }

  buckets.forEach((b, i) => {
    const x = padL + i * step;
    const w = Math.max(6, step - 7);
    const h = (b.total / max) * (plot - padT);
    const failH = b.total ? h * (b.failed / b.total) : 0;
    node.appendChild(svg("rect", { x, y: plot - (h - failH), width: w, height: Math.max(1, h - failH), rx: 2, class: "cbar" }));
    if (failH > 0.5) node.appendChild(svg("rect", { x, y: plot - h, width: w, height: failH, rx: 2, class: "cbar fail" }));
    node.appendChild(text(x + w / 2, plot - h - 4, String(b.total), "val"));
    if (i % 2 === 0) node.appendChild(text(x + w / 2, H - 8, b.week.slice(5), "lbl"));
  });
  node.appendChild(svg("line", { x1: padL, x2: W - 4, y1: plot, y2: plot, class: "axis" }));
  return node;
}

export function parityChart(rows) {
  const projects = [...new Set(rows.map((r) => r.project))];
  const W = 640, rowH = 30, padT = 6, padR = 96;
  const H = padT * 2 + projects.length * rowH;
  const node = svg("svg", { viewBox: `0 0 ${W} ${H}`, class: "chart", role: "img",
    "aria-label": "Version parity between SIT and UAT per project" });
  const palette = { same: "var(--ok)", diff: "var(--warn)", new: "var(--accent)" };

  projects.forEach((project, i) => {
    const mine = rows.filter((r) => r.project === project);
    const y = padT + i * rowH;
    node.appendChild(text(0, y + 17, project, "lbl"));
    let x = 92;
    const usable = W - padR - x;
    for (const state of ["same", "diff", "new"]) {
      const count = mine.filter((r) => r.state === state).length;
      if (!count) continue;
      const w = (count / mine.length) * usable;
      const rect = svg("rect", { x, y: y + 6, width: Math.max(2, w - 2), height: 12, rx: 3, fill: palette[state] });
      node.appendChild(rect);
      if (w > 22) node.appendChild(text(x + (w - 2) / 2, y + 16, String(count), "val"));
      x += w;
    }
    node.appendChild(text(W - padR + 10, y + 17, `${mine.filter((r) => r.state === "same").length}/${mine.length} in step`, "lbl"));
  });
  return node;
}

export function legend(items) {
  const node = el("div", "legend");
  for (const [cls, label] of items) {
    const span = el("span");
    const dot = el("i", cls);
    span.append(dot, document.createTextNode(label));
    node.appendChild(span);
  }
  return node;
}

// The same bar means two different things: a suite that missed one case is
// failing, a service at 87% coverage is not. The caller decides where the line
// sits instead of the component guessing.
export function passBar(value, total, { okAt = 100, warnAt = 90 } = {}) {
  const pct = total ? Math.round((value / total) * 100) : 0;
  const bar = el("span", "bar");
  const fill = el("i", pct >= okAt ? "ok" : pct >= warnAt ? "warn" : "bad");
  fill.style.width = `${pct}%`;
  bar.appendChild(fill);
  const wrap = el("span", "bar-cell");
  wrap.append(bar, el("span", "mono", `${pct}%`));
  return wrap;
}

export function spinner() {
  const node = el("div", "empty");
  node.append(icon("clock", 22), el("p", "dim", "loading"));
  return node;
}
