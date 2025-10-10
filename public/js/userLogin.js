const form = document.getElementById("userLoginForm");
const msg = document.getElementById("message");

form.addEventListener("submit", (e) => {
  e.preventDefault();

  const username = document.getElementById("username").value.trim();
  const password = document.getElementById("password").value.trim();

  const storedUser = JSON.parse(localStorage.getItem(`user_${username}`));

  if (!storedUser || storedUser.password !== password) {
    msg.style.color = "red";
    msg.textContent = "Invalid username or password!";
    return;
  }

  msg.style.color = "green";
  msg.textContent = "Login successful!";
  localStorage.setItem("loggedInUser", username);

  setTimeout(() => {
    window.location.href = "userDashboard.html"; // future page
  }, 1000);
});
