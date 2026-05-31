const speakers = [
  { id: "s1", name: "Annie", role: "PM", color: "#16a36b" },
  { id: "s2", name: "Ben", role: "工程", color: "#315fcb" },
  { id: "s3", name: "Clara", role: "設計", color: "#e95f4e" },
];

const demoLines = [
  {
    speakerId: "s1",
    text: "今天先確認 Q3 roadmap，我們需要把會議逐字稿 MVP 壓在兩週內可測。",
    type: "decision",
  },
  {
    speakerId: "s2",
    text: "錄音端我建議先做本機儲存，再接 Whisper 或 Parakeet，避免第一版就碰雲端合規。",
    type: "default",
  },
  {
    speakerId: "s3",
    text: "使用者需要很快看懂誰說了什麼，我會把講者標籤、時間戳和搜尋做成主視覺。",
    type: "default",
  },
  {
    speakerId: "s1",
    text: "決定了，第一版先支援桌面錄音、逐字稿、摘要、決策和待辦匯出。",
    type: "decision",
  },
  {
    speakerId: "s2",
    text: "我負責把錄音 pipeline 和逐字稿資料格式定出來，明天下班前給範例 JSON。",
    type: "action",
  },
  {
    speakerId: "s3",
    text: "我負責補齊會議結束後的 review 畫面，包含搜尋、講者篩選和摘要修訂。",
    type: "action",
  },
];

const state = {
  transcript: [],
  recording: false,
  startedAt: null,
  elapsed: 0,
  filter: "all",
  recognition: null,
  mediaStream: null,
  mediaRecorder: null,
  audioChunks: [],
  audioContext: null,
  analyser: null,
  timerId: null,
  demoId: null,
  recordings: [],
};

const STORAGE_KEY = "meetnote-ai-session-v1";
const DB_NAME = "meetnote-ai-db";
const DB_VERSION = 1;
const RECORDING_STORE = "recordings";

const els = {
  statusPill: document.querySelector("#statusPill"),
  timer: document.querySelector("#timer"),
  recordCircle: document.querySelector("#recordCircle"),
  recordButton: document.querySelector("#recordButton"),
  demoButton: document.querySelector("#demoButton"),
  summarizeButton: document.querySelector("#summarizeButton"),
  exportButton: document.querySelector("#exportButton"),
  meetingTitle: document.querySelector("#meetingTitle"),
  workspaceTitle: document.querySelector("#workspaceTitle"),
  languageSelect: document.querySelector("#languageSelect"),
  speakerList: document.querySelector("#speakerList"),
  addSpeakerButton: document.querySelector("#addSpeakerButton"),
  recordingList: document.querySelector("#recordingList"),
  recordingCount: document.querySelector("#recordingCount"),
  speakerSelect: document.querySelector("#speakerSelect"),
  transcriptList: document.querySelector("#transcriptList"),
  composer: document.querySelector("#composer"),
  lineInput: document.querySelector("#lineInput"),
  searchInput: document.querySelector("#searchInput"),
  summaryCopy: document.querySelector("#summaryCopy"),
  summaryState: document.querySelector("#summaryState"),
  decisionList: document.querySelector("#decisionList"),
  todoList: document.querySelector("#todoList"),
  decisionCount: document.querySelector("#decisionCount"),
  todoCount: document.querySelector("#todoCount"),
  actionCount: document.querySelector("#actionCount"),
  talkRatio: document.querySelector("#talkRatio"),
  toast: document.querySelector("#toast"),
  waveform: document.querySelector("#waveform"),
};

const canvasContext = els.waveform.getContext("2d");

