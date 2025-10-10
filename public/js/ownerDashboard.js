// ===== Session & greeting =====
const businessName = localStorage.getItem("businessName") || "Business Name";
document.getElementById("businessName").textContent = businessName;
document.getElementById("greetName").textContent = businessName;

// ===== Sidebar: collapse & active behavior =====
const sidebar = document.getElementById("sidebar");
const toggleBtn = document.getElementById("sidebarToggle");
if (toggleBtn) {
  toggleBtn.addEventListener("click", () => {
    sidebar?.classList.toggle("collapsed");
  });
}

// Side nav links (only internal anchors get smooth scroll)
const sideLinks = [...document.querySelectorAll(".side-nav .item")];
sideLinks.forEach((link) => {
  const href = link.getAttribute("href");
  if (href && href.startsWith("#")) {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      const id = href.slice(1);
      const el = document.getElementById(id);
      if (el) window.scrollTo({ top: el.offsetTop - 10, behavior: "smooth" });
    });
  }
});

// Active state using IntersectionObserver (observe only existing sections in nav)
const observedIds = ["home", "statsCard"]; // dashboard & stats in nav
const observedEls = observedIds
  .map((id) => document.getElementById(id))
  .filter(Boolean);

const observer = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        const id = entry.target.id;
        sideLinks.forEach((a) => {
          const href = a.getAttribute("href");
          a.classList.toggle("active", href === `#${id}`);
        });
      }
    });
  },
  { root: null, rootMargin: "-30% 0px -60% 0px", threshold: 0.0 }
);
observedEls.forEach((el) => observer.observe(el));

// ===== Elements (DECLARE ONCE) =====
const walkinBtn = document.getElementById("walkinBtn");
const openCloseBtn = document.getElementById("openCloseBtn");
const stopQueueBtn = document.getElementById("stopQueueBtn");
const restartQueueBtn = document.getElementById("restartQueueBtn");

const announcementInput = document.getElementById("announcementInput");
const announceBtn = document.getElementById("announceBtn");
const announceList = document.getElementById("announceList");

const queueList = document.getElementById("queueList");
const undoBtn = document.getElementById("undoBtn");

// Toast + Modal
const toast = document.getElementById("toast");
const toastText = document.getElementById("toastText");
const toastUndo = document.getElementById("toastUndo");
const toastClose = document.getElementById("toastClose");

const modal = document.getElementById("modal");
const modalClose = document.getElementById("modalClose");
const modalClose2 = document.getElementById("modalClose2");
const undoList = document.getElementById("undoList");

// Metric pills
const mWalkins = document.getElementById("mWalkins");
const mOpen = document.getElementById("mOpen");
const mQueueCount = document.getElementById("mQueueCount");
const mAvgWait = document.getElementById("mAvgWait");

// ===== State =====
let walkinsEnabled = false;
let restaurantOpen = false;
let queueActive = true;

let queue = [
  {
    name: "Sarah Johnson",
    email: "sarah@gmail.com",
    phone: "9876543210",
    position: 1,
    people: 3,
  },
  {
    name: "David Miller",
    email: "david@gmail.com",
    phone: "9234567890",
    position: 2,
    people: 2,
  },
  {
    name: "Priya Sharma",
    email: "priya@gmail.com",
    phone: "9988776655",
    position: 3,
    people: 4,
  },
  {
    name: "Tom Holland",
    email: "tom@gmail.com",
    phone: "8765432198",
    position: 4,
    people: 2,
  },
  {
    name: "Maria Lopez",
    email: "maria@gmail.com",
    phone: "9123456780",
    position: 5,
    people: 3,
  },
  {
    name: "Liam Brown",
    email: "liam@gmail.com",
    phone: "9998887776",
    position: 6,
    people: 5,
  },
  {
    name: "Olivia Davis",
    email: "olivia@gmail.com",
    phone: "9988771122",
    position: 7,
    people: 1,
  },
  {
    name: "Emma White",
    email: "emma@gmail.com",
    phone: "9977665544",
    position: 8,
    people: 2,
  },
  {
    name: "Noah Wilson",
    email: "noah@gmail.com",
    phone: "9988776655",
    position: 9,
    people: 4,
  },
  {
    name: "Lucas Martin",
    email: "lucas@gmail.com",
    phone: "9990001112",
    position: 10,
    people: 2,
  },
];

