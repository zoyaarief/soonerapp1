const form = document.getElementById("userSignupForm");
const msg = document.getElementById("message");

form.addEventListener("submit", (e) => {
  e.preventDefault();

  const user = {
    name: document.getElementById("name").value.trim(),
    phone: document.getElementById("phone").value.trim(),
    email: document.getElementById("email").value.trim(),
    username: document.getElementById("username").value.trim(),
    password: document.getElementById("password").value.trim(),
  };

  if (!user.name || !user.phone || !user.email || !user.username || !user.password) {
    msg.style.color = "red";
    msg.textContent = "All fields are required!";
    return;
  }

  localStorage.setItem(`user_${user.username}`, JSON.stringify(user));
  msg.style.color = "green";
  msg.textContent = "Account created successfully! Redirecting...";
  setTimeout(() => (window.location.href = "userLogin.html"), 1500);
});
