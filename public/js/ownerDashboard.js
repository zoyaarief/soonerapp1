// public/js/ownerDashboard.js

const API_BASE = "http://localhost:3000";
const FETCH_CREDENTIALS = "include";

/* =========================
   Auth + greetings
========================= */
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

/* =========================
   Avatar helpers
========================= */
function setDashboardAvatar(src) {
  const fallback = "./images/default_profile.png";
  const finalSrc =
    src && typeof src === "string" && src.length > 10 ? src : fallback;
  const sidebarImg = document.querySelector(".userchip img");
  const topImg = document.querySelector(".top .avatar");
  if (sidebarImg) sidebarImg.src = finalSrc;
  if (topImg) topImg.src = finalSrc;
}

// Paint avatar from cache fast
(function paintCachedAvatarFirst() {
  const cached = localStorage.getItem("ownerAvatar");
  const fallback = "./images/default_profile.png";
  setDashboardAvatar(cached || fallback);
})();

// Hydrate avatar from server
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

// Keep avatar in sync between tabs
window.addEventListener("storage", (evt) => {
  if (evt.key === "ownerAvatar") {
    const val = evt.newValue || "./images/default_profile.png";
    setDashboardAvatar(val);
  }
});

/* =========================
   Sidebar + nav
========================= */
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

/* =========================
   Logout
========================= */
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

/* =========================
   DOM refs
========================= */
const walkinBtn = document.getElementById("walkinBtn");
const openCloseBtn = document.getElementById("openCloseBtn");
const stopQueueBtn = document.getElementById("stopQueueBtn");
const restartQueueBtn = document.getElementById("restartQueueBtn");

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
const mOpen = document.getElementById("mOpen");
const mQueueCount = document.getElementById("mQueueCount");
const mAvgWait = document.getElementById("mAvgWait");
const spotsLeftEl = document.getElementById("spotsLeft");

// Chart
const canvas = document.getElementById("chart");
const ctx = canvas?.getContext("2d");

/* =========================
   Local state (mirrors server)
========================= */
let walkinsEnabled = false;
let restaurantOpen = false;
let queueActive = true;

let queue = [];
let announcements = []; // server-backed

let history = [];
let undoStack = [];
let lastRemoved = null;

// new: settings + capacity
let settings = {
  walkinsEnabled: false,
  openStatus: "closed",
  queueActive: true,
};
let spotsLeft = 0;
let totalSeats = 0;
let seatsUsed = 0;

/* =========================
   Small helpers
========================= */
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
  setText(mWalkins, walkinsEnabled ? "Enabled" : "Disabled");
  setText(mOpen, restaurantOpen ? "Open" : "Closed");
  setText(mQueueCount, String(queue.length));
  const avg = Math.round(
    (queue.reduce((a, b) => a + (Number(b.people) || 0), 0) * 8) /
      Math.max(queue.length, 1)
  );
  setText(mAvgWait, `${avg}m`);
}

/* =========================
   SERVER: Announcements
========================= */
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

/* =========================
   SERVER: Settings
========================= */
async function fetchSettings() {
  try {
    const res = await fetch(`${API_BASE}/api/settings`, {
      credentials: FETCH_CREDENTIALS,
    });
    if (!res.ok) throw new Error("settings fetch failed");
    const data = await res.json();
    settings = data.settings || settings;

    // Reflect on local flags
    walkinsEnabled = !!settings.walkinsEnabled;
    restaurantOpen = settings.openStatus === "open";
    queueActive = !!settings.queueActive;

    // Paint buttons
    if (walkinBtn)
      walkinBtn.textContent = walkinsEnabled
        ? "Disable Walk-ins"
        : "Enable Walk-ins";
    if (openCloseBtn)
      openCloseBtn.textContent = restaurantOpen ? "Close" : "Open";

    if (queueActive) {
      stopQueueBtn?.classList.remove("hidden");
      restartQueueBtn?.classList.add("hidden");
    } else {
      stopQueueBtn?.classList.add("hidden");
      restartQueueBtn?.classList.remove("hidden");
    }

    updateMetrics();
  } catch (e) {
    console.warn("fetchSettings error:", e);
  }
}

