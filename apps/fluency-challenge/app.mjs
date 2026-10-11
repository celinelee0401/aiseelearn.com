import { PcmWavRecorder } from "./lib/browser-recorder.mjs";
import {
  FINISH_SENTENCE_GRACE_MS,
  getRecordingTimerState
} from "./lib/recording-timer.mjs";
import {
  firstIncompleteRoundIndex,
  mergeRoundResults,
  normalizeCompletedRounds
} from "./lib/round-progress.mjs";
import { urlWithUnit } from "./lib/unit-url.mjs";
import { canRetryAssessment, createAssessmentForm } from "./lib/assessment-retry.mjs";
import {
  biggestGain,
  compareRounds,
  formatDelta,
  previousResult,
  progressHeadline
} from "./lib/round-comparison.mjs";

const api = Object.freeze({
  login: "/api/fluency/auth/login",
  session: "/api/fluency/session",
  logout: "/api/fluency/auth/logout",
  task: "/api/fluency/task",
  assess: "/api/fluency/assess"
});

const elements = Object.fromEntries([
  "loginView", "challengeView", "loginForm", "loginButton", "loginError",
  "schoolYear", "classCode", "seatNumber", "pin", "unitId", "activationFields",
  "activationCode", "pinConfirmation", "activationToggle", "logoutButton", "studentLabel",
  "taskTitle", "roundBadge", "promptText", "timerLabel", "timer", "recordButton",
  "recordButtonText", "recordMessage", "resultCard", "metrics", "transcript", "playback",
  "assessmentNotice", "nextRoundButton", "completeCard", "roundSummary", "finishButton",
  "discardRecordingButton", "progressHeadline", "growthHeadline"
].map((id) => [id, document.getElementById(id)]));

const state = {
  activationMode: false,
  session: null,
  task: null,
  roundIndex: 0,
  recorder: null,
  timerId: null,
  deadline: 0,
  stopping: false,
  completedRounds: [],
  results: [],
  objectUrls: [],
  pendingRecording: null,
  pendingAttemptId: null
};

elements.loginForm.addEventListener("submit", login_);
elements.activationToggle.addEventListener("click", toggleActivation_);
elements.logoutButton.addEventListener("click", logout_);
elements.finishButton.addEventListener("click", logout_);
elements.recordButton.addEventListener("click", toggleRecording_);
elements.discardRecordingButton.addEventListener("click", discardPendingRecording_);
elements.nextRoundButton.addEventListener("click", nextRound_);
window.addEventListener("beforeunload", cleanupAudio_);

setUnitFromUrl_();
void resumeSession_();

async function resumeSession_() {
  const response = await safeFetch_(api.session, { cache: "no-store" });
  if (!response?.ok) return;
  const body = await response.json();
  if (!body?.session) return;
  state.session = body.session;
  await loadTask_();
}

async function login_(event) {
  event.preventDefault();
  elements.loginError.textContent = "";
  const pin = elements.pin.value.trim();
  if (!/^\d{6}$/.test(pin)) return showLoginError_("請輸入六位數 PIN。");
  if (state.activationMode && pin !== elements.pinConfirmation.value.trim()) {
    return showLoginError_("兩次輸入的新 PIN 不一樣。");
  }
  const requestBody = {
    requestId: uuid_(),
    mode: state.activationMode ? "activate" : "login",
    schoolYear: elements.schoolYear.value.trim(),
    classCode: elements.classCode.value.trim(),
    seatNumber: Number(elements.seatNumber.value),
    pin,
    ...(state.activationMode ? { activationCode: elements.activationCode.value.trim() } : {})
  };
  setBusy_(elements.loginButton, true, "正在驗證…");
  const response = await safeFetch_(api.login, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody)
  });
  const body = await jsonOrNull_(response);
  setBusy_(elements.loginButton, false, "登入並載入任務");
  if (!response?.ok || !body?.session) return showLoginError_(body?.error || "目前無法登入，請稍後再試。");
  state.session = body.session;
  elements.pin.value = "";
  elements.pinConfirmation.value = "";
  elements.activationCode.value = "";
  await loadTask_();
}

