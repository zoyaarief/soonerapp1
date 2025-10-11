
// place.js — Single venue page with join/cancel, live position & 45-min rule (server-backed with fallbacks)

// ============== Helpers ==============
function qs(sel){ return document.querySelector(sel); }
function qsa(sel){ return Array.from(document.querySelectorAll(sel)); }

// Toast
const toastEl = qs("#toast");
const toastText = qs("#toastText");
qs("#toastClose")?.addEventListener("click", () => toastEl?.classList.remove("show"));
function toast(msg){
  if (!toastEl || !toastText) { console.log("[toast]", msg); return; }
  toastText.textContent = msg;
  toastEl.classList.add("show");
  clearTimeout(toastEl._t);
  toastEl._t = setTimeout(()=>toastEl.classList.remove("show"), 2200);
}

async function fetchJSON(url, opts={}){
  const r = await fetch(url, { credentials:"include", ...opts });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

const usp = new URLSearchParams(location.search);
const currentId = usp.get("id");
let pollingT = null;

// ============== Venue load ==============
async function loadVenue(){
  const v = await fetchJSON(`/api/venues/${encodeURIComponent(currentId)}`);
  qs("#name") && (qs("#name").textContent = v.name);
  qs("#rating") && (qs("#rating").textContent = v.rating ?? "—");
  qs("#count") && (qs("#count").textContent = v.waiting ?? 0);
  qs("#cover") && (qs("#cover").src = v.heroImage || v.image || "./images/restaurant.jpg");
  // approx wait
  const per = (v.stats?.avgWaitMins) ?? v.waitPerGroup ?? 8;
  const approx = (v.waiting ?? 0) * per;
  qs("#wait") && (qs("#wait").textContent = approx ? `${approx} mins` : "—");

    // unhide main container once venue data is ready
  document.getElementById("main")?.classList.remove("hidden");

    // check owner settings
  try {
    const s = await fetchJSON(`/api/owner_settings/${encodeURIComponent(currentId)}`);
    const enterBtn = qs("#enterBtn");
    if (
      !s.walkingenable ||
      s.openstatus !== "open" ||
      !s.queueactive
    ) {
      enterBtn.disabled = true;
      enterBtn.textContent = "Queue Unavailable";
      enterBtn.classList.add("disabled");
    }
  } catch {
    // ignore missing settings
  }
}

// ============== Queue actions ==============
async function joinQueue(people){
  try{
    const r = await fetch(`/api/queue/${encodeURIComponent(currentId)}/join`, {
      method:"POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ people })
    });
    if (r.status === 401){
      const ret = encodeURIComponent(location.pathname + location.search);
      location.href = `ownerSignUp.html?role=customer&mode=login&returnTo=${ret}`;
      return;
    }
    const data = await r.json();
    toast(`✅ Joined queue (order #${data.order})`);
    await loadActive(); // begin polling
  }catch(e){
    toast("Failed to join queue");
  }
}

async function cancelQueue(){
  try{
    await fetch(`/api/queue/${encodeURIComponent(currentId)}/cancel`, { method:"POST", credentials:"include" });
    toast("❌ You left the queue");
    stopPolling();
    renderActive(null);
  }catch(e){
    toast("Failed to cancel");
  }
}

async function arrived(){
  try{
    await fetch(`/api/queue/${encodeURIComponent(currentId)}/arrived`, { method:"POST", credentials:"include" });
    toast("⏸️ Timer paused — we’ll wait here until the owner lets you in");
  }catch(e){
    toast("Failed to update arrival");
  }
}

// ============== Active state & polling ==============
function stopPolling(){ if (pollingT){ clearInterval(pollingT); pollingT=null; } }

function formatCountdown(ms){
  if (!ms || ms < 0) return "00:00";
  const s = Math.floor(ms/1000);
  const m = String(Math.floor(s/60)).padStart(2,"0");
  const ss = String(s%60).padStart(2,"0");
  return `${m}:${ss}`;
}

function renderActive(active, venueWaiting){
  const box = qs("#activeQueue");
  if (!box) return;
  if (!active){
    box.innerHTML = "<p>No active queue.</p>";
    return;
  }
  const yourOrder = active.order;
  const waiting = Number(venueWaiting ?? 0);
  // A rough position estimate: count users ahead. If backend exposes better metric, replace this.
  const position = Math.max(1, Math.min(yourOrder, waiting)) || 1;

  let near = active.nearTurnAt ? new Date(active.nearTurnAt) : null;
  let deadline = active.arrivalDeadline ? new Date(active.arrivalDeadline) : null;

  // If not provided yet but position <=5, start local countdown (fallback)
  if (!near && position <= 5){
    near = new Date();
    deadline = new Date(near.getTime() + 45*60*1000);
  }

  const now = Date.now();
  const msLeft = deadline ? (deadline.getTime() - now) : null;

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

  // live countdown tick
  if (deadline){
    const t = setInterval(() => {
      const left = deadline.getTime() - Date.now();
      const el = qs("#timerLeft");
      if (!el){ clearInterval(t); return; }
      el.textContent = formatCountdown(left);
      if (left <= 0){
        clearInterval(t);
        toast("⌛ Time exceeded — you may be moved out of the queue");
      }
    }, 1000);
  }
}

async function loadActive(){
  try{
    const [active, venue] = await Promise.all([
      fetchJSON("/api/queue/active"),
      fetchJSON(`/api/venues/${encodeURIComponent(currentId)}`)
    ]);
    if (!active || active.venueId !== currentId){
      renderActive(null);
      stopPolling();
      return;
    }
    renderActive(active, venue?.waiting);
    if (!pollingT){
      pollingT = setInterval(loadActive, 10_000);
    }
  }catch(e){
    // if the call fails, keep last render; don't crash
    console.warn("poll failed", e);
  }
}

// ============== Reviews (client-side gated) ==============
async function canReview(){
  try{
    const hist = await fetchJSON("/api/history");
    return hist.some(h => String(h.venueId||h.venue_id) === String(currentId) && h.type === "queue.served");
  }catch{return false;}
}
function renderReviews(){
  const listEl = qs("#reviewsList");
  if (!listEl) return;
  const arr = JSON.parse(localStorage.getItem("reviews_"+currentId)||"[]");
  listEl.innerHTML = arr.map(r => {
    const dt = new Date(r.at).toLocaleString();
    return `<li><b>${r.user}</b> • ⭐ ${r.rating}<br>${r.text}<br><span class="muted">${dt}</span></li>`;
  }).join("") || "<p class='muted'>No reviews yet.</p>";
}
async function handlePostReview(){
  if (!(await canReview())){
    toast("You can review after being served.");
    return;
  }
  const textEl = qs("#revText");
  const ratingEl = qs("#revRating");
  if (!textEl || !ratingEl) return;
  const text = textEl.value.trim();
  const rating = Number(ratingEl.value || 5);
  if (!text){ toast("Write something first"); return; }
  const user = localStorage.getItem("customerName") || "Customer";
  const arr = JSON.parse(localStorage.getItem("reviews_"+currentId)||"[]");
  arr.unshift({ user, rating, text, at: Date.now() });
  localStorage.setItem("reviews_"+currentId, JSON.stringify(arr));
  textEl.value = "";
  toast("Review posted");
  renderReviews();
}

// ============== Wire UI ==============
qs("#enterBtn")?.addEventListener("click", () => {
  let people = 2;
  const inp = prompt("How many people in your party?", "2");
  if (inp !== null){
    const n = Math.max(1, Math.min(12, Number(inp)));
    if (!Number.isFinite(n)) return;
    people = n;
  }
  joinQueue(people);
});
qs("#postReviewBtn")?.addEventListener("click", handlePostReview);

// Init
(async function init(){
  if (!currentId){
    document.body.innerHTML = "<p style='padding:20px'>Place not specified.</p>";
    return;
  }
  await loadVenue();
  await loadActive();
  renderReviews();
})();