async function putSettings(patch) {
  const res = await fetch(`${API_BASE}/api/settings`, {
    method: "PUT",
    credentials: FETCH_CREDENTIALS,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error("settings update failed");
  const data = await res.json();
  settings = data.settings || settings;

  // mirror to local flags
  walkinsEnabled = !!settings.walkinsEnabled;
  restaurantOpen = settings.openStatus === "open";
  queueActive = !!settings.queueActive;

  // paint buttons after update
  if (walkinBtn)
    walkinBtn.textContent = walkinsEnabled
      ? "Disable Walk-ins"
      : "Enable Walk-ins";
  if (openCloseBtn)
    openCloseBtn.textContent = restaurantOpen ? "Close" : "Open";

  if (queueActive) {
    stopQueueBtn?.classList.remove("hidden");
    restartQueueBtn?.classList.add("hidden");
  } else {
    stopQueueBtn?.classList.add("hidden");
    restartQueueBtn?.classList.remove("hidden");
  }

  updateMetrics();
}

/* =========================
   SERVER: Queue
========================= */
async function fetchQueue() {
  try {
    const res = await fetch(`${API_BASE}/api/queue`, {
      credentials: FETCH_CREDENTIALS,
    });
    if (!res.ok) throw new Error("queue fetch failed");
    const data = await res.json();

    queue = Array.isArray(data.queue) ? data.queue : [];
    spotsLeft = Number(data.spotsLeft ?? 0);
    totalSeats = Number(data.totalSeats ?? 0);
    seatsUsed = Number(data.seatsUsed ?? 0);

    if (data.settings) {
      settings = data.settings;
      walkinsEnabled = !!settings.walkinsEnabled;
      restaurantOpen = settings.openStatus === "open";
      queueActive = !!settings.queueActive;
    }

    renderQueue();
  } catch (e) {
    console.warn("fetchQueue error:", e);
    queue = [];
    renderQueue();
  }
}

/* =========================
   Renderers
========================= */
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

function renderQueue() {
  // spots left label
  if (spotsLeftEl) {
    spotsLeftEl.textContent =
      totalSeats > 0
        ? `Spots left: ${spotsLeft} / ${totalSeats} (used: ${seatsUsed})`
        : `Spots left: —`;
  }

  if (!queueList) return;
  queueList.innerHTML = "";

  if (!queueActive) {
    queueList.innerHTML =
      "<p style='color:#ef4444'>Queue stopped for the day.</p>";
    updateMetrics();
    drawChart();
    return;
  }

  if (!queue.length) {
    queueList.innerHTML =
      "<p style='color:#6B7280'>No one currently in queue.</p>";
    updateMetrics();
    drawChart();
    return;
  }

  queue.forEach((q) => {
    const row = document.createElement("div");
    row.className = "queue-item";
    const disabledAttr = queueActive ? "" : "disabled";
    row.innerHTML = `
      <span>${q.position}. ${q.name} (${q.people} people)</span>
      <input type="checkbox" class="checkbox" data-id="${q._id}" aria-label="Mark served" ${disabledAttr}>
    `;
    queueList.appendChild(row);
  });

  updateMetrics();
  drawChart();
}

/* =========================
   Modal
========================= */
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

undoBtn?.addEventListener("click", openModal);
modalClose?.addEventListener("click", closeModal);
modalClose2?.addEventListener("click", closeModal);
modal?.addEventListener("click", (e) => {
  if (e.target === modal) closeModal();
});

/* =========================
   Controls (persist to /api/settings)
========================= */
walkinBtn?.addEventListener("click", async () => {
  try {
    await putSettings({ walkinsEnabled: !walkinsEnabled });
    walkinBtn.textContent = walkinsEnabled
      ? "Disable Walk-ins"
      : "Enable Walk-ins";
    showToast(`Walk-ins ${walkinsEnabled ? "enabled" : "disabled"}`);
  } catch {
    showToast("Failed to update walk-ins");
  }
});

openCloseBtn?.addEventListener("click", async () => {
  try {
    const next = restaurantOpen ? "closed" : "open";
    await putSettings({ openStatus: next });
    openCloseBtn.textContent = restaurantOpen ? "Close" : "Open";
    showToast(`Restaurant set to ${restaurantOpen ? "Open" : "Closed"}`);
  } catch {
    showToast("Failed to update open status");
  }
});

if (stopQueueBtn) {
  stopQueueBtn.addEventListener("click", async () => {
    try {
      await putSettings({ queueActive: false });
      stopQueueBtn.classList.add("hidden");
      restartQueueBtn?.classList.remove("hidden");
      renderQueue();
      showToast("Queue stopped for the day");
    } catch {
      showToast("Failed to stop queue");
    }
  });
}
if (restartQueueBtn) {
  restartQueueBtn.addEventListener("click", async () => {
    try {
      await putSettings({ queueActive: true });
      stopQueueBtn?.classList.remove("hidden");
      restartQueueBtn.classList.add("hidden");
      renderQueue();
      showToast("Queue restarted");
    } catch {
      showToast("Failed to restart queue");
    }
  });
}

/* =========================
   Queue actions (serve/undo)
========================= */
queueList?.addEventListener("change", async (e) => {
  if (e.target.matches(".checkbox") && queueActive) {
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
      await fetchQueue();
      showToast(`Removed ${removed?.name ?? "guest"}`, true);
    } catch (err) {
      console.warn(err);
      showToast("Failed to mark served");
      e.target.checked = false;
    }
  }
});

// Toast + Modal UNDO (server restore)
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

/* =========================
   SSE for live updates (with polling fallback)
========================= */
let es;
function startQueueStream() {
  if (!window.EventSource) {
    // fallback: poll
    setInterval(fetchQueue, 5000);
    return;
  }

  es = new EventSource(`${API_BASE}/api/queue/stream`, {
    withCredentials: true,
  });

  es.addEventListener("snapshot", (evt) => {
    try {
      const data = JSON.parse(evt.data);

      queue = Array.isArray(data.queue) ? data.queue : [];
      spotsLeft = Number(data.spotsLeft ?? 0);
      totalSeats = Number(data.totalSeats ?? 0);
      seatsUsed = Number(data.seatsUsed ?? 0);

      if (data.settings) {
        settings = data.settings;
        walkinsEnabled = !!settings.walkinsEnabled;
        restaurantOpen = settings.openStatus === "open";
        queueActive = !!settings.queueActive;
      }

      renderQueue();
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

/* =========================
   Chart (tiny custom bars)
========================= */
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
  queue.forEach((q, i) => {
    const ppl = Number(q.people) || 0;
    const x = i * (barW + gap) + 40;
    const y = h - ppl * scale - 14;
    ctx.fillRect(x, y, barW, ppl * scale);
    ctx.fillStyle = "#94a3b8";
    ctx.font = "12px Plus Jakarta Sans";
    ctx.fillText(ppl, x + 5, y - 4);
    ctx.fillStyle = "#8B5CF6";
  });
}

/* =========================
   Init
========================= */
(async function init() {
  await fetchSettings(); // load server settings first
  await fetchAnnouncements();
  await fetchQueue(); // first paint quickly
  startQueueStream(); // keep it fresh without refresh
})();
