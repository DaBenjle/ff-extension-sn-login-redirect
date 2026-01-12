// Firefox uses 'browser', Chrome uses 'chrome'
const browserAPI = typeof browser !== "undefined" ? browser : chrome;

console.log("Prompt loaded, URL:", window.location.href);

const params = new URLSearchParams(window.location.search);
const tabId = parseInt(params.get("tabId"));
const instance = decodeURIComponent(params.get("instance") || "unknown");

console.log("TabId:", tabId, "Instance:", instance);

document.getElementById("instance").textContent = instance;

let timeLeft = 10;
const timerEl = document.getElementById("timer");
let countdownInterval = null;

function startCountdown() {
  countdownInterval = setInterval(() => {
    timeLeft--;
    timerEl.textContent = timeLeft;
    console.log("Countdown:", timeLeft);

    if (timeLeft <= 0) {
      clearInterval(countdownInterval);
      console.log("Timeout reached, using OAuth");
      useOAuth();
    }
  }, 1000);
}

document.getElementById("admin-btn").onclick = () => {
  console.log("Admin button clicked");
  if (countdownInterval) clearInterval(countdownInterval);

  browserAPI.runtime
    .sendMessage({
      action: "useAdminLogin",
      tabId: tabId,
    })
    .then(() => {
      console.log("Message sent, closing window");
      window.close();
    })
    .catch((err) => {
      console.error("Failed to send message:", err);
    });
};

document.getElementById("oauth-btn").onclick = () => {
  console.log("OAuth button clicked");
  if (countdownInterval) clearInterval(countdownInterval);
  useOAuth();
};

function useOAuth() {
  console.log("Using OAuth");
  browserAPI.runtime
    .sendMessage({
      action: "useOAuth",
      tabId: tabId,
    })
    .then(() => {
      console.log("Message sent, closing window");
      window.close();
    })
    .catch((err) => {
      console.error("Failed to send message:", err);
    });
}

// Keyboard shortcuts
document.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === "a" || e.key === "A") {
    document.getElementById("admin-btn").click();
  } else if (e.key === "Escape" || e.key === "o" || e.key === "O") {
    document.getElementById("oauth-btn").click();
  }
});

// Start countdown after page loads
window.addEventListener("load", () => {
  console.log("Page loaded, starting countdown");
  startCountdown();
});

// Also start immediately in case load event already fired
if (document.readyState === "complete") {
  console.log("Already loaded, starting countdown now");
  startCountdown();
}
