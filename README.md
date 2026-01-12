# ServiceNow Admin Login Helper

A Firefox extension for ServiceNow administrators who want to use admin credentials instead of OAuth SSO, with automatic tab restoration after login. *Completely vibe-coded, but it works how I want*.

## 🚀 Quick Start

### Prerequisites
- Firefox 57 or later
- ServiceNow admin credentials
- Access to ServiceNow instances that use OAuth/SSO redirects

### Installation

#### Option 1: Temporary Installation (Testing/Development)

1. **Download/Clone this repository**
   ```bash
   git clone <repository-url>
   cd servicenow-admin-helper
   ```

2. **Load the extension in Firefox**
   - Open Firefox
   - Navigate to `about:debugging#/runtime/this-firefox`
   - Click "Load Temporary Add-on"
   - Navigate to the extension folder and select `manifest.json`

3. **⚠️ IMPORTANT: Configure your instances**
   - Click the extension icon in your toolbar (🔐)
   - Click "+ Add Instance"
   - Enter your ServiceNow instance URL (e.g., `company.service-now.com`)
   - Add all your instances (dev, test, prod, etc.)
   - Click "Save Configuration"
   - **The extension will NOT work until you configure at least one instance!**

#### Option 2: Permanent Installation (Self-Signing)

1. **Package the extension**
   ```bash
   cd servicenow-admin-helper
   zip -r servicenow-admin-helper.zip * -x "*.git*" "*.DS_Store"
   ```

2. **Sign with Mozilla** (requires Mozilla developer account)
   - Visit https://addons.mozilla.org/developers/
   - Submit the .zip file for signing
   - Download the signed .xpi file

3. **Install the signed extension**
   - Open Firefox
   - Drag and drop the .xpi file into Firefox
   - Click "Add" when prompted
   - Configure your instances as described above

## 📖 How It Works

### The OAuth Redirect Problem

When your ServiceNow session expires, ServiceNow automatically redirects you to an OAuth/SSO login flow. This is problematic for admins because:

1. You lose your current page/work
2. You can't easily use admin credentials
3. Multiple tabs get redirected simultaneously
4. You have to manually navigate back to what you were working on

### The Solution

This extension intercepts OAuth redirects and gives you a choice:

```
ServiceNow Session Expires
         ↓
Extension Detects OAuth Redirect
         ↓
    [Block Redirect]
         ↓
   Show Prompt Dialog
    ┌─────────────┐
    │ Admin Login │  ← You choose this
    │    OAuth    │
    └─────────────┘
         ↓
Navigate to /login.do
         ↓
  You Login with Admin Creds
         ↓
Extension Monitors Login Progress
         ↓
[Detects Successful Login]
         ↓
Redirect Back to Original Page
         ↓
     You're Back!
```

### Technical Implementation

#### 1. Request Interception

The extension uses Firefox's `webRequest.onBeforeRequest` API to intercept all main frame requests to `*.service-now.com`:

```javascript
browser.webRequest.onBeforeRequest.addListener(
  (details) => {
    // Check if this is an OAuth redirect pattern
    if (isOAuthRedirect(url)) {
      // Block the redirect
      return { cancel: true };
    }
  },
  { urls: ["*://*.service-now.com/*"] },
  ["blocking"]
);
```

**OAuth Patterns Detected:**
- `auth_redirect.do`
- `oauth_redirect.do`
- `navpage.do` (when part of OAuth flow)
- `login.microsoftonline.com`
- `sso.do`

#### 2. State Management

The extension maintains three key state sets:

**`redirectedTabs`** - Map of tabs that have been intercepted
- Stores: original URL, redirect URL, instance, timestamp
- Used to track which tabs need handling and where to return them

**`loginInProgressTabs`** - Set of tab IDs currently in admin login flow
- Prevents duplicate prompts
- Allows all requests through during login (including MFA)
- Kept active until login completes + 3 second grace period

**`allowedOAuthTabs`** - Set of tab IDs whitelisted for OAuth
- Used when user chooses "Continue with OAuth"
- Prevents re-interception of the OAuth flow
- Cleared after 10 seconds

#### 3. Race Condition Prevention

Several race conditions are handled:

**A. Duplicate Prompt Prevention**
```javascript
// Block IMMEDIATELY on detection
redirectedTabs.set(tabId, { /* initial data */ });

// Then asynchronously get full tab info
browser.tabs.get(tabId).then(tab => {
  // Update with full data
  tabInfo.originalUrl = tab.url;
});
```

**B. Admin Login Flow Protection**
```javascript
// Check synchronously FIRST
if (loginInProgressTabs.has(tabId)) {
  return { cancel: true }; // Block silently
}
```

**C. Delayed State Cleanup**
```javascript
// Keep tab protected for 3 seconds after login
setTimeout(() => {
  loginInProgressTabs.delete(tabId);
}, 3000);
```

#### 4. Login Monitoring

The extension monitors the admin login process through all stages:

```javascript
function monitorLoginCompletion(tabId, instance, originalUrl) {
  const listener = (updatedTabId, changeInfo, tab) => {
    // Stage 1: Still on /login.do → keep monitoring
    if (tab.url.includes('/login.do')) {
      return; // Not done yet
    }
    
    // Stage 2: On MFA page → keep monitoring
    if (tab.url.includes('validate_multifactor_auth_code.do') ||
        tab.url.includes('validate_mfa_code.do')) {
      return; // Still in login flow
    }
    
    // Stage 3: Navigated away from login/MFA → SUCCESS!
    if (changeInfo.status === 'complete' && 
        tab.url.includes(instance)) {
      // Clean up and redirect back
    }
  };
}
```

