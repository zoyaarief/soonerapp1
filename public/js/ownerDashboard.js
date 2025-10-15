// public/js/ownerDashboard.js

const API_BASE = "http://localhost:3000";
const FETCH_CREDENTIALS = "include";

// -------------------- Auth + greet --------------------
(async function guard() {
  try {
    const res = await fetch(`${API_BASE}/api/session`, {
      method: "GET",
      credentials: FETCH_CREDENTIALS,
    });
    if (!res.ok) {
      location.href = "ownerSignUp.html?role=owner&mode=login";
      return;
    }
    const data = await res.json();
    localStorage.setItem("businessName", data.business || "Business");
    const name = data.business || "Business Name";
    document.getElementById("businessName").textContent = name;
    document.getElementById("greetName").textContent = name;
  } catch {
    location.href = "ownerSignUp.html?role=owner&mode=login";
  }
})();

// -------------------- helpers --------------------
function setDashboardAvatar(src) {
  const fallback = "./images/default_profile.png";
  const finalSrc =
    src && typeof src === "string" && src.length > 10 ? src : fallback;
  const sidebarImg = document.querySelector(".userchip img");
  const topImg = document.querySelector(".top .avatar");
  if (sidebarImg) sidebarImg.src = finalSrc;
  if (topImg) topImg.src = finalSrc;
}

(function paintCachedAvatarFirst() {
  const cached = localStorage.getItem("ownerAvatar");
  const fallback = "./images/default_profile.png";
  setDashboardAvatar(cached || fallback);
})();

(async function hydrateDashboardAvatar() {
  try {
    const res = await fetch(`${API_BASE}/api/owners/me`, {
      method: "GET",
      credentials: FETCH_CREDENTIALS,
    });
    if (!res.ok) return;
    const data = await res.json();
    const serverAvatar = data?.profile?.avatar || "";
    const isUseful =
      typeof serverAvatar === "string" &&
      serverAvatar.length > 0 &&
      !/default_profile\.png$/i.test(serverAvatar);
    if (isUseful) {
      setDashboardAvatar(serverAvatar);
      localStorage.setItem("ownerAvatar", serverAvatar);
    }
  } catch (e) {
    console.warn("hydrateDashboardAvatar error:", e);
  }
})();

window.addEventListener("storage", (evt) => {
  if (evt.key === "ownerAvatar") {
    const val = evt.newValue || "./images/default_profile.png";
    setDashboardAvatar(val);
  }
});

// -------------------- Sidebar + nav --------------------
const sidebar = document.getElementById("sidebar");
const toggleBtn = document.getElementById("sidebarToggle");
toggleBtn?.addEventListener("click", () => {
  sidebar?.classList.toggle("collapsed");
});

const sideLinks = [...document.querySelectorAll(".side-nav .item")];
sideLinks.forEach((link) => {
  const href = link.getAttribute("href");
  if (href && href.startsWith("#")) {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      const id = href.slice(1);
      const el = document.getElementById(id);
      if (el) window.scrollTo({ top: el.offsetTop - 10, behavior: "smooth" });
    });
  }
});

const observedIds = ["home", "statsCard"];
const observedEls = observedIds
  .map((id) => document.getElementById(id))
  .filter(Boolean);
const observer = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        const id = entry.target.id;
        sideLinks.forEach((a) => {
          const href = a.getAttribute("href");
          a.classList.toggle("active", href === `#${id}`);
        });
      }
    });
  },
  { root: null, rootMargin: "-30% 0px -60% 0px", threshold: 0.0 }
);
observedEls.forEach((el) => observer.observe(el));

// -------------------- Logout --------------------
document.getElementById("logoutBtn")?.addEventListener("click", async () => {
  try {
    await fetch(`${API_BASE}/api/logout`, {
      method: "POST",
      credentials: FETCH_CREDENTIALS,
    });
  } finally {
    localStorage.removeItem("businessName");
    localStorage.removeItem("role");
    localStorage.removeItem("ownerAvatar");
    location.href = "ownerSignUp.html?role=owner&mode=login";
  }
});

// ======================
// Controls / Announcements / Queue / Chart
// ======================
const walkinBtn = document.getElementById("walkinBtn");

const announcementInput = document.getElementById("announcementInput");
const announceBtn = document.getElementById("announceBtn");
const announceList = document.getElementById("announceList");

