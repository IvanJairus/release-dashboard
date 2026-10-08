export class ApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
  get refused() {
    return this.body && this.body.refused ? this.body.refused.message : null;
  }
}

async function request(method, path, body) {
  const res = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && !path.startsWith("/api/auth/")) {
    location.href = "/login.html";
    throw new ApiError("session expired", 401, null);
  }
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError((payload && (payload.error || payload.message)) || `http ${res.status}`, res.status, payload);
  }
  return payload;
}

export const api = {
  get: (path) => request("GET", path),
  post: (path, body) => request("POST", path, body || {}),
};

// Every view is scoped by the same query string, so "Payments Core" cannot mean
// one thing on the dashboard and another on the secrets ledger.
export const scoped = (path, project) =>
  `${path}${path.includes("?") ? "&" : "?"}project=${encodeURIComponent(project)}`;
