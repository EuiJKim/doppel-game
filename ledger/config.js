// 동기화 설정. projectId 가 비어 있으면 동기화 메뉴는 '준비 중'으로 보이고 앱은 이 기기에만 저장한다.
// 여기 값은 비밀이 아니다 — 기록은 가족 코드로 암호화해서 올리고, 코드 없이는 읽을 수 없다.
export const SYNC = {
  projectId: 'ledger-3685c',
  apiKey: '',
  endpoint: 'https://firestore.googleapis.com/v1',
};