let history = [];
let undoStack = []; // [{ item, timestamp }]
let lastRemoved = null;
let announcements = JSON.parse(localStorage.getItem("announcements") || "[]");

// ===== Helpers =====
function setText(node, text) {
  if (node) node.textContent = text;
}
function showToast(message, withUndo = false) {
  if (!toast || !toastText) return;
  toastText.textContent = message;
  if (toastUndo) toastUndo.style.display = withUndo ? "inline" : "none";
  toast.classList.add("show");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.remove("show"), 4000);
}

function updateMetrics() {
  setText(mWalkins, walkinsEnabled ? "Enabled" : "Disabled");
  setText(mOpen, restaurantOpen ? "Open" : "Closed");
  setText(mQueueCount, String(queue.length));
  const avg = Math.round(
    (queue.reduce((a, b) => a + b.people, 0) * 8) / Math.max(queue.length, 1)
  );
  setText(mAvgWait, `${avg}m`);
}

function renderAnnouncements() {
  if (!announceList) return;
  announceList.innerHTML = "";
  announcements.forEach((txt, i) => {
    const li = document.createElement("li");
    li.className = "announce-item";
    li.innerHTML = `
      <p>${txt}</p>
      <div class="announce-actions">
        <button class="btn btn--ghost small" data-remove="${i}">Remove</button>
      </div>
    `;
    announceList.appendChild(li);
  });
  localStorage.setItem("announcements", JSON.stringify(announcements));
}

function openModal() {
  if (!modal) return;
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
  renderUndoList();
}
function closeModal() {
  if (!modal) return;
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
}
function renderUndoList() {
  if (!undoList) return;
  undoList.innerHTML = "";
  if (!undoStack.length) {
    undoList.innerHTML = `<p class="meta">No recent removals.</p>`;
    return;
  }
  undoStack.forEach((u, idx) => {
    const leftMs = Math.max(0, u.timestamp + 5 * 60 * 1000 - Date.now());
    const leftMin = Math.floor(leftMs / 60000);
    const leftSec = Math.floor((leftMs % 60000) / 1000);
    const row = document.createElement("div");
    row.className = "undo-item";
    row.innerHTML = `
      <div>
        <strong>${u.item.name}</strong>
        <div class="meta">${u.item.people} people • expires in ${leftMin}m ${leftSec}s</div>
      </div>
      <div>
        <button class="btn btn--ghost" data-undo="${idx}">Undo</button>
      </div>
    `;
    undoList.appendChild(row);
  });
}

// keep modal countdown fresh
setInterval(() => {
  if (modal && !modal.classList.contains("hidden")) renderUndoList();
}, 1000);

function addToUndoStack(item) {
  const timestamp = Date.now();
  undoStack.push({ item, timestamp });
  // expire after 5 min
  setTimeout(
    () => {
      undoStack = undoStack.filter((u) => u.item.email !== item.email);
      if (modal && !modal.classList.contains("hidden")) renderUndoList();
    },
    5 * 60 * 1000
  );
}

// ===== Render Queue =====
function renderQueue() {
  if (!queueList) return;
  queueList.innerHTML = "";
  if (!queueActive) {
    queueList.innerHTML =
      "<p style='color:#ef4444'>Queue stopped for the day.</p>";
    updateMetrics();
    drawChart();
    return;
  }
  if (!queue.length) {
    queueList.innerHTML =
      "<p style='color:#6B7280'>No one currently in queue.</p>";
    updateMetrics();
    drawChart();
    return;
  }

  queue.forEach((q) => {
    const row = document.createElement("div");
    row.className = "queue-item";
    row.innerHTML = `
      <span>${q.position}. ${q.name} (${q.people} people)</span>
      <input type="checkbox" class="checkbox" data-email="${q.email}" aria-label="Mark served">
    `;
    queueList.appendChild(row);
  });

  updateMetrics();
  drawChart();
}

