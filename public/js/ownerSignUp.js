// Simulate session: show stored business name
const businessName = localStorage.getItem("businessName") || "Business Name";
document.getElementById("businessName").textContent = businessName;

// Form handling (just front-end behavior for now)
const form = document.getElementById("profileForm");
const msg = document.getElementById("statusMsg");

form.addEventListener("submit", (e) => {
  e.preventDefault();
  msg.style.color = "gray";
  msg.textContent = "Saving...";

  setTimeout(() => {
    msg.style.color = "green";
    msg.textContent = "Profile saved locally (no DB yet)!";
  }, 800);
});