async function loadTask_(options = {}) {
  const preserveResults = options.preserveResults === true;
  const resumeMessage = String(options.resumeMessage || "");
  const unitId = normalizeUnit_(elements.unitId.value);
  if (!unitId) return showLoginError_("請確認單元代碼。");
  elements.loginError.textContent = "正在載入老師指定的任務…";
  const response = await safeFetch_(`${api.task}?unitId=${encodeURIComponent(unitId)}`, { cache: "no-store" });
  const body = await jsonOrNull_(response);
  if (!response?.ok || !body?.task) {
    if (response?.status === 401) state.session = null;
    return showLoginError_(body?.error || "目前沒有可開始的口說任務。");
  }
  state.task = body.task;
  elements.unitId.value = state.task.unitId;
  window.history.replaceState(window.history.state, "", urlWithUnit(location.href, state.task.unitId));
  state.completedRounds = normalizeCompletedRounds(body.task.completedRounds, body.task.rounds.length);
  const savedResults = restoredResults_(body.task.completedAttempts);
  const localResults = preserveResults
    ? state.results.filter((result) => state.completedRounds.includes(result.round))
    : [];
  state.results = mergeRoundResults(savedResults, localResults);
  elements.loginError.textContent = "";
  elements.studentLabel.textContent = `${state.session.classCode} 班 · ${state.session.seatNumber} 號 · ${state.task.unitId}`;
  elements.taskTitle.textContent = state.task.title;
  elements.promptText.textContent = state.task.promptText || "依照老師指定的題目完成口說。";
  elements.loginView.classList.add("hidden");
  elements.challengeView.classList.remove("hidden");
  elements.logoutButton.classList.remove("hidden");
  const nextRoundIndex = firstIncompleteRoundIndex(state.task.rounds, state.completedRounds);
  if (nextRoundIndex < 0) {
    showComplete_();
    return;
  }
  state.roundIndex = nextRoundIndex;
  showRound_();
  if (resumeMessage) elements.recordMessage.textContent = resumeMessage;
}

function showRound_() {
  clearPendingRecording_();
  const round = currentRound_();
  elements.resultCard.classList.add("hidden");
  elements.completeCard.classList.add("hidden");
  elements.recordButton.closest(".record-card").classList.remove("hidden");
  elements.recordButton.disabled = false;
  elements.recordButton.classList.remove("recording");
  elements.timer.classList.remove("finish-sentence");
  elements.recordButtonText.textContent = "開始錄音";
  elements.recordMessage.textContent = "請先想好內容，再按下開始。";
  elements.roundBadge.textContent = `Round ${round.round}`;
  elements.timerLabel.textContent = `本輪目標 ${round.timeLimitSeconds} 秒`;
  elements.timer.textContent = String(round.timeLimitSeconds);
  document.querySelectorAll(".progress-step").forEach((step, index) => {
    step.classList.toggle("done", state.completedRounds.includes(index + 1));
    step.classList.toggle("active", index === state.roundIndex);
  });
}

async function toggleRecording_() {
  if (state.stopping || elements.recordButton.disabled) return;
  if (state.pendingRecording) return submitPendingAssessment_();
  if (state.recorder) return stopAndAssess_();
  const recorder = new PcmWavRecorder();
  try {
    await recorder.start();
  } catch {
    recorder.cancel();
    elements.recordMessage.textContent = "無法使用麥克風。請允許錄音權限後再試一次。";
    return;
  }
  state.recorder = recorder;
  const seconds = currentRound_().timeLimitSeconds;
  state.deadline = performance.now() + seconds * 1000;
  elements.recordButton.classList.add("recording");
  elements.recordButtonText.textContent = "停止並評測";
  elements.recordMessage.textContent = "錄音中…請繼續說到完成。";
  updateTimer_();
  state.timerId = window.setInterval(updateTimer_, 100);
}

