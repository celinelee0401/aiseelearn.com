(function () {
  const PLAYLIST_STORAGE_KEY = "aiseelearn:b3-u1-teacher-playlist-v1";

  function defaultPlaylistState() {
    return {
      periods: {},
      updatedAt: null
    };
  }

  function loadPlaylistState() {
    try {
      const saved = JSON.parse(localStorage.getItem(PLAYLIST_STORAGE_KEY)) || defaultPlaylistState();
      return {
        ...defaultPlaylistState(),
        ...saved,
        periods: saved.periods || {}
      };
    } catch (_error) {
      return defaultPlaylistState();
    }
  }

  function savePlaylistState(playlistState) {
    playlistState.updatedAt = new Date().toISOString();
    localStorage.setItem(PLAYLIST_STORAGE_KEY, JSON.stringify(playlistState));
    flashPlaylistSaved();
  }

  function periodDefaults(card) {
    return {
      status: "planned",
      compressed: false,
      home: card.dataset.periodKind === "prep",
      paper: false
    };
  }

  function periodState(playlistState, card) {
    const key = card.dataset.playlistPeriod;
    const saved = playlistState.periods[key] || {};
    return {
      ...periodDefaults(card),
      ...saved,
      status: ["planned", "assigned", "done"].includes(saved.status) ? saved.status : "planned",
      compressed: Boolean(saved.compressed),
      home: Boolean(saved.home ?? periodDefaults(card).home),
      paper: Boolean(saved.paper)
    };
  }

  function setPeriodState(playlistState, card, nextState) {
    const key = card.dataset.playlistPeriod;
    playlistState.periods[key] = {
      ...periodState(playlistState, card),
      ...nextState
    };
    savePlaylistState(playlistState);
    renderPlaylistCard(card, playlistState);
    updatePlaylistMetrics(playlistState);
  }

  function ensurePeriodControls(card, playlistState) {
    if (card.querySelector("[data-period-planner]")) return;

    const key = card.dataset.playlistPeriod;
    const planner = document.createElement("div");
    planner.className = "period-planner";
    planner.dataset.periodPlanner = key;
    planner.innerHTML = `
      <div class="period-status-control" role="group" aria-label="Period status">
        <button type="button" data-period-status="planned">Planned</button>
        <button type="button" data-period-status="assigned">Assigned</button>
        <button type="button" data-period-status="done">Done</button>
      </div>
      <div class="period-flags">
        <label><input type="checkbox" data-period-flag="compressed"> Compressed</label>
        <label><input type="checkbox" data-period-flag="home"> Move home</label>
        <label><input type="checkbox" data-period-flag="paper"> Paper record</label>
      </div>
    `;

    const tagRow = card.querySelector(".path-tags");
    if (tagRow) {
      card.insertBefore(planner, tagRow);
    } else {
      card.appendChild(planner);
    }

    planner.querySelectorAll("[data-period-status]").forEach((button) => {
      button.addEventListener("click", () => {
        setPeriodState(playlistState, card, { status: button.dataset.periodStatus });
      });
    });

    planner.querySelectorAll("[data-period-flag]").forEach((checkbox) => {
      checkbox.addEventListener("change", () => {
        setPeriodState(playlistState, card, { [checkbox.dataset.periodFlag]: checkbox.checked });
      });
    });
  }

  function renderPlaylistCard(card, playlistState) {
    const current = periodState(playlistState, card);
    card.classList.toggle("status-assigned", current.status === "assigned");
    card.classList.toggle("status-done", current.status === "done");

    card.querySelectorAll("[data-period-status]").forEach((button) => {
      const active = button.dataset.periodStatus === current.status;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });

    card.querySelectorAll("[data-period-flag]").forEach((checkbox) => {
      checkbox.checked = Boolean(current[checkbox.dataset.periodFlag]);
    });
  }

  function updatePlaylistMetrics(playlistState) {
    const cards = Array.from(document.querySelectorAll("[data-playlist-period]"));
    const coreCards = cards.filter((card) => card.dataset.periodKind === "core");
    const coreStates = coreCards.map((card) => periodState(playlistState, card));
    const done = coreStates.filter((item) => item.status === "done").length;
    const assigned = coreStates.filter((item) => item.status === "assigned" || item.status === "done").length;
    const adjusted = cards.filter((card) => {
      const current = periodState(playlistState, card);
      return current.compressed || current.home || current.paper;
    }).length;

    const doneNode = document.querySelector("[data-playlist-done]");
    const assignedNode = document.querySelector("[data-playlist-assigned]");
    const adjustedNode = document.querySelector("[data-playlist-adjusted]");
    if (doneNode) doneNode.textContent = `${done} / ${coreCards.length}`;
    if (assignedNode) assignedNode.textContent = String(assigned);
    if (adjustedNode) adjustedNode.textContent = String(adjusted);
  }

  function flashPlaylistSaved() {
    const saveState = document.querySelector("[data-playlist-save-state]");
    if (!saveState) return;
    saveState.textContent = "Saved locally";
    window.clearTimeout(flashPlaylistSaved.timer);
    flashPlaylistSaved.timer = window.setTimeout(() => {
      saveState.textContent = "Ready";
    }, 1400);
  }

  function bindResetPlaylist(playlistState) {
    const button = document.querySelector("[data-reset-playlist]");
    if (!button) return;
    button.addEventListener("click", () => {
      localStorage.removeItem(PLAYLIST_STORAGE_KEY);
      const fresh = defaultPlaylistState();
      playlistState.periods = fresh.periods;
      playlistState.updatedAt = fresh.updatedAt;
      document.querySelectorAll("[data-playlist-period]").forEach((card) => {
        renderPlaylistCard(card, playlistState);
      });
      updatePlaylistMetrics(playlistState);
      flashPlaylistSaved();
    });
  }

  function initUnitPathPage() {
    if (document.body.dataset.page !== "unit-path") return;
    const playlistState = loadPlaylistState();
    document.querySelectorAll("[data-playlist-period]").forEach((card) => {
      ensurePeriodControls(card, playlistState);
      renderPlaylistCard(card, playlistState);
    });
    updatePlaylistMetrics(playlistState);
    bindResetPlaylist(playlistState);
  }

  initUnitPathPage();
})();