const queueList = document.getElementById("queueList");
const undoBtn = document.getElementById("undoBtn");

const toast = document.getElementById("toast");
const toastText = document.getElementById("toastText");
const toastUndo = document.getElementById("toastUndo");
const toastClose = document.getElementById("toastClose");

const modal = document.getElementById("modal");
const modalClose = document.getElementById("modalClose");
const modalClose2 = document.getElementById("modalClose2");
const undoList = document.getElementById("undoList");

const mWalkins = document.getElementById("mWalkins");
const mQueueCount = document.getElementById("mQueueCount");
const mAvgWait = document.getElementById("mAvgWait");

// Capacity line in the Queue card
const spotsLeftEl = document.getElementById("spotsLeft");

// --------- state ---------
let queue = [];
let announcements = []; // server-backed

let settings = {
  walkinsEnabled: true,
};

let capacity = {
  totalSeats: 0,
  seatsUsed: 0,
  spotsLeft: Infinity,
};

let undoStack = [];
let lastRemoved = null;

// --------- small helpers ---------
function setText(node, text) {
  if (node) node.textContent = text;
}
function showToast(message, withUndo = false) {
  if (!toast || !toastText) return;
  toastText.textContent = message;
  if (toastUndo) toastUndo.style.display = withUndo ? "inline" : "none";
  toast.classList.add("show");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.remove("show"), 4000);
}
function updateMetrics() {
  setText(mWalkins, settings.walkinsEnabled ? "Enabled" : "Disabled");
  setText(mQueueCount, String(queue.length)); // total items in queue array
  const avg = Math.round(
    (queue.reduce((a, b) => a + (Number(b.people) || 0), 0) * 8) /
      Math.max(queue.length, 1)
  );
  setText(mAvgWait, `${avg}m`);
}

// Capacity -> UI (clamps "used" to total and short-circuits when full)
function updateSpotsLeftUI() {
  if (!spotsLeftEl) return;

  const T = Number(capacity.totalSeats || 0);
  const usedRaw = Number(capacity.seatsUsed || 0);
  const used = T > 0 ? Math.min(usedRaw, T) : usedRaw;
  const left = Number.isFinite(capacity.spotsLeft) ? capacity.spotsLeft : null;

  spotsLeftEl.style.color = "#6b7280"; // default gray

  if (!T) {
    spotsLeftEl.textContent = "Spots left: — (set total seats)";
    return;
  }

  if (left !== null && left <= 0) {
    spotsLeftEl.textContent = `Full — 0 / ${T}`;
    spotsLeftEl.style.color = "#ef4444"; // red when full
    return;
  }

  // When not full, show clamped used
  spotsLeftEl.textContent = `Spots left: ${left ?? "—"} / ${T} (used: ${used})`;
}

// Given the full queue and capacity, compute the subset that actually fits now.
// We preserve original order and stop once we would exceed the total seats.
function visibleQueueByCapacity(fullQueue, totalSeats) {
  if (!Number(totalSeats)) return fullQueue; // if not configured, show all
  let sum = 0;
  const out = [];
  for (const q of fullQueue) {
    const size = Number(q.people) || 0;
    if (sum + size <= totalSeats) {
      out.push(q);
      sum += size;
    } else {
      break; // stop showing once we'd exceed capacity
    }
  }
  return out;
}

// -------------------- SETTINGS fetch/apply --------------------
async function fetchSettings() {
  try {
    const res = await fetch(`${API_BASE}/api/settings`, {
      credentials: FETCH_CREDENTIALS,
    });
    if (!res.ok) throw new Error("settings fetch failed");
    const data = await res.json();
    const s = data?.settings || {};
    settings.walkinsEnabled = !!s.walkinsEnabled;

    // ensure no stale flags linger in memory
    delete settings.openStatus;
    delete settings.queueActive;

    applySettingsToUI();
  } catch (e) {
    console.warn("fetchSettings error:", e);
  }
}

function applySettingsToUI() {
  // Walk-ins button text
  if (walkinBtn) {
    walkinBtn.textContent = settings.walkinsEnabled
      ? "Disable Walk-ins"
      : "Enable Walk-ins";
  }

  // Just render capacity normally (no red “stopped” banner tied to other flags)
  if (spotsLeftEl) {
    spotsLeftEl.style.color = ""; // reset any previous styling
  }
  updateSpotsLeftUI();

  updateMetrics();
  renderQueue();
}

