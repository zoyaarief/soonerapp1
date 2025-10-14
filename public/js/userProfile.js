const links = document.querySelectorAll(".navlink");
const sections = [...document.querySelectorAll("section.user-card, section.section")];
function setActive() {
  const y = window.scrollY + 120;
  let current = sections[0].id;
  sections.forEach((s) => {
    if (y >= s.offsetTop) current = s.id;
  });
  links.forEach((a) =>
    a.classList.toggle("active", a.getAttribute("href") === "#" + current)
  );
}
window.addEventListener("scroll", setActive);
setActive();

const userName = document.getElementById("userName");
userName.textContent = localStorage.getItem("customerName") || "Customer";

(async function loadProfile() {
  try {
    const res = await fetch("/api/customers/me", { credentials: "include" });
    if (!res.ok) throw new Error("not logged in");
    const me = await res.json();
    if (me.name) document.getElementById("userName").textContent = me.name;
    if (me.email) document.getElementById("userEmail").textContent = me.email;
    if (me.phone) document.getElementById("userPhone").textContent = me.phone;
  } catch (err) {
    console.warn("Could not load profile", err);
  }
})();

// ---------- Favorites -----------
async function loadFavorites() {
  const box = document.getElementById("favorites");
  box.textContent = "Loading…";

  try {
    const likes = await fetch("/api/likes", { credentials: "include" });
    if (!likes.ok) throw new Error("Failed");
    const arr = await likes.json();

    if (!arr.length) {
      box.innerHTML = `<div class="muted">No favorites yet.</div>`;
      return;
    }

    box.innerHTML = "";
    for (const fav of arr) {
      const div = document.createElement("div");
      div.className = "card small";
      div.innerHTML = `
        <h4>${fav.name || "Unnamed"}</h4>
        <p>${fav.city || ""}</p>
        <button class="btn small" onclick="location.href='place.html?id=${encodeURIComponent(fav.venueId || fav._id)}'">Open</button>
      `;
      box.appendChild(div);
    }
  } catch (err) {
    console.error("Favorites load failed", err);
    box.innerHTML = `<div class="muted">Couldn't load favorites.</div>`;
  }
}

// ---------- Visited Places -----------
async function loadHistory() {
  const box = document.getElementById("history");
  box.textContent = "Loading…";

  try {
    const r = await fetch("/api/history", { credentials: "include" });
    if (!r.ok) throw new Error("Failed");
    const items = await r.json();

    if (!items.length) {
      box.innerHTML = `<div class="muted">No visits yet.</div>`;
      return;
    }

    box.innerHTML = "";
    for (const h of items) {
      const div = document.createElement("div");
      const dt = new Date(h.at || h.date || Date.now()).toLocaleString();
      div.className = "card small";
      div.innerHTML = `
        <h4>${h.name || "Unknown place"}</h4>
        <p>Visited ${dt}</p>
        <button class="btn small" onclick="location.href='place.html?id=${encodeURIComponent(h.venueId || h._id)}'">Revisit</button>
      `;
      box.appendChild(div);
    }
  } catch (err) {
    console.error("History load failed", err);
    box.innerHTML = `<div class="muted">Couldn't load history.</div>`;
  }
}

// ---------- Active Queue -----------
async function loadActiveQueue() {
  const box = document.getElementById("activeQueue");
  box.textContent = "Loading…";

  try {
    const res = await fetch("/api/queue/active", { credentials: "include" });
    if (res.status === 204) {
      box.innerHTML = `<div class="muted">You have no active queue.</div>`;
      return;
    }
    if (!res.ok) throw new Error("Failed");
    const data = await res.json();

    box.innerHTML = `
      <p>You’re in line at <b>${data.venueName || "—"}</b></p>
      <p>Position: <b>#${data.position ?? "?"}</b> · Party: ${data.people ?? "?"}</p>
      <p>Approx wait: ${data.approxWaitMins ? data.approxWaitMins + "m" : "—"}</p>
      <div class="row gap">
        <button class="btn small" onclick="location.href='place.html?id=${encodeURIComponent(data.venueId)}'">Open place</button>
        <button class="btn ghost small" onclick="location.href='place.html?id=${encodeURIComponent(data.venueId)}#queue'">Manage</button>
      </div>
    `;
  } catch (err) {
    console.error("Active queue load failed", err);
    box.innerHTML = `<div class="muted">Couldn't load queue info.</div>`;
  }
}



