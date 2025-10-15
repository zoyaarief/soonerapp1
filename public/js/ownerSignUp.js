// public/js/ownerSignUp.js

// ===== API CONFIG =====
// const API_BASE = "http://localhost:3000";
// const FETCH_CREDENTIALS = "include";

const API_BASE = window.location.origin;
const FETCH_CREDENTIALS = "same-origin";

// ===== STATE =====
let role = "owner"; // "owner" | "customer"
let mode = "login"; // "login" | "signup"

// ===== ELEMENTS =====
const yearEl = document.getElementById("year");
if (yearEl) yearEl.textContent = new Date().getFullYear();

const tabOwner = document.getElementById("tabOwner");
const tabCustomer = document.getElementById("tabCustomer");

const formTitle = document.getElementById("formTitle");
const formSubtitle = document.getElementById("formSubtitle");

// Forms
const ownerLogin = document.getElementById("ownerLogin");
const ownerSignup = document.getElementById("ownerSignup");
const custLogin = document.getElementById("custLogin");
const custSignup = document.getElementById("custSignup");

// Owner fields & messages
const olEmail = document.getElementById("olEmail");
const olPass = document.getElementById("olPass");
const olMsg = document.getElementById("olMsg");

const osManager = document.getElementById("osManager");
const osBusiness = document.getElementById("osBusiness");
const osType = document.getElementById("osType");
const osPhone = document.getElementById("osPhone");
const osEmail = document.getElementById("osEmail");
const osPass = document.getElementById("osPass");
const osMsg = document.getElementById("osMsg");

// Customer demo fields
const clUser = document.getElementById("clUser");
const clPass = document.getElementById("clPass");
const clMsg = document.getElementById("clMsg");

const csName = document.getElementById("csName");
const csPhone = document.getElementById("csPhone");
const csEmail = document.getElementById("csEmail");
const csUser = document.getElementById("csUser");
const csPass = document.getElementById("csPass");
const csMsg = document.getElementById("csMsg");

// Switchers
const toOwnerSignup = document.getElementById("toOwnerSignup");
const toOwnerLogin = document.getElementById("toOwnerLogin");
const toCustSignup = document.getElementById("toCustSignup");
const toCustLogin = document.getElementById("toCustLogin");

toOwnerSignup?.addEventListener("click", () => {
  role = "owner";
  mode = "signup";
  render();
});
toOwnerLogin?.addEventListener("click", () => {
  role = "owner";
  mode = "login";
  render();
});
toCustSignup?.addEventListener("click", () => {
  role = "customer";
  mode = "signup";
  render();
});
toCustLogin?.addEventListener("click", () => {
  role = "customer";
  mode = "login";
  render();
});

tabOwner?.addEventListener("click", () => {
  role = "owner";
  render();
});
tabCustomer?.addEventListener("click", () => {
  role = "customer";
  render();
});

// ===== HELPERS =====
const show = (el) => el?.classList.remove("hidden");
const hide = (el) => el?.classList.add("hidden");
function setStatus(node, text, ok = false) {
  if (!node) return;
  node.textContent = text;
  node.style.color = ok ? "#10b981" : "#eab308";
}

function render() {
  tabOwner?.classList.toggle("active", role === "owner");
  tabOwner?.setAttribute("aria-selected", role === "owner");
  tabCustomer?.classList.toggle("active", role === "customer");
  tabCustomer?.setAttribute("aria-selected", role === "customer");

  if (mode === "login") {
    formTitle && (formTitle.textContent = "Login");
    formSubtitle &&
      (formSubtitle.textContent =
        role === "owner"
          ? "Welcome back! Manage your queues."
          : "Welcome back! Join and track queues.");
  } else {
    formTitle && (formTitle.textContent = "Create account");
    formSubtitle &&
      (formSubtitle.textContent =
        role === "owner"
          ? "Let’s get your business on Sooner."
          : "A few details to start skipping waits.");
  }

  hide(ownerLogin);
  hide(ownerSignup);
  hide(custLogin);
  hide(custSignup);
  if (role === "owner" && mode === "login") show(ownerLogin);
  if (role === "owner" && mode === "signup") show(ownerSignup);
  if (role === "customer" && mode === "login") show(custLogin);
  if (role === "customer" && mode === "signup") show(custSignup);
}

// Allow deep link: ?role=customer&mode=signup&returnTo=/place.html?id=123
const usp = new URLSearchParams(location.search);
if (usp.get("role")) role = usp.get("role");
if (usp.get("mode")) mode = usp.get("mode");
const returnTo = usp.get("returnTo");
render();

