const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");

initializeApp();
const db = getFirestore();

// staffId 목록 → 해당 사용자들의 푸시 토큰 목록 조회
async function tokensForStaff(staffIds) {
  const tokens = [];
  for (const sid of staffIds) {
    if (!sid) continue;
    const snap = await db.collection("office_push_tokens").where("staffId", "==", sid).get();
    snap.forEach((doc) => {
      const t = doc.get("token");
      if (t) tokens.push(t);
    });
  }
  return [...new Set(tokens)];
}

// 토큰들에게 푸시 발송 (무효 토큰은 정리)
async function sendToTokens(tokens, title, body, data) {
  if (!tokens.length) return;
  const res = await getMessaging().sendEachForMulticast({
    tokens,
    notification: { title, body },
    data: data || {},
    android: { priority: "high", notification: { channelId: "office_default", sound: "default" } },
  });
  // 실패(등록해제된) 토큰 삭제
  const dead = [];
  res.responses.forEach((r, i) => {
    if (!r.success) {
      const code = r.error && r.error.code;
      if (code === "messaging/registration-token-not-registered" ||
          code === "messaging/invalid-registration-token") {
        dead.push(tokens[i]);
      }
    }
  });
  for (const t of dead) {
    try { await db.collection("office_push_tokens").doc(t).delete(); } catch (e) {}
  }
}

// 새 쪽지 → 받는 사람들에게 푸시
exports.onNewMessage = onDocumentCreated(
  { document: "office_messages/{msgId}", region: "asia-northeast3" },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const m = snap.data() || {};
    if (m.unsent === true) return; // 미발송 표시면 스킵

    const toIds = Array.isArray(m.toIds) ? m.toIds : [];
    const targets = toIds.filter((id) => id && id !== m.fromId); // 보낸 본인 제외
    if (!targets.length) return;

    const tokens = await tokensForStaff(targets);
    if (!tokens.length) return;

    const from = m.fromName || "";
    const text = (m.body || "").toString().slice(0, 60);
    const title = m.isTask ? "새 업무요청" : "새 쪽지";
    const body = (from ? from + ": " : "") + text;

    await sendToTokens(tokens, title, body, { type: "message", msgId: event.params.msgId });
  }
);

// 새 공유일정 → 대상자에게 푸시
exports.onNewSchedule = onDocumentCreated(
  { document: "office_schedules/{schId}", region: "asia-northeast3" },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const s = snap.data() || {};

    // 공유 대상 필드 후보 (구조 확인 후 조정 가능)
    let targets = [];
    if (Array.isArray(s.sharedWith)) targets = s.sharedWith;
    else if (Array.isArray(s.toIds)) targets = s.toIds;
    if (s.source !== "shared" && !targets.length) return; // 공유 아닌 개인일정 스킵

    targets = targets.filter((id) => id && id !== s.ownerId);
    if (!targets.length) return;

    const tokens = await tokensForStaff(targets);
    if (!tokens.length) return;

    const title = "새 공유일정";
    const body = (s.title || s.text || "일정이 공유되었습니다").toString().slice(0, 60);

    await sendToTokens(tokens, title, body, { type: "schedule", schId: event.params.schId });
  }
);
