// Firefox uses 'browser', Chrome uses 'chrome'
const browserAPI = typeof browser !== "undefined" ? browser : chrome;

const instanceList = document.getElementById("instanceList");
const addButton = document.getElementById("addInstance");
const saveButton = document.getElementById("saveInstances");
const statusDiv = document.getElementById("status");

let instances = [];

// Load saved instances
function loadInstances() {
  browserAPI.storage.local.get("instances").then((result) => {
    instances = result.instances || [];

    if (instances.length === 0) {
      // Show empty state
      instanceList.innerHTML =
        '<div class="empty-state">No instances configured yet</div>';
    } else {
      renderInstances();
    }
  });
}

// Render the instance list
function renderInstances() {
  instanceList.innerHTML = "";

  instances.forEach((instance, index) => {
    const item = document.createElement("div");
    item.className = "instance-item";

    // Create input
    const input = document.createElement("input");
    input.type = "text";
    input.value = instance;
    input.placeholder = "example.service-now.com";
    input.setAttribute("data-index", index);

    // Create remove button
    const removeBtn = document.createElement("button");
    removeBtn.className = "btn-remove";
    removeBtn.textContent = "Remove";
    removeBtn.setAttribute("data-index", index);

    item.appendChild(input);
    item.appendChild(removeBtn);
    instanceList.appendChild(item);
  });

  // Add event listeners to remove buttons
  document.querySelectorAll(".btn-remove").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const index = parseInt(e.target.getAttribute("data-index"));
      removeInstance(index);
    });
  });

  // Add event listeners to inputs for live updates
  document.querySelectorAll('input[type="text"]').forEach((input) => {
    input.addEventListener("input", (e) => {
      const index = parseInt(e.target.getAttribute("data-index"));
      instances[index] = e.target.value.trim();
    });
  });
}

// Add a new instance input
function addInstance() {
  instances.push("");
  renderInstances();

  // Focus the new input
  const inputs = instanceList.querySelectorAll('input[type="text"]');
  if (inputs.length > 0) {
    inputs[inputs.length - 1].focus();
  }
}

// Remove an instance
function removeInstance(index) {
  instances.splice(index, 1);

  if (instances.length === 0) {
    instanceList.innerHTML =
      '<div class="empty-state">No instances configured yet</div>';
  } else {
    renderInstances();
  }
}

// Save instances
function saveInstances() {
  // Filter out empty instances
  const validInstances = instances
    .map((i) => i.trim())
    .filter((i) => i.length > 0);

  if (validInstances.length === 0) {
    showStatus("Please add at least one instance", "error");
    return;
  }

  // Validate instances (basic check)
  for (const instance of validInstances) {
    if (!instance.includes(".service-now.com")) {
      showStatus(
        `Invalid instance: ${instance}. Must be a .service-now.com domain`,
        "error"
      );
      return;
    }
  }

  browserAPI.storage.local
    .set({ instances: validInstances })
    .then(() => {
      // Notify background script to update
      browserAPI.runtime.sendMessage({
        action: "updateInstances",
        instances: validInstances,
      });

      instances = validInstances;
      renderInstances();
      showStatus(
        `Saved ${validInstances.length} instance(s) successfully!`,
        "success"
      );
    })
    .catch((err) => {
      showStatus("Failed to save: " + err.message, "error");
    });
}

// Show status message
function showStatus(message, type) {
  statusDiv.textContent = message;
  statusDiv.className = `status ${type}`;

  // Hide after 3 seconds
  setTimeout(() => {
    statusDiv.className = "status";
  }, 3000);
}

// Event listeners
addButton.addEventListener("click", addInstance);
saveButton.addEventListener("click", saveInstances);

// Load on startup
loadInstances();
