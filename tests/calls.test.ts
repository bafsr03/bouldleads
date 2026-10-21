import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

// Own throwaway database so it can't collide with other DB tests running in parallel.
const dir = path.join(process.env.BOULDLEADS_DATA_DIR!, "calls");
process.env.BOULDLEADS_DATA_DIR = dir;

let db: typeof import("@/lib/db").db;
let calls: typeof import("@/lib/calls");
let leads: typeof import("@/lib/leads");
let isSuppressed: typeof import("@/lib/outreach/suppression").isSuppressed;
let insertBusinesses: typeof import("@/lib/discovery/run-search").insertBusinesses;

async function lead(id: number, email: string | null, status = "verified") {
  await db.run(
    `INSERT INTO businesses (id, search_id, source, source_id, name, email, phone, status, lat, lng, created_at)
     VALUES (?, 1, 'google', ?, ?, ?, '555-0100', ?, -12.1, -77.0, 0)`,
    id,
    `place${id}`,
    `Shop ${id}`,
    email,
    status,
  );
}

const stage = async (id: number) => (await db.get<{ s: string }>(`SELECT ${calls.STAGE_SQL} AS s FROM businesses WHERE id = ?`, id))!.s;
const fu = (id: number) =>
  db.get<{ state: string; step: number; next_send_at: number }>(
    "SELECT cl.state, cl.step, cl.next_send_at FROM campaign_leads cl JOIN campaigns c ON c.id = cl.campaign_id WHERE c.kind = 'followup' AND cl.business_id = ?",
    id,
  );

beforeAll(async () => {
  fs.rmSync(dir, { recursive: true, force: true });
  db = (await import("@/lib/db")).db;
  calls = await import("@/lib/calls");
  leads = await import("@/lib/leads");
  ({ isSuppressed } = await import("@/lib/outreach/suppression"));
  ({ insertBusinesses } = await import("@/lib/discovery/run-search"));
  await db.run("INSERT INTO searches (id, label, place, area, categories, created_at) VALUES (1, 't', 'Lima, Peru', '{}', '[]', 0)");
  await db.run("INSERT INTO settings (key, value) VALUES ('emailOutreach', 'true')");
  for (let i = 1; i <= 8; i++) await lead(i, i === 3 ? null : `owner${i}@shop${i}.pe`);
});