function formatTime(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, "0");
  const seconds = Math.floor(totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function getSpeaker(id) {
  return speakers.find((speaker) => speaker.id === id) || speakers[0];
}

function classify(text) {
  const actionWords = ["負責", "待辦", "明天", "下週", "完成", "跟進", "寄給", "整理"];
  const decisionWords = ["決定", "確認", "先支援", "定案", "採用", "不做"];
  if (actionWords.some((word) => text.includes(word))) return "action";
  if (decisionWords.some((word) => text.includes(word))) return "decision";
  return "default";
}

function addTranscriptLine({ speakerId, text, type }) {
  const cleanText = text.trim();
  if (!cleanText) return;
  state.transcript.push({
    id: crypto.randomUUID(),
    speakerId,
    text: cleanText,
    type: type || classify(cleanText),
    time: formatTime(state.elapsed || state.transcript.length * 18 + 3),
  });
  renderTranscript();
  updateInsights(false);
  saveSession();
}

function renderSpeakers() {
  els.speakerList.innerHTML = speakers
    .map(
      (speaker) => `
        <div class="speaker-item">
          <div class="speaker-name">
            <span class="swatch" style="background:${speaker.color}"></span>
            <span>${speaker.name}</span>
          </div>
          <div class="speaker-actions">
            <span class="mini-label">${speaker.role}</span>
            <button class="icon-button" data-edit-speaker="${speaker.id}" title="編輯講者">✎</button>
          </div>
        </div>
      `,
    )
    .join("");

  els.speakerSelect.innerHTML = speakers
    .map((speaker) => `<option value="${speaker.id}">${speaker.name}</option>`)
    .join("");
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(RECORDING_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveRecordingBlob(id, blob) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(RECORDING_STORE, "readwrite");
    tx.objectStore(RECORDING_STORE).put(blob, id);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

async function getRecordingBlob(id) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(RECORDING_STORE, "readonly");
    const request = tx.objectStore(RECORDING_STORE).get(id);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function deleteRecordingBlob(id) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(RECORDING_STORE, "readwrite");
    tx.objectStore(RECORDING_STORE).delete(id);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

async function renderRecordings() {
  els.recordingCount.textContent = state.recordings.length;
  if (!state.recordings.length) {
    els.recordingList.innerHTML = `<div class="recording-item"><span class="recording-meta">停止錄音後會出現在這裡。</span></div>`;
    return;
  }

  els.recordingList.innerHTML = state.recordings
    .map(
      (recording) => `
        <div class="recording-item" data-recording-id="${recording.id}">
          <strong>${recording.title}</strong>
          <span class="recording-meta">${recording.createdAt} · ${recording.duration}</span>
          <div class="recording-actions">
            <audio controls preload="metadata"></audio>
            <a href="#" download="${recording.title}.webm">下載</a>
            <button class="ghost-button small" data-delete-recording="${recording.id}">刪除</button>
          </div>
        </div>
      `,
    )
    .join("");

  await Promise.all(
    state.recordings.map(async (recording) => {
      const item = els.recordingList.querySelector(`[data-recording-id="${recording.id}"]`);
      const audio = item?.querySelector("audio");
      const link = item?.querySelector("a");
      if (!audio || !link) return;
      const blob = await getRecordingBlob(recording.id);
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      audio.src = url;
      link.href = url;
    }),
  );
}

function saveSession() {
  const data = {
    title: els.meetingTitle.value,
    language: els.languageSelect.value,
    speakers,
    transcript: state.transcript,
    summary: els.summaryCopy.textContent,
    summaryState: els.summaryState.textContent,
    elapsed: state.elapsed,
    recordings: state.recordings,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function loadSession() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return;
  try {
    const data = JSON.parse(raw);
    if (data.title) {
      els.meetingTitle.value = data.title;
      els.workspaceTitle.textContent = data.title;
    }
    if (data.language) els.languageSelect.value = data.language;
    if (Array.isArray(data.speakers) && data.speakers.length) {
      speakers.splice(0, speakers.length, ...data.speakers);
    }
    if (Array.isArray(data.transcript)) {
      state.transcript = data.transcript;
    }
    if (data.summary) els.summaryCopy.textContent = data.summary;
    if (data.summaryState) els.summaryState.textContent = data.summaryState;
    if (Number.isFinite(data.elapsed)) {
      state.elapsed = data.elapsed;
      els.timer.textContent = formatTime(state.elapsed);
    }
    if (Array.isArray(data.recordings)) {
      state.recordings = data.recordings;
    }
  } catch (error) {
    localStorage.removeItem(STORAGE_KEY);
  }
}

function renderTranscript() {
  const searchTerm = els.searchInput.value.trim().toLowerCase();
  const filtered = state.transcript.filter((line) => {
    const matchesFilter = state.filter === "all" || line.type === state.filter;
    const speaker = getSpeaker(line.speakerId);
    const matchesSearch =
      !searchTerm ||
      line.text.toLowerCase().includes(searchTerm) ||
      speaker.name.toLowerCase().includes(searchTerm);
    return matchesFilter && matchesSearch;
  });

  if (!filtered.length) {
    els.transcriptList.innerHTML = `
      <div class="empty-state">
        <div>
          <strong>還沒有逐字稿</strong>
          <p>開始錄音、播放範例，或手動加入一句。</p>
        </div>
      </div>
    `;
    return;
  }

  els.transcriptList.innerHTML = filtered
    .map((line) => {
      const speaker = getSpeaker(line.speakerId);
      const tag =
        line.type === "action"
          ? `<span class="tag action">待辦</span>`
          : line.type === "decision"
            ? `<span class="tag decision">決策</span>`
            : "";
      return `
        <article class="transcript-item" data-kind="${line.type}">
          <time class="timestamp">${line.time}</time>
          <div class="transcript-card">
            <div class="transcript-meta">
              <span class="swatch" style="background:${speaker.color}"></span>
              <strong>${speaker.name}</strong>
              <span>${speaker.role}</span>
              ${tag}
            </div>
            <p class="transcript-text">${line.text}</p>
          </div>
        </article>
      `;
    })
    .join("");

  els.transcriptList.scrollTop = els.transcriptList.scrollHeight;
}

function updateInsights(markGenerated) {
  const actions = state.transcript.filter((line) => line.type === "action");
  const decisions = state.transcript.filter((line) => line.type === "decision");
  els.actionCount.textContent = actions.length;
  els.todoCount.textContent = actions.length;
  els.decisionCount.textContent = decisions.length;
  els.talkRatio.textContent = `${Math.min(92, 48 + state.transcript.length * 5)}%`;

  els.decisionList.innerHTML = decisions.length
    ? decisions.map((line) => `<li>${line.text}</li>`).join("")
    : `<li>尚未標記決策。</li>`;

  els.todoList.innerHTML = actions.length
    ? actions.map((line) => `<li>${line.text}</li>`).join("")
    : `<li>尚未標記待辦。</li>`;

  if (markGenerated) {
    const firstDecision = decisions[0]?.text || "目前討論集中在會議錄音、逐字稿與後續整理流程。";
    const owners = actions
      .map((line) => getSpeaker(line.speakerId).name)
      .filter((name, index, list) => list.indexOf(name) === index)
      .join("、");
    els.summaryCopy.textContent = `${firstDecision} 目前共有 ${state.transcript.length} 句逐字稿，整理出 ${decisions.length} 個決策與 ${actions.length} 個待辦${owners ? `，主要負責人是 ${owners}` : ""}。`;
    els.summaryState.textContent = "已更新";
    saveSession();
  }
}

function drawIdleWave() {
  const width = els.waveform.width;
  const height = els.waveform.height;
  canvasContext.clearRect(0, 0, width, height);
  canvasContext.fillStyle = "#edf4f0";
  canvasContext.fillRect(0, 0, width, height);
  canvasContext.strokeStyle = "#16a36b";
  canvasContext.lineWidth = 2;
  canvasContext.beginPath();
  for (let x = 0; x < width; x += 8) {
    const y = height / 2 + Math.sin((x + Date.now() / 28) / 13) * (state.recording ? 18 : 7);
    if (x === 0) canvasContext.moveTo(x, y);
    else canvasContext.lineTo(x, y);
  }
  canvasContext.stroke();
  requestAnimationFrame(drawIdleWave);
}

function setRecordingUi(isRecording) {
  state.recording = isRecording;
  els.recordCircle.classList.toggle("recording", isRecording);
  els.statusPill.classList.toggle("recording", isRecording);
  els.statusPill.textContent = isRecording ? "錄音中" : "待命";
  els.recordButton.innerHTML = isRecording
    ? `<span class="icon">■</span><span>停止錄音</span>`
    : `<span class="icon">●</span><span>開始錄音</span>`;
}

async function startRecording() {
  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      showToast("這個瀏覽器不支援錄音，請用 Safari 或 Chrome 的 HTTPS 網址。");
      return;
    }
    state.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    setRecordingUi(true);
    state.elapsed = 0;
    state.startedAt = Date.now();
    els.timer.textContent = "00:00";
    state.timerId = window.setInterval(() => {
      state.elapsed = Math.floor((Date.now() - state.startedAt) / 1000);
      els.timer.textContent = formatTime(state.elapsed);
    }, 250);

    state.audioChunks = [];
    if (window.MediaRecorder) {
      const recorder = new MediaRecorder(state.mediaStream);
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) state.audioChunks.push(event.data);
      };
      recorder.onstop = saveCurrentRecording;
      recorder.start();
      state.mediaRecorder = recorder;
    } else {
      showToast("這個瀏覽器可以開麥克風，但不支援儲存音檔。");
    }

    state.audioContext = new AudioContext();
    const source = state.audioContext.createMediaStreamSource(state.mediaStream);
    state.analyser = state.audioContext.createAnalyser();
    source.connect(state.analyser);
    startSpeechRecognition();
    showToast("已連接麥克風，會嘗試即時轉錄。");
  } catch (error) {
    setRecordingUi(false);
    showToast("沒有取得麥克風權限，請確認使用 HTTPS 並允許麥克風。");
  }
}