// ===== Controls (USING THE SINGLE DECLARATIONS ABOVE) =====
if (walkinBtn) {
  walkinBtn.addEventListener("click", () => {
    walkinsEnabled = !walkinsEnabled;
    walkinBtn.textContent = walkinsEnabled
      ? "Disable Walk-ins"
      : "Enable Walk-ins";
    showToast(`Walk-ins ${walkinsEnabled ? "enabled" : "disabled"}`);
    updateMetrics();
  });
}
if (openCloseBtn) {
  openCloseBtn.addEventListener("click", () => {
    restaurantOpen = !restaurantOpen;
    openCloseBtn.textContent = restaurantOpen ? "Close" : "Open";
    showToast(`Restaurant set to ${restaurantOpen ? "Open" : "Closed"}`);
    updateMetrics();
  });
}
if (stopQueueBtn && restartQueueBtn) {
  stopQueueBtn.addEventListener("click", () => {
    queueActive = false;
    stopQueueBtn.classList.add("hidden");
    restartQueueBtn.classList.remove("hidden");
    renderQueue();
    showToast("Queue stopped for the day");
  });
  restartQueueBtn.addEventListener("click", () => {
    queueActive = true;
    stopQueueBtn.classList.remove("hidden");
    restartQueueBtn.classList.add("hidden");
    renderQueue();
    showToast("Queue restarted");
  });
}

// Announcements: add + remove
if (announceBtn) {
  announceBtn.addEventListener("click", () => {
    const val =
      announcementInput && "value" in announcementInput
        ? announcementInput.value.trim()
        : "";
    if (!val) {
      showToast("Type an announcement first");
      return;
    }
    announcements.unshift(val);
    if (announcementInput) announcementInput.value = "";
    renderAnnouncements();
    showToast("Announcement added");
  });
}
if (announceList) {
  announceList.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-remove]");
    if (!btn) return;
    const idx = Number(btn.getAttribute("data-remove"));
    announcements.splice(idx, 1);
    renderAnnouncements();
    showToast("Announcement removed");
  });
}

// Queue: check to remove
if (queueList) {
  queueList.addEventListener("change", (e) => {
    if (e.target.matches(".checkbox") && queueActive) {
      const email = e.target.dataset.email;
      const i = queue.findIndex((q) => q.email === email);
      if (i > -1) {
        const removed = queue.splice(i, 1)[0];
        removed.position = history.length + 1;
        history.push(removed);
        addToUndoStack(removed);
        lastRemoved = removed;
        renderQueue();
        showToast(`Removed ${removed.name}`, true);
      }
    }
  });
}

// Toast actions
if (toastUndo) {
  toastUndo.addEventListener("click", () => {
    if (!lastRemoved) return;
    queue.push(lastRemoved);
    queue.sort((a, b) => a.position - b.position);
    undoStack = undoStack.filter((u) => u.item.email !== lastRemoved.email);
    renderQueue();
    showToast(`${lastRemoved.name} restored`);
    lastRemoved = null;
  });
}
if (toastClose) {
  toastClose.addEventListener("click", () => toast.classList.remove("show"));
}

// Undo Center Modal
if (undoBtn) undoBtn.addEventListener("click", openModal);
if (modalClose) modalClose.addEventListener("click", closeModal);
if (modalClose2) modalClose2.addEventListener("click", closeModal);
if (modal) {
  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeModal();
  });
}
if (undoList) {
  undoList.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-undo]");
    if (!btn) return;
    const idx = Number(btn.getAttribute("data-undo"));
    const u = undoStack[idx];
    if (!u) return;
    queue.push(u.item);
    queue.sort((a, b) => a.position - b.position);
    undoStack.splice(idx, 1);
    renderQueue();
    renderUndoList();
    showToast(`${u.item.name} restored`);
  });
}

// ===== Chart =====
const canvas = document.getElementById("chart");
const ctx = canvas?.getContext("2d");
function drawChart() {
  if (!canvas || !ctx) return;
  const w = canvas.clientWidth,
    h = canvas.clientHeight;
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const maxPeople = Math.max(...queue.map((q) => q.people), 1);
  const barW = 26,
    gap = 12,
    scale = (h - 30) / maxPeople;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#8B5CF6";
  queue.forEach((q, i) => {
    const x = i * (barW + gap) + 40;
    const y = h - q.people * scale - 14;
    ctx.fillRect(x, y, barW, q.people * scale);
    ctx.fillStyle = "#94a3b8";
    ctx.font = "12px Plus Jakarta Sans";
    ctx.fillText(q.people, x + 5, y - 4);
    ctx.fillStyle = "#8B5CF6";
  });
}

// Init
renderAnnouncements();
renderQueue();
