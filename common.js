// common.js — 공유 Firebase 초기화 및 공통 UI 함수
// 모든 게임 페이지에서 import하여 사용
// 각 페이지의 <script type="module"> 상단에 다음을 추가:
//   import { auth, db, onAuthStateChanged, doc, getDoc, setDoc, updateDoc,
//            collection, getDocs, addDoc, query, orderBy, serverTimestamp }
//     from './common.js';

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
         signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, updateDoc, collection, getDocs,
         addDoc, query, orderBy, serverTimestamp }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ── Firebase 초기화 ────────────────────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyDJv5VYIt2xFrQmignCwSzuThAkULz1NW8",
  authDomain: "kings-44a9b.firebaseapp.com",
  projectId: "kings-44a9b",
  storageBucket: "kings-44a9b.firebasestorage.app",
  messagingSenderId: "715133382138",
  appId: "1:715133382138:web:62cf478cc321fa418c0843"
};

const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);

export { app, auth, db, onAuthStateChanged,
         doc, getDoc, setDoc, updateDoc, collection, getDocs, addDoc,
         query, orderBy, serverTimestamp,
         signOut, createUserWithEmailAndPassword, signInWithEmailAndPassword };

// ── 인증 오류 메시지 ───────────────────────────────────────────
export function parseAuthError(code) {
  const m = {
    'auth/invalid-credential':   '아이디 또는 비밀번호가 틀렸습니다.',
    'auth/user-not-found':       '존재하지 않는 아이디입니다.',
    'auth/wrong-password':       '비밀번호가 틀렸습니다.',
    'auth/email-already-in-use': '이미 사용 중인 아이디입니다.',
    'auth/weak-password':        '비밀번호는 6자 이상이어야 합니다.',
    'auth/too-many-requests':    '잠시 후 다시 시도해주세요.',
  };
  return m[code] ?? `오류: ${code}`;
}

// 이메일 변환 (내부용)
function toEmail(u) { return u.toLowerCase() + '@kings.com'; }

// ── 로그인 UI ─────────────────────────────────────────────────
window.formatPhone = function(el) {
  let v = el.value.replace(/\D/g,'');
  if (v.length <= 3) el.value = v;
  else if (v.length <= 7) el.value = v.slice(0,3)+'-'+v.slice(3);
  else el.value = v.slice(0,3)+'-'+v.slice(3,7)+'-'+v.slice(7,11);
};

window.switchTab = function(tab) {
  const isReg = tab === 'register';
  document.getElementById('tabLogin').classList.toggle('active', !isReg);
  document.getElementById('tabRegister').classList.toggle('active', isReg);
  document.getElementById('registerFields').style.display = isReg ? 'block' : 'none';
  document.getElementById('submitBtn').textContent = isReg ? '회원가입' : '로그인';
  document.getElementById('authError').textContent = '';
};

window.handleEnter = function(e) { if (e.key === 'Enter') window.handleSubmit(); };

window.handleSubmit = async function() {
  const isReg    = document.getElementById('tabRegister').classList.contains('active');
  const username = document.getElementById('usernameInput').value.trim();
  const password = document.getElementById('passwordInput').value;
  const btn      = document.getElementById('submitBtn');
  const errEl    = document.getElementById('authError');
  errEl.textContent = '';
  if (!username || !password) { errEl.textContent = '아이디와 비밀번호를 입력해주세요.'; return; }
  btn.disabled = true; btn.textContent = '처리 중...';
  try {
    if (isReg) {
      const confirm  = document.getElementById('passwordConfirmInput').value;
      const nickname = document.getElementById('nicknameInput').value.trim();
      const phone    = document.getElementById('phoneInput').value.trim();
      const referral = document.getElementById('referralInput').value.trim();
      if (password !== confirm)  { errEl.textContent = '비밀번호가 일치하지 않습니다.'; return; }
      if (!nickname)             { errEl.textContent = '닉네임을 입력해주세요.'; return; }
      if (!/^010-\d{4}-\d{4}$/.test(phone)) { errEl.textContent = '올바른 휴대폰 번호를 입력해주세요.'; return; }
      if (!referral)             { errEl.textContent = '추천인 코드를 입력해주세요.'; return; }
      const codeSnap = await getDoc(doc(db, 'referralCodes', referral.toUpperCase()));
      if (!codeSnap.exists()) { errEl.textContent = '유효하지 않은 추천인 코드입니다.'; return; }
      const cred = await createUserWithEmailAndPassword(auth, toEmail(username), password);
      await setDoc(doc(db, 'users', cred.user.uid),
        { username, nickname, phone, referral, points: 10000, createdAt: new Date() });
      await signOut(auth);
      errEl.style.color = '#4ade80';
      errEl.textContent = '회원가입이 완료됐습니다! 로그인해주세요.';
      window.switchTab('login');
      document.getElementById('usernameInput').value = username;
      btn.disabled = false; btn.textContent = '회원가입';
      return;
    } else {
      await signInWithEmailAndPassword(auth, toEmail(username), password);
    }
  } catch(e) { errEl.textContent = parseAuthError(e.code); }
  finally    { btn.disabled = false; btn.textContent = isReg ? '회원가입' : '로그인'; }
};

// ── 네비게이션 UI ─────────────────────────────────────────────
window.toggleMobileMenu = function() {
  document.getElementById('mobileMenuOverlay')?.classList.toggle('open');
};
window.closeMobileMenu = function() {
  document.getElementById('mobileMenuOverlay')?.classList.remove('open');
};
window.toggleSubnav = function(cat) {
  const idMap = { game:'catGame', casino:'catCasino', menu:'catMenu' };
  Object.keys(idMap).forEach(c => {
    const el = document.getElementById(idMap[c]);
    if (el) { c === cat ? el.classList.toggle('open') : el.classList.remove('open'); }
  });
};
document.addEventListener('click', function(e) {
  if (!e.target.closest('.subnav-category')) {
    document.querySelectorAll('.subnav-category').forEach(el => el.classList.remove('open'));
  }
});
