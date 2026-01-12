// Prefix for all logs
const LOG_PREFIX = "[SN Auth Helper]";

// Simple state tracking
const redirectedTabs = new Map();
const allowedOAuthTabs = new Set();
const loginInProgressTabs = new Set();

// Your ServiceNow instances (loaded from storage, no defaults)
let instances = [];

// Load instances from storage
browser.storage.local
  .get("instances")
  .then((result) => {
    if (result.instances && result.instances.length > 0) {
      instances = result.instances;
      console.log(LOG_PREFIX, "Loaded instances:", instances);
    } else {
      console.log(
        LOG_PREFIX,
        "No instances configured. Please configure instances in the extension popup."
      );
    }
  })
  .catch((err) => console.error(LOG_PREFIX, "Failed to load instances:", err));

// OAuth redirect patterns
const oauthPatterns = [
  /auth_redirect\.do/,
  /oauth_redirect\.do/,
  /navpage\.do/,
  /login\.microsoftonline\.com/,
  /sso\.do/,
];

function isOAuthRedirect(url) {
  return oauthPatterns.some((pattern) => pattern.test(url));
}

function isServiceNowInstance(url) {
  try {
    const hostname = new URL(url).hostname;
    return instances.some((instance) => hostname.includes(instance));
  } catch {
    return false;
  }
}

// Main request interceptor
browser.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (details.type !== "main_frame") {
      return { cancel: false };
    }

    const url = details.url;
    const tabId = details.tabId;

    console.debug(LOG_PREFIX, "Request:", url);

    // Check whitelists first
    if (loginInProgressTabs.has(tabId)) {
      console.debug(LOG_PREFIX, "Tab in admin login flow, allowing:", tabId);
      return { cancel: false };
    }

    if (allowedOAuthTabs.has(tabId)) {
      console.debug(LOG_PREFIX, "Tab whitelisted for OAuth, allowing:", tabId);
      return { cancel: false };
    }

    // Check if this is an OAuth redirect we should intercept
    if (isServiceNowInstance(url) && isOAuthRedirect(url)) {
      // If we're already handling this tab, just block silently
      if (redirectedTabs.has(tabId) || loginInProgressTabs.has(tabId)) {
        console.debug(
          LOG_PREFIX,
          "Already handling tab or in admin login, blocking silently:",
          tabId
        );
        return { cancel: true };
      }

      console.log(LOG_PREFIX, "🛑 Blocking OAuth redirect for tab:", tabId);

      // Mark that we're handling this tab IMMEDIATELY to prevent duplicates
      redirectedTabs.set(tabId, {
        originalUrl: null, // Will be filled in below
        redirectUrl: url,
        instance: new URL(url).hostname,
        timestamp: Date.now(),
      });

      // Get tab info and show prompt
      browser.tabs
        .get(tabId)
        .then((tab) => {
          const originalUrl = tab.url;
          console.debug(LOG_PREFIX, "Original URL:", originalUrl);

          // Skip if already on login.do or if page hasn't loaded yet
          if (
            originalUrl &&
            (originalUrl.includes("/login.do") || originalUrl === "about:blank")
          ) {
            console.debug(LOG_PREFIX, "Skipping - on login.do or blank page");
            redirectedTabs.delete(tabId);
            return;
          }

          // Check if tab is now in admin login flow (user clicked button already)
          if (loginInProgressTabs.has(tabId)) {
            console.debug(
              LOG_PREFIX,
              "Tab already in admin login flow, skipping prompt"
            );
            return;
          }

          // Update with the actual original URL
          const tabInfo = redirectedTabs.get(tabId);
          if (tabInfo) {
            tabInfo.originalUrl = originalUrl;
            console.debug(LOG_PREFIX, "Updated tab info:", tabId, tabInfo);
          }

          // Show prompt
          showPrompt(tabId, tabInfo.instance);
        })
        .catch((err) => {
          console.error(LOG_PREFIX, "Failed to get tab:", err);
          redirectedTabs.delete(tabId);
        });

      // Block the redirect
      return { cancel: true };
    }

    return { cancel: false };
  },
  {
    urls: ["*://*.service-now.com/*"],
    types: ["main_frame"],
  },
  ["blocking"]
);

