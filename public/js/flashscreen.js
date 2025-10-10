// Order of rotating backgrounds
const IMAGES = [
  "./images/restaurant.jpg",
  "./images/clinic.jpg",
  "./images/party.jpg",
  "./images/salon.jpg",
];

const heroBg = document.getElementById("heroBg");
const progressBar = document.getElementById("progressBar");
const slideNum = document.getElementById("slideNum");
const cards = Array.from(document.querySelectorAll(".card"));

let index = 0;
let timerId;

// cross-fade background
function setBackground(src) {
  const layer = document.createElement("div");
  layer.className = "hero__bg";
  layer.style.opacity = "0";
  layer.style.backgroundImage = `url('${src}')`;
  heroBg.parentElement.insertBefore(layer, heroBg);

  requestAnimationFrame(() => {
    layer.style.opacity = "1";
  });
  setTimeout(() => {
    heroBg.style.backgroundImage = `url('${src}')`;
    layer.remove();
  }, 800);
}

function updateProgress() {
  const pct = ((index + 1) / IMAGES.length) * 100;
  progressBar.style.width = pct + "%";
  if (slideNum) slideNum.textContent = String(index + 1).padStart(2, "0");
}

function tick() {
  index = (index + 1) % IMAGES.length;
  setBackground(IMAGES[index]);
  updateProgress();
}

function start() {
  stop();
  timerId = setInterval(tick, 5000);
}
function stop() {
  if (timerId) clearInterval(timerId);
}

// init
setBackground(IMAGES[index]);
updateProgress();
start();

// card click sets background + resets timer
cards.forEach((c) => {
  c.addEventListener("click", () => {
    const to = c.getAttribute("data-bg");
    const i = IMAGES.findIndex((p) => p === to);
    if (i !== -1) index = i;
    setBackground(to);
    updateProgress();
    start();
  });
});
