// public/js/place.js — Single venue page with join/cancel, live position & 45-min rule (server-backed with fallbacks) + settings key fix

// ============== Helpers ==============
function qs(sel) {
  return document.querySelector(sel);
}
function qsa(sel) {
  return Array.from(document.querySelectorAll(sel));
}

const API_BASE = "http://localhost:3000";

// Toast
const toastEl = qs("#toast");
const toastText = qs("#toastText");
qs("#toastClose")?.addEventListener("click", () =>
  toastEl?.classList.remove("show")
);
function toast(msg) {
  if (!toastEl || !toastText) {
    console.log("[toast]", msg);
    return;
  }
  toastText.textContent = msg;
  toastEl.classList.add("show");
  clearTimeout(toastEl._t);
  toastEl._t = setTimeout(() => toastEl.classList.remove("show"), 2200);
}

async function fetchJSON(url, opts = {}) {
  const r = await fetch(url, { credentials: "include", ...opts });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

const usp = new URLSearchParams(location.search);
const currentId = usp.get("id");
let pollingT = null;

// ============== Venue load ==============
async function loadVenue() {
  const v = await fetchJSON(
    `${API_BASE}/api/owners/public/${encodeURIComponent(currentId)}`
  );
  qs("#name") && (qs("#name").textContent = v.name);
  qs("#rating") && (qs("#rating").textContent = v.rating ?? "—");
  qs("#cover") && (qs("#cover").src = v.heroImage || "./images/restaurant.jpg");
  qs("#description") && (qs("#description").textContent = v.description || "");
  qs("#features") && (qs("#features").textContent = v.features || "");
  qs("#timing") &&
    (qs("#timing").textContent = `${v.openTime || ""} - ${v.closeTime || ""}`);
  qs("#location") && (qs("#location").textContent = v.location || "");

  if (v.gallery && v.gallery.length) {
    const galleryEl = document.getElementById("gallery");
    if (galleryEl) {
      galleryEl.innerHTML = v.gallery
        .map((g) => `<img src="${g}" alt="gallery image">`)
        .join("");
    }
  }

  // === load announcement if exists ===
  await loadAnnouncement(currentId);

  // unhide main container once venue data is ready
  document.getElementById("main")?.classList.remove("hidden");

  // check owner settings — 🔧 fix field names to match server
  try {
    const s = await fetchJSON(
      `${API_BASE}/api/owner_settings/${encodeURIComponent(currentId)}`
    );
    const enterBtn = qs("#enterBtn");
    if (!s.walkinsEnabled || s.openStatus !== "open" || !s.queueActive) {
      if (enterBtn) {
        enterBtn.disabled = true;
        enterBtn.textContent = "Queue Unavailable";
        enterBtn.classList.add("disabled");
      }
    }
  } catch {
    // ignore missing settings
  }
}

async function loadAnnouncement(venueId) {
  try {
    const a = await fetchJSON(
      `${API_BASE}/api/announcements/venue/${encodeURIComponent(venueId)}`
    );
    if (a?.message) {
      const banner = document.getElementById("announcement");
      const text = document.getElementById("announcementText");
      const icon = document.getElementById("announcementIcon");
      if (banner && text && icon) {
        icon.textContent = a.type === "offer" ? "🎁" : "📢";
        text.textContent = a.message;
        banner.classList.remove("hidden");
      }
    }
  } catch {
    // no announcement found → ignore
  }
}

// ============== Queue actions ==============
async function joinQueue(people) {
  try {
    const r = await fetch(
      `${API_BASE}/api/queue/${encodeURIComponent(currentId)}/join`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ people }),
      }
    );
    if (r.status === 401) {
      const ret = encodeURIComponent(location.pathname + location.search);
      location.href = `ownerSignUp.html?role=customer&mode=login&returnTo=${ret}`;
      return;
    }
    const data = await r.json();
    toast(`✅ Joined queue (order #${data.order})`);
    await loadActive(); // begin polling
  } catch (e) {
    toast("Failed to join queue");
  }
}

async function cancelQueue() {
  try {
    await fetch(
      `${API_BASE}/api/queue/${encodeURIComponent(currentId)}/cancel`,
      { method: "POST", credentials: "include" }
    );
    toast("❌ You left the queue");
    stopPolling();
    renderActive(null);
  } catch (e) {
    toast("Failed to cancel");
  }
}

async function arrived() {
  try {
    await fetch(
      `${API_BASE}/api/queue/${encodeURIComponent(currentId)}/arrived`,
      { method: "POST", credentials: "include" }
    );
    toast("⏸️ Timer paused — we’ll wait here until the owner lets you in");
  } catch (e) {
    toast("Failed to update arrival");
  }
}

// ============== Active state & polling ==============
function stopPolling() {
  if (pollingT) {
    clearInterval(pollingT);
    pollingT = null;
  }
}