describe("call dispositions", () => {
  it("starts with every lead in 'To call'", async () => {
    expect(await stage(1)).toBe("new");
  });

  it("No answer starts the email follow-up (day 1, 3, 5, 12) and counts the attempt", async () => {
    const r = await calls.logCall(1, "no_answer", { user: "Jake" });
    expect(r.followup).toBe("started");
    const f = await fu(1);
    expect(f).toMatchObject({ state: "queued", step: 0 });
    expect(f!.next_send_at).toBeLessThanOrEqual(Date.now());
    expect(await stage(1)).toBe("followup");
    const b = await db.get<{ call_attempts: number; call_outcome: string }>("SELECT call_attempts, call_outcome FROM businesses WHERE id = 1");
    expect(b).toEqual({ call_attempts: 1, call_outcome: "no_answer" });
    expect(await db.get("SELECT outcome, user FROM calls WHERE business_id = 1")).toEqual({ outcome: "no_answer", user: "Jake" });
    const c = await calls.followupCampaign();
    expect((JSON.parse(c.steps) as { delayDays: number }[]).map((s) => s.delayDays)).toEqual([0, 2, 2, 7]);
  });

  it("a second No answer doesn't enroll twice", async () => {
    await calls.logCall(1, "no_answer");
    expect(await db.count("SELECT COUNT(*) FROM campaign_leads WHERE business_id = 1")).toBe(1);
    expect((await db.get<{ n: number }>("SELECT call_attempts AS n FROM businesses WHERE id = 1"))!.n).toBe(2);
  });

  it("leads without an email are still called but skip the emails", async () => {
    const r = await calls.logCall(3, "voicemail");
    expect(r).toEqual({ followup: "skipped", followupError: "No email address found for this business." });
    expect(await stage(3)).toBe("recall");
  });

  it("Call back stops the emails and sets a callback; a missed callback stays warm (no cold emails)", async () => {
    await calls.logCall(2, "no_answer");
    const at = Date.now() + 3600_000;
    await calls.logCall(2, "call_back", { callbackAt: at });
    expect((await fu(2))!.state).toBe("stopped");
    expect(await stage(2)).toBe("callback");
    expect((await db.get<{ callback_at: number }>("SELECT callback_at FROM businesses WHERE id = 2"))!.callback_at).toBe(at);
    await calls.logCall(2, "no_answer");
    expect((await fu(2))!.state).toBe("stopped");
    expect(await stage(2)).toBe("callback");
    const r = (await db.get<{ callback_at: number; warm_tries: number }>("SELECT callback_at, warm_tries FROM businesses WHERE id = 2"))!;
    expect(r.warm_tries).toBe(1);
    expect(r.callback_at).toBeGreaterThanOrEqual(at + 86_400_000); // same time, next business day
  });

  it("Booked moves the lead to Booked and stops emails", async () => {
    await calls.logCall(4, "no_answer");
    await calls.logCall(4, "audit_booked");
    expect((await fu(4))!.state).toBe("stopped");
    expect(await stage(4)).toBe("booked");
  });

  it("Do not call closes the lead and suppresses its email", async () => {
    await calls.logCall(5, "no_answer");
    await calls.logCall(5, "do_not_call");
    expect((await fu(5))!.state).toBe("stopped");
    expect(await stage(5)).toBe("closed");
    expect(await isSuppressed("owner5@shop5.pe")).toBe(true);
    expect(await calls.startFollowup(5)).toBe("Marked do not contact.");
  });

  it("a reply to the follow-up moves the lead to Replied", async () => {
    await calls.logCall(6, "no_answer");
    await db.run("UPDATE campaign_leads SET state = 'replied' WHERE business_id = 6");
    expect(await stage(6)).toBe("replied");
  });

  it("Wrong number marks the phone bad and drops it from the phone list", async () => {
    await calls.logCall(7, "wrong_number");
    const { where, params } = leads.leadListWhere({ phone: "1" });
    const ids = (await db.all<{ id: number }>(`SELECT id FROM businesses ${where}`, ...params)).map((r) => r.id);
    expect(ids).not.toContain(7);
    expect(await stage(7)).toBe("closed");
  });

  it("Number disconnected drops the lead from calls but not emails, and Clear status undoes it", async () => {
    await lead(130, "owner130@shop130.pe");
    await calls.startFollowup(130);
    await calls.logCall(130, "disconnected");
    const phoneList = async () => {
      const { where, params } = leads.leadListWhere({ phone: "1" });
      return (await db.all<{ id: number }>(`SELECT id FROM businesses ${where}`, ...params)).map((r) => r.id);
    };
    expect(await db.get("SELECT phone_bad FROM businesses WHERE id = 130")).toMatchObject({ phone_bad: 1 });
    expect(await stage(130)).toBe("closed");
    expect(await phoneList()).not.toContain(130);
    expect((await fu(130))?.state).toBe("queued");
    await calls.logCall(130, null);
    expect(await db.get("SELECT phone_bad, call_outcome FROM businesses WHERE id = 130")).toMatchObject({ phone_bad: 0, call_outcome: null });
    expect(await phoneList()).toContain(130);
    await calls.stopEmails(130); // keep it out of the stage-filter test below
  });

  it("filters leads by place and stage", async () => {
    const { where, params } = leads.leadListWhere({ place: "Lima, Peru", stage: "followup,callback" });
    const ids = (await db.all<{ id: number }>(`SELECT id FROM businesses ${where} ORDER BY id`, ...params)).map((r) => r.id);
    expect(ids).toEqual([1, 2]);
  });
});

describe("with email outreach off", () => {
  it("logs the call but never queues an email", async () => {
    await db.run("UPDATE settings SET value = 'false' WHERE key = 'emailOutreach'");
    try {
      await lead(20, "owner20@shop20.pe");
      expect(await calls.logCall(20, "no_answer")).toEqual({ followup: null, followupError: null });
      expect(await fu(20)).toBeUndefined();
      expect(await stage(20)).toBe("recall");
      expect(await calls.startFollowup(20)).toMatch(/turned off/);
    } finally {
      await db.run("UPDATE settings SET value = 'true' WHERE key = 'emailOutreach'");
    }
  });
});

