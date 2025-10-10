const sidebar = document.getElementById("sidebar");
const toggleBtn = document.getElementById("sidebarToggle");
toggleBtn?.addEventListener("click", () => sidebar?.classList.toggle("collapsed"));

// Greeting
const name = localStorage.getItem("customerName") || "Customer";
document.getElementById("customerName").textContent = name;
document.getElementById("greetName").textContent = name;

// Pills data
function getFavs() {
  try { return JSON.parse(localStorage.getItem("favorites") || "[]"); } catch { return []; }
}
function getHistory() {
  try { return JSON.parse(localStorage.getItem("history") || "[]"); } catch { return []; }
}
function getActive() {
  try { return JSON.parse(localStorage.getItem("activeQueue") || "null"); } catch { return null; }
}
function setText(id, txt) { const el = document.getElementById(id); if (el) el.textContent = txt; }
function toast(t){ const el = document.getElementById("toast"); const tx = document.getElementById("toastText"); if(!el||!tx) return; tx.textContent = t; el.classList.add("show"); clearTimeout(toast._t); toast._t = setTimeout(()=>el.classList.remove("show"), 2600); }
document.getElementById("toastClose")?.addEventListener("click", () => document.getElementById("toast")?.classList.remove("show"));

function refresh() {
  const favs = getFavs();
  const hist = getHistory();
  const active = getActive();
  setText("pillFavs", String(favs.length));
  setText("pillHistory", String(hist.length));
  if (active) {
    setText("pillQueue", `${active.placeName} • #${active.position}`);
    document.getElementById("gotoActive")?.classList.remove("hidden");
    document.getElementById("continueBlock").innerHTML = `<strong>${active.placeName}</strong><br/>You are #${active.position} in queue. <a href="place.html?id=${encodeURIComponent(active.placeId)}">Open</a>`;
  } else {
    setText("pillQueue", "None");
    document.getElementById("gotoActive")?.classList.add("hidden");
    document.getElementById("continueBlock").textContent = "No active queue.";
  }

  // Favorites list
  const list = document.getElementById("favList");
  const empty = document.getElementById("favEmpty");
  if (list) {
    list.innerHTML = "";
    if (!favs.length) { empty.style.display = "block"; }
    else {
      empty.style.display = "none";
      favs.slice(0,6).forEach(f => {
        const li = document.createElement("li");
        li.innerHTML = `<span>${f.name} • ⭐ ${f.rating ?? "—"}</span> <a class="btn btn--ghost small" href="place.html?id=${encodeURIComponent(f.id)}">Open</a>`;
        list.appendChild(li);
      });
    }
  }

  // Recently viewed
  const rec = JSON.parse(localStorage.getItem("recentPlaces") || "[]");
  const row = document.getElementById("recentRow");
  if (row) {
    row.innerHTML = "";
    rec.slice(0,8).forEach(p => {
      const tile = document.createElement("div");
      tile.className = "tile";
      tile.innerHTML = `<img src="${p.image || "./images/restaurant2.jpg"}" alt="${p.name}" />
                        <div class="meta"><span>${p.name}</span><a class="btn btn--ghost small" href="place.html?id=${encodeURIComponent(p.id)}">Open</a></div>`;
      row.appendChild(tile);
    });
  }
}
refresh();

document.getElementById("useLocation")?.addEventListener("click", () => {
  if (!navigator.geolocation) { toast("Geolocation not supported"); return; }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      localStorage.setItem("userLocation", JSON.stringify({lat: pos.coords.latitude, lng: pos.coords.longitude, ts: Date.now()}));
      toast("Location saved"); 
      window.location.href = "browse.html?nearby=1";
    },
    () => toast("Location denied")
  );
});

document.getElementById("globalSearch")?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    const q = e.currentTarget.value.trim();
    if (q) window.location.href = `browse.html?q=${encodeURIComponent(q)}`;
  }
});

document.getElementById("gotoActive")?.addEventListener("click", () => {
  const a = getActive();
  if (a) location.href = `place.html?id=${encodeURIComponent(a.placeId)}`;
});
