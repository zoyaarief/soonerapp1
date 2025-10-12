
// userDashboard.js — LIVE data + hearts + announcements + graceful fallbacks

// ============== Helpers ==============
function qs(sel){ return document.querySelector(sel); }
function qsa(sel){ return Array.from(document.querySelectorAll(sel)); }

// Toast (optional UI)
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

async function fetchJSON(url, opts={}){
  const r = await fetch(url, { credentials: "include", ...opts });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

const greetNameEl = document.getElementById("greetName");
if (greetNameEl) greetNameEl.textContent = localStorage.getItem("customerName") || "Customer";

// ====== Category buttons → Browse page ======
document.querySelectorAll(".categories button").forEach((btn) => {
  const raw = btn.getAttribute("data-type"); // e.g. "restaurants", "salons", etc.
  btn.addEventListener("click", () => {
    location.href = `browse.html?type=${encodeURIComponent(raw)}`;
  });
});

// Normalize plural/singular category names
function normalizeType(t){
  const map = { restaurants:"restaurant", restaurant:"restaurant",
                salons:"salon", salon:"salon",
                clinics:"clinic", clinic:"clinic",
                events:"event", event:"event",
                services:"other", service:"other", other:"other" };
  return map[(t||"").toLowerCase()] || t;
}

// Category buttons → browse
qsa(".categories button").forEach(btn => {
  btn.addEventListener("click", () => {
    const raw = btn.getAttribute("data-type");
    const type = normalizeType(raw);
    if (type) location.href = `browse.html?type=${encodeURIComponent(type)}`;
  });
});

// Explore nearby
document.getElementById("exploreBtn")?.addEventListener("click", () => {
  location.href = "browse.html?nearby=1";
});

// Announcements banner
fetchJSON("/api/announcements/active")
  .then(items => {
    if (!items?.length) return;
    const b = document.querySelector(".banner .text");
    if (!b) return;
    const first = items[0];
    b.innerHTML = `<h2>${first.type === "offer" ? "🎁 Offer" : "📢 Announcement"}</h2><p>${first.message}</p>`;
  })
  .catch(()=>{});

// Favorites (likes) — preload to render hearts
let likedSet = new Set();
async function loadLikes(){
  try {
    const likes = await fetchJSON("/api/likes");
    likedSet = new Set(likes.map(x => String(x.venueId || x.venue_id || x._id)));
  } catch(e){ likedSet = new Set(); }
}
function isLiked(id){ return likedSet.has(String(id)); }

function heartButtonHTML(id){
  const on = isLiked(id) ? "on" : "off";
  return `<button class="heart ${on}" aria-label="Favorite" data-like="${id}">♥</button>`;
}

async function toggleLike(venueId, btn){
  try{
    const idStr = String(venueId);
    if (isLiked(idStr)){
      await fetch(`/api/likes/${encodeURIComponent(idStr)}`, { method:"DELETE", credentials:"include" });
      likedSet.delete(idStr);
      btn?.classList.remove("on");
      toast("Removed from favorites");
    } else {
      await fetch(`/api/likes/${encodeURIComponent(idStr)}`, { method:"POST", credentials:"include" });
      likedSet.add(idStr);
      btn?.classList.add("on");
      toast("Added to favorites");
    }
  }catch(e){
    if (e?.message?.includes("Unauthorized") || e?.status === 401){
      const ret = encodeURIComponent(location.pathname + location.search);
      location.href = `ownerSignUp.html?role=customer&mode=login&returnTo=${ret}`;
      return;
    }
    toast("Action failed");
  }
}

// Card factory
function makeCard(p){
  const div = document.createElement("div");
  div.className = "card";
  div.innerHTML = `
    <div class="card-media">
      <img src="${p.heroImage || p.image || './images/restaurant.jpg'}" alt="${p.name}">
      <div class="card-actions">
        ${heartButtonHTML(p._id)}
      </div>
    </div>
    <div class="body">
      <h3>${p.name}</h3>
      <div class="meta">⭐ ${p.rating ?? "—"} · ${p.city || ""}</div>
      <button data-id="${p._id}">Join Queue</button>
    </div>`;
  div.querySelector("button[data-id]")?.addEventListener("click", () => {
    location.href = `place.html?id=${encodeURIComponent(p._id)}`;
  });
  div.querySelector("button.heart")?.addEventListener("click", (ev) => {
    ev.stopPropagation();
    toggleLike(p._id, ev.currentTarget);
  });
  return div;
}

// Render rows
async function renderSection(rowId, typeRaw){
  const type = normalizeType(typeRaw);
  const row = document.getElementById(rowId);
  if (!row) return;
  row.innerHTML = "<div class='muted'>Loading…</div>";

  try {
    const list = await fetchJSON(`/api/owners/public?type=${encodeURIComponent(type)}`);

    // sort by rating (desc), then slice top 5
    const sorted = list
      .sort((a, b) => (b.rating || 0) - (a.rating || 0))
      .slice(0, 5);

    row.innerHTML = "";
    sorted.forEach(p => row.appendChild(makeCard(p)));

  } catch(e) {
    console.error("renderSection error", e);
    row.innerHTML = "<div class='muted'>Failed to load.</div>";
  }
}

(async function init(){
  await loadLikes();
  renderSection("restaurantsRow", "restaurant");
  renderSection("salonsRow", "salon");
  renderSection("clinicsRow", "clinic");
  renderSection("eventsRow", "event");
})();

// redirect to profile page on click
document.getElementById("avatar")?.addEventListener("click", () => {
  window.location.href = "userProfile.html";
});

(async function loadAvatar(){
  try {
    const me = await fetchJSON("/api/customers/me");
    const img = document.getElementById("profilePic");
    if (me.avatar) img.src = me.avatar;
  } catch {}
})();

// Logout button → clear session + local data
const logoutBtn = document.getElementById("logoutBtn");
if (logoutBtn) {
  logoutBtn.addEventListener("click", async () => {
    try {
      await fetch("/api/logout", { method: "POST", credentials: "include" });
    } catch (err) {
      console.error("Logout failed", err);
    } finally {
      localStorage.clear();
      location.href = "ownerSignUp.html?role=customer&mode=login";
    }
  });
}

// Geolocation label (optional)
if (navigator.geolocation){
  navigator.geolocation.getCurrentPosition(
    (pos)=>{ localStorage.setItem("userLocation", JSON.stringify({ latitude: pos.coords.latitude, longitude: pos.coords.longitude })); qs("#userCity") && (qs("#userCity").textContent = "your location"); },
    ()=>{ qs("#userCity") && (qs("#userCity").textContent = "Boston"); }
  );
} else {
  qs("#userCity") && (qs("#userCity").textContent = "Boston");
}