// Avatar upload (local only)
const avatarInput = document.getElementById("avatarInput");
avatarInput?.addEventListener("change", async (e) => {
  const f = e.target.files?.[0];
  if (!f) return;
  const fr = new FileReader();
  fr.onload = () => {
    document.getElementById("avatar").src = fr.result;
    localStorage.setItem("customerAvatar", fr.result);
  };
  fr.readAsDataURL(f);
});
const savedAvatar = localStorage.getItem("customerAvatar");
if (savedAvatar) document.getElementById("avatar").src = savedAvatar;

// Stats + lists
function getFavs() {
  try {
    return JSON.parse(localStorage.getItem("favorites") || "[]");
  } catch {
    return [];
  }
}
function getHist() {
  try {
    return JSON.parse(localStorage.getItem("history") || "[]");
  } catch {
    return [];
  }
}
function getActive() {
  try {
    return JSON.parse(localStorage.getItem("activeQueue") || "null");
  } catch {
    return null;
  }
}

function render() {
  const favs = getFavs();
  const hist = getHist();
  const active = getActive();
  document.getElementById("statFavs").textContent = String(favs.length);
  document.getElementById("statHistory").textContent = String(hist.length);
  document.getElementById("statActive").textContent = active
    ? `${active.placeName} • #${active.position}`
    : "None";

  const favList = document.getElementById("favList");
  favList.innerHTML = "";
  if (!favs.length)
    favList.innerHTML = `<li class="muted">No favorites yet.</li>`;
  favs.forEach((f) => {
    const li = document.createElement("li");
    li.innerHTML = `<span>${f.name} • ⭐ ${f.rating ?? "—"}</span>
                    <span>
                      <a class="btn btn--ghost small" href="place.html?id=${encodeURIComponent(f.id)}">Open</a>
                      <button data-rm="${f.id}" class="btn small">Remove</button>
                    </span>`;
    favList.appendChild(li);
  });
  favList.addEventListener(
    "click",
    (e) => {
      const rm = e.target.closest("[data-rm]");
      if (!rm) return;
      const id = rm.getAttribute("data-rm");
      const arr = getFavs();
      const i = arr.findIndex((x) => x.id === id);
      if (i > -1) arr.splice(i, 1);
      localStorage.setItem("favorites", JSON.stringify(arr));
      render();
    },
    { once: true }
  );

  const hList = document.getElementById("historyList");
  hList.innerHTML = "";
  if (!hist.length) hList.innerHTML = `<li class="muted">No visits yet.</li>`;
  hist.forEach((h) => {
    const dt = new Date(h.at).toLocaleString();
    const li = document.createElement("li");
    li.innerHTML = `<span>${h.name} • ${dt}</span>
                    <span>
                      <a class="btn btn--ghost small" href="place.html?id=${encodeURIComponent(h.id)}">Revisit</a>
                      <button class="btn small" data-fav="${h.id}">Fav</button>
                    </span>`;
    hList.appendChild(li);
  });
  hList.addEventListener(
    "click",
    (e) => {
      const fav = e.target.closest("[data-fav]");
      if (!fav) return;
      const id = fav.getAttribute("data-fav");
      const favs = JSON.parse(localStorage.getItem("favorites") || "[]");
      if (!favs.some((f) => f.id === id)) {
        const place = JSON.parse(localStorage.getItem("places") || "[]").find(
          (p) => p.id === id
        );
        favs.push({
          id,
          name: place?.name || "Place",
          rating: place?.rating || 0,
        });
        localStorage.setItem("favorites", JSON.stringify(favs));
        render();
      }
    },
    { once: true }
  );

  render();

  // Account form
  const acctForm = document.getElementById("acctForm");
  const status = document.getElementById("status");
  (function hydrate() {
    const profile = JSON.parse(localStorage.getItem("customerProfile") || "{}");
    document.getElementById("name").value =
      profile.name || localStorage.getItem("customerName") || "";
    document.getElementById("phone").value = profile.phone || "";
    document.getElementById("email").value = profile.email || "";
  })();
  acctForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const profile = {
      name: document.getElementById("name").value.trim(),
      phone: document.getElementById("phone").value.trim(),
      email: document.getElementById("email").value.trim(),
    };
    localStorage.setItem("customerProfile", JSON.stringify(profile));
    if (profile.name) {
      localStorage.setItem("customerName", profile.name);
      userName.textContent = profile.name;
    }
    status.style.color = "green";
    status.textContent = "Saved";
    setTimeout(() => (status.textContent = ""), 1500);
  });
}

(async function initExtras() {
  await loadFavorites();
  await loadHistory();
  await loadActiveQueue();
})();