function stopRecording() {
  setRecordingUi(false);
  window.clearInterval(state.timerId);
  state.timerId = null;
  if (state.mediaRecorder?.state === "recording") {
    state.mediaRecorder.stop();
  }
  state.mediaStream?.getTracks().forEach((track) => track.stop());
  state.audioContext?.close();
  state.recognition?.stop();
  showToast("錄音已停止。");
}

async function saveCurrentRecording() {
  if (!state.audioChunks.length) return;
  const mimeType = state.mediaRecorder?.mimeType || "audio/webm";
  const blob = new Blob(state.audioChunks, { type: mimeType });
  const id = crypto.randomUUID();
  const recording = {
    id,
    title: `${els.meetingTitle.value || "未命名會議"} ${new Date().toLocaleTimeString("zh-TW", {
      hour: "2-digit",
      minute: "2-digit",
    })}`,
    createdAt: new Date().toLocaleString("zh-TW", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }),
    duration: formatTime(state.elapsed),
  };
  await saveRecordingBlob(id, blob);
  state.recordings.unshift(recording);
  saveSession();
  renderRecordings();
  showToast("已新增一筆錄音檔。");
}

function startSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) return;

  const recognition = new SpeechRecognition();
  recognition.lang = els.languageSelect.value;
  recognition.continuous = true;
  recognition.interimResults = false;
  recognition.onresult = (event) => {
    const result = event.results[event.results.length - 1];
    const text = result[0]?.transcript || "";
    addTranscriptLine({ speakerId: speakers[0].id, text });
  };
  recognition.onerror = () => showToast("即時語音辨識暫停，可繼續手動補充。");
  recognition.start();
  state.recognition = recognition;
}

