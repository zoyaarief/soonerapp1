const toastEl = document.getElementById("toast");
const toastText = document.getElementById("toastText");
document.getElementById("toastClose")?.addEventListener("click", () => toastEl?.classList.remove("show"));
function toast(t){ if(!toastEl||!toastText) return; toastText.textContent = t; toastEl.classList.add("show"); clearTimeout(toast._t); toast._t=setTimeout(()=>toastEl.classList.remove("show"), 2400); }

// Seed demo places if not present
function seed() {
  if (localStorage.getItem("places")) return;
  const places = [
    { id: "r_olive", category: "restaurants", name: "Olive & Thyme", location: "Boston", price: 2, rating: 4.6, cuisine: "Mediterranean", queue: 7, waitPerGroup: 8, image: "./images/restaurant2.jpg" },
    { id: "r_sushi", category: "restaurants", name: "Sora Sushi", location: "Cambridge", price: 3, rating: 4.7, cuisine: "Japanese", queue: 3, waitPerGroup: 10, image: "./images/restaurant.jpg" },
    { id: "s_blush", category: "salons", name: "Blush & Blow", location: "Cambridge", price: 2, rating: 4.4, cuisine: "Salon", queue: 2, waitPerGroup: 12, image: "./images/salon2.jpg" },
    { id: "c_river", category: "clinics", name: "Riverwalk Clinic", location: "Boston", price: 2, rating: 4.3, cuisine: "General", queue: 9, waitPerGroup: 6, image: "./images/clinic2.jpg" },
    { id: "e_arcade", category: "events", name: "Arcade Nights", location: "Somerville", price: 1, rating: 4.1, cuisine: "Event", queue: 12, waitPerGroup: 5, image: "./images/party2.jpg" },
    { id: "g_ups", category: "services", name: "UPS Center - Central Sq", location: "Cambridge", price: 1, rating: 4.0, cuisine: "Shipping", queue: 5, waitPerGroup: 4, image: "./images/clinic.jpg" }
  ];
  localStorage.setItem("places", JSON.stringify(places));
}
seed();

// Read params
const usp = new URLSearchParams(location.search);
const type = usp.get("type");
const nearby = usp.get("nearby")==="1";
const qIn = document.getElementById("q");
const title = document.getElementById("title");
if (type) title.textContent = type[0].toUpperCase()+type.slice(1);

// Filters
const locSel = document.getElementById("loc");
const priceSel = document.getElementById("price");
const ratingSel = document.getElementById("rating");
const cuisineIn = document.getElementById("cuisine");
document.getElementById("apply").addEventListener("click", render);
document.getElementById("clear").addEventListener("click", () => {
  qIn.value = ""; locSel.value=""; priceSel.value=""; ratingSel.value=""; cuisineIn.value=""; render();
});
qIn.addEventListener("keydown", (e) => { if(e.key==="Enter") render(); });

function getAll() { try { return JSON.parse(localStorage.getItem("places")||"[]"); } catch { return []; }}

function distanceScore(p) {
  const loc = JSON.parse(localStorage.getItem("userLocation")||"null");
  if (!loc) return Math.random(); // fallback
  // fake: random score as we don't have coords per place
  return Math.random();
}

function render() {
  const grid = document.getElementById("grid");
  const q = qIn.value.trim().toLowerCase();
  const loc = locSel.value;
  const price = Number(priceSel.value || 0);
  const rating = Number(ratingSel.value || 0);
  const cuisine = cuisineIn.value.trim().toLowerCase();

  let items = getAll().filter(p => (!type || p.category===type));
  if (q) items = items.filter(p => p.name.toLowerCase().includes(q) || p.cuisine.toLowerCase().includes(q));
  if (loc) items = items.filter(p => p.location===loc);
  if (price) items = items.filter(p => p.price===price);
  if (rating) items = items.filter(p => p.rating >= rating);
  if (cuisine) items = items.filter(p => p.cuisine.toLowerCase().includes(cuisine));

  if (nearby) items.sort((a,b)=>distanceScore(a)-distanceScore(b));
  else items.sort((a,b)=>b.rating-a.rating);

  grid.innerHTML = "";
  if (!items.length) {
    grid.innerHTML = `<p class="muted">No results. Try clearing filters.</p>`;
    return;
  }
  items.forEach(p => {
    const card = document.createElement("article");
    card.className = "card";
    card.innerHTML = `
      <img src="${p.image || "./images/restaurant2.jpg"}" alt="${p.name}" />
      <div class="body">
        <h3>${p.name}</h3>
        <div class="meta">
          <span>⭐ ${p.rating} · ${p.location} · ${"$".repeat(p.price)}</span>
          <span class="badge">${p.queue} in queue</span>
        </div>
        <div class="actions">
          <a class="btn small" href="place.html?id=${encodeURIComponent(p.id)}">Open</a>
          <button class="btn btn--ghost small" data-fav="${p.id}">♡</button>
        </div>
      </div>`;
    grid.appendChild(card);
  });

  grid.addEventListener("click", (e)=> {
    const btn = e.target.closest("[data-fav]"); if(!btn) return;
    const id = btn.getAttribute("data-fav");
    const p = getAll().find(x=>x.id===id); if(!p) return;
    const favs = JSON.parse(localStorage.getItem("favorites")||"[]");
    if (favs.some(f=>f.id===id)) {
      const i=favs.findIndex(f=>f.id===id); favs.splice(i,1);
      toast("Removed from favorites");
    } else {
      favs.push({id: p.id, name: p.name, rating: p.rating});
      toast("Added to favorites");
    }
    localStorage.setItem("favorites", JSON.stringify(favs));
  }, { once: true });
}
render();
