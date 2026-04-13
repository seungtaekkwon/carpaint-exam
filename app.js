
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
let startedAt = null;
let submitted = false;

function showToast(msg) {
  toast.textContent = msg;
  toast.classList.remove("hidden");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.add("hidden"), 2600);
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
  return str
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

function renderExam() {
  examContainer.innerHTML = "";
  selectedQuestions.forEach((q, idx) => {
    const card = document.createElement("section");
    card.className = "question-card";
    card.id = `q-${q.id}`;
    card.innerHTML = `
      <div class="q-meta">
        <span class="badge">문항 ${idx + 1}</span>
        <span class="badge cat">${escapeHtml(q.category)}</span>
        <span class="badge">문제은행 #${q.id}</span>
      </div>
      <div class="question-text">${escapeHtml(q.question)}</div>
      <div class="choice-list">
        ${q.choices.map((choice, i) => `
          <label class="choice" data-choice="${i + 1}">
            <input type="radio" name="answer-${q.id}" value="${i + 1}" ${submitted ? "disabled" : ""} />
            <div><strong>${i + 1}.</strong> ${escapeHtml(choice)}</div>
          </label>
        `).join("")}
      </div>
    `;
    examContainer.appendChild(card);
  });

  examContainer.querySelectorAll('input[type="radio"]').forEach(input => {
    input.addEventListener("change", (e) => {
      const qid = Number(e.target.name.replace("answer-", ""));
      answers[qid] = Number(e.target.value);
      updateProgress();
    });
  });
}

function updateProgress() {
  const count = Object.keys(answers).length;
  answeredCountEl.textContent = count;
  progressBar.style.width = `${(count / EXAM_COUNT) * 100}%`;
}

function startTimer() {
  timerEl.textContent = formatTime(remainingSeconds);
  timer = setInterval(() => {
    remainingSeconds -= 1;
    timerEl.textContent = formatTime(Math.max(remainingSeconds, 0));
    if (remainingSeconds <= 0) {
      clearInterval(timer);
      submitExam(true);
    }
  }, 1000);
}

async function loadRanking() {
  if (!db) return;
  const q = query(collection(db, "rankings"), orderBy("bestScore", "desc"), orderBy("bestElapsedSec", "asc"), limit(10));
  const snap = await getDocs(q);
  rankingList.innerHTML = "";
  if (snap.empty) {
    rankingList.innerHTML = '<div class="help">아직 랭킹이 없습니다.</div>';
    return;
  }
  let pos = 1;
  snap.forEach(docSnap => {
    const item = docSnap.data();
    const el = document.createElement("div");
    el.className = "rank-item";
    el.innerHTML = `
      <div class="rank-pos">${pos}</div>
      <div class="rank-name">${escapeHtml(item.nickname || docSnap.id)}</div>
      <div class="rank-score">${item.bestScore ?? 0}점</div>
      <div class="rank-time">${formatTime(item.bestElapsedSec ?? 0)}</div>
    `;
    rankingList.appendChild(el);
    pos += 1;
  });
}

async function initFirebase() {
  const cfg = window.FIREBASE_CONFIG;
  if (!cfg || cfg.apiKey === "REPLACE_ME") {
    showToast("firebase-config.js에 Firebase 설정값을 먼저 넣어주세요.");
    return null;
  }
  const app = initializeApp(cfg);
  db = getFirestore(app);
  return db;
}

async function applyRanking(score, elapsedSec) {
  if (!db) return "Firebase 미연결";
  const ref = doc(db, "rankings", nickname);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      nickname,
      bestScore: score,
      bestElapsedSec: elapsedSec,
      updatedAt: serverTimestamp()
    });
    return "신규 등록";
  }
  const data = snap.data();
  const better = score > (data.bestScore ?? -1) ||
    (score === (data.bestScore ?? -1) && elapsedSec < (data.bestElapsedSec ?? Infinity));
  if (better) {
    await updateDoc(ref, {
      nickname,
      bestScore: score,
      bestElapsedSec: elapsedSec,
      updatedAt: serverTimestamp()
    });
    return "기록 갱신";
  }
  return "기존 기록 유지";
}