function showPrompt(tabId, instance) {
  console.log(
    LOG_PREFIX,
    "📋 Opening prompt for tab:",
    tabId,
    "loginInProgress?",
    loginInProgressTabs.has(tabId)
  );

  const promptUrl = browser.runtime.getURL(
    `prompt.html?tabId=${tabId}&instance=${encodeURIComponent(instance)}`
  );

  browser.windows
    .create({
      url: promptUrl,
      type: "popup",
      width: 500,
      height: 400,
    })
    .catch((err) => {
      console.error(LOG_PREFIX, "Failed to create prompt window:", err);
      console.error(
        LOG_PREFIX,
        "Fallback triggered for tab:",
        tabId,
        "loginInProgress?",
        loginInProgressTabs.has(tabId)
      );

      // Only fallback to OAuth if NOT in admin login flow
      if (!loginInProgressTabs.has(tabId)) {
        handleOAuthLogin(tabId);
      } else {
        console.log(
          LOG_PREFIX,
          "Skipping OAuth fallback - already in admin login"
        );
      }
    });
}

// Handle messages from prompt
browser.runtime.onMessage.addListener((message, sender) => {
  console.log(
    LOG_PREFIX,
    "📨 Message:",
    message.action,
    "for tab:",
    message.tabId
  );

  if (message.action === "useAdminLogin") {
    handleAdminLogin(message.tabId);
  } else if (message.action === "useOAuth") {
    handleOAuthLogin(message.tabId);
  } else if (message.action === "updateInstances") {
    instances = message.instances;
    console.log(LOG_PREFIX, "Updated instances:", instances);
  }
});

function handleAdminLogin(tabId) {
  console.log(LOG_PREFIX, "🔐 User chose ADMIN LOGIN for tab:", tabId);

  const tabInfo = redirectedTabs.get(tabId);
  if (!tabInfo) {
    console.error(LOG_PREFIX, "No tab info found for:", tabId);
    return;
  }

  console.debug(LOG_PREFIX, "Tab info:", tabInfo);

  // Add to whitelist so we don't block any redirects during login
  loginInProgressTabs.add(tabId);
  console.debug(LOG_PREFIX, "Added to loginInProgressTabs:", tabId);

  const loginUrl = `https://${tabInfo.instance}/login.do`;
  console.log(LOG_PREFIX, "➡️ Navigating to:", loginUrl);

  // Navigate to login.do
  browser.tabs
    .update(tabId, { url: loginUrl })
    .then(() => {
      console.debug(LOG_PREFIX, "Navigation successful");

      // Monitor for login completion
      monitorLoginCompletion(tabId, tabInfo.instance, tabInfo.originalUrl);
    })
    .catch((err) => {
      console.error(LOG_PREFIX, "Navigation failed:", err);
      loginInProgressTabs.delete(tabId);
      redirectedTabs.delete(tabId);
    });
}

function handleOAuthLogin(tabId) {
  console.log(LOG_PREFIX, "🌐 User chose OAUTH (or timeout) for tab:", tabId);

  const tabInfo = redirectedTabs.get(tabId);
  if (!tabInfo) {
    console.error(LOG_PREFIX, "No tab info for OAuth:", tabId);
    return;
  }

  console.debug(LOG_PREFIX, "Redirect URL:", tabInfo.redirectUrl);

  // Whitelist this tab for OAuth
  allowedOAuthTabs.add(tabId);
  console.debug(LOG_PREFIX, "Added to allowedOAuthTabs:", tabId);

  // Navigate to OAuth URL
  setTimeout(() => {
    browser.tabs
      .update(tabId, { url: tabInfo.redirectUrl })
      .then(() => {
        console.debug(LOG_PREFIX, "OAuth navigation successful");

        // Clean up after a delay
        setTimeout(() => {
          redirectedTabs.delete(tabId);
          allowedOAuthTabs.delete(tabId);
          console.debug(LOG_PREFIX, "Cleaned up OAuth whitelist for:", tabId);
        }, 10000);
      })
      .catch((err) => {
        console.error(LOG_PREFIX, "OAuth navigation failed:", err);
        allowedOAuthTabs.delete(tabId);
      });
  }, 100);
}

