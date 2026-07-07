(function () {
  const STORAGE_KEY = "aiseelearn:b3-u1-dialogue-part1";
  const state = loadState();
  let activeInput = null;

  function loadState() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {
        path: "S4",
        status: "in_progress",
        fields: {}
      };
    } catch (_error) {
      return { path: "S4", status: "in_progress", fields: {} };
    }
  }

  function saveState() {
    state.updatedAt = new Date().toISOString();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    updateProgressText();
    flashSaved();
  }

  function updateProgressText() {
    const progressText = document.querySelector("[data-progress-text]");
    const currentPath = document.querySelector("[data-current-path]");
    const taskStatus = document.querySelector("[data-task-status]");
    const updated = state.updatedAt ? new Date(state.updatedAt) : null;
    const readableStatus = state.status === "completed" ? "Completed" : "In progress";

    if (progressText) {
      progressText.textContent = updated ? `${readableStatus} · ${state.path}` : "Not started";
    }

    if (currentPath) {
      currentPath.textContent = state.path;
    }

    if (taskStatus) {
      taskStatus.textContent = readableStatus;
    }
  }

  function flashSaved() {
    const saveState = document.querySelector("[data-save-state]");
    if (!saveState) return;
    saveState.textContent = "Saved locally";
    window.clearTimeout(flashSaved.timer);
    flashSaved.timer = window.setTimeout(() => {
      saveState.textContent = "Ready";
    }, 1400);
  }

  function setPath(path, options = {}) {
    state.path = path;
    state.status = state.status || "in_progress";
    document.querySelectorAll("[data-path-select]").forEach((button) => {
      button.classList.toggle("active", button.dataset.pathSelect === path);
    });
    document.querySelectorAll("[data-level-task]").forEach((card) => {
      card.classList.toggle("active", card.dataset.levelTask === path);
    });
    if (options.persist !== false) {
      saveState();
    } else {
      updateProgressText();
    }
  }

  function restoreFields() {
    document.querySelectorAll("[data-field]").forEach((field) => {
      field.value = state.fields[field.dataset.field] || "";
    });
  }

  function bindFields() {
    document.querySelectorAll("[data-field]").forEach((field) => {
      field.addEventListener("focus", () => {
        activeInput = field;
      });
      field.addEventListener("input", () => {
        state.fields[field.dataset.field] = field.value;
        state.status = "in_progress";
        saveState();
      });
    });
  }

  function bindWordBank() {
    document.querySelectorAll("[data-word]").forEach((button) => {
      button.addEventListener("click", () => {
        const word = button.dataset.word;
        button.classList.toggle("selected");
        addKeyword(word);

        if (activeInput && activeInput.dataset.field !== "keywords") {
          activeInput.value = appendToken(activeInput.value, word);
          state.fields[activeInput.dataset.field] = activeInput.value;
        }

        state.status = "in_progress";
        saveState();
      });
    });

    const copyButton = document.querySelector("[data-copy-keywords]");
    if (copyButton) {
      copyButton.addEventListener("click", async () => {
        const value = state.fields.keywords || "";
        if (!value) return;
        try {
          await navigator.clipboard.writeText(value);
          copyButton.textContent = "Copied";
          window.setTimeout(() => {
            copyButton.textContent = "Copy Selected";
          }, 1200);
        } catch (_error) {
          const keywordInput = document.querySelector('[data-field="keywords"]');
          if (keywordInput) keywordInput.select();
        }
      });
    }
  }

  function addKeyword(word) {
    const keywordInput = document.querySelector('[data-field="keywords"]');
    const current = state.fields.keywords || "";
    const tokens = current.split(",").map((item) => item.trim()).filter(Boolean);
    if (!tokens.includes(word)) tokens.push(word);
    state.fields.keywords = tokens.join(", ");
    if (keywordInput) keywordInput.value = state.fields.keywords;
  }

  function appendToken(value, token) {
    const clean = value.trim();
    if (!clean) return token;
    const parts = clean.split(/,\s*/);
    if (parts.includes(token)) return clean;
    return `${clean}, ${token}`;
  }

  function bindPathButtons() {
    document.querySelectorAll("[data-path-select]").forEach((button) => {
      button.addEventListener("click", () => setPath(button.dataset.pathSelect));
    });
  }

  function bindCompleteButton() {
    const button = document.querySelector("[data-mark-complete]");
    if (!button) return;
    button.addEventListener("click", () => {
      state.status = "completed";
      saveState();
    });
  }

  function bindClearProgress() {
    document.querySelectorAll("[data-clear-progress]").forEach((button) => {
      button.addEventListener("click", () => {
        localStorage.removeItem(STORAGE_KEY);
        state.path = "S4";
        state.status = "in_progress";
        state.fields = {};
        state.updatedAt = null;
        restoreFields();
        setPath("S4", { persist: false });
        updateProgressText();
      });
    });
  }

  function initUnitTaskPage() {
    restoreFields();
    bindFields();
    bindWordBank();
    bindPathButtons();
    bindCompleteButton();
    setPath(state.path || "S4", { persist: false });
    updateProgressText();
  }

  bindClearProgress();

  if (document.body.dataset.page === "unit-task") {
    initUnitTaskPage();
  }
})();
