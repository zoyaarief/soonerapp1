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

    // prefer the UL list if present; fallback to the section
    const listEl = document.getElementById("historyList") || document.getElementById("history");
    if (!listEl) return;

    listEl.innerHTML = "";

    if (!hist || !hist.length) {
      listEl.innerHTML = "<p class='muted'>No past visits yet.</p>";
      return;
    }

    // Render each served venue as a list item with a 'View' button
    hist.forEach(h => {
      const li = document.createElement("li");
      li.className = "list-item"; // optional; your CSS already styles .list > li
      const date = new Date(h.date).toLocaleDateString();

      li.innerHTML = `
        <div>
          <strong>${h.name}</strong><br>
          <span class="muted">Served on ${date}</span>
        </div>
        <button class="btn small" data-id="${h.venueId}">View</button>
      `;

      listEl.appendChild(li);
    });

    // Attach the click handler once (event delegation)
    if (!listEl._historyBound) {
      listEl.addEventListener("click", (e) => {
        const btn = e.target.closest("button[data-id]");
        if (!btn) return;
        const id = btn.getAttribute("data-id");
        location.href = `place.html?id=${encodeURIComponent(id)}`;
      });
      listEl._historyBound = true;
    }
  } catch (err) {
    console.error(err);
    const wrap = document.getElementById("history") || document.getElementById("historyList");
    if (wrap) wrap.innerHTML = "<p class='muted'>Failed to load history.</p>";
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
