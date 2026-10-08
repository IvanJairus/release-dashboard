import { api } from "../api.js";
import { make, panel, badge, button, table, empty, stamp } from "../ui.js";
import { LAYERS } from "../parts.js";

export const meta = { title: "Board", subtitle: "Every card moves through validated transitions — a refusal says why" };

const PHASES = [
  ["intake", "Intake"],
  ["in-dev", "In development"],
  ["in-review", "In review"],
  ["merged", "Merged"],
  ["deployed", "Deployed"],
];

const ACTIONS = {
  intake: [["startDevelopment", "Start development"]],
  "in-dev": [["openMergeRequest", "Open merge request"]],
  "in-review": [["merge", "Merge"]],
  merged: [["deploy", "Deploy to SIT"]],
  deployed: [],
};

export async function render(ctx) {
  const { tickets } = await api.get("/api/tickets");
  const { ledger } = await api.get("/api/promotions");

  const card = (ticket) => {
    const granted = LAYERS.filter((l) => (ticket.approvals || {})[l]);
    const node = make("div", "card", [
      make("h4", null, `#${ticket.id} · ${ticket.title}`),
      make("div", "meta", [
        make("span", "mono", ticket.service),
        make("span", "mono", `r${ticket.revision}`),
        ticket.releaseTag && badge(ticket.releaseTag, "mono"),
        ticket.mergeRequest && make("span", "mono", ticket.mergeRequest),
      ]),
      make("div", "chips", ticket.phase === "in-review" || granted.length
        ? [make("span", "faint", "approvals "), ...granted.map((l) => make("span", "chip on", l)),
           ...LAYERS.filter((l) => !granted.includes(l)).map((l) => make("span", "chip", l))]
        : []),
    ]);

    const row = make("div", "row");
    for (const [action, label] of ACTIONS[ticket.phase] || []) {
      row.appendChild(button(label, { small: true, kind: "primary", onClick: run(ticket, action, node) }));
    }
    if (ctx.can("ticket:comment")) {
      for (const layer of LAYERS) {
        if (granted.includes(layer) || !ctx.can(`approval:grant:${layer}`)) continue;
        row.appendChild(button(layer, { small: true, iconName: "check", onClick: approve(ticket, layer, node) }));
      }
    }
    if (row.childNodes.length) node.appendChild(row);
    return node;
  };

  const refuse = (node, message) => {
    let note = node.querySelector(".reason");
    if (!note) { note = make("p", "reason"); node.appendChild(note); }
    note.textContent = message;
  };

  function run(ticket, action, node) {
    return async (event) => {
      event.target.closest("button").disabled = true;
      try {
        await api.post(`/api/tickets/${ticket.id}/actions/${action}`, { expectedRevision: ticket.revision });
        ctx.reload();
      } catch (err) {
        refuse(node, err.refused || err.message);
        event.target.closest("button").disabled = false;
      }
    };
  }

  function approve(ticket, layer, node) {
    return async (event) => {
      event.target.closest("button").disabled = true;
      try {
        await api.post(`/api/tickets/${ticket.id}/approvals/${layer}`);
        ctx.reload();
      } catch (err) {
        refuse(node, err.refused || err.message);
        event.target.closest("button").disabled = false;
      }
    };
  }

  const board = make("div", "board", PHASES.map(([phase, label]) => {
    const mine = tickets.filter((t) => t.phase === phase);
    return make("div", "column", [
      make("h3", null, [make("span", null, label), make("span", "count", String(mine.length))]),
      ...mine.map(card),
      mine.length ? null : make("p", "faint", "empty"),
    ]);
  }));

  const latest = ledger.slice().reverse().slice(0, 40);
  return make("div", "stack", [
    panel("Release board", { sub: `${tickets.length} tickets`, body: make("div", "board-scroll", board) }),
    panel("Promotion ledger", {
      sub: `${ledger.length} recorded, newest ${latest.length}`,
      flush: true,
      body: ledger.length
        ? table([
          { head: "Release", className: "mono", render: (e) => e.releaseTag },
          { head: "Environment", render: (e) => badge(e.env, "mono") },
          { head: "Result", render: (e) => badge(e.result) },
          { head: "Actor", className: "mono", render: (e) => e.actor },
          { head: "When", className: "mono nowrap", render: (e) => stamp(e.at) },
        ], latest, { scroll: true })
        : empty("inbox", "Nothing has been promoted in this session", "The ledger starts empty by design."),
      note: "A rung opens only if the tag already succeeded one level below, and never to the person who ran the rung before.",
    }),
  ]);
}
