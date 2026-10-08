"use strict";

/*
  No framework on purpose: the board is a list, a few buttons and one open
  connection. Anything heavier would need its own supply-chain story, and this
  file is the part a reviewer reads to see what the API actually guarantees.
*/

const PHASES = ["intake", "in-dev", "in-review", "merged", "deployed"];

const ACTIONS = {
  intake: [{ action: "startDevelopment", label: "start development" }],
  "in-dev": [{ action: "openMergeRequest", label: "open merge request" }],
  "in-review": [{ action: "merge", label: "merge" }],
  merged: [{ action: "deploy", label: "deploy to SIT" }],
  deployed: [],
};

const LAYERS = ["team", "business", "product", "architecture", "engineering"];

async function api(path, options) {
  const res = await fetch(path, {
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    ...options,
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error((body && (body.error || body.message)) || `http ${res.status}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function startLogin() {
  const form = document.getElementById("login");
  const error = document.getElementById("error");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    error.hidden = true;
    try {
      await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: form.email.value, password: form.password.value }),
      });
      location.href = "/";
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
    }
  });
}

function ticketCard(ticket, onAct, onApprove) {
  const card = el("div", "ticket");
  card.appendChild(el("h3", null, `#${ticket.id} ${ticket.title}`));
  card.appendChild(el("p", "meta", `${ticket.service} · r${ticket.revision}${ticket.releaseTag ? " · " + ticket.releaseTag : ""}`));

  const granted = LAYERS.filter((l) => (ticket.approvals || {})[l]);
  card.appendChild(el("p", "meta", granted.length ? `approved: ${granted.join(" · ")}` : "no approvals yet"));

  const actions = el("div", "actions");
  for (const a of ACTIONS[ticket.phase] || []) {
    const button = el("button", null, a.label);
    button.type = "button";
    button.addEventListener("click", () => onAct(ticket, a.action, button));
    actions.appendChild(button);
  }
  if (ticket.phase === "in-review") {
    for (const layer of LAYERS) {
      if (granted.includes(layer)) continue;
      const button = el("button", "ghost", `approve: ${layer}`);
      button.type = "button";
      button.addEventListener("click", () => onApprove(ticket, layer, button));
      actions.appendChild(button);
    }
  }
  card.appendChild(actions);
  return card;
}

async function startBoard() {
  const board = document.getElementById("board");
  const who = document.getElementById("who");
  const live = document.getElementById("live");
  const ledger = document.getElementById("ledger");

  const me = await api("/api/auth/whoami").catch(() => null);
  if (!me) { location.href = "/login.html"; return; }
  who.textContent = `${me.email} · ${me.role}`;
  document.getElementById("signout").addEventListener("click", async () => {
    await api("/api/auth/logout", { method: "POST" });
    location.href = "/login.html";
  });

  let tickets = [];

  const render = () => {
    board.replaceChildren();
    for (const phase of PHASES) {
      const column = el("div", "col");
      column.appendChild(el("h2", null, phase));
      for (const ticket of tickets.filter((t) => t.phase === phase)) {
        column.appendChild(ticketCard(ticket, act, approve));
      }
      board.appendChild(column);
    }
  };

  const reload = async () => {
    tickets = (await api("/api/tickets")).tickets;
    render();
    const promotions = await api("/api/promotions").catch(() => ({ ledger: [] }));
    ledger.replaceChildren(...(promotions.ledger || []).map((e) =>
      el("li", null, `${e.releaseTag} → ${e.env} · ${e.result} · ${e.actor}`)));
  };

  // A refusal is rendered on the card that caused it: the reason is the point
  // of the guard, and hiding it behind a toast teaches nothing.
  const act = async (ticket, action, button) => {
    button.disabled = true;
    try {
      await api(`/api/tickets/${ticket.id}/actions/${action}`, {
        method: "POST",
        body: JSON.stringify({ expectedRevision: ticket.revision }),
      });
      await reload();
    } catch (err) {
      showReason(button, err.body && err.body.refused ? err.body.refused.message : err.message);
      button.disabled = false;
    }
  };

  const approve = async (ticket, layer, button) => {
    button.disabled = true;
    try {
      await api(`/api/tickets/${ticket.id}/approvals/${layer}`, { method: "POST" });
      await reload();
    } catch (err) {
      showReason(button, err.message);
      button.disabled = false;
    }
  };

  const stream = new EventSource("/api/stream");
  stream.addEventListener("open", () => { live.textContent = "live"; live.classList.add("on"); });
  stream.addEventListener("error", () => { live.textContent = "reconnecting"; live.classList.remove("on"); });
  stream.addEventListener("ticket", reload);
  stream.addEventListener("approval", reload);
  stream.addEventListener("refused", (e) => {
    const data = JSON.parse(e.data);
    live.textContent = `refused ${data.ticket}: ${data.code}`;
  });

  function showReason(button, message) {
    const card = button.closest(".ticket");
    let note = card.querySelector(".reason");
    if (!note) { note = el("p", "reason"); card.appendChild(note); }
    note.textContent = message;
  }

  await reload();
}

window.startLogin = startLogin;
window.startBoard = startBoard;
