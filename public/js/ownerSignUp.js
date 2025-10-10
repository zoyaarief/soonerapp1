// Role & mode state
let role = "owner"; // "owner" | "customer"
let mode = "login"; // "login" | "signup"

// Elements
const yearEl = document.getElementById("year");
yearEl.textContent = new Date().getFullYear();

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

// Customer fields & messages
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
document.getElementById("toOwnerSignup").addEventListener("click", () => {
  role = "owner";
  mode = "signup";
  render();
});
document.getElementById("toOwnerLogin").addEventListener("click", () => {
  role = "owner";
  mode = "login";
  render();
});
document.getElementById("toCustSignup").addEventListener("click", () => {
  role = "customer";
  mode = "signup";
  render();
});
document.getElementById("toCustLogin").addEventListener("click", () => {
  role = "customer";
  mode = "login";
  render();
});

// Tabs
tabOwner.addEventListener("click", () => {
  role = "owner";
  render();
});
tabCustomer.addEventListener("click", () => {
  role = "customer";
  render();
});

// Helpers
const show = (el) => el.classList.remove("hidden");
const hide = (el) => el.classList.add("hidden");
function setStatus(node, text, ok = false) {
  node.textContent = text;
  node.style.color = ok ? "#10b981" : "#eab308"; // green / amber
}

// UI render
function render() {
  // tabs
  tabOwner.classList.toggle("active", role === "owner");
  tabOwner.setAttribute("aria-selected", role === "owner");
  tabCustomer.classList.toggle("active", role === "customer");
  tabCustomer.setAttribute("aria-selected", role === "customer");

  // titles
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

  // show correct form
  hide(ownerLogin);
  hide(ownerSignup);
  hide(custLogin);
  hide(custSignup);
  if (role === "owner" && mode === "login") show(ownerLogin);
  if (role === "owner" && mode === "signup") show(ownerSignup);
  if (role === "customer" && mode === "login") show(custLogin);
  if (role === "customer" && mode === "signup") show(custSignup);
}
render();

// Allow deep link: ?role=customer&mode=signup
const usp = new URLSearchParams(location.search);
if (usp.get("role")) role = usp.get("role");
if (usp.get("mode")) mode = usp.get("mode");
render();

/* ====== SUBMIT HANDLERS (DEMO ONLY) ====== */

// Owner login
ownerLogin.addEventListener("submit", (e) => {
  e.preventDefault();
  setStatus(olMsg, "Checking…");
  setTimeout(() => {
    if (!olEmail.value.trim() || olPass.value.length < 8) {
      setStatus(olMsg, "Invalid email or password.");
      return;
    }
    localStorage.setItem("role", "owner");
    if (!localStorage.getItem("businessName")) {
      const derived = olEmail.value.split("@")[0] || "Business Name";
      localStorage.setItem("businessName", derived);
    }
    setStatus(olMsg, "Logged in. Redirecting…", true);
    setTimeout(() => (location.href = "ownerProfile.html"), 600);
  }, 600);
});

// Owner signup
ownerSignup.addEventListener("submit", (e) => {
  e.preventDefault();
  setStatus(osMsg, "Saving…");
  const ok =
    osManager.value.trim() &&
    osBusiness.value.trim() &&
    osType.value.trim() &&
    osPhone.value.trim() &&
    osEmail.value.trim() &&
    osPass.value.length >= 8;

  setTimeout(() => {
    if (!ok) {
      setStatus(osMsg, "Fill all fields (min 8-char password).");
      return;
    }
    localStorage.setItem("role", "owner");
    localStorage.setItem("businessName", osBusiness.value.trim());
    localStorage.setItem(
      "ownerSignup",
      JSON.stringify({
        manager: osManager.value.trim(),
        business: osBusiness.value.trim(),
        type: osType.value.trim(),
        phone: osPhone.value.trim(),
        email: osEmail.value.trim(),
      })
    );
    setStatus(osMsg, "Account created. Redirecting…", true);
    setTimeout(() => (location.href = "ownerProfile.html"), 700);
  }, 700);
});

// Customer login
custLogin.addEventListener("submit", (e) => {
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
    setTimeout(() => (location.href = "flashscreen.html"), 600); // change if you have a customer page
  }, 600);
});

// Customer signup
custSignup.addEventListener("submit", (e) => {
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
  }, 700);
});