function formatCountdown(ms) {
  if (!ms || ms < 0) return "00:00";
  const s = Math.floor(ms / 1000);
  const m = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${m}:${ss}`;
}

function renderActive(active, venueWaiting) {
  const box = qs("#activeQueue");
  if (!box) return;
  if (!active) {
    box.innerHTML = "<p>No active queue.</p>";
    return;
  }
  const yourOrder = active.order;
  const waiting = Number(venueWaiting ?? 0);
  const position = Math.max(1, Math.min(yourOrder, waiting)) || 1;

  let near = active.nearTurnAt ? new Date(active.nearTurnAt) : null;
  let deadline = active.arrivalDeadline
    ? new Date(active.arrivalDeadline)
    : null;

  if (!near && position <= 5) {
    near = new Date();
    deadline = new Date(near.getTime() + 45 * 60 * 1000);
  }

  const now = Date.now();
  const msLeft = deadline ? deadline.getTime() - now : null;

  box.innerHTML = `
    <p>You're currently <b>#${position}</b> in line.</p>
    <div class="timerRow">
      <span>Near turn timer:</span>
      <b id="timerLeft">${deadline ? formatCountdown(msLeft) : "—"}</b>
    </div>
    <div class="actions">
      <button id="cancelBtn">Cancel</button>
      <button id="imhere">I'm here</button>
    </div>
  `;

  qs("#cancelBtn")?.addEventListener("click", cancelQueue);
  qs("#imhere")?.addEventListener("click", arrived);

  if (deadline) {
    const t = setInterval(() => {
      const left = deadline.getTime() - Date.now();
      const el = qs("#timerLeft");
      if (!el) {
        clearInterval(t);
        return;
      }
      el.textContent = formatCountdown(left);
      if (left <= 0) {
        clearInterval(t);
        toast("⌛ Time exceeded — you may be moved out of the queue");
      }
    }, 1000);
  }
}

async function loadActive() {
  try {
    const [active, venue] = await Promise.all([
      fetchJSON(`${API_BASE}/api/queue/active`),
      fetchJSON(`${API_BASE}/api/venues/${encodeURIComponent(currentId)}`),
    ]);
    if (!active || String(active.venueId) !== String(currentId)) {
      renderActive(null);
      stopPolling();
      return;
    }
    renderActive(active, venue?.waiting);
    if (!pollingT) {
      pollingT = setInterval(loadActive, 10_000);
    }
  } catch (e) {
    console.warn("poll failed", e);
  }
}

// ============== Reviews (client-side demo) ==============
async function canReview() {
  try {
    const hist = await fetchJSON(`${API_BASE}/api/history`);
    return hist.some(
      (h) =>
        String(h.venueId || h.venue_id) === String(currentId) &&
        h.type === "queue.served"
    );
  } catch {
    return false;
  }
}
function renderReviews() {
  const listEl = qs("#reviewsList");
  if (!listEl) return;
  const arr = JSON.parse(localStorage.getItem("reviews_" + currentId) || "[]");
  listEl.innerHTML =
    arr
      .map((r) => {
        const dt = new Date(r.at).toLocaleString();
        return `<li><b>${r.user}</b> • ⭐ ${r.rating}<br>${r.text}<br><span class="muted">${dt}</span></li>`;
      })
      .join("") || "<p class='muted'>No reviews yet.</p>";
}
async function handlePostReview() {
  if (!(await canReview())) {
    toast("You can review after being served.");
    return;
  }
  const textEl = qs("#revText");
  const ratingEl = qs("#revRating");
  if (!textEl || !ratingEl) return;
  const text = textEl.value.trim();
  const rating = Number(ratingEl.value || 5);
  if (!text) {
    toast("Write something first");
    return;
  }
  const user = localStorage.getItem("customerName") || "Customer";
  const arr = JSON.parse(localStorage.getItem("reviews_" + currentId) || "[]");
  arr.unshift({ user, rating, text, at: Date.now() });
  localStorage.setItem("reviews_" + currentId, JSON.stringify(arr));
  textEl.value = "";
  toast("Review posted");
  renderReviews();
}

// ============== Wire UI ==============
qs("#enterBtn")?.addEventListener("click", () => {
  let people = 2;
  const inp = prompt("How many people in your party?", "2");
  if (inp !== null) {
    const n = Math.max(1, Math.min(12, Number(inp)));
    if (!Number.isFinite(n)) return;
    people = n;
  }
  joinQueue(people);
});
qs("#postReviewBtn")?.addEventListener("click", handlePostReview);

// Init
(async function init() {
  if (!currentId) {
    document.body.innerHTML =
      "<p style='padding:20px'>Place not specified.</p>";
    return;
  }
  await loadVenue();
  await loadActive();
  renderReviews();
})();
