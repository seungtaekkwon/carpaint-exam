import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  collection,
  getDocs,
  deleteDoc
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

const toast = document.getElementById("toast");
const loginCard = document.getElementById("loginCard");
const blockedCard = document.getElementById("blockedCard");
const adminPanel = document.getElementById("adminPanel");
const googleLoginBtn = document.getElementById("googleLoginBtn");
const logoutBtn = document.getElementById("logoutBtn");
const loginInfo = document.getElementById("loginInfo");
const adminEmailText = document.getElementById("adminEmailText");
const newAdminEmail = document.getElementById("newAdminEmail");
const addAdminBtn = document.getElementById("addAdminBtn");
const adminList = document.getElementById("adminList");
const resetNickname = document.getElementById("resetNickname");
const resetNicknameBtn = document.getElementById("resetNicknameBtn");
const wrongResetNickname = document.getElementById("wrongResetNickname");
const resetWrongBtn = document.getElementById("resetWrongBtn");

function showToast(msg, duration = 2600) {
  toast.textContent = msg;
  toast.classList.remove("hidden");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.add("hidden"), duration);
}

function validEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}

const config = window.FIREBASE_CONFIG;
const app = initializeApp(config);
const db = getFirestore(app);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();

async function getAllowedAdmins() {
  const ref = doc(db, "adminConfig", "allowedAdmins");
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    const initial = config.adminEmails && Array.isArray(config.adminEmails) ? config.adminEmails : [];
    await setDoc(ref, { emails: initial });
    return initial;
  }
  return snap.data().emails || [];
}

async function saveAllowedAdmins(emails) {
  const ref = doc(db, "adminConfig", "allowedAdmins");
  await setDoc(ref, { emails: [...new Set(emails.map(v => v.trim().toLowerCase()))] });
}

async function renderAdminList() {
  const emails = await getAllowedAdmins();
  if (!emails.length) {
    adminList.innerHTML = '<p class="help">등록된 관리자 이메일이 없습니다.</p>';
    return;
  }
  adminList.innerHTML = emails.map(v => `<span class="admin-chip">${v}</span>`).join(" ");
}

async function deleteWrongQuestionsForNickname(nickname) {
  const wrongCol = collection(db, "users", nickname, "wrongQuestions");
  const snap = await getDocs(wrongCol);
  for (const d of snap.docs) {
    await deleteDoc(d.ref);
  }
}

async function deleteNicknameAll(nickname) {
  await deleteWrongQuestionsForNickname(nickname);
  const userRef = doc(db, "users", nickname);
  const snap = await getDoc(userRef);
  if (snap.exists()) await deleteDoc(userRef);
}

async function applyAdminView(user) {
  if (!user?.email) {
    loginCard.classList.remove("hidden");
    blockedCard.classList.add("hidden");
    adminPanel.classList.add("hidden");
    logoutBtn.classList.add("hidden");
    loginInfo.textContent = "";
    return;
  }

  const allowed = await getAllowedAdmins();
  const email = user.email.toLowerCase();
  if (!allowed.includes(email)) {
    loginCard.classList.add("hidden");
    blockedCard.classList.remove("hidden");
    adminPanel.classList.add("hidden");
    logoutBtn.classList.remove("hidden");
    loginInfo.textContent = "";
    return;
  }

  loginCard.classList.add("hidden");
  blockedCard.classList.add("hidden");
  adminPanel.classList.remove("hidden");
  logoutBtn.classList.remove("hidden");
  adminEmailText.textContent = email;
  await renderAdminList();
}

googleLoginBtn.addEventListener("click", async () => {
  try {
    await signInWithPopup(auth, provider);
  } catch (e) {
    console.error("Google login error:", e);
    showToast(`${e.code || "unknown"}: ${e.message || "로그인 실패"}`, 5000);
  }
});

logoutBtn.addEventListener("click", async () => {
  await signOut(auth);
});

addAdminBtn.addEventListener("click", async () => {
  const email = newAdminEmail.value.trim().toLowerCase();
  if (!validEmail(email)) {
    showToast("올바른 이메일 형식이 아닙니다");
    return;
  }
  const allowed = await getAllowedAdmins();
  if (allowed.includes(email)) {
    showToast("이미 등록된 관리자 이메일입니다");
    return;
  }
  allowed.push(email);
  await saveAllowedAdmins(allowed);
  newAdminEmail.value = "";
  await renderAdminList();
  showToast("관리자 이메일을 추가했습니다");
});

resetNicknameBtn.addEventListener("click", async () => {
  const nickname = resetNickname.value.trim();
  if (!nickname) {
    showToast("닉네임을 입력해주세요");
    return;
  }
  try {
    await deleteNicknameAll(nickname);
    resetNickname.value = "";
    showToast("닉네임 전체 기록을 초기화했습니다");
  } catch (e) {
    showToast("초기화 중 오류가 발생했습니다");
  }
});

resetWrongBtn.addEventListener("click", async () => {
  const nickname = wrongResetNickname.value.trim();
  if (!nickname) {
    showToast("닉네임을 입력해주세요");
    return;
  }
  try {
    await deleteWrongQuestionsForNickname(nickname);
    wrongResetNickname.value = "";
    showToast("오답 기록만 초기화했습니다");
  } catch (e) {
    showToast("초기화 중 오류가 발생했습니다");
  }
});

onAuthStateChanged(auth, async (user) => {
  await applyAdminView(user);
});
