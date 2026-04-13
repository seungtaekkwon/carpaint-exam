# 자동차보수도장기능사 웹 시험 페이지 배포 가이드

이 폴더는 GitHub Pages + Firebase Firestore 기준으로 바로 배포할 수 있게 준비된 정적 웹 프로젝트입니다.

## 포함 파일
- `index.html` : 시험 페이지 본문
- `styles.css` : 스타일
- `app.js` : 시험 로직, 타이머, 랭킹, 오답 누적 처리
- `questions.json` : 문제은행 데이터 (엑셀 변환본)
- `firebase-config.js` : Firebase 설정값을 넣는 파일
- `firestore.rules` : Firestore 보안 규칙 예시

## 먼저 해야 할 일

### 1) Firebase Firestore 켜기
- Firebase 콘솔 > 프로젝트 > Build > Firestore Database
- `데이터베이스 만들기`
- `테스트 모드로 시작`
- 위치는 가능하면 `asia-northeast3 (Seoul)` 권장

### 2) Web 앱 설정값 복사
- Firebase 콘솔 > 프로젝트 설정(톱니바퀴) > 내 앱 > Web 앱
- `firebaseConfig` 객체 값 복사

### 3) `firebase-config.js` 수정
아래 부분을 Firebase 콘솔에서 복사한 값으로 바꿉니다.

```js
window.FIREBASE_CONFIG = {
  apiKey: "REPLACE_ME",
  authDomain: "REPLACE_ME",
  projectId: "REPLACE_ME",
  storageBucket: "REPLACE_ME",
  messagingSenderId: "REPLACE_ME",
  appId: "REPLACE_ME"
};
```

### 4) Firestore 보안 규칙 적용
- Firebase 콘솔 > Firestore Database > 규칙
- `firestore.rules` 파일 내용으로 덮어쓰기 후 게시

주의: 지금 규칙은 테스트/개인 프로젝트용으로 매우 느슨합니다. 링크가 널리 퍼지면 악용될 수 있습니다.

### 5) GitHub Pages 배포
1. GitHub에서 새 저장소 생성
2. 이 폴더 안 파일들을 모두 업로드
3. GitHub 저장소 > Settings > Pages
4. Build and deployment:
   - Source: `Deploy from a branch`
   - Branch: `main`
   - Folder: `/ (root)`
5. 저장 후 몇 분 기다리면 공개 링크가 생성됩니다

## 동작 방식
- 접속할 때마다 문제은행에서 랜덤 60문항 출제
- 카테고리 편중을 줄이도록 비율 반영
- 제한시간 60분
- 제출 후 정답/해설 공개
- 시험 시작 전에 닉네임 입력
- 닉네임별 최고 점수/최단 시간으로 랭킹 저장
- 같은 닉네임으로 같은 문제를 3회 이상 틀리면 해당 문제 해설 위에 경고 표시

## 닉네임 규칙
- 2~12자
- 한글 / 영문 / 숫자만 허용
- 같은 닉네임은 같은 사용자로 간주

## 참고
- GitHub Pages는 정적 웹 호스팅만 제공하므로, 랭킹과 오답 누적 저장은 Firestore가 담당합니다.
- Firebase 설정값은 공개되어도 괜찮지만, 보안 규칙은 꼭 확인하세요.