function monitorLoginCompletion(tabId, instance, originalUrl) {
  console.debug(LOG_PREFIX, "Monitoring login for tab:", tabId);
  console.debug(LOG_PREFIX, "Will return to:", originalUrl);

  const listener = (updatedTabId, changeInfo, tab) => {
    if (updatedTabId !== tabId) return;

    console.debug(LOG_PREFIX, "Tab update:", changeInfo.status, tab.url);

    // Check if we're on an MFA page - keep monitoring
    if (
      tab.url &&
      (tab.url.includes("validate_multifactor_auth_code.do") ||
        tab.url.includes("validate_mfa_code.do"))
    ) {
      console.debug(LOG_PREFIX, "On MFA page, continuing to monitor");
      return; // Keep monitoring
    }

    // Login complete when we navigate away from login.do AND MFA pages
    if (
      changeInfo.status === "complete" &&
      tab.url &&
      !tab.url.includes("/login.do") &&
      !tab.url.includes("validate_multifactor_auth_code.do") &&
      !tab.url.includes("validate_mfa_code.do") &&
      tab.url.includes(instance)
    ) {
      console.log(LOG_PREFIX, "✅ Login successful! Now at:", tab.url);

      // Clean up listener first
      browser.tabs.onUpdated.removeListener(listener);

      // If we have an original URL and it's different from where we landed, redirect back
      if (
        originalUrl &&
        originalUrl !== tab.url &&
        !originalUrl.includes("auth_redirect") &&
        !originalUrl.includes("oauth_redirect") &&
        originalUrl.includes(instance)
      ) {
        console.log(
          LOG_PREFIX,
          "↩️ Redirecting back to original page:",
          originalUrl
        );

        setTimeout(() => {
          browser.tabs
            .update(tabId, { url: originalUrl })
            .then(() => {
              console.log(LOG_PREFIX, "✅ Returned to original page");
              redirectedTabs.delete(tabId);

              // Keep in loginInProgressTabs for a bit longer to prevent re-prompting
              // if the session isn't fully established yet
              setTimeout(() => {
                loginInProgressTabs.delete(tabId);
                console.debug(
                  LOG_PREFIX,
                  "Removed from loginInProgressTabs after delay:",
                  tabId
                );
              }, 3000);
            })
            .catch((err) => {
              console.error(
                LOG_PREFIX,
                "Failed to redirect to original page:",
                err
              );
              redirectedTabs.delete(tabId);
              loginInProgressTabs.delete(tabId);
            });
        }, 500); // Small delay to ensure login completes
      } else {
        console.debug(LOG_PREFIX, "No valid original URL to return to");
        redirectedTabs.delete(tabId);

        // Still keep in loginInProgressTabs for a bit to prevent re-prompting
        setTimeout(() => {
          loginInProgressTabs.delete(tabId);
          console.debug(
            LOG_PREFIX,
            "Removed from loginInProgressTabs after delay:",
            tabId
          );
        }, 3000);
      }
    }
  };

  browser.tabs.onUpdated.addListener(listener);

  // Timeout cleanup
  setTimeout(() => {
    browser.tabs.onUpdated.removeListener(listener);
    loginInProgressTabs.delete(tabId);
    console.debug(LOG_PREFIX, "Login monitoring timeout for tab:", tabId);
  }, 5 * 60 * 1000);
}

// Clean up on tab close
browser.tabs.onRemoved.addListener((tabId) => {
  if (
    redirectedTabs.has(tabId) ||
    allowedOAuthTabs.has(tabId) ||
    loginInProgressTabs.has(tabId)
  ) {
    console.debug(LOG_PREFIX, "Cleaning up closed tab:", tabId);
  }
  redirectedTabs.delete(tabId);
  allowedOAuthTabs.delete(tabId);
  loginInProgressTabs.delete(tabId);
});

console.log(LOG_PREFIX, "✅ Extension loaded");