// -------------------- SERVER FETCHERS --------------------
async function fetchAnnouncements() {
  try {
    const res = await fetch(`${API_BASE}/api/announcements`, {
      credentials: FETCH_CREDENTIALS,
    });
    if (!res.ok) throw new Error("announcements fetch failed");
    const data = await res.json();
    announcements = Array.isArray(data.items) ? data.items : [];
    renderAnnouncements();
  } catch (e) {
    console.warn("fetchAnnouncements error:", e);
    announcements = [];
    renderAnnouncements();
  }
}

async function fetchQueue() {
  try {
    const res = await fetch(`${API_BASE}/api/queue`, {
      credentials: FETCH_CREDENTIALS,
    });
    if (!res.ok) throw new Error("queue fetch failed");
    const data = await res.json();

    queue = Array.isArray(data.queue) ? data.queue : [];

    // Capacity snapshot from server
    capacity.totalSeats = Number(data.totalSeats || 0);
    capacity.seatsUsed = Number(data.seatsUsed || 0);
    capacity.spotsLeft = Number.isFinite(Number(data.spotsLeft))
      ? Number(data.spotsLeft)
      : Infinity;
    updateSpotsLeftUI();

    // Settings (authoritative)
    // Settings (authoritative)
    if (data.settings) {
      settings.walkinsEnabled = !!data.settings.walkinsEnabled;
      delete settings.openStatus;
      delete settings.queueActive;
    }

    renderQueue();
    applySettingsToUI();
  } catch (e) {
    console.warn("fetchQueue error:", e);
    queue = [];
    renderQueue();
  }
}

// -------------------- RENDERERS --------------------
function renderAnnouncements() {
  if (!announceList) return;
  announceList.innerHTML = "";
  announcements.forEach((item) => {
    const li = document.createElement("li");
    li.className = "announce-item";
    li.innerHTML = `
      <p>${item.text}</p>
      <div class="announce-actions">
        <button class="btn btn--ghost small" data-remove="${item._id}">Remove</button>
      </div>
    `;
    announceList.appendChild(li);
  });
}

function renderUndoList() {
  if (!undoList) return;
  undoList.innerHTML = "";
  if (!undoStack.length) {
    undoList.innerHTML = `<p class="meta">No recent removals.</p>`;
    return;
  }
  undoStack.forEach((u, idx) => {
    const leftMs = Math.max(0, u.timestamp + 5 * 60 * 1000 - Date.now());
    const leftMin = Math.floor(leftMs / 60000);
    const leftSec = Math.floor((leftMs % 60000) / 1000);
    const row = document.createElement("div");
    row.className = "undo-item";
    row.innerHTML = `
      <div>
        <strong>${u.item.name}</strong>
        <div class="meta">${u.item.people} people • expires in ${leftMin}m ${leftSec}s</div>
      </div>
      <div>
        <button class="btn btn--ghost" data-undo="${idx}">Undo</button>
      </div>
    `;
    undoList.appendChild(row);
  });
}
setInterval(() => {
  if (modal && !modal.classList.contains("hidden")) renderUndoList();
}, 1000);
function addToUndoStack(item) {
  const timestamp = Date.now();
  undoStack.push({ item, timestamp });
  setTimeout(
    () => {
      undoStack = undoStack.filter((u) => u.item._id !== item._id);
      if (modal && !modal.classList.contains("hidden")) renderUndoList();
    },
    5 * 60 * 1000
  );
}

/*function renderQueue() {
  if (!queueList) return;
  queueList.innerHTML = "";

  if (!settings.queueActive) {
    queueList.innerHTML =
      "<p style='color:#ef4444'>Queue stopped for the day.</p>";
    updateMetrics();
    drawChart();
    return;
  }

  const totalSeats = Number(capacity.totalSeats || 0);

  // Only render the parties that fit entirely into totalSeats (cumulative)
  const visible = visibleQueueByCapacity(queue, totalSeats);
  const hiddenCount = Math.max(queue.length - visible.length, 0);

  if (!visible.length) {
    queueList.innerHTML =
      "<p style='color:#6B7280'>No one currently in queue.</p>";
  } else {
    visible.forEach((q) => {
      const row = document.createElement("div");
      row.className = "queue-item";
      row.innerHTML = `
        <span>${q.position}. ${q.name} (${q.people} people)</span>
        <input type="checkbox" class="checkbox" data-id="${q._id}" aria-label="Mark served">
      `;
      queueList.appendChild(row);
    });

    if (hiddenCount > 0) {
      const more = document.createElement("div");
      more.className = "meta";
      more.style.cssText = "color:#6B7280;margin-top:8px;";
      more.textContent = `…and ${hiddenCount} more waiting`;
      queueList.appendChild(more);
    }
  }

  updateMetrics();
  drawChart();
}*/