function updateTimer_() {
  const timer = getRecordingTimerState({
    targetDeadlineMs: state.deadline,
    nowMs: performance.now(),
    graceMs: FINISH_SENTENCE_GRACE_MS
  });
  elements.timer.textContent = String(timer.displaySeconds);
  const isFinishingSentence = timer.phase === "finish-sentence";
  elements.timer.classList.toggle("finish-sentence", isFinishingSentence);
  if (isFinishingSentence) {
    elements.timerLabel.textContent = "時間到｜請說完這一句";
    elements.recordMessage.textContent = "請把現在這句說完；最多 3 秒後自動停止。";
  }
  if (timer.shouldStop && state.recorder && !state.stopping) void stopAndAssess_();
}

async function stopAndAssess_() {
  if (!state.recorder || state.stopping) return;
  state.stopping = true;
  window.clearInterval(state.timerId);
  state.timerId = null;
  elements.recordButton.disabled = true;
  elements.recordButton.classList.remove("recording");
  elements.timer.classList.remove("finish-sentence");
  elements.recordButtonText.textContent = "分析中…";
  elements.recordMessage.textContent = "正在檢查錄音品質與口說表現。";
  let recording;
  try {
    recording = await state.recorder.stop();
  } catch {
    state.recorder.cancel();
    state.recorder = null;
    state.stopping = false;
    return resetRoundWithMessage_("錄音沒有完整保存，請重新錄製。");
  }
  state.recorder = null;
  state.pendingRecording = recording;
  state.pendingAttemptId = uuid_();
  state.stopping = false;
  await submitPendingAssessment_();
}

async function submitPendingAssessment_() {
  if (!state.pendingRecording || state.stopping) return;
  state.stopping = true;
  elements.recordButton.disabled = true;
  elements.discardRecordingButton.disabled = true;
  elements.recordButtonText.textContent = "分析中…";
  elements.recordMessage.textContent = "正在送出這次錄音並檢查口說表現。";
  const recording = state.pendingRecording;
  const form = createAssessmentForm({
    attemptId: state.pendingAttemptId,
    assignmentId: state.task.assignmentId,
    unitId: state.task.unitId,
    round: currentRound_().round,
    audio: recording.blob
  });
  const response = await safeFetch_(api.assess, { method: "POST", body: form });
  const body = await jsonOrNull_(response);
  state.stopping = false;
  if (response?.status === 409) {
    clearPendingRecording_();
    await loadTask_({
      preserveResults: true,
      resumeMessage: "上一輪已經完成，已為你進入下一輪。"
    });
    return;
  }
  if (!response?.ok || !body?.assessment) {
    if (canRetryAssessment(response?.status ?? null) || response?.ok) {
      elements.recordButton.disabled = false;
      elements.discardRecordingButton.disabled = false;
      elements.discardRecordingButton.classList.remove("hidden");
      elements.recordButtonText.textContent = "重新送出評測";
      elements.recordMessage.textContent = "語音服務暫時未完成評測。錄音仍保留在此頁，請勿重新整理；可重新送出同一段，或選擇重新錄製。";
      return;
    }
    clearPendingRecording_();
    return resetRoundWithMessage_(body?.error || "這次評測沒有完成，請再錄一次。");
  }
  clearPendingRecording_();
  const objectUrl = URL.createObjectURL(recording.blob);
  state.objectUrls.push(objectUrl);
  state.completedRounds = normalizeCompletedRounds(
    [...state.completedRounds, currentRound_().round],
    state.task.rounds.length
  );
  state.results.push({
    round: currentRound_().round,
    attemptId: body.attemptId,
    audioUrl: objectUrl,
    timeLimitSeconds: body.timeLimitSeconds ?? currentRound_().timeLimitSeconds,
    assessment: body.assessment
  });
  showResult_(state.results.at(-1));
}

