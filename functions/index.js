const { onDocumentCreated, onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
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

/* ============================================================
 * 구글드라이브 사건 폴더 자동생성
 *
 * 새 사건(office_cases)이 만들어지면 구글드라이브에 폴더를 만들고
 * 사건 문서에 driveFolderId / driveFolderUrl 을 저장한다.
 *
 * 폴더 위치는 office_config/main 의 driveFolders 설정을 따른다.
 *   { rootName: "법무사업무공유폴더",
 *     fallback: "8. 기타업무",
 *     map: { "부동산등기": { folder: "1. 부동산등기업무" },      // 기준 폴더 바로 아래
 *            "부동산등기::매매": { folder: "매매" }, ... } }        // 대분류 폴더 안
 *   최종 경로 = 기준 / 대분류폴더 / 소분류폴더 / 사건폴더
 *
 * 인증은 OAuth 위임(한용구 계정). 개인 지메일 드라이브는 서비스계정으로
 * 폴더를 만들 수 없기 때문(저장공간 미지급).
 * ============================================================ */

const { defineSecret } = require("firebase-functions/params");
const GDRIVE_CLIENT_ID = defineSecret("GDRIVE_CLIENT_ID");
const GDRIVE_CLIENT_SECRET = defineSecret("GDRIVE_CLIENT_SECRET");
const GDRIVE_REFRESH_TOKEN = defineSecret("GDRIVE_REFRESH_TOKEN");

const FOLDER_MIME = "application/vnd.google-apps.folder";

// refresh token 으로 access token 발급 (1시간짜리, 매 호출마다 새로 받음)
async function getAccessToken() {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: GDRIVE_CLIENT_ID.value(),
      client_secret: GDRIVE_CLIENT_SECRET.value(),
      refresh_token: GDRIVE_REFRESH_TOKEN.value(),
      grant_type: "refresh_token",
    }).toString(),
  });
  const j = await res.json();
  if (!j.access_token) throw new Error("access token 발급 실패: " + JSON.stringify(j));
  return j.access_token;
}

// Drive 검색어 안의 작은따옴표 이스케이프 (폴더 이름에 ' 가 있어도 깨지지 않게)
const esc = (s) => String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'");

// 부모 폴더 안에서 이름이 일치하는 하위 폴더 찾기. 없으면 null
async function findFolder(token, name, parentId) {
  const q = [
    `name = '${esc(name)}'`,
    `mimeType = '${FOLDER_MIME}'`,
    `'${esc(parentId)}' in parents`,
    "trashed = false",
  ].join(" and ");
  const url =
    "https://www.googleapis.com/drive/v3/files?" +
    new URLSearchParams({ q, fields: "files(id,name)", pageSize: "10" }).toString();
  const res = await fetch(url, { headers: { Authorization: "Bearer " + token } });
  const j = await res.json();
  if (j.error) throw new Error("검색 실패: " + JSON.stringify(j.error));
  return (j.files && j.files[0]) ? j.files[0].id : null;
}

async function createFolder(token, name, parentId) {
  const res = await fetch("https://www.googleapis.com/drive/v3/files?fields=id", {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }),
  });
  const j = await res.json();
  if (!j.id) throw new Error("폴더 생성 실패: " + JSON.stringify(j));
  return j.id;
}

// 'A/B/C' 경로를 따라 내려간다. 도중에 없으면 null (조용히 새로 만들지 않음 —
// 오타 하나로 엉뚱한 폴더가 생기면 나중에 찾기가 더 어려워지기 때문)
async function walkPath(token, path, rootId) {
  let cur = rootId;
  for (const seg of String(path).split("/").map((x) => x.trim()).filter(Boolean)) {
    const next = await findFolder(token, seg, cur);
    if (!next) return null;
    cur = next;
  }
  return cur;
}

// 경로를 따라 내려가되, 없는 폴더는 만든다 (소분류 폴더용)
async function walkOrCreate(token, path, rootId) {
  let cur = rootId;
  for (const seg of String(path).split("/").map((x) => x.trim()).filter(Boolean)) {
    const found = await findFolder(token, seg, cur);
    cur = found || (await createFolder(token, seg, cur));
  }
  return cur;
}