describe("deleting leads", () => {
  it("removes the lead with its calls and outreach, and keeps it from coming back", async () => {
    expect(await leads.deleteLeads([1])).toBe(1);
    expect(await db.count("SELECT COUNT(*) FROM calls WHERE business_id = 1")).toBe(0);
    expect(await db.count("SELECT COUNT(*) FROM campaign_leads WHERE business_id = 1")).toBe(0);
    const again = await insertBusinesses(
      1,
      [{ sourceId: "place1", name: "Shop 1", category: null, address: null, city: "Lima", countryCode: "PE", lat: -12.1, lng: -77.0, phone: null, website: null, email: null,
         google: { placeId: "place1", mapsUrl: null, type: null, rating: null, reviewCount: null, status: null } }],
      "google",
      "PE",
    );
    expect(again).toBe(0);
  });

  it("can forget instead, so the next search finds it again", async () => {
    await leads.deleteLeads([8], false);
    const again = await insertBusinesses(
      1,
      [{ sourceId: "place8", name: "Shop 8", category: null, address: null, city: "Lima", countryCode: "PE", lat: -12.1, lng: -77.0, phone: null, website: null, email: null }],
      "google",
      "PE",
    );
    expect(again).toBe(1);
  });
});

describe("background tick", () => {
  it("only one tick runs at a time", async () => {
    const { runTick } = await import("@/lib/tasks/tick");
    await db.run("INSERT INTO settings (key, value) VALUES ('sys:tickLock', ?)", `${Date.now() + 60_000}:someone-else`);
    expect((await runTick(1000)).ran).toBe(false);
    await db.run("UPDATE settings SET value = ? WHERE key = 'sys:tickLock'", `${Date.now() - 1}:someone-else`);
    const r = await runTick(1000);
    expect(r.ran).toBe(true);
    expect(await db.get("SELECT 1 FROM settings WHERE key = 'sys:tickLock'")).toBeUndefined();
  });
});

describe("hang-ups, daily counter and today's to-do", () => {
  it("'Hung up' sends the lead to Call again without emails", async () => {
    await lead(120, "owner120@shop120.pe");
    await calls.logCall(120, "hung_up");
    expect(await stage(120)).toBe("recall");
    expect(await fu(120)).toBeUndefined();
  });

  it("'Bad timing' counts as answered and keeps the lead warm in Callbacks, without emails", async () => {
    await lead(141, "owner141@shop141.pe");
    const t = Date.now();
    await calls.logCall(141, "bad_timing", { note: "Owner with a crying customer" });
    expect(await stage(141)).toBe("callback");
    // No time picked: tomorrow, same time (skipping Sunday).
    const r = (await db.get<{ callback_at: number }>("SELECT callback_at FROM businesses WHERE id = 141"))!;
    expect(r.callback_at).toBeGreaterThanOrEqual(t + 86_400_000);
    expect(r.callback_at).toBeLessThanOrEqual(t + 2 * 86_400_000 + 5000);
    expect(await fu(141)).toBeUndefined();
    const { NOT_REACHED } = await import("@/lib/call-outcomes");
    expect(NOT_REACHED).not.toContain("bad_timing");
  });

  it("counts calls per day in the caller's time zone", async () => {
    await lead(121, null);
    // 2026-03-05 05:00 UTC is still Mar 4 in Denver (UTC-7).
    const t = Date.UTC(2026, 2, 5, 18, 0);
    const rows: [string, number, string][] = [
      ["no_answer", Date.UTC(2026, 2, 5, 17, 0), "Jake"],
      ["call_back", Date.UTC(2026, 2, 5, 16, 0), "Jake"],
      ["hung_up", Date.UTC(2026, 2, 5, 15, 0), "Ana"],
      ["voicemail", Date.UTC(2026, 2, 5, 5, 0), "Jake"],
      ["disconnected", Date.UTC(2026, 2, 5, 16, 30), "Ana"],
    ];
    for (const [o, at, user] of rows) await db.run("INSERT INTO calls (business_id, outcome, user, created_at) VALUES (121, ?, ?, ?)", o, user, at);
    const all = await calls.dailyCallLog({ tz: "America/Denver", now: t });
    expect(all.today).toMatchObject({ date: "2026-03-05", dials: 4, answered: 2, outcomes: { no_answer: 1, call_back: 1, hung_up: 1, disconnected: 1 } });
    expect(all.days.find((d) => d.date === "2026-03-04")).toMatchObject({ dials: 1, outcomes: { voicemail: 1 } });
    const jake = await calls.dailyCallLog({ tz: "America/Denver", now: t, user: "Jake" });
    expect(jake.today.dials).toBe(2);
  });

  it("lists overdue and today's callbacks, earliest first", async () => {
    const t = Date.UTC(2026, 9, 16, 18, 0); // noon in Denver
    for (const [id, at] of [
      [122, t + 3 * 3600_000], // 3 pm today
      [123, t - 3600_000], // 11 am, overdue
      [124, t + 24 * 3600_000], // tomorrow
    ]) {
      await lead(id, null);
      await calls.logCall(id, "call_back", { callbackAt: at, note: id === 122 ? "Ask for Mike" : null });
    }
    const a = await calls.callbackAgenda("America/Denver", t);
    const mine = a.items.filter((i) => [122, 123, 124].includes(i.id));
    expect(mine.map((i) => [i.id, i.overdue])).toEqual([
      [123, true],
      [122, false],
    ]);
    expect(mine[1].note).toBe("Ask for Mike");
    expect(a.tomorrow).toBeGreaterThanOrEqual(1);
  });

  it("lists every scheduled callback by day, with when and who marked it", async () => {
    await lead(125, null);
    const monday = Date.UTC(2099, 0, 5, 17, 0); // far ahead: after every other callback in this file
    await calls.logCall(125, "call_back", { callbackAt: monday, user: "Jake", note: "Owner back Monday" });
    const all = await calls.callbackSchedule("America/Denver");
    const last = all[all.length - 1];
    expect(last).toMatchObject({ id: 125, day: "2099-01-05", marked_by: "Jake", note: "Owner back Monday", overdue: false });
    expect(last.marked_at).toBeGreaterThan(0);
    expect(all.map((r) => r.callback_at)).toEqual([...all.map((r) => r.callback_at)].sort((a, b) => a - b));
  });
});

