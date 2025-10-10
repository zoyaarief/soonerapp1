const usp = new URLSearchParams(location.search);
const id = usp.get("id");

const toastEl = document.getElementById("toast");
const toastText = document.getElementById("toastText");
document.getElementById("toastClose")?.addEventListener("click", () => toastEl?.classList.remove("show"));
function toast(t){ if(!toastEl||!toastText) return; toastText.textContent = t; toastEl.classList.add("show"); clearTimeout(toast._t); toast._t=setTimeout(()=>toastEl.classList.remove("show"), 2400); }

function getPlaces(){ try{return JSON.parse(localStorage.getItem("places")||"[]");}catch{return [];} }
const place = getPlaces().find(p=>p.id===id);
if (!place) {
  document.body.innerHTML = "<p style='padding:20px'>Place not found.</p>";
} else {
  // populate
  document.getElementById("main").classList.remove("hidden");
  document.getElementById("cover").src = place.image || "./images/restaurant.jpg";
  document.getElementById("name").textContent = place.name;
  document.getElementById("rating").textContent = place.rating;
  document.getElementById("location").textContent = place.location;
  document.getElementById("price").textContent = "$".repeat(place.price);
  document.getElementById("cuisine").textContent = place.cuisine;
  document.getElementById("queueBadge").textContent = `${place.queue} in queue`;

  // remember recent
  const rec = JSON.parse(localStorage.getItem("recentPlaces")||"[]");
  const trimmed = [ {id: place.id, name: place.name, image: place.image} ].concat(rec.filter(x=>x.id!==place.id)).slice(0,12);
  localStorage.setItem("recentPlaces", JSON.stringify(trimmed));
}

// Queue UI state
let active = JSON.parse(localStorage.getItem("activeQueue")||"null");
const countEl = document.getElementById("count");
const waitEl = document.getElementById("wait");
const posEl = document.getElementById("pos");
const enterBtn = document.getElementById("enterBtn");
const cancelBtn = document.getElementById("cancelBtn");
const peopleRow = document.getElementById("peopleRow");
const peopleIn = document.getElementById("people");
const timerRow = document.getElementById("timerRow");
const countdownEl = document.getElementById("countdown");
const imHereBtn = document.getElementById("imHere");
const checkedInBtn = document.getElementById("checkedIn");
const favBtn = document.getElementById("favBtn");
const queueBadge = document.getElementById("queueBadge");

let simInterval = null;
let timerInterval = null;
let timerEndsAt = null;
let timerPaused = false;

function renderQueue() {
  const queueCount = place.queue + (active && active.placeId===place.id ? 1 : 0);
  countEl.textContent = String(queueCount);
  const est = Math.max( (queueCount) * (place.waitPerGroup||8), 1 );
  waitEl.textContent = `${est} mins`;

  if (active && active.placeId===place.id) {
    enterBtn.classList.add("hidden");
    cancelBtn.classList.remove("hidden");
    peopleRow.classList.add("hidden");
    posEl.textContent = String(active.position);
    if (active.position <= 5) {
      timerRow.classList.remove("hidden");
      if (!timerEndsAt && !timerPaused) startTimer(45*60);
    } else {
      timerRow.classList.add("hidden");
    }
  } else {
    enterBtn.classList.remove("hidden");
    cancelBtn.classList.add("hidden");
    posEl.textContent = "—";
    timerRow.classList.add("hidden");
  }
  queueBadge.textContent = `${queueCount} in queue`;
}

function startSimulation() {
  if (simInterval) clearInterval(simInterval);
  // demo speed: every 12s position decreases by 1
  simInterval = setInterval(() => {
    if (!active || active.placeId !== place.id) return;
    if (active.position > 1) {
      active.position--;
      localStorage.setItem("activeQueue", JSON.stringify(active));
      renderQueue();
      if (active.position === 5 && !timerEndsAt) startTimer(45*60);
      if (active.position === 3) pushNotify("near", "You're near your turn (#3).");
      if (active.position === 1) pushNotify("near", "You're up next!");
    }
  }, 12000);
}
function stopSimulation(){ if (simInterval) clearInterval(simInterval); simInterval=null; }

function startTimer(seconds) {
  timerPaused = false;
  timerEndsAt = Date.now() + seconds*1000;
  if (timerInterval) clearInterval(timerInterval);
  tickTimer();
  timerInterval = setInterval(tickTimer, 1000);
}
function pauseTimer() { timerPaused = true; if (timerInterval) clearInterval(timerInterval); }
function tickTimer() {
  if (timerPaused) return;
  const left = Math.max(0, Math.floor((timerEndsAt - Date.now()) / 1000));
  const mm = String(Math.floor(left/60)).padStart(2,"0");
  const ss = String(left%60).padStart(2,"0");
  countdownEl.textContent = `${mm}:${ss}`;
  if (left <= 0) {
    clearInterval(timerInterval);
    // auto drop
    toast("Time exceeded. You were removed from the queue.");
    pushNotify("expired", "45 minutes passed — removed from queue.");
    cancelQueue(false);
  }
}

