const { onDocumentCreated, onDocumentUpdated } = require("firebase-functions/v2/firestore");
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

// 새 공유일정 → 대상자에게 푸시  (2026-07-15 실전 확인 완료)
exports.onNewSchedule = onDocumentCreated(
  { document: "office_schedules/{schId}", region: "asia-northeast3" },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const s = snap.data() || {};

    // [푸시 폭탄 방지] 네이버 일정 가져오기(source:"naver")는 한 번에 수십~수백 건이
    // 일괄 생성되므로 건건이 푸시하면 안 된다. 직접 만든 일정(source:"manual")만 알린다.
    if (s.source === "naver") return;

    // 공유 대상은 sharedWith 필드.
    // App.jsx 의 resolveSharedWith() 가 shared/office(전체)/team 모두 이 배열에 채워 넣고,
    // 개인일정(private)이면 빈 배열이 된다. (toIds 는 옛 데이터 호환용)
    let targets = Array.isArray(s.sharedWith) ? s.sharedWith
      : Array.isArray(s.toIds) ? s.toIds
      : [];
    if (!targets.length) return; // 개인일정 스킵

    targets = targets.filter((id) => id && id !== s.ownerId); // 만든 본인 제외
    if (!targets.length) return;

    const tokens = await tokensForStaff(targets);
    if (!tokens.length) return;

    const title = "새 공유일정";
    const body = (s.title || s.text || "일정이 공유되었습니다").toString().slice(0, 60);

    await sendToTokens(tokens, title, body, { type: "schedule", schId: event.params.schId });
  }
);

// 쪽지 댓글/대댓글 → 쪽지 관련자 전원(보낸이 + 받은이)에게 푸시. 댓글 단 본인은 제외.
// 댓글은 office_messages 문서의 comments 배열에 쌓이므로 '생성'이 아니라 '수정' 이벤트로 잡는다.
exports.onNewComment = onDocumentUpdated(
  { document: "office_messages/{msgId}", region: "asia-northeast3" },
  async (event) => {
    const before = (event.data.before && event.data.before.data()) || {};
    const after = (event.data.after && event.data.after.data()) || {};

    const b = Array.isArray(before.comments) ? before.comments : [];
    const a = Array.isArray(after.comments) ? after.comments : [];
    // 댓글이 늘어난 경우만. (읽음/처리완료/휴지통 같은 다른 수정에는 반응하지 않음)
    if (a.length <= b.length) return;

    const last = a[a.length - 1];
    if (!last || !last.byId) return;

    // 쪽지 관련자 = 보낸이 + 받은이 전원
    const parties = [after.fromId].concat(Array.isArray(after.toIds) ? after.toIds : []);
    const targets = [...new Set(parties)].filter((id) => id && id !== last.byId);
    if (!targets.length) return;

    const tokens = await tokensForStaff(targets);
    if (!tokens.length) return;

    const isReply = !!last.parentId;
    const title = isReply ? "새 답글" : "새 댓글";
    const who = last.byName || "";
    const text = (last.text || "").toString().slice(0, 60);
    const body = (who ? who + ": " : "") + text;

    await sendToTokens(tokens, title, body, {
      type: "comment",
      msgId: event.params.msgId,
      commentId: String(last.id || ""),
    });
  }
);
