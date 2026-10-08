import { api } from "./api.js";

const form = document.querySelector("[data-login]");
const error = document.querySelector("[data-error]");

// A signed-in visitor never sees the form flash before the redirect lands.
api.get("/api/auth/whoami").then((me) => { if (me && me.email) location.replace("/"); }).catch(() => null);

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  error.hidden = true;
  const submit = form.querySelector("button");
  submit.disabled = true;
  try {
    await api.post("/api/auth/login", {
      email: form.email.value,
      password: form.password.value,
    });
    location.href = "/";
  } catch (err) {
    error.textContent = err.status === 429
      ? `Too many attempts. Try again in ${err.body.retryAfterSeconds}s.`
      : err.message;
    error.hidden = false;
    submit.disabled = false;
    form.password.select();
  }
});
