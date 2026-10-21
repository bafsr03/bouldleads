import { describe, expect, it } from "vitest";
import { allowedToday } from "@/lib/outreach/inboxes";
import { inSendWindow } from "@/lib/outreach/scheduler";
import { classify } from "@/lib/outreach/imap-sync";
import { DEFAULT_SETTINGS } from "@/lib/settings";
import { ruleFor } from "@/lib/compliance/rules";

const DAY = 86_400_000;

describe("warm-up", () => {
  const inbox = { daily_cap: 40, warmup_enabled: 1, warmup_start: 0 };
  it("ramps from the start value by the increment per day, capped", () => {
    expect(allowedToday(inbox, 10, 5, 0)).toBe(10);
    expect(allowedToday(inbox, 10, 5, 1 * DAY)).toBe(15);
    expect(allowedToday(inbox, 10, 5, 4 * DAY)).toBe(30);
    expect(allowedToday(inbox, 10, 5, 30 * DAY)).toBe(40);
  });
  it("uses the cap directly when warm-up is off", () => {
    expect(allowedToday({ ...inbox, warmup_enabled: 0 }, 10, 5, 0)).toBe(40);
  });
});

describe("send window", () => {
  it("only sends on configured days and hours, in the configured time zone", () => {
    const lima = { ...DEFAULT_SETTINGS, timezone: "America/Lima" }; // UTC-5, no DST
    const mondayTen = new Date("2026-10-12T15:00:00Z"); // Mon 10:00 in Lima
    const mondayEight = new Date("2026-10-12T13:59:00Z"); // 08:59
    const saturday = new Date("2026-10-17T16:00:00Z");
    expect(inSendWindow(lima, mondayTen)).toBe(true);
    expect(inSendWindow(lima, mondayEight)).toBe(false);
    expect(inSendWindow(lima, saturday)).toBe(false);
    // The same instant is Monday 15:00 in UTC: still inside 9-17, while Tokyo is already Tuesday 00:00.
    expect(inSendWindow({ ...lima, timezone: "Asia/Tokyo" }, mondayTen)).toBe(false);
  });
});

describe("reply classification", () => {
  const mail = (from: string, subject: string, text: string, headers: Record<string, string> = {}) =>
    ({
      from: { value: [{ address: from, name: "" }], html: "", text: from },
      subject,
      text,
      headers: new Map(Object.entries(headers)),
    }) as unknown as Parameters<typeof classify>[0];

  it("detects bounces, auto-replies, opt-outs and real replies", () => {
    expect(classify(mail("MAILER-DAEMON@mx.google.com", "Delivery Status Notification", "failed"))).toBe("bounce");
    expect(classify(mail("bob@acme.com", "Automatic reply: Hello", "I'm away"))).toBe("auto");
    expect(classify(mail("bob@acme.com", "Re: Hi", "hi", { "auto-submitted": "auto-replied" }))).toBe("auto");
    expect(classify(mail("bob@acme.com", "Re: Hi", "Please remove me from your list.\n\nOn Mon, X wrote:\n> hi"))).toBe("unsubscribe");
    expect(classify(mail("bob@acme.com", "Re: Hi", "Sounds good, call me tomorrow.\n\nOn Mon, X wrote:\n> reply remove to stop"))).toBe("reply");
  });
});

describe("compliance rules", () => {
  it("flags consent-required countries", () => {
    expect(ruleFor("DE").level).toBe("consent");
    expect(ruleFor("us").level).toBe("ok");
    expect(ruleFor("CA").law).toBe("CASL");
  });
});
