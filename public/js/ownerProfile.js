// public/js/ownerProfile.js

// const API_BASE = "http://localhost:3000";
// const FETCH_CREDENTIALS = "include";

const API_BASE = window.location.origin;
const FETCH_CREDENTIALS = "same-origin";

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

/* ============================================================
   FAST IMAGE UPLOADS: client-side resize + compress to WebP/JPEG
   ============================================================ */

// Load an <img> from a File
function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    const fr = new FileReader();
    fr.onload = () => {
      img.src = fr.result;
    };
    fr.onerror = reject;
    fr.readAsDataURL(file);
  });
}

// Draw into canvas with max dimensions and export to WebP (fallback JPEG)
async function compressFileToDataURL(file, { maxW, maxH, quality = 0.8 } = {}) {
  const img = await loadImageFromFile(file);

  // Compute target size while preserving aspect ratio
  let { width, height } = img;
  if (maxW && width > maxW) {
    const s = maxW / width;
    width = maxW;
    height = Math.round(height * s);
  }
  if (maxH && height > maxH) {
    const s = maxH / height;
    height = maxH;
    width = Math.round(width * s);
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });
  ctx.drawImage(img, 0, 0, width, height);

  let out = "";
  try {
    out = canvas.toDataURL("image/webp", quality);
    if (!out || out.length < 20) throw new Error("bad webp");
  } catch {
    out = canvas.toDataURL("image/jpeg", quality);
  }
  return out;
}

// Optional: recompress existing base64 (if you already had big images in DB)
async function compressDataURL(dataURL, { maxW, maxH, quality = 0.8 } = {}) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = async () => {
      let { width, height } = img;
      if (maxW && width > maxW) {
        const s = maxW / width;
        width = maxW;
        height = Math.round(height * s);
      }
      if (maxH && height > maxH) {
        const s = maxH / height;
        height = maxH;
        width = Math.round(width * s);
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d", {
        alpha: false,
        desynchronized: true,
      });
      ctx.drawImage(img, 0, 0, width, height);
      let out = canvas.toDataURL("image/webp", quality);
      if (!out || out.length < 20)
        out = canvas.toDataURL("image/jpeg", quality);
      resolve(out);
    };
    img.onerror = reject;
    img.src = dataURL;
  });
}

/* ==========================
   Rendering helpers
   ========================== */
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

/* ==========================
   Upload handlers (compressed)
   ========================== */

// Avatar upload → shrink to ~320px, WebP/JPEG, q=0.8
avatarInput?.addEventListener("change", async (e) => {
  const f = e.target.files?.[0];
  if (!f) return;
  try {
    const url = await compressFileToDataURL(f, {
      maxW: 320,
      maxH: 320,
      quality: 0.8,
    });
    avatarPreview.src = url;
    if (chipImg) chipImg.src = url;
  } catch (err) {
    console.warn("Avatar compress failed:", err);
  }
});

// Gallery/Menu uploads → each to max 1280px, q=0.8
const MAX_GALLERY_ITEMS = 20; // adjust if you want
async function handleMulti(files) {
  if (!files?.length) return;
  for (const f of files) {
    if (galleryState.length >= MAX_GALLERY_ITEMS) break;
    try {
      const url = await compressFileToDataURL(f, {
        maxW: 1280,
        maxH: 1280,
        quality: 0.8,
      });
      galleryState.push(url);
    } catch (e) {
      console.warn("Gallery compress failed:", e);
    }
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

/* ==========================
   Save → PUT to server
   ========================== */

// (Optional) If you already had giant base64s in memory from hydration, shrink them before saving
async function shrinkExistingGalleryIfNeeded() {
  const MAX_LEN = 400_000; // ~400 KB per data URL string
  const out = [];
  for (const src of galleryState) {
    if (typeof src === "string" && src.length > MAX_LEN) {
      out.push(
        await compressDataURL(src, { maxW: 1280, maxH: 1280, quality: 0.8 })
      );
    } else {
      out.push(src);
    }
  }
  galleryState = out;
}

form?.addEventListener("submit", async (e) => {
  e.preventDefault();
  msg.textContent = "Saving…";
  msg.style.color = "#6B7280";

  // Optional: ensure any pre-existing large base64s are tamed
  // await shrinkExistingGalleryIfNeeded();

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
    avatar: avatarPreview.src, // now a small WebP/JPEG data URL
    gallery: galleryState, // array of small WebP/JPEG data URLs
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
