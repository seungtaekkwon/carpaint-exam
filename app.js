import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  increment,
  collection,
  query,
  orderBy,
  limit,
  getDocs,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const EXAM_COUNT = 60;
const EXAM_MINUTES = 60;
const WRONG_THRESHOLD = 3;
const WARNING_TEXT = "⚠️ 이 문제는 3회 이상 틀린 문제입니다. 해설을 꼭 다시 확인해 주세요.";

const nicknameInput = document.getElementById("nickname");
const startBtn = document.getElementById("startBtn");
const submitBtn = document.getElementById("submitBtn");
const retryBtn = document.getElementById("retryBtn");
const introCard = document.getElementById("introCard");
const statusCard = document.getElementById("statusCard");
const examContainer = document.getElementById("examContainer");
const resultCard = document.getElementById("resultCard");
const timerEl = document.getElementById("timer");
const answeredCountEl = document.getElementById("answeredCount");
const progressBar = document.querySelector("#progressBar span");
const nicknameDisplay = document.getElementById("nicknameDisplay");
const scoreText = document.getElementById("scoreText");
const correctText = document.getElementById("correctText");
const elapsedText = document.getElementById("elapsedText");
const rankingStatus = document.getElementById("rankingStatus");
const rankingList = document.getElementById("rankingList");
const toast = document.getElementById("toast");

let db = null;
let nickname = "";
let questions = [];
let selectedQuestions = [];
let answers = {};
let timer = null;
let remainingSeconds = EXAM_MINUTES * 60;
let submitted = false;

function showToast(msg, duration = 2600) {
  toast.textContent = msg;
  toast.classList.remove("hidden");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.add("hidden"), duration);
}

function normalizeNickname(value) {
  return value.trim();
}

function validNickname(value) {
  return /^[가-힣A-Za-z0-9]{2,12}$/.test(value);
}

function shuffle(arr) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function formatTime(sec) {
  const m = String(Math.floor(sec / 60)).padStart(2, "0");
  const s = String(sec % 60).padStart(2, "0");
  return `${m}:${s}`;
}

