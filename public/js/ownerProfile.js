// public/js/ownerProfile.js

const API_BASE = "http://localhost:3000";
const FETCH_CREDENTIALS = "include";

// Auth guard
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
    const chip = document.getElementById("businessName");
    if (chip) chip.textContent = data.business || "Business Name";
  } catch {
    location.href = "ownerSignUp.html?role=owner&mode=login";
  }
})();

// Nav highlight
const links = document.querySelectorAll(".navlink");
const sections = [...document.querySelectorAll("section.card")];
const setActive = () => {
  const y = window.scrollY + 120;
  let current = sections[0]?.id;
  sections.forEach((s) => {
    if (y >= s.offsetTop) current = s.id;
  });
  links.forEach((a) =>
    a.classList.toggle("active", a.getAttribute("href") === `#${current}`)
  );
};
window.addEventListener("scroll", setActive);
setActive();

// Buttons
document.getElementById("goDashboardBtn")?.addEventListener("click", () => {
  window.location.href = "ownerDashboard.html";
});
document.getElementById("logoutBtn")?.addEventListener("click", async () => {
  try {
    await fetch(`${API_BASE}/api/logout`, {
      method: "POST",
      credentials: FETCH_CREDENTIALS,
    });
  } finally {
    location.href = "ownerSignUp.html?role=owner&mode=login";
  }
});

// Form fields
const form = document.getElementById("profileForm");
const msg = document.getElementById("statusMsg");
const displayName = document.getElementById("displayName");
const description = document.getElementById("description");
const cuisine = document.getElementById("cuisine");
const approxPrice = document.getElementById("approxPrice");
const waitTime = document.getElementById("waitTime");
const totalSeats = document.getElementById("totalSeats");
const maxBooking = document.getElementById("maxBooking");
const locationInput = document.getElementById("location");
const features = document.getElementById("features");
const openTime = document.getElementById("openTime");
const closeTime = document.getElementById("closeTime");

const avatarInput = document.getElementById("avatarInput");
const avatarPreview = document.getElementById("avatarPreview");
const chipImg = document.querySelector(".userchip img");

const placeImages = document.getElementById("placeImages");
const menuImages = document.getElementById("menuImages");
const galleryGrid = document.getElementById("galleryGrid");

const clearGalleryBtn = document.getElementById("clearGallery");
const clearProfileBtn = document.getElementById("clearProfile");

// In-memory gallery for this page session
let galleryState = [];

// Helpers
function readAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = reject;
    fr.readAsDataURL(file);
  });
}
function renderGallery() {
  galleryGrid.innerHTML = "";
  galleryState.forEach((src, i) => {
    const tile = document.createElement("div");
    tile.className = "tile";
    tile.innerHTML = `<img src="${src}" alt="upload ${i}" />
      <button class="del" data-i="${i}">Delete</button>`;
    galleryGrid.appendChild(tile);
  });
}

// Hydrate from server
(async function hydrateFromServer() {
  try {
    const res = await fetch(`${API_BASE}/api/owners/me`, {
      method: "GET",
      credentials: FETCH_CREDENTIALS,
    });
    if (!res.ok) throw new Error("not ok");
    const data = await res.json();

    const p = data.profile || {};
    displayName.value = p.displayName || data.business || "";
    description.value = p.description || "";
    cuisine.value = p.cuisine || "";
    approxPrice.value = p.approxPrice || "";
    waitTime.value = p.waitTime ?? "";
    totalSeats.value = p.totalSeats ?? "";
    maxBooking.value = p.maxBooking ?? "";
    locationInput.value = p.location || "";
    openTime.value = p.openTime || "";
    closeTime.value = p.closeTime || "";
    features.value = p.features || "";

    const avatarSrc = p.avatar || "./images/default_profile.png";
    avatarPreview.src = avatarSrc;
    if (chipImg) chipImg.src = avatarSrc;

    galleryState = Array.isArray(p.gallery) ? p.gallery.slice() : [];
    renderGallery();

    const chipName = document.getElementById("businessName");
    if (p.displayName && chipName) chipName.textContent = p.displayName;
  } catch (e) {
    console.warn("hydrateFromServer error:", e);
  }
})();

// Avatar upload (preview only; saved on Submit)
avatarInput?.addEventListener("change", async (e) => {
  const f = e.target.files?.[0];
  if (!f) return;
  const url = await readAsDataURL(f);
  avatarPreview.src = url;
  if (chipImg) chipImg.src = url;
});

// Multiple images → galleryState
async function handleMulti(files) {
  if (!files?.length) return;
  for (const f of files) {
    const url = await readAsDataURL(f);
    galleryState.push(url);
  }
  renderGallery();
}
placeImages?.addEventListener("change", (e) => handleMulti(e.target.files));
menuImages?.addEventListener("change", (e) => handleMulti(e.target.files));

galleryGrid?.addEventListener("click", (e) => {
  const btn = e.target.closest(".del");
  if (!btn) return;
  const idx = Number(btn.getAttribute("data-i"));
  galleryState.splice(idx, 1);
  renderGallery();
});

// Save → PUT to server
form?.addEventListener("submit", async (e) => {
  e.preventDefault();
  msg.textContent = "Saving…";
  msg.style.color = "#6B7280";

  const payload = {
    displayName: displayName.value.trim(),
    description: description.value.trim(),
    cuisine: cuisine.value.trim(),
    approxPrice: approxPrice.value.trim(),
    waitTime: Number(waitTime.value || 0),
    totalSeats: Number(totalSeats.value || 0),
    maxBooking: Number(maxBooking.value || 0),
    location: locationInput.value.trim(),
    openTime: openTime.value.trim(),
    closeTime: closeTime.value.trim(),
    features: features.value.trim(),
    avatar: avatarPreview.src, // data URL
    gallery: galleryState, // array of data URLs
  };

  try {
    const res = await fetch(`${API_BASE}/api/owners/me`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: FETCH_CREDENTIALS,
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      msg.style.color = "crimson";
      msg.textContent = data?.error || "Save failed.";
      return;
    }
    if (payload.displayName) {
      const chipName = document.getElementById("businessName");
      if (chipName) chipName.textContent = payload.displayName;
    }
    msg.style.color = "green";
    msg.textContent = "Saved to database!";
    setTimeout(() => (msg.textContent = ""), 2000);
  } catch (err) {
    console.error(err);
    msg.style.color = "crimson";
    msg.textContent = "Network error.";
  }
});

// Clear helpers (local preview only)
clearGalleryBtn?.addEventListener("click", () => {
  galleryState = [];
  renderGallery();
});
clearProfileBtn?.addEventListener("click", () => {
  window.location.reload();
});