function ensureLoginAndProceed(next) {
  const role = localStorage.getItem("role");
  if (role !== "customer") {
    const ret = encodeURIComponent(location.pathname + location.search);
    location.href = `ownerSignUp.html?role=customer&mode=login&returnTo=${ret}`;
    return false;
  }
  next?.();
  return true;
}

function enterQueue() {
  const people = Math.max(1, Math.min(12, Number(peopleIn.value || 2)));
  const basePos = place.queue + 1;
  active = {
    placeId: place.id,
    placeName: place.name,
    people,
    position: basePos,
    startedAt: Date.now(),
    status: "waiting"
  };
  localStorage.setItem("activeQueue", JSON.stringify(active));
  toast("Entered queue");
  pushNotify("entered", `Entered ${place.name} queue as #${basePos}`);
  renderQueue();
  startSimulation();
}

function cancelQueue(showNotif=true) {
  if (active && active.placeId===place.id) {
    if (showNotif) pushNotify("canceled", `You left ${place.name}'s queue`);
  }
  active = null;
  localStorage.removeItem("activeQueue");
  timerEndsAt = null; timerPaused=false; if (timerInterval) clearInterval(timerInterval);
  stopSimulation();
  renderQueue();
}

function markServed() {
  // add to history
  const history = JSON.parse(localStorage.getItem("history")||"[]");
  history.unshift({
    id: place.id, name: place.name, at: Date.now(), people: active?.people||1
  });
  localStorage.setItem("history", JSON.stringify(history));
  // allow reviews afterwards
  localStorage.setItem("canReview_"+place.id, "1");
  cancelQueue(false);
  toast("Marked as served. You can review now.");
}

function pushNotify(type, message) {
  // Toast
  toast(message);
  // Browser Notification (optional)
  if ("Notification" in window) {
    if (Notification.permission === "granted") {
      new Notification("Sooner", { body: message });
    } else if (Notification.permission !== "denied") {
      Notification.requestPermission().then((p)=>{
        if (p==="granted") new Notification("Sooner", { body: message });
      });
    }
  }
}

// Bindings
enterBtn?.addEventListener("click", () => ensureLoginAndProceed(() => {
  peopleRow.classList.remove("hidden");
  if (peopleIn) peopleIn.focus();
  // If already visible, this acts as confirm
  if (!peopleRow.classList.contains("justShown")) {
    peopleRow.classList.add("justShown");
    toast("Set people and click Enter again");
    return;
  }
  peopleRow.classList.remove("justShown");
  enterQueue();
}));
cancelBtn?.addEventListener("click", () => { cancelQueue(); });

imHereBtn?.addEventListener("click", () => { 
  pauseTimer(); 
  toast("Timer paused. Waiting for owner to let you in.");
});
checkedInBtn?.addEventListener("click", () => { 
  markServed(); 
});

// Favorite toggle
function syncFavButton(){
  const favs = JSON.parse(localStorage.getItem("favorites")||"[]");
  const isFav = favs.some(f=>f.id===place.id);
  favBtn.textContent = isFav ? "★ Favorited" : "♡ Favorite";
}
favBtn?.addEventListener("click", () => {
  const favs = JSON.parse(localStorage.getItem("favorites")||"[]");
  const i = favs.findIndex(f=>f.id===place.id);
  if (i>-1) favs.splice(i,1);
  else favs.push({id: place.id, name: place.name, rating: place.rating});
  localStorage.setItem("favorites", JSON.stringify(favs));
  syncFavButton();
});
syncFavButton();

// Reviews
function renderReviews() {
  const list = document.getElementById("reviewsList");
  const data = JSON.parse(localStorage.getItem("reviews_"+place.id)||"[]");
  list.innerHTML = "";
  if (!data.length) list.innerHTML = `<p class="muted">No reviews yet.</p>`;
  data.forEach(r => {
    const div = document.createElement("div"); div.className = "review";
    const date = new Date(r.at).toLocaleString();
    div.innerHTML = `<div><strong>${r.user}</strong> — ⭐ ${r.rating}</div>
                     <div class="meta">${date}</div>
                     <div>${r.text}</div>`;
    list.appendChild(div);
  });
}
renderReviews();

const revForm = document.getElementById("reviewForm");
revForm.addEventListener("submit", (e) => {
  e.preventDefault();
  if (!localStorage.getItem("canReview_"+place.id)) {
    toast("You can review after being served.");
    return;
  }
  const rating = Number(document.getElementById("revRating").value);
  const text = document.getElementById("revText").value.trim();
  const user = localStorage.getItem("customerName") || "Customer";
  const arr = JSON.parse(localStorage.getItem("reviews_"+place.id)||"[]");
  arr.unshift({ user, rating, text, at: Date.now() });
  localStorage.setItem("reviews_"+place.id, JSON.stringify(arr));
  document.getElementById("revText").value = "";
  toast("Review posted");
  renderReviews();
});

// Init counts
renderQueue();

// If landed with active queue for another place, still simulate countdown there — but we scope to this place
if (active && active.placeId===place.id) startSimulation();
