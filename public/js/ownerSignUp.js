// ===== Config: use this origin if served by Express; otherwise fall back to dev port
const API_BASE = window.location.origin.startsWith("http")
  ? window.location.origin
  : "http://localhost:3000";

// ===== STATE =====
let role = "owner"; // "owner" | "customer"
let mode = "login"; // "login" | "signup"

// ===== COMMON ELEMENTS =====
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

// Customer fields & messages (front-end only demo)
const clUser = document.getElementById("clUser");
const clPass = document.getElementById("clPass");
const clMsg = document.getElementById("clMsg");

const csName = document.getElementById("csName");
const csPhone = document.getElementById("csPhone");
const csEmail = document.getElementById("csEmail");
const csUser = document.getElementById("csUser");
const csPass = document.getElementById("csPass");
const csMsg = document.getElementById("csMsg");

// Switchers inside forms
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

// Tabs
tabOwner?.addEventListener("click", () => {
  role = "owner";
  render();
});
tabCustomer?.addEventListener("click", () => {
  role = "customer";
  render();
});

// ===== HELPERS =====
const show = (el) => el && el.classList.remove("hidden");
const hide = (el) => el && el.classList.add("hidden");
function setStatus(node, text, ok = false) {
  if (!node) return;
  node.textContent = text;
  node.style.color = ok ? "#10b981" : "#eab308"; // green / amber
}

// UI render
function render() {
  tabOwner?.classList.toggle("active", role === "owner");
  tabOwner?.setAttribute("aria-selected", role === "owner");
  tabCustomer?.classList.toggle("active", role === "customer");
  tabCustomer?.setAttribute("aria-selected", role === "customer");

  if (mode === "login") {
    formTitle.textContent = "Login";
    formSubtitle.textContent =
      role === "owner"
        ? "Welcome back! Manage your queues."
        : "Welcome back! Join and track queues.";
  } else {
    formTitle.textContent = "Create account";
    formSubtitle.textContent =
      role === "owner"
        ? "Let’s get your business on Sooner."
        : "A few details to start skipping waits.";
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

// Deep link (?role=&mode=)
const usp = new URLSearchParams(location.search);
if (usp.get("role")) role = usp.get("role");
if (usp.get("mode")) mode = usp.get("mode");
render();

/* ====== OWNER: LOGIN (calls backend) ====== */
ownerLogin?.addEventListener("submit", async (e) => {
  e.preventDefault();
  setStatus(olMsg, "Checking…");

  const email = olEmail.value.trim();
  const password = olPass.value;

  if (!email || password.length < 8) {
    setStatus(olMsg, "Invalid email or password.");
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/api/owners/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();

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
    setTimeout(() => (location.href = "ownerProfile.html"), 600);
  } catch (err) {
    console.error(err);
    setStatus(olMsg, "Network error.");
  }
});

/* ====== OWNER: SIGN UP (calls backend) ====== */
ownerSignup?.addEventListener("submit", async (e) => {
  e.preventDefault();
  setStatus(osMsg, "Saving…");

  const payload = {
    manager: osManager.value.trim(),
    business: osBusiness.value.trim(),
    type: osType.value.trim(),
    phone: osPhone.value.trim(),
    email: osEmail.value.trim(),
    password: osPass.value,
  };

  const valid =
    payload.manager &&
    payload.business &&
    payload.type &&
    payload.phone &&
    payload.email &&
    typeof payload.password === "string" &&
    payload.password.length >= 8;

  if (!valid) {
    setStatus(osMsg, "Fill all fields (min 8-char password).");
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/api/owners`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();

    if (!res.ok || !data?.ok) {
      setStatus(osMsg, data?.error || "Failed to create account.");
      return;
    }

    localStorage.setItem("role", "owner");
    localStorage.setItem("businessName", payload.business);

    setStatus(osMsg, "Account created. Redirecting…", true);
    setTimeout(() => (location.href = "ownerProfile.html"), 700);
  } catch (err) {
    console.error(err);
    setStatus(osMsg, "Network error.");
  }
});

/* ====== CUSTOMER: (front-end only demo) ====== */
custLogin?.addEventListener("submit", (e) => {
  e.preventDefault();
  setStatus(clMsg, "Checking…");
  setTimeout(() => {
    if (!clUser.value.trim() || clPass.value.length < 8) {
      setStatus(clMsg, "Invalid credentials.");
      return;
    }
    localStorage.setItem("role", "customer");
    if (!localStorage.getItem("customerName")) {
      const base = clUser.value.includes("@")
        ? clUser.value.split("@")[0]
        : clUser.value.replace(/^@/, "");
      localStorage.setItem("customerName", base || "Customer");
    }
    setStatus(clMsg, "Logged in. Redirecting…", true);
    setTimeout(() => (location.href = "flashscreen.html"), 600);
  }, 500);
});

custSignup?.addEventListener("submit", (e) => {
  e.preventDefault();
  setStatus(csMsg, "Saving…");
  const ok =
    csName.value.trim() &&
    csPhone.value.trim() &&
    csEmail.value.trim() &&
    csUser.value.trim() &&
    csPass.value.length >= 8;

  setTimeout(() => {
    if (!ok) {
      setStatus(csMsg, "Please complete all fields (min 8-char password).");
      return;
    }
    localStorage.setItem("role", "customer");
    localStorage.setItem("customerName", csName.value.trim());
    localStorage.setItem(
      "customerSignup",
      JSON.stringify({
        name: csName.value.trim(),
        phone: csPhone.value.trim(),
        email: csEmail.value.trim(),
        username: csUser.value.trim(),
      })
    );
    setStatus(csMsg, "Account created. Redirecting…", true);
    setTimeout(() => (location.href = "flashscreen.html"), 700);
  }, 500);
});
