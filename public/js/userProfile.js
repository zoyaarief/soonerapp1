async function fetchJSON(url, opts={}) {
  const r = await fetch(url, { credentials: "include", ...opts });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

const toastEl = document.getElementById("toast");
const toastText = document.getElementById("toastText");
function toast(msg) {
  toastText.textContent = msg;
  toastEl.classList.add("show");
  setTimeout(() => toastEl.classList.remove("show"), 2000);
}

async function loadProfile() {
  try {
    const user = await fetchJSON("/api/customers/me");
    document.getElementById("userName").textContent = user.name || "—";
    document.getElementById("userEmail").textContent = user.email || "—";
    document.getElementById("userPhone").textContent = user.phone || "—";
    if (user.avatar) document.getElementById("avatar").src = user.avatar;
  } catch {
    toast("Not logged in");
    location.href = "ownerSignUp.html?role=customer&mode=login";
  }
}

async function loadFavorites() {
  try {
    const favs = await fetchJSON("/api/likes");
    const wrap = document.getElementById("favorites");
    wrap.innerHTML = "";
    if (!favs.length) { wrap.textContent = "No favorites yet."; return; }

    favs.forEach(f => {
      const div = document.createElement("div");
      div.className = "card";
      div.innerHTML = `
        <img src="${f.heroImage || './images/restaurant.jpg'}" alt="">
        <h3>${f.name}</h3>
      `;
      div.addEventListener("click", () => location.href = `place.html?id=${f.venueId}`);
      wrap.appendChild(div);
    });
  } catch {
    document.getElementById("favorites").textContent = "Failed to load favorites.";
  }
}

async function loadHistory() {
  try {
    const hist = await fetchJSON("/api/history");
    const wrap = document.getElementById("history");
    wrap.innerHTML = "";
    if (!hist.length) { wrap.textContent = "No past visits yet."; return; }

    hist.forEach(h => {
      const div = document.createElement("div");
      div.className = "card";
      div.innerHTML = `<h3>${h.name}</h3><p>Served on ${new Date(h.date).toLocaleDateString()}</p>`;
      wrap.appendChild(div);
    });
  } catch {
    document.getElementById("history").textContent = "Failed to load history.";
  }
}

async function loadActiveQueue() {
  try {
    const q = await fetchJSON("/api/queue/active");
    const wrap = document.getElementById("activeQueue");
    if (!q || !q.venueName) {
      wrap.textContent = "No active queue.";
      return;
    }
    wrap.innerHTML = `
      <p>You’re currently in line at <b>${q.venueName}</b></p>
      <p>Position: #${q.position || "?"}</p>
    `;
  } catch {
    document.getElementById("activeQueue").textContent = "No active queue.";
  }
}

// handle avatar upload
document.getElementById("avatarUpload")?.addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    const base64 = reader.result;
    try {
      await fetch("/api/customers/me", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ avatar: base64 })
      });
      document.getElementById("avatar").src = base64;
      toast("Profile picture updated!");
    } catch {
      toast("Upload failed");
    }
  };
  reader.readAsDataURL(file);
});

(async function init() {
  await loadProfile();
  await loadFavorites();
  await loadHistory();
  await loadActiveQueue();
})();