describe("warm leads", () => {
  it("go back to Call again after 6 missed tries", async () => {
    await lead(150, null);
    await calls.logCall(150, "call_back", { callbackAt: Date.now() + 3600_000 });
    for (let i = 1; i < 6; i++) {
      await calls.logCall(150, i % 2 ? "no_answer" : "voicemail");
      expect(await stage(150)).toBe("callback");
    }
    expect((await db.get<{ warm_tries: number }>("SELECT warm_tries FROM businesses WHERE id = 150"))!.warm_tries).toBe(5);
    await calls.logCall(150, "no_answer");
    expect(await stage(150)).toBe("recall");
    expect((await db.get<{ callback_at: number | null; warm_tries: number }>("SELECT callback_at, warm_tries FROM businesses WHERE id = 150"))).toEqual({ callback_at: null, warm_tries: 0 });
  });

  it("skip Sunday when moving a missed callback", () => {
    // Saturday 2026-10-17 10:00 in Denver → Monday 2026-10-19 10:00.
    const sat = Date.UTC(2026, 9, 17, 16, 0);
    expect(calls.nextTry(sat, sat, "America/Denver")).toBe(Date.UTC(2026, 9, 19, 16, 0));
  });

  it("show the same counts everywhere, with notes, tries and ask-for", async () => {
    await lead(151, null);
    await lead(152, null);
    await lead(153, null);
    await db.run("UPDATE businesses SET ask_for = 'Kenny' WHERE id = 151");
    const t = Date.UTC(2026, 9, 19, 18, 0); // Mon noon in Denver
    await calls.logCall(151, "call_back", { callbackAt: t - 3600_000, note: "Jamie answers, ask for Kenny", now: t - 86_400_000 });
    await calls.logCall(152, "call_back", { callbackAt: t + 3 * 3600_000, now: t - 86_400_000 });
    await calls.logCall(153, "bad_timing", { callbackAt: t + 5 * 86_400_000, now: t - 86_400_000 });
    const { items, counts } = await calls.callbackAgenda("America/Denver", t);
    const mine = items.filter((i) => [151, 152, 153].includes(i.id));
    expect(mine.map((i) => i.id)).toEqual([151, 152]);
    expect(mine[0]).toMatchObject({ overdue: true, ask_for: "Kenny", note: "Jamie answers, ask for Kenny", call_outcome: "call_back", call_attempts: 1 });
    expect(counts.overdue).toBeGreaterThanOrEqual(1);
    expect(counts.scheduled).toBeGreaterThanOrEqual(3);
    const sched = await calls.callbackSchedule("America/Denver", t);
    expect(sched.find((r) => r.id === 153)).toMatchObject({ call_outcome: "bad_timing", marked_at: t - 86_400_000 });
  });
});