function renderQueue() {
  if (!queueList) return;
  queueList.innerHTML = "";

  const totalSeats = Number(capacity.totalSeats || 0);

  // Only render the parties that fit entirely into totalSeats (cumulative)
  const visible = visibleQueueByCapacity(queue, totalSeats);
  const hiddenCount = Math.max(queue.length - visible.length, 0);

  if (!visible.length) {
    queueList.innerHTML =
      "<p style='color:#6B7280'>No one currently in queue.</p>";
  } else {
    visible.forEach((q) => {
      const row = document.createElement("div");
      row.className = "queue-item";
      row.innerHTML = `
        <span>${q.position}. ${q.name} (${q.people} people)</span>
        <input type="checkbox" class="checkbox" data-id="${q._id}" aria-label="Mark served">
      `;
      queueList.appendChild(row);
    });

    if (hiddenCount > 0) {
      const more = document.createElement("div");
      more.className = "meta";
      more.style.cssText = "color:#6B7280;margin-top:8px;";
      more.textContent = `…and ${hiddenCount} more waiting`;
      queueList.appendChild(more);
    }
  }

  updateMetrics();
  drawChart();
}

// -------------------- MODAL --------------------
function openModal() {
  if (!modal) return;
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
  renderUndoList();
}
function closeModal() {
  if (!modal) return;
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
}

// -------------------- CONTROLS (SERVER-BACKED) --------------------

// Walk-ins toggle
walkinBtn?.addEventListener("click", async () => {
  try {
    const next = !settings.walkinsEnabled;
    const res = await fetch(`${API_BASE}/api/settings`, {
      method: "PUT",
      credentials: FETCH_CREDENTIALS,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ walkinsEnabled: next }),
    });
    if (!res.ok) throw new Error("settings save failed");
    const data = await res.json();
    settings.walkinsEnabled = !!data.settings.walkinsEnabled;
    applySettingsToUI();
    showToast(`Walk-ins ${settings.walkinsEnabled ? "enabled" : "disabled"}`);
  } catch (e) {
    console.warn(e);
    showToast("Failed to update walk-ins");
  }
});

// -------------------- SSE (live queue) with polling fallback --------------------
let es;
function startQueueStream() {
  if (!window.EventSource) {
    setInterval(fetchQueue, 5000);
    return;
  }
  es = new EventSource(`${API_BASE}/api/queue/stream`, {
    withCredentials: true,
  });

  es.addEventListener("snapshot", (evt) => {
    try {
      const data = JSON.parse(evt.data);

      // Update queue
      queue = Array.isArray(data.queue) ? data.queue : [];

      // Update capacity snapshot from server
      capacity.totalSeats = Number(data.totalSeats || 0);
      capacity.seatsUsed = Number(data.seatsUsed || 0);
      capacity.spotsLeft = Number.isFinite(Number(data.spotsLeft))
        ? Number(data.spotsLeft)
        : Infinity;
      updateSpotsLeftUI();

      // Settings from stream (authoritative)
      if (data.settings) {
        settings.walkinsEnabled = !!data.settings.walkinsEnabled;
        delete settings.openStatus;
        delete settings.queueActive;
      }

      renderQueue();
      applySettingsToUI();
    } catch (e) {
      console.warn("SSE parse error:", e);
    }
  });

  es.onerror = () => {
    console.warn("SSE dropped; falling back to polling");
    try {
      es.close();
    } catch {}
    setInterval(fetchQueue, 5000);
  };
}

// -------------------- Announcements (SERVER) --------------------
announceBtn?.addEventListener("click", async () => {
  const val = announcementInput?.value?.trim() || "";
  if (!val) {
    showToast("Type an announcement first");
    return;
  }
  try {
    const res = await fetch(`${API_BASE}/api/announcements`, {
      method: "POST",
      credentials: FETCH_CREDENTIALS,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: val }),
    });
    if (!res.ok) throw new Error("add failed");
    announcementInput.value = "";
    await fetchAnnouncements();
    showToast("Announcement added");
  } catch (e) {
    showToast("Failed to add announcement");
  }
});

