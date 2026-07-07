(function () {
  const STORAGE_KEY = "aiseelearn:b3-u1-dialogue-part1";
  const TABLE_FIELDS = [
    "zacPlace",
    "zacWeather",
    "zacThing",
    "jamiePlace",
    "jamieWeather",
    "jamieThing"
  ];
  const TASK_LABELS = {
    keyword: "Need Word Help",
    table: "Fill the Table",
    sentences: "Write Sentences",
    thinking: "Explain Why"
  };

  const state = loadState();
  let activeInput = null;

  function defaultState() {
    return {
      step: "warmup",
      nextTask: "undecided",
      status: "in_progress",
      fields: {}
    };
  }

  function loadState() {
    try {
      return normalizeState(JSON.parse(localStorage.getItem(STORAGE_KEY)) || defaultState());
    } catch (_error) {
      return defaultState();
    }
  }

  function normalizeState(saved) {
    const fresh = defaultState();
    return {
      ...fresh,
      ...saved,
      nextTask: TASK_LABELS[saved.nextTask] ? saved.nextTask : "undecided",
      step: ["warmup", "listening", "next"].includes(saved.step) ? saved.step : "warmup",
      fields: saved.fields || {}
    };
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
    const currentStep = document.querySelector("[data-current-step]");
    const updated = state.updatedAt ? new Date(state.updatedAt) : null;
    const readableStatus = state.status === "completed" ? "Completed" : "In progress";
    const nextTask = TASK_LABELS[state.nextTask] || "Not decided";

    if (progressText) {
      progressText.textContent = updated ? `${readableStatus} · ${nextTask}` : "Not started";
    }

    if (currentPath) {
      currentPath.textContent = nextTask;
    }

    if (currentStep) {
      currentStep.textContent = stepLabel(state.step);
    }

    document.querySelectorAll("[data-flow-step]").forEach((item) => {
      item.classList.toggle("active", item.dataset.flowStep === state.step);
    });

    document.querySelectorAll("[data-level-task]").forEach((card) => {
      card.classList.toggle("active", card.dataset.levelTask === state.nextTask);
    });
  }

  function stepLabel(step) {
    if (step === "listening") return "Listening";
    if (step === "next") return "Next Task";
    return "Warm-up";
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

  function restoreFields() {
    document.querySelectorAll("[data-field]").forEach((field) => {
      field.value = state.fields[field.dataset.field] || "";
    });
    restoreWordButtons();
  }

  function restoreWordButtons() {
    const selected = (state.fields.keywords || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);

    document.querySelectorAll("[data-word]").forEach((button) => {
      button.classList.toggle("selected", selected.includes(button.dataset.word));
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
        if (TABLE_FIELDS.includes(field.dataset.field)) {
          state.step = "listening";
        }
        saveState();
      });
    });
  }

  function bindWordBank() {
    document.querySelectorAll("[data-word]").forEach((button) => {
      button.addEventListener("click", () => {
        const word = button.dataset.word;
        button.classList.toggle("selected");
        updateKeywordsFromButtons();

        if (activeInput && activeInput.dataset.field !== "keywords") {
          activeInput.value = appendToken(activeInput.value, word);
          state.fields[activeInput.dataset.field] = activeInput.value;
        }

        state.status = "in_progress";
        state.step = "listening";
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

  function updateKeywordsFromButtons() {
    const tokens = Array.from(document.querySelectorAll("[data-word].selected"))
      .map((button) => button.dataset.word);
    state.fields.keywords = tokens.join(", ");
    const keywordInput = document.querySelector('[data-field="keywords"]');
    if (keywordInput) keywordInput.value = state.fields.keywords;
  }

  function appendToken(value, token) {
    const clean = value.trim();
    if (!clean) return token;
    const parts = clean.split(/,\s*/);
    if (parts.includes(token)) return clean;
    return `${clean}, ${token}`;
  }

  function bindStartButton() {
    const button = document.querySelector("[data-start-task]");
    if (!button) return;
    button.addEventListener("click", () => {
      state.step = "warmup";
      state.status = "in_progress";
      saveState();
      document.querySelector(".ai-warmup-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  function bindRecommendationButton() {
    const button = document.querySelector("[data-check-listening]");
    if (!button) return;
    button.addEventListener("click", () => {
      state.nextTask = recommendNextTask();
      state.step = "next";
      state.status = "in_progress";
      updateRecommendationCopy();
      saveState();
      document.querySelector("[data-recommend-panel]")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  function recommendNextTask() {
    const filledCount = TABLE_FIELDS.filter((field) => (state.fields[field] || "").trim()).length;
    const keywordCount = (state.fields.keywords || "").split(",").filter((item) => item.trim()).length;
    const sentenceCount = ["zacSentence", "jamieSentence"].filter((field) => (state.fields[field] || "").trim()).length;

    if (filledCount <= 2 && keywordCount < 3) return "keyword";
    if (filledCount < TABLE_FIELDS.length) return "table";
    if (sentenceCount < 2) return "sentences";
    return "thinking";
  }

  function updateRecommendationCopy() {
    const copy = document.querySelector("[data-recommend-copy]");
    if (!copy) return;

    const messages = {
      keyword: "Start with word support. Choose useful words, then listen again and fill in the table.",
      table: "You caught some information. Listen again and complete the missing cells before writing.",
      sentences: "Your table is ready. Now turn the information into two complete sentences.",
      thinking: "You are ready for the stretch task. Explain why the weather is different in the dialogue.",
      undecided: "Finish the warm-up and Listening Table, then click “Recommend Next Task.”"
    };

    copy.textContent = messages[state.nextTask] || messages.undecided;
  }

  function bindCompleteButton() {
    const button = document.querySelector("[data-mark-complete]");
    if (!button) return;
    button.addEventListener("click", () => {
      state.status = "completed";
      state.step = "next";
      saveState();
    });
  }

  function bindClearProgress() {
    document.querySelectorAll("[data-clear-progress]").forEach((button) => {
      button.addEventListener("click", () => {
        localStorage.removeItem(STORAGE_KEY);
        Object.assign(state, defaultState(), { updatedAt: null });
        restoreFields();
        updateRecommendationCopy();
        updateProgressText();
      });
    });
  }

  function initUnitTaskPage() {
    restoreFields();
    bindFields();
    bindWordBank();
    bindStartButton();
    bindRecommendationButton();
    bindCompleteButton();
    updateRecommendationCopy();
    updateProgressText();
  }

  bindClearProgress();

  if (document.body.dataset.page === "unit-task") {
    initUnitTaskPage();
  }
})();