**Why MFA Detection Matters:**
Without MFA detection, the extension would consider login "complete" as soon as you navigate away from `/login.do`. But if you're on the MFA page for more than 3 seconds (the grace period), an OAuth redirect could trigger and pull you away mid-MFA.

By detecting MFA pages, the extension keeps the tab protected throughout the entire authentication flow:
- `/login.do` → Username/password entry
- `validate_multifactor_auth_code.do` → MFA code entry
- Final redirect → Login complete

#### 5. Tab Restoration

After successful login, the extension restores your original context:

```javascript
if (originalUrl && 
    originalUrl !== currentUrl && 
    !originalUrl.includes('auth_redirect') &&
    originalUrl.includes(instance)) {
  
  // Redirect back to what you were working on
  browser.tabs.update(tabId, { url: originalUrl });
}
```

**Validation checks:**
- Original URL exists and is valid
- Not already on that URL
- Not an auth redirect URL (don't create loops)
- Same ServiceNow instance (security)

## 🔧 Configuration

### Adding Instances

1. Click the extension icon (🔐)
2. Click "+ Add Instance"
3. Enter full hostname: `yourcompany.service-now.com`
4. Click "Save Configuration"

**Validation:**
- Must end with `.service-now.com`
- Empty entries are automatically filtered out
- Changes take effect immediately

### Removing Instances

1. Click the extension icon
2. Click "Remove" next to any instance
3. Click "Save Configuration"

### Storage

Instances are stored in `browser.storage.local`, which:
- Persists across browser restarts
- Survives cookie clearing
- Is not synced (local to this Firefox installation)

## 🐛 Troubleshooting

### Extension not intercepting redirects

**Symptoms:** OAuth redirects happen normally, no prompt appears

**Solutions:**
1. Check that instances are configured (click extension icon)
2. Reload the extension in `about:debugging`
3. Check browser console for errors (Ctrl+Shift+J)
4. Verify the URL matches your configured instances

### Prompt appears multiple times

**Symptoms:** Dialog pops up repeatedly during login

**This should not happen.** If it does:
1. Check browser console logs for the tab ID
2. Look for "Already handling tab" or "Tab in admin login flow" messages
3. File a bug report with the logs

### Can't complete MFA / gets redirected during MFA

**Symptoms:** OAuth redirect happens while entering MFA code

**This should not happen.** The extension monitors for:
- `validate_multifactor_auth_code.do`
- `validate_mfa_code.do`

If you have a different MFA URL, file a bug report.

### Not redirecting back to original page

**Symptoms:** Login succeeds but stays on homepage

**This is expected** in these cases:
- Original URL was a new tab (`about:newtab`)
- Original URL was `about:blank`
- Original URL contained `auth_redirect` or `oauth_redirect`
- Original URL was on a different instance

**For other cases:** Check console logs for "No valid original URL to return to"

## 📊 Console Logging

The extension uses prefixed logging for easy debugging:

```
[SN Auth Helper] 🛑 Blocking OAuth redirect for tab: 123
[SN Auth Helper] 📋 Opening prompt for tab: 123
[SN Auth Helper] 🔐 User chose ADMIN LOGIN for tab: 123
[SN Auth Helper] ➡️ Navigating to: https://instance.service-now.com/login.do
[SN Auth Helper] ✅ Login successful! Now at: https://...
[SN Auth Helper] ↩️ Redirecting back to original page: https://...
```

Enable `console.debug` messages in Firefox DevTools to see detailed flow:
1. Open Browser Console (Ctrl+Shift+J)
2. Click the gear icon
3. Check "Show Content Messages"
4. Filter by `[SN Auth Helper]`

## 🤝 Contributing

### Project Structure

```
servicenow-admin-helper/
├── manifest.json          # Extension metadata and permissions
├── background.js          # Main logic (request interception, state management)
├── popup.html            # Extension popup UI
├── popup.js              # Popup logic (instance management)
├── prompt.html           # Login choice dialog
├── prompt.js             # Prompt dialog logic
├── icon.svg              # Extension icon (convert to icon.png)
└── README.md             # This file
```

### Development Workflow

1. Make changes to files
2. Go to `about:debugging#/runtime/this-firefox`
3. Click "Reload" next to the extension
4. Test your changes
5. Check browser console for logs

### Testing Scenarios

**Must test:**
- [ ] Fresh page login (navigate to ServiceNow when not logged in)
- [ ] Session expiration (clear cookies while on a page, then refresh)
- [ ] Multiple tabs expiring simultaneously
- [ ] MFA flow (if your instance uses it)
- [ ] OAuth choice (clicking "Continue with OAuth")
- [ ] Timeout (let the 10-second timer expire)
- [ ] Multiple instances (dev, test, prod)

## 📝 License

MIT License

...

AI generated the icon.svg. If it derived its material from your assets, please let me know and I'll take it down.

## 🙏 Acknowledgments

Built for ServiceNow administrators who value efficiency and want to maintain their workflow when sessions expire.