// ===== OWNER: LOGIN (real API) =====
ownerLogin?.addEventListener("submit", async (e) => {
  e.preventDefault();
  setStatus(olMsg, "Checking…");
  try {
    const email = (olEmail?.value || "").trim();
    const password = olPass?.value || "";
    if (!email || password.length < 8) {
      setStatus(olMsg, "Invalid email or password.");
      return;
    }
    const res = await fetch(`${API_BASE}/api/owners/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: FETCH_CREDENTIALS,
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.ok) {
      setStatus(olMsg, data?.error || "Login failed.");
      return;
    }
    localStorage.setItem("role", "owner");
    localStorage.setItem(
      "businessName",
      data.business || email.split("@")[0] || "Business"
    );
    setStatus(olMsg, "Logged in. Redirecting…", true);

    setTimeout(() => window.location.assign("/ownerProfile.html"), 300);
  } catch (err) {
    console.error(err);
    setStatus(olMsg, "Network error.");
  }
});

// ===== OWNER: SIGNUP (real API) =====
ownerSignup?.addEventListener("submit", async (e) => {
  e.preventDefault();
  setStatus(osMsg, "Saving…");
  try {
    const payload = {
      manager: (osManager?.value || "").trim(),
      business: (osBusiness?.value || "").trim(),
      type: (osType?.value || "").trim(),
      phone: (osPhone?.value || "").trim(),
      email: (osEmail?.value || "").trim(),
      password: osPass?.value || "",
    };
    const valid =
      payload.manager &&
      payload.business &&
      payload.type &&
      payload.phone &&
      payload.email &&
      payload.password.length >= 8;
    if (!valid) {
      setStatus(osMsg, "Fill all fields (min 8-char password).");
      return;
    }

    const res = await fetch(`${API_BASE}/api/owners`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: FETCH_CREDENTIALS,
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.ok) {
      setStatus(osMsg, data?.error || "Failed to create account.");
      return;
    }

    localStorage.setItem("role", "owner");
    localStorage.setItem("businessName", payload.business);
    setStatus(osMsg, "Account created. Redirecting…", true);

    setTimeout(() => window.location.assign("/ownerProfile.html"), 300);
  } catch (err) {
    console.error(err);
    setStatus(osMsg, "Network error.");
  }
});

// ===== CUSTOMER (real API) =====
custLogin?.addEventListener("submit", async (e) => {
  e.preventDefault();
  setStatus(clMsg, "Checking…");
  try {
    const email = (clUser?.value || "").trim();
    const password = clPass?.value || "";
    if (!email || password.length < 6) {
      setStatus(clMsg, "Invalid email or password.");
      return;
    }

    const res = await fetch(`${API_BASE}/api/customers/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: FETCH_CREDENTIALS,
      body: JSON.stringify({ email, password }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.ok) {
      setStatus(clMsg, data?.error || "Login failed.");
      return;
    }

    localStorage.setItem("role", "customer");
    localStorage.setItem(
      "customerName",
      data.user?.name || email.split("@")[0] || "Customer"
    );
    setStatus(clMsg, "Logged in. Redirecting…", true);

    setTimeout(() => {
      if (returnTo) {
        location.href = decodeURIComponent(returnTo);
      } else {
        location.href = "/userDashboard.html";
      }
    }, 400);
  } catch (err) {
    console.error(err);
    setStatus(clMsg, "Network error.");
  }
});

custSignup?.addEventListener("submit", async (e) => {
  e.preventDefault();
  setStatus(csMsg, "Saving…");
  try {
    const payload = {
      name: (csName?.value || "").trim(),
      email: (csEmail?.value || "").trim(),
      phone: (csPhone?.value || "").trim(),
      password: csPass?.value || "",
      username: (csName?.value || "").trim(),
    };
    const ok = payload.name && payload.email && payload.password.length >= 6;

    if (!ok) {
      setStatus(csMsg, "Please complete all fields (min 6-char password).");
      return;
    }

    const res = await fetch(`${API_BASE}/api/customers/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: FETCH_CREDENTIALS,
      body: JSON.stringify(payload),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.ok) {
      setStatus(csMsg, data?.error || "Signup failed.");
      return;
    }

    localStorage.setItem("customerId", data.user.id || data.id);
    localStorage.setItem("role", "customer");
    localStorage.setItem("customerName", payload.name);
    setStatus(csMsg, "Account created. Redirecting…", true);

    setTimeout(() => {
      if (returnTo) {
        location.href = decodeURIComponent(returnTo);
      } else {
        location.href = "/userDashboard.html";
      }
    }, 400);
  } catch (err) {
    console.error(err);
    setStatus(csMsg, "Network error.");
  }
});