function escapeHtml(str = "") {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function chooseBalancedQuestions(allQuestions, count) {
  const byCat = new Map();
  for (const q of allQuestions) {
    if (!byCat.has(q.category)) byCat.set(q.category, []);
    byCat.get(q.category).push(q);
  }
  for (const list of byCat.values()) {
    list.sort(() => Math.random() - 0.5);
  }

  const cats = [...byCat.keys()];
  const total = allQuestions.length;
  const selected = [];
  const used = new Set();

  const targetByCat = cats.map(cat => {
    const ratio = byCat.get(cat).length / total;
    return { cat, target: Math.max(1, Math.round(ratio * count)) };
  });

  let assigned = targetByCat.reduce((sum, x) => sum + x.target, 0);
  while (assigned > count) {
    const item = targetByCat.sort((a, b) => b.target - a.target).find(x => x.target > 1);
    if (!item) break;
    item.target -= 1;
    assigned -= 1;
  }
  while (assigned < count) {
    const item = targetByCat.sort((a, b) => byCat.get(b.cat).length - byCat.get(a.cat).length)[0];
    item.target += 1;
    assigned += 1;
  }

  for (const { cat, target } of targetByCat) {
    const pool = byCat.get(cat);
    for (let i = 0; i < Math.min(target, pool.length); i++) {
      if (!used.has(pool[i].id)) {
        selected.push(pool[i]);
        used.add(pool[i].id);
      }
    }
  }

  if (selected.length < count) {
    const leftovers = shuffle(allQuestions.filter(q => !used.has(q.id)));
    selected.push(...leftovers.slice(0, count - selected.length));
  } else if (selected.length > count) {
    selected.splice(count);
  }

  return shuffle(selected);
}

function updateSubmitState() {
  const answered = Object.keys(answers).length;
  const allAnswered = answered === EXAM_COUNT;
  submitBtn.classList.toggle("soft-disabled", !allAnswered);
  submitBtn.setAttribute("aria-disabled", String(!allAnswered));
  submitBtn.title = allAnswered ? "제출하기" : "모든 문항에 답변을 체크해주세요";
}

function getFirstUnanswered() {
  for (let i = 0; i < selectedQuestions.length; i++) {
    const q = selectedQuestions[i];
    if (!(q.id in answers)) return q;
  }
  return null;
}

function renderQuestions() {
  examContainer.innerHTML = selectedQuestions.map((q, idx) => {
    const choicesHtml = q.choices.map((choice, cidx) => `
      <label class="choice" id="q-${q.id}-choice-${cidx + 1}">
        <input type="radio" name="q-${q.id}" value="${cidx + 1}" ${submitted ? "disabled" : ""} />
        <span><strong>${cidx + 1}.</strong> ${escapeHtml(choice)}</span>
      </label>
    `).join("");

    return `
      <section class="question-card" id="question-${q.id}" data-question-id="${q.id}">
        <div class="q-meta">
          <span class="badge">${idx + 1}번</span>
          <span class="badge cat">${escapeHtml(q.category)}</span>
        </div>
        <div class="question-text">${escapeHtml(q.question)}</div>
        <div class="choice-list">${choicesHtml}</div>
        <div class="after-submit"></div>
      </section>
    `;
  }).join("");

  for (const q of selectedQuestions) {
    const radios = document.querySelectorAll(`input[name="q-${q.id}"]`);
    radios.forEach(radio => {
      radio.addEventListener("change", (e) => {
        answers[q.id] = Number(e.target.value);
        updateProgress();
        updateSubmitState();
      });
    });
  }
}

function updateProgress() {
  const answered = Object.keys(answers).length;
  answeredCountEl.textContent = answered;
  progressBar.style.width = `${(answered / EXAM_COUNT) * 100}%`;
}

function lockAllChoices() {
  document.querySelectorAll('input[type="radio"]').forEach(el => el.disabled = true);
}

function revealResults(extraWarnings = {}) {
  let correct = 0;
  selectedQuestions.forEach((q, idx) => {
    const selected = answers[q.id];
    if (selected === q.answer) correct += 1;

    q.choices.forEach((_, cidx) => {
      const label = document.getElementById(`q-${q.id}-choice-${cidx + 1}`);
      if (!label) return;
      if (cidx + 1 === q.answer) label.classList.add("correct");
      if (selected === cidx + 1 && selected !== q.answer) label.classList.add("incorrect");
    });

    const after = document.querySelector(`#question-${q.id} .after-submit`);
    const warning = extraWarnings[q.id] ? `<div class="warning-note">${WARNING_TEXT}</div>` : "";
    after.innerHTML = `
      ${warning}
      <div class="explanation">
정답: ${q.answer}번
내 답: ${selected ? `${selected}번` : "미응답"}

해설:
${escapeHtml(q.explanation || "해설이 없습니다.")}
      </div>
    `;
  });
  return correct;
}

function startTimer() {
  timerEl.textContent = formatTime(remainingSeconds);
  clearInterval(timer);
  timer = setInterval(() => {
    remainingSeconds -= 1;
    timerEl.textContent = formatTime(remainingSeconds);
    if (remainingSeconds <= 0) {
      clearInterval(timer);
      handleSubmit(true);
    }
  }, 1000);
}

function loadFirebase() {
  try {
    const config = window.FIREBASE_CONFIG;
    if (!config || !config.apiKey || config.apiKey === "REPLACE_ME") {
      throw new Error("config missing");
    }
    const app = initializeApp(config);
    db = getFirestore(app);
  } catch (e) {
    db = null;
  }
}

async function fetchQuestions() {
  const res = await fetch("./questions.json");
  if (!res.ok) throw new Error("questions.json 로드 실패");
  questions = await res.json();
}

async function recordAttempt(score, elapsedSeconds, warningsMap) {
  if (!db) {
    rankingStatus.textContent = "Firebase 미연결";
    return;
  }

  try {
    const userRef = doc(db, "users", nickname);
    const userSnap = await getDoc(userRef);

    if (!userSnap.exists()) {
      await setDoc(userRef, {
        nickname,
        bestScore: score,
        bestElapsed: elapsedSeconds,
        updatedAt: serverTimestamp()
      });
    } else {
      const old = userSnap.data();
      const shouldUpdate = score > (old.bestScore ?? -1) || (score === (old.bestScore ?? -1) && elapsedSeconds < (old.bestElapsed ?? 999999));
      if (shouldUpdate) {
        await updateDoc(userRef, {
          bestScore: score,
          bestElapsed: elapsedSeconds,
          updatedAt: serverTimestamp()
        });
      }
    }

    for (const q of selectedQuestions) {
      const selected = answers[q.id];
      if (selected !== q.answer) {
        const wrongRef = doc(db, "users", nickname, "wrongQuestions", String(q.id));
        const wrongSnap = await getDoc(wrongRef);
        if (!wrongSnap.exists()) {
          await setDoc(wrongRef, { count: 1, questionId: q.id, updatedAt: serverTimestamp() });
          warningsMap[q.id] = false;
        } else {
          await updateDoc(wrongRef, { count: increment(1), updatedAt: serverTimestamp() });
          const nextCount = (wrongSnap.data().count || 0) + 1;
          warningsMap[q.id] = nextCount >= WRONG_THRESHOLD;
        }
      }
    }

    rankingStatus.textContent = "저장 완료";
  } catch (e) {
    rankingStatus.textContent = "저장 실패";
  }
}

async function loadRanking() {
  if (!db) {
    rankingList.innerHTML = '<div class="help">Firebase 미연결 상태입니다.</div>';
    return;
  }
  try {
    const qy = query(collection(db, "users"), orderBy("bestScore", "desc"), orderBy("bestElapsed", "asc"), limit(20));
    const snap = await getDocs(qy);
    const docs = snap.docs.map(d => d.data());
    if (!docs.length) {
      rankingList.innerHTML = '<div class="help">아직 랭킹 데이터가 없습니다.</div>';
      return;
    }
    rankingList.innerHTML = docs.map((item, i) => `
      <div class="rank-item">
        <div class="rank-pos">${i + 1}위</div>
        <div class="rank-name">${escapeHtml(item.nickname || "-")}</div>
        <div class="rank-score">${item.bestScore ?? 0}점</div>
        <div class="rank-time">${formatTime(item.bestElapsed ?? 0)}</div>
      </div>
    `).join("");
  } catch (e) {
    rankingList.innerHTML = '<div class="help">랭킹을 불러오지 못했습니다.</div>';
  }
}

async function handleSubmit(auto = false) {
  if (submitted) return;

  const firstUnanswered = getFirstUnanswered();
  if (!auto && firstUnanswered) {
    showToast("모든 문항에 답변을 체크해주세요");
    document.getElementById(`question-${firstUnanswered.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }

  submitted = true;
  clearInterval(timer);
  lockAllChoices();
  submitBtn.classList.add("soft-disabled");
  submitBtn.setAttribute("aria-disabled", "true");

  const warningsMap = {};
  let correct = revealResults(warningsMap);
  const score = Math.round((correct / EXAM_COUNT) * 100);
  const elapsed = EXAM_MINUTES * 60 - Math.max(remainingSeconds, 0);

  nicknameDisplay.textContent = nickname;
  scoreText.textContent = `${score}점`;
  correctText.textContent = `${correct} / ${EXAM_COUNT}`;
  elapsedText.textContent = formatTime(elapsed);
  resultCard.classList.remove("hidden");

  await recordAttempt(score, elapsed, warningsMap);

  // Re-render with warnings after DB save
  correct = revealResults(warningsMap);
  await loadRanking();
  resultCard.scrollIntoView({ behavior: "smooth", block: "start" });
}

function resetExam() {
  answers = {};
  selectedQuestions = chooseBalancedQuestions(questions, EXAM_COUNT);
  remainingSeconds = EXAM_MINUTES * 60;
  submitted = false;
  introCard.classList.add("hidden");
  statusCard.classList.remove("hidden");
  examContainer.classList.remove("hidden");
  resultCard.classList.add("hidden");
  rankingStatus.textContent = "대기";
  nicknameDisplay.textContent = nickname;
  renderQuestions();
  updateProgress();
  updateSubmitState();
  startTimer();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

startBtn.addEventListener("click", async () => {
  const value = normalizeNickname(nicknameInput.value);
  if (!validNickname(value)) {
    showToast("닉네임은 2~12자의 한글/영문/숫자만 가능합니다");
    nicknameInput.focus();
    return;
  }
  nickname = value;
  resetExam();
});

submitBtn.addEventListener("click", () => handleSubmit(false));
retryBtn.addEventListener("click", () => resetExam());

async function init() {
  loadFirebase();
  await fetchQuestions();
  submitBtn.classList.add("soft-disabled");
  submitBtn.setAttribute("aria-disabled", "true");
  await loadRanking();
}

init().catch(() => {
  showToast("초기화 중 오류가 발생했습니다");
});