// 폴더 이름에 쓸 수 없는 문자 정리
const clean = (s) =>
  String(s || "").replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim();

// 2026-03-21 -> 2026.03.21 (기존 폴더 표기와 동일)
const dotDate = (s) => {
  const m = String(s || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}.${m[2]}.${m[3]}` : String(s || "").slice(0, 10);
};

// 폴더 이름: 수임일_담당자_사건명_위임인
function buildFolderName(c, staffName) {
  const parts = [
    dotDate(c.acceptDate),
    clean(staffName),
    clean(c.caseName),
    clean(c.clientName),
  ].filter(Boolean);
  return parts.join("_").slice(0, 180); // 드라이브 이름 길이 여유 있게 제한
}

exports.onCaseCreated = onDocumentCreated(
  {
    document: "office_cases/{caseId}",
    region: "asia-northeast3",
    secrets: [GDRIVE_CLIENT_ID, GDRIVE_CLIENT_SECRET, GDRIVE_REFRESH_TOKEN],
  },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const c = snap.data() || {};
    if (c.driveFolderId) return; // 이미 있음

    const caseId = event.params.caseId;
    const fail = async (reason) => {
      console.error("[drive] " + caseId + " " + reason);
      try { await snap.ref.update({ driveFolderError: reason }); } catch (e) {}
    };

    try {
      const cfgSnap = await db.collection("office_config").doc("main").get();
      const cfg = (cfgSnap.exists && cfgSnap.get("driveFolders")) || {};
      const rootName = (cfg.rootName || "법무사업무공유폴더").trim();
      const fallback = (cfg.fallback || "").trim();
      // 설정은 단계별로 저장된다: 대분류 칸 = 기준 폴더 바로 아래, 소분류 칸 = 그 대분류 폴더 안
      const cmap = cfg.map || {};
      const minorKey = c.minorCategory ? `${c.majorCategory}::${c.minorCategory}` : null;
      const majorFolder = ((cmap[c.majorCategory] || {}).folder || "").trim();
      const minorFolder = ((minorKey && (cmap[minorKey] || {}).folder) || "").trim();

      const token = await getAccessToken();

      const rootId = await findFolder(token, rootName, "root");
      if (!rootId) return fail(`기준 폴더 '${rootName}' 를 내 드라이브에서 찾지 못했습니다.`);

      // 대분류 폴더는 드라이브에 미리 있어야 한다 (오타로 엉뚱한 폴더가 생기는 것 방지)
      let baseId = null;
      if (majorFolder) baseId = await walkPath(token, majorFolder, rootId);
      if (!baseId && fallback) baseId = await walkPath(token, fallback, rootId);
      if (!baseId) return fail(`대분류 폴더를 찾지 못했습니다: ${majorFolder || "(미지정)"} / 대체: ${fallback || "(없음)"}`);

      // 소분류 폴더는 없으면 만든다
      if (minorFolder) baseId = await walkOrCreate(token, minorFolder, baseId);

      // 담당자 이름
      let staffName = "";
      if (c.staffId) {
        try {
          const st = await db.collection("office_staff").doc(c.staffId).get();
          if (st.exists) staffName = st.get("name") || "";
        } catch (e) {}
      }

      const name = buildFolderName(c, staffName);
      if (!name) return fail("폴더 이름을 만들 수 없습니다 (사건 정보 부족).");

      // 같은 이름이 이미 있으면 그걸 쓴다 (중복 생성 방지)
      const folderId = (await findFolder(token, name, baseId)) || (await createFolder(token, name, baseId));

      await snap.ref.update({
        driveFolderId: folderId,
        driveFolderUrl: "https://drive.google.com/drive/folders/" + folderId,
        driveFolderName: name,
        driveFolderError: FieldValue.delete(),
      });
      console.log("[drive] 폴더 생성 완료:", name);
    } catch (e) {
      await fail(String((e && e.message) || e).slice(0, 300));
    }
  }
);