async function incrementWrongCount(questionId) {
  if (!db) return 0;
  const ref = doc(db, "userStats", nickname, "questions", String(questionId));
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      questionId,
      wrongCount: 1,
      updatedAt: serverTimestamp()
    });
    return 1;
  }
  const current = snap.data().wrongCount ?? 0;
  await updateDoc(ref, {
    wrongCount: increment(1),
    updatedAt: serverTimestamp()
  });
  return current + 1;
}

function decorateChoices(card, selected, correct) {
  card.querySelectorAll(".choice").forEach((label, idx) => {
    const choiceNo = idx + 1;
    if (choiceNo === correct) label.classList.add("correct");
    if (selected === choiceNo && selected !== correct) label.classList.add("incorrect");
    const radio = label.querySelector("input");
    radio.disabled = true;
    if (selected === choiceNo) radio.checked = true;
  });
}

async function submitExam(auto = false) {
  if (submitted) return;
  submitted = true;
  clearInterval(timer);

  const elapsedSec = EXAM_MINUTES * 60 - Math.max(remainingSeconds, 0);
  let correct = 0;

  for (const q of selectedQuestions) {
    const userAnswer = answers[q.id] || null;
    if (userAnswer === q.answer) correct += 1;
  }
  const score = Math.round((correct / EXAM_COUNT) * 100);

  for (const q of selectedQuestions) {
    const card = document.getElementById(`q-${q.id}`);
    const userAnswer = answers[q.id] || null;
    decorateChoices(card, userAnswer, q.answer);

    let warningHtml = "";
    if (userAnswer !== q.answer) {
      const wrongCount = await incrementWrongCount(q.id);
      if (wrongCount >= WRONG_THRESHOLD) {
        warningHtml = `<div class="warning-note">${WARNING_TEXT}</div>`;
      }
    }

    const exp = document.createElement("div");
    exp.className = "explanation";
    exp.innerHTML = `
      <div><strong>정답:</strong> ${q.answer}번</div>
      ${warningHtml}
      <div style="margin-top:10px;"><strong>해설</strong></div>
      <div style="margin-top:6px;">${escapeHtml(q.explanation).replaceAll("\n", "<br>")}</div>
    `;
    card.appendChild(exp);
  }

  scoreText.textContent = `${score}점`;
  correctText.textContent = `${correct} / ${EXAM_COUNT}`;
  elapsedText.textContent = formatTime(elapsedSec);
  rankingStatus.textContent = db ? "반영 중..." : "Firebase 미연결";

  if (db) {
    try {
      rankingStatus.textContent = await applyRanking(score, elapsedSec);
      await loadRanking();
    } catch (err) {
      console.error(err);
      rankingStatus.textContent = "반영 실패";
      showToast("Firebase 저장 중 오류가 발생했습니다.");
    }
  } else {
    await loadRanking().catch(() => {});
  }

  resultCard.classList.remove("hidden");
  submitBtn.disabled = true;
  if (auto) {
    showToast("시간이 종료되어 자동 제출되었습니다.");
  } else {
    showToast("제출이 완료되었습니다.");
  }

  resultCard.scrollIntoView({ behavior: "smooth" });
}

async function startExam() {
  nickname = normalizeNickname(nicknameInput.value);
  if (!validNickname(nickname)) {
    showToast("닉네임은 2~12자의 한글/영문/숫자만 사용할 수 있습니다.");
    nicknameInput.focus();
    return;
  }

  if (!questions.length) {
    const res = await fetch("./questions.json");
    questions = await res.json();
  }
  selectedQuestions = chooseBalancedQuestions(questions, EXAM_COUNT);
  answers = {};
  remainingSeconds = EXAM_MINUTES * 60;
  startedAt = Date.now();
  submitted = false;

  nicknameDisplay.textContent = `응시자: ${nickname}`;
  introCard.classList.add("hidden");
  statusCard.classList.remove("hidden");
  examContainer.classList.remove("hidden");
  resultCard.classList.add("hidden");
  submitBtn.disabled = false;
  renderExam();
  updateProgress();
  startTimer();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

startBtn.addEventListener("click", startExam);
submitBtn.addEventListener("click", () => submitExam(false));
retryBtn.addEventListener("click", () => window.location.reload());

await initFirebase();
await loadRanking().catch(() => {});