function showResult_(result) {
  elements.recordButton.disabled = true;
  const isFlowCheck = result.assessment.provider?.name === "staging-flow-check";
  elements.recordMessage.textContent = isFlowCheck
    ? "本輪已儲存（測試模式：尚未進行語音評測）。"
    : "本輪已完成並安全儲存。";
  elements.playback.src = result.audioUrl;
  elements.transcript.textContent = result.assessment.transcript
    || (isFlowCheck ? "測試模式尚未啟用語音辨識。" : "未取得可顯示的辨識文字。");
  const comparisons = compareRounds(result, previousResult(state.results, result.round));
  elements.progressHeadline.textContent = isFlowCheck ? "" : progressHeadline(comparisons);
  elements.metrics.replaceChildren(
    ...comparisons.map((item) => metric_(
      item.label,
      item.unit ? `${display_(item.value)} ${item.unit}` : display_(item.value),
      item
    )),
    metric_("實際錄音", formatDuration_(result.assessment.durationMs, result.timeLimitSeconds))
  );
  elements.recordButton.closest(".record-card").classList.add("hidden");
  showAssessmentNotice_(result.assessment);
  elements.nextRoundButton.textContent = firstIncompleteRoundIndex(state.task.rounds, state.completedRounds) < 0
    ? "查看三輪結果"
    : "進入下一輪";
  elements.resultCard.classList.remove("hidden");
  elements.resultCard.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function nextRound_() {
  const nextRoundIndex = firstIncompleteRoundIndex(state.task.rounds, state.completedRounds);
  if (nextRoundIndex >= 0) {
    state.roundIndex = nextRoundIndex;
    showRound_();
    return;
  }
  showComplete_();
}

function showComplete_() {
  elements.resultCard.classList.add("hidden");
  elements.recordButton.closest(".record-card").classList.add("hidden");
  elements.roundBadge.textContent = "三輪完成";
  document.querySelectorAll(".progress-step").forEach((step) => {
    step.classList.add("done");
    step.classList.remove("active");
  });
  const results = state.task.rounds.map((round) => state.results.find((value) => value.round === round.round) || null);
  const completedResults = results.filter(Boolean);
  const gain = biggestGain(completedResults);
  elements.growthHeadline.textContent = gain
    ? `三輪下來，你進步最多的是「${gain.label}」：${formatDelta(gain.delta)}`
    : "你完成了三輪練習。每說一次，都在讓同一段話更順。";
  elements.roundSummary.replaceChildren(summaryTable_(results));
  elements.completeCard.classList.remove("hidden");
}

function showAssessmentNotice_(assessment) {
  const transcriptReliability = assessment?.metrics?.evidenceReliability?.transcript;
  const scoreReliability = assessment?.metrics?.evidenceReliability?.scores;
  const messages = [];
  if (transcriptReliability?.status === "review") {
    messages.push("這次辨識文字的可信度較低，WPM 請只用來觀察趨勢。");
  } else if (assessment?.warnings?.includes("enhanced_transcript_unavailable")) {
    messages.push("增強辨識暫時無法使用，本輪顯示基礎辨識結果。");
  }
  if (scoreReliability?.status === "review") {
    messages.push("本次錄音超過 30 秒，發音、流暢與韻律分數需由老師複核。");
  }
  elements.assessmentNotice.textContent = messages.join(" ");
  elements.assessmentNotice.classList.toggle("hidden", messages.length === 0);
}

function assessmentNeedsReview_(assessment) {
  return assessment?.metrics?.evidenceReliability?.transcript?.status === "review"
    || assessment?.metrics?.evidenceReliability?.scores?.status === "review";
}

function resetRoundWithMessage_(message) {
  clearPendingRecording_();
  elements.recordButton.disabled = false;
  elements.recordButton.classList.remove("recording");
  elements.timer.classList.remove("finish-sentence");
  elements.recordButtonText.textContent = "重新錄音";
  elements.recordMessage.textContent = message;
  elements.timerLabel.textContent = `本輪目標 ${currentRound_().timeLimitSeconds} 秒`;
  elements.timer.textContent = String(currentRound_().timeLimitSeconds);
}

function discardPendingRecording_() {
  if (state.stopping || !state.pendingRecording) return;
  resetRoundWithMessage_("已放棄這次錄音，請重新錄製。");
}

function clearPendingRecording_() {
  state.pendingRecording = null;
  state.pendingAttemptId = null;
  elements.discardRecordingButton.disabled = false;
  elements.discardRecordingButton.classList.add("hidden");
}

async function logout_() {
  cleanupAudio_();
  await safeFetch_(api.logout, { method: "POST" });
  location.reload();
}

function cleanupAudio_() {
  window.clearInterval(state.timerId);
  state.recorder?.cancel();
  clearPendingRecording_();
  for (const url of state.objectUrls) URL.revokeObjectURL(url);
  state.objectUrls = [];
}

function toggleActivation_() {
  state.activationMode = !state.activationMode;
  elements.activationFields.classList.toggle("hidden", !state.activationMode);
  elements.activationToggle.textContent = state.activationMode ? "已有 PIN？回到登入" : "第一次使用？用啟用碼設定 PIN";
  elements.loginButton.textContent = state.activationMode ? "啟用並載入任務" : "登入並載入任務";
}

function setUnitFromUrl_() {
  const unit = normalizeUnit_(new URL(location.href).searchParams.get("unit") || "");
  if (unit) elements.unitId.value = unit;
}

function normalizeUnit_(value) {
  const normalized = String(value || "").trim().toUpperCase();
  return /^[A-Z0-9][A-Z0-9._-]{1,63}$/.test(normalized) ? normalized : "";
}

function currentRound_() { return state.task.rounds[state.roundIndex]; }

function restoredResults_(attempts) {
  if (!Array.isArray(attempts)) return [];
  return attempts.map((attempt) => ({
    round: attempt.round,
    attemptId: attempt.attemptId,
    audioUrl: "",
    timeLimitSeconds: attempt.timeLimitSeconds,
    assessment: attempt.assessment
  }));
}

function metric_(label, value, comparison = null) {
  const item = document.createElement("div");
  item.className = "metric";
  item.append(text_("span", label), text_("strong", value));
  if (comparison?.direction) {
    const tone = comparison.neutral || comparison.direction === "same" ? "neutral" : comparison.direction;
    const delta = text_("em", `${formatDelta(comparison.delta)}`);
    delta.className = `metric-delta ${tone}`;
    delta.title = "和上一輪相比";
    item.append(delta);
  }
  return item;
}

function summaryTable_(results) {
  const table = document.createElement("table");
  table.className = "summary-table";
  const head = document.createElement("tr");
  head.append(text_("th", ""), ...results.map((result, index) => {
    const cell = text_("th", `R${index + 1}`);
    if (result && assessmentNeedsReview_(result.assessment)) cell.textContent += " ⚠️";
    return cell;
  }), text_("th", "變化"));
  const firstResult = results.find(Boolean) || null;
  const lastResult = [...results].reverse().find(Boolean) || null;
  const totals = firstResult && lastResult && firstResult !== lastResult
    ? compareRounds(lastResult, firstResult)
    : [];
  const rows = compareRounds(null, null).map((metric) => {
    const row = document.createElement("tr");
    row.append(text_("th", metric.unit ? `${metric.label} ${metric.unit}` : metric.label));
    for (const result of results) {
      const value = result ? compareRounds(result, null).find((item) => item.key === metric.key).value : null;
      row.append(text_("td", display_(value)));
    }
    const total = totals.find((item) => item.key === metric.key);
    const change = text_("td", total?.direction ? formatDelta(total.delta) : "—");
    change.className = total?.direction && !total.neutral && total.direction !== "same" ? total.direction : "neutral";
    row.append(change);
    return row;
  });
  table.append(head, ...rows);
  return table;
}

function text_(tag, value) {
  const element = document.createElement(tag);
  element.textContent = value;
  return element;
}

function display_(value) {
  if (value === null || value === undefined || value === "") return "—";
  const number = Number(value);
  return Number.isFinite(number) ? String(Math.round(number * 10) / 10) : "—";
}

function formatDuration_(durationMs, targetSeconds) {
  const duration = Number(durationMs);
  const target = Number(targetSeconds);
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(target) || target <= 0) return "—";
  return `${(duration / 1_000).toFixed(1)} / ${target} 秒`;
}

function showLoginError_(message) { elements.loginError.textContent = message; }

function setBusy_(button, busy, label) {
  button.disabled = busy;
  button.textContent = label;
}

async function safeFetch_(url, options = {}) {
  try { return await fetch(url, options); } catch { return null; }
}

async function jsonOrNull_(response) {
  try { return response ? await response.json() : null; } catch { return null; }
}

function uuid_() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