announceList?.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-remove]");
  if (!btn) return;
  const id = btn.getAttribute("data-remove");
  try {
    const res = await fetch(
      `${API_BASE}/api/announcements/${encodeURIComponent(id)}`,
      {
        method: "DELETE",
        credentials: FETCH_CREDENTIALS,
      }
    );
    if (!res.ok) throw new Error("delete failed");
    await fetchAnnouncements();
    showToast("Announcement removed");
  } catch (e) {
    showToast("Failed to remove");
  }
});

// -------------------- Queue actions (SERVER) --------------------
queueList?.addEventListener("change", async (e) => {
  if (e.target.matches(".checkbox")) {
    const id = e.target.dataset.id;
    try {
      const res = await fetch(`${API_BASE}/api/queue/serve`, {
        method: "POST",
        credentials: FETCH_CREDENTIALS,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) throw new Error("serve failed");
      const { removed } = await res.json();
      if (removed) {
        addToUndoStack(removed);
        lastRemoved = removed;
      }
      await fetchQueue(); // will cause visible list to refill up to capacity
      showToast(`Removed ${removed?.name ?? "guest"}`, true);
    } catch (err) {
      console.warn(err);
      showToast("Failed to mark served");
      e.target.checked = false;
    }
  }
});

// Toast + Modal actions (SERVER restore)
toastUndo?.addEventListener("click", async () => {
  if (!lastRemoved) return;
  try {
    const res = await fetch(`${API_BASE}/api/queue/restore`, {
      method: "POST",
      credentials: FETCH_CREDENTIALS,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ item: lastRemoved }),
    });
    if (!res.ok) throw new Error("restore failed");
    undoStack = undoStack.filter((u) => u.item._id !== lastRemoved._id);
    await fetchQueue();
    showToast(`${lastRemoved.name} restored`);
    lastRemoved = null;
  } catch (e) {
    showToast("Failed to restore");
  }
});
toastClose?.addEventListener("click", () => toast.classList.remove("show"));
undoBtn?.addEventListener("click", openModal);
modalClose?.addEventListener("click", closeModal);
modalClose2?.addEventListener("click", closeModal);
modal?.addEventListener("click", (e) => {
  if (e.target === modal) closeModal();
});
undoList?.addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-undo]");
  if (!btn) return;
  const idx = Number(btn.getAttribute("data-undo"));
  const u = undoStack[idx];
  if (!u) return;
  try {
    const res = await fetch(`${API_BASE}/api/queue/restore`, {
      method: "POST",
      credentials: FETCH_CREDENTIALS,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ item: u.item }),
    });
    if (!res.ok) throw new Error("restore failed");
    undoStack.splice(idx, 1);
    await fetchQueue();
    renderUndoList();
    showToast(`${u.item.name} restored`);
  } catch (e2) {
    showToast("Failed to restore");
  }
});

// -------------------- Chart --------------------
const canvas = document.getElementById("chart");
const ctx = canvas?.getContext("2d");
function drawChart() {
  if (!canvas || !ctx) return;
  const w = canvas.clientWidth,
    h = canvas.clientHeight;
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const maxPeople = Math.max(...queue.map((q) => Number(q.people) || 0), 1);
  const barW = 26,
    gap = 12,
    scale = (h - 30) / maxPeople;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#8B5CF6";
  visibleQueueByCapacity(queue, Number(capacity.totalSeats || 0)).forEach(
    (q, i) => {
      const ppl = Number(q.people) || 0;
      const x = i * (barW + gap) + 40;
      const y = h - ppl * scale - 14;
      ctx.fillRect(x, y, barW, ppl * scale);
      ctx.fillStyle = "#94a3b8";
      ctx.font = "12px Plus Jakarta Sans";
      ctx.fillText(ppl, x + 5, y - 4);
      ctx.fillStyle = "#8B5CF6";
    }
  );
}

// -------------------- Init --------------------
(async function init() {
  await fetchSettings(); // settings first
  await fetchAnnouncements();
  await fetchQueue();
  startQueueStream();
})();
