// public/js/ownerProfile.js

// Guard: must be logged-in owner (cross-origin: include credentials)
(async function guard() {
  try {
    const res = await fetch("http://localhost:3000/api/session", {
      method: "GET",
      credentials: "include",
    });
    if (!res.ok) {
      location.href = "ownerSignUp.html?role=owner&mode=login";
      return;
    }
    const data = await res.json();
    localStorage.setItem("businessName", data.business || "Business");
    const b1 = document.getElementById("businessName");
    if (b1) b1.textContent = data.business || "Business Name";
  } catch {
    location.href = "ownerSignUp.html?role=owner&mode=login";
  }
})();

// Session name → top chips
const businessName = localStorage.getItem("businessName") || "Business Name";
document.getElementById("businessName").textContent = businessName;

// Quick nav active state on scroll (profile sections)
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

// Go dashboard
document.getElementById("goDashboardBtn")?.addEventListener("click", () => {
  window.location.href = "ownerDashboard.html";
});

// Logout
document.getElementById("logoutBtn")?.addEventListener("click", async () => {
  try {
    await fetch("http://localhost:3000/api/logout", {
      method: "POST",
      credentials: "include",
    });
  } catch (e) {
    console.error(e);
  } finally {
    localStorage.removeItem("businessName");
    localStorage.removeItem("role");
    location.href = "ownerSignUp.html?role=owner&mode=login";
  }
});

// ===== Local-only profile data (unchanged behavior) =====
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

const placeImages = document.getElementById("placeImages");
const menuImages = document.getElementById("menuImages");
const galleryGrid = document.getElementById("galleryGrid");

const clearGalleryBtn = document.getElementById("clearGallery");
const clearProfileBtn = document.getElementById("clearProfile");

const LS_PROFILE = "ownerProfile";
const LS_GALLERY = "ownerGallery";

function readAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = reject;
    fr.readAsDataURL(file);
  });
}

function saveGallery(urls) {
  localStorage.setItem(LS_GALLERY, JSON.stringify(urls));
}
function loadGallery() {
  try {
    return JSON.parse(localStorage.getItem(LS_GALLERY) || "[]");
  } catch {
    return [];
  }
}
function renderGallery() {
  const urls = loadGallery();
  galleryGrid.innerHTML = "";
  urls.forEach((src, i) => {
    const tile = document.createElement("div");
    tile.className = "tile";
    tile.innerHTML = `<img src="${src}" alt="upload ${i}" />
      <button class="del" data-i="${i}">Delete</button>`;
    galleryGrid.appendChild(tile);
  });
}

// Hydrate
(function hydrate() {
  const p = JSON.parse(localStorage.getItem(LS_PROFILE) || "{}");
  if (p.displayName) {
    displayName.value = p.displayName;
    const chip = document.getElementById("businessName");
    if (chip) chip.textContent = p.displayName;
  }
  if (p.description) description.value = p.description;
  if (p.cuisine) cuisine.value = p.cuisine;
  if (p.approxPrice) approxPrice.value = p.approxPrice;
  if (p.waitTime) waitTime.value = p.waitTime;
  if (p.totalSeats) totalSeats.value = p.totalSeats;
  if (p.maxBooking) maxBooking.value = p.maxBooking;
  if (p.location) locationInput.value = p.location;
  if (p.features) features.value = p.features;
  if (p.openTime) openTime.value = p.openTime;
  if (p.closeTime) closeTime.value = p.closeTime;
  if (p.avatar) avatarPreview.src = p.avatar;

  renderGallery();
})();

// Avatar upload
avatarInput?.addEventListener("change", async (e) => {
  const f = e.target.files?.[0];
  if (!f) return;
  const url = await readAsDataURL(f);
  avatarPreview.src = url;
  const p = JSON.parse(localStorage.getItem(LS_PROFILE) || "{}");
  p.avatar = url;
  localStorage.setItem(LS_PROFILE, JSON.stringify(p));
});

// Multi image uploads
async function handleMulti(files) {
  if (!files?.length) return;
  const urls = loadGallery();
  for (const f of files) {
    const url = await readAsDataURL(f);
    urls.push(url);
  }
  saveGallery(urls);
  renderGallery();
}
placeImages?.addEventListener("change", (e) => handleMulti(e.target.files));
menuImages?.addEventListener("change", (e) => handleMulti(e.target.files));

// Delete gallery image
galleryGrid?.addEventListener("click", (e) => {
  const btn = e.target.closest(".del");
  if (!btn) return;
  const idx = Number(btn.getAttribute("data-i"));
  const urls = loadGallery();
  urls.splice(idx, 1);
  saveGallery(urls);
  renderGallery();
});

// Save profile (local)
form?.addEventListener("submit", (e) => {
  e.preventDefault();
  msg.textContent = "Saving…";
  msg.style.color = "#6B7280";

  const profileData = {
    displayName: displayName.value.trim(),
    description: description.value.trim(),
    cuisine: cuisine.value.trim(),
    approxPrice: approxPrice.value.trim(),
    waitTime: waitTime.value,
    totalSeats: totalSeats.value,
    maxBooking: maxBooking.value,
    location: locationInput.value.trim(),
    openTime: openTime.value.trim(),
    closeTime: closeTime.value.trim(),
    features: features.value.trim(),
    avatar: avatarPreview.src,
  };

  localStorage.setItem(LS_PROFILE, JSON.stringify(profileData));
  if (profileData.displayName) {
    const chip = document.getElementById("businessName");
    if (chip) chip.textContent = profileData.displayName;
  }

  msg.style.color = "green";
  msg.textContent = "Profile saved locally!";
  setTimeout(() => (msg.textContent = ""), 2000);
});

// Clear helpers
clearGalleryBtn?.addEventListener("click", () => {
  localStorage.removeItem(LS_GALLERY);
  renderGallery();
});
clearProfileBtn?.addEventListener("click", () => {
  localStorage.removeItem(LS_PROFILE);
  location.reload();
});
