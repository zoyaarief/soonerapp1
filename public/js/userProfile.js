
// userProfile.js — Avatar + profile info + favorites + history + logout (backend wired)

// Elements
const avatarInput = document.getElementById("avatarUpload");
const avatarImg = document.getElementById("avatarImg");
const nameInput = document.getElementById("userName");
const emailInput = document.getElementById("userEmail");
const phoneInput = document.getElementById("userPhone");
const favsList = document.getElementById("favoritesList");
const historyList = document.getElementById("historyList");
const logoutBtn = document.getElementById("logoutBtn");
const favCount = document.getElementById("favCount");
const queueCount = document.getElementById("queueCount");
const saveBtn = document.getElementById("saveProfile");

// Toast (optional)
const toastEl = document.getElementById("toast");
const toastText = document.getElementById("toastText");
document.getElementById("toastClose")?.addEventListener("click", () => toastEl?.classList.remove("show"));
function toast(msg){
  if (!toastEl || !toastText) { console.log("[toast]", msg); return; }
  toastText.textContent = msg;
  toastEl.classList.add("show");
  clearTimeout(toastEl._t);
  toastEl._t = setTimeout(()=>toastEl.classList.remove("show"), 2200);
}

async function fetchJSON(url, opts = {}) {
  const r = await fetch(url, { credentials: "include", ...opts });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

// Avatar upload + preview (local persistence for now)
avatarInput?.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    avatarImg.src = reader.result;
    localStorage.setItem("customerAvatar", reader.result);
    toast("Avatar updated");
  };
  reader.readAsDataURL(file);
});

const storedAvatar = localStorage.getItem("customerAvatar");
if (storedAvatar) avatarImg.src = storedAvatar;

// Favorites
async function renderFavorites() {
  try {
    const list = await fetchJSON("/api/likes");
    favsList.innerHTML = "";
    if (!list.length) {
      favsList.innerHTML = "<p class='muted'>No favorites yet.</p>";
    } else {
      list.forEach((f) => {
        const li = document.createElement("li");
        li.textContent = f.venueId;
        favsList.appendChild(li);
      });
    }
    favCount.textContent = list.length;
  } catch(e) {
    favsList.innerHTML = "<p class='muted'>Failed to load favorites.</p>";
  }
}

// History
async function renderHistory() {
  try {
    const list = await fetchJSON("/api/history");
    historyList.innerHTML = "";
    if (!list.length) {
      historyList.innerHTML = "<p class='muted'>No queue history yet.</p>";
    } else {
      list.forEach((h) => {
        const li = document.createElement("li");
        const dt = new Date(h.at).toLocaleString();
        li.textContent = `${h.type.replace("queue.", "")} • ${dt}`;
        historyList.appendChild(li);
      });
    }
    queueCount.textContent = list.length;
  } catch(e) {
    historyList.innerHTML = "<p class='muted'>Failed to load history.</p>";
  }
}

// Profile info (local for now)
function loadProfileInfo() {
  if (nameInput) nameInput.value = localStorage.getItem("customerName") || "";
  if (emailInput) emailInput.value = localStorage.getItem("customerEmail") || "";
  if (phoneInput) phoneInput.value = localStorage.getItem("customerPhone") || "";
}
function saveProfileInfo() {
  if (nameInput) localStorage.setItem("customerName", nameInput.value);
  if (emailInput) localStorage.setItem("customerEmail", emailInput.value);
  if (phoneInput) localStorage.setItem("customerPhone", phoneInput.value);
  toast("✅ Profile updated");
}

// Logout
logoutBtn?.addEventListener("click", async () => {
  await fetch("/api/logout", { method: "POST", credentials: "include" });
  localStorage.clear();
  location.href = "ownerSignUp.html?role=customer&mode=login";
});

saveBtn?.addEventListener("click", saveProfileInfo);

// Init
(async function init(){
  loadProfileInfo();
  await Promise.all([renderFavorites(), renderHistory()]);
})();
