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

// Cross-fade background
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

// Progress Bar + Slide Indicator
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

// Init
setBackground(IMAGES[index]);
updateProgress();
start();

// Card click logic
cards.forEach((card) => {
  card.addEventListener("click", () => {
    const bg = card.getAttribute("data-bg");
    const type = card.getAttribute("data-type");

    // Change background image + progress state
    if (bg) {
      const i = IMAGES.findIndex((p) => p === bg);
      if (i !== -1) index = i;
      setBackground(bg);
      updateProgress();
      start();
    }
  });
});
