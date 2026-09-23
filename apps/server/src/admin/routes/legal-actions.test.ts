import { describe, expect, it } from "vitest";
import {
  addWeekdays,
  RESTORE_DEADLINE_WEEKDAYS,
  RESTORE_NOT_BEFORE_WEEKDAYS,
} from "./legal-actions.js";

describe("addWeekdays", () => {
  it("skips Saturdays and Sundays and keeps the time of day", () => {
    // 2026-09-25 是星期五。
    expect(addWeekdays(new Date("2026-09-25T09:30:00Z"), 1).toISOString()).toBe(
      "2026-09-28T09:30:00.000Z",
    );
    expect(addWeekdays(new Date("2026-09-26T09:30:00Z"), 1).toISOString()).toBe(
      "2026-09-28T09:30:00.000Z",
    );
    expect(addWeekdays(new Date("2026-09-22T12:00:00Z"), 5).toISOString()).toBe(
      "2026-09-29T12:00:00.000Z",
    );
    expect(addWeekdays(new Date("2026-09-22T12:00:00Z"), 0).toISOString()).toBe(
      "2026-09-22T12:00:00.000Z",
    );
  });

  it("the restore window stays within 10 to 14 business days even with two holidays", () => {
    expect(RESTORE_NOT_BEFORE_WEEKDAYS - 2).toBeGreaterThanOrEqual(10);
    expect(RESTORE_DEADLINE_WEEKDAYS).toBeLessThanOrEqual(14);
    // 圣诞节与元旦之间：2026-12-21（星期一）收到反通知。
    const from = new Date("2026-12-21T00:00:00Z");
    expect(addWeekdays(from, RESTORE_NOT_BEFORE_WEEKDAYS).toISOString()).toBe(
      "2027-01-06T00:00:00.000Z",
    );
    expect(addWeekdays(from, RESTORE_DEADLINE_WEEKDAYS).toISOString()).toBe(
      "2027-01-08T00:00:00.000Z",
    );
  });
});