function playDemo() {
  window.clearInterval(state.demoId);
  let index = 0;
  showToast("範例逐字稿開始流入。");
  state.demoId = window.setInterval(() => {
    addTranscriptLine(demoLines[index]);
    index += 1;
    if (index >= demoLines.length) {
      window.clearInterval(state.demoId);
      updateInsights(true);
    }
  }, 760);
}

function exportMarkdown() {
  const title = els.meetingTitle.value;
  const decisions = state.transcript.filter((line) => line.type === "decision");
  const actions = state.transcript.filter((line) => line.type === "action");
  const transcript = state.transcript
    .map((line) => {
      const speaker = getSpeaker(line.speakerId);
      return `- ${line.time} ${speaker.name}: ${line.text}`;
    })
    .join("\n");

  const markdown = `# ${title}

## 摘要
${els.summaryCopy.textContent}

## 決策
${decisions.map((line) => `- ${line.text}`).join("\n") || "- 無"}

## 待辦
${actions.map((line) => `- ${line.text}`).join("\n") || "- 無"}

## 逐字稿
${transcript || "- 無"}
`;

  navigator.clipboard?.writeText(markdown);
  showToast("Markdown 已複製到剪貼簿。");
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  window.setTimeout(() => els.toast.classList.remove("show"), 2200);
}

els.recordButton.addEventListener("click", () => {
  if (state.recording) stopRecording();
  else startRecording();
});

els.demoButton.addEventListener("click", playDemo);
els.summarizeButton.addEventListener("click", () => updateInsights(true));
els.exportButton.addEventListener("click", exportMarkdown);
els.searchInput.addEventListener("input", renderTranscript);
els.meetingTitle.addEventListener("input", () => {
  els.workspaceTitle.textContent = els.meetingTitle.value || "未命名會議";
  saveSession();
});
els.languageSelect.addEventListener("change", saveSession);

els.addSpeakerButton.addEventListener("click", () => {
  const next = speakers.length + 1;
  speakers.push({
    id: `s${next}`,
    name: `Speaker ${next}`,
    role: "來賓",
    color: ["#0f766e", "#d9911a", "#7c5cc4", "#b33d2e"][next % 4],
  });
  renderSpeakers();
  saveSession();
});

els.speakerList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-edit-speaker]");
  if (!button) return;
  const speaker = getSpeaker(button.dataset.editSpeaker);
  const name = prompt("講者名稱", speaker.name);
  if (name === null) return;
  const role = prompt("角色/職稱", speaker.role);
  if (role === null) return;
  speaker.name = name.trim() || speaker.name;
  speaker.role = role.trim() || speaker.role;
  renderSpeakers();
  renderTranscript();
  updateInsights(false);
  saveSession();
});

els.recordingList.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-delete-recording]");
  if (!button) return;
  const id = button.dataset.deleteRecording;
  state.recordings = state.recordings.filter((recording) => recording.id !== id);
  await deleteRecordingBlob(id);
  saveSession();
  renderRecordings();
  showToast("錄音檔已刪除。");
});

document.querySelectorAll(".segmented button").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".segmented button").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    state.filter = button.dataset.filter;
    renderTranscript();
  });
});

els.composer.addEventListener("submit", (event) => {
  event.preventDefault();
  addTranscriptLine({
    speakerId: els.speakerSelect.value,
    text: els.lineInput.value,
  });
  els.lineInput.value = "";
});

renderSpeakers();
loadSession();
renderSpeakers();
renderTranscript();
updateInsights(false);
renderRecordings();
drawIdleWave();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}
