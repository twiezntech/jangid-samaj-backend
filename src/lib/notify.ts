import type { NotificationType, Prisma } from "@prisma/client";

type Db = Prisma.TransactionClient;

export interface NotificationInput {
  type: NotificationType;
  title: { hi: string; en: string };
  body?: { hi: string; en: string };
  /** Site-relative link, e.g. "/news/slug". */
  link?: string | null;
}

/** Adds one row to a member's in-site inbox. Runs inside the caller's transaction. */
export async function notify(db: Db, userId: string | null | undefined, n: NotificationInput) {
  if (!userId) return;
  await db.notification.create({
    data: { userId, type: n.type, titleHi: n.title.hi, titleEn: n.title.en, bodyHi: n.body?.hi ?? null, bodyEn: n.body?.en ?? null, link: n.link ?? null },
  });
}

/** Hindi noun + its grammatical gender (the verb agrees: "प्रकाशित हो गई / गया"). */
const NOUN: Record<string, { hi: string; en: string; masc?: boolean }> = {
  news: { hi: "आपकी खबर", en: "Your story" },
  directory: { hi: "आपकी डायरेक्टरी प्रविष्टि", en: "Your directory entry" },
  leader: { hi: "नेतृत्व प्रोफाइल", en: "The leader profile" },
  business: { hi: "आपकी व्यापार लिस्टिंग", en: "Your business listing" },
  achievement: { hi: "आपकी भेजी उपलब्धि", en: "The achievement you sent" },
  obituary: { hi: "आपका शोक संदेश", en: "Your demise notice", masc: true },
  job: { hi: "आपकी नौकरी पोस्ट", en: "Your job post" },
  album: { hi: "आपका एल्बम", en: "Your album", masc: true },
  matrimony: { hi: "आपकी रिश्ता प्रोफाइल", en: "Your matrimony profile" },
};

/**
 * Tells the person who submitted something that a moderator approved or returned it.
 * Staff acting on their own records are not notified.
 */
export async function notifyReview(
  db: Db,
  p: { userId: string | null | undefined; actorId: string; kind: keyof typeof NOUN; action: string; reason?: string | null; link?: string | null; editLink?: string | null }
) {
  if (!p.userId || p.userId === p.actorId) return;
  const noun = NOUN[p.kind];
  if (p.action === "publish") {
    await notify(db, p.userId, {
      type: "APPROVED",
      title: { hi: `${noun.hi} प्रकाशित हो ${noun.masc ? "गया" : "गई"} है`, en: `${noun.en} is now live` },
      link: p.link,
    });
  } else if (p.action === "reject") {
    await notify(db, p.userId, {
      type: "REJECTED",
      title: { hi: `${noun.hi} में बदलाव ज़रूरी है`, en: `${noun.en} needs changes` },
      body: p.reason ? { hi: p.reason, en: p.reason } : undefined,
      link: p.editLink ?? "/account",
    });
  }
}
