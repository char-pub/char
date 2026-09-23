import { describe, expect, it } from "vitest";
import { guestVerificationEmail, SmtpEmailSender } from "./email.js";
import {
  GUEST_TOKEN_RE,
  GuestHasher,
  hashGuestToken,
  newGuestId,
  normalizeEmail,
  randomGuestToken,
} from "./guest.js";

const key = new Uint8Array(32).fill(7);

describe("guest identity helpers", () => {
  it("hashes the normalized email, so case and whitespace do not create a second guest", () => {
    const h = new GuestHasher(key);
    expect(h.email(" Alice@Example.COM ")).toBe(h.email("alice@example.com"));
    expect(h.email("alice@example.com")).not.toBe(h.email("bob@example.com"));
    expect(h.email("alice@example.com")).toMatch(/^[0-9a-f]{64}$/);
    expect(normalizeEmail("  A@B.C ")).toBe("a@b.c");
  });

  it("separates purposes and depends on the key", () => {
    const h = new GuestHasher(key);
    expect(h.ip("203.0.113.7")).not.toBe(h.email("203.0.113.7"));
    expect(new GuestHasher(new Uint8Array(32).fill(8)).email("a@b.c")).not.toBe(h.email("a@b.c"));
    expect(() => new GuestHasher(new Uint8Array(16))).toThrow();
  });

  it("generates 256-bit url-safe tokens and stores only their hash", () => {
    const a = randomGuestToken();
    const b = randomGuestToken();
    expect(a).toMatch(GUEST_TOKEN_RE);
    expect(a).not.toBe(b);
    expect(hashGuestToken(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashGuestToken(a)).not.toContain(a);
  });

  it("encodes guest ids with a gst_ prefix", () => {
    expect(newGuestId("0192d4b4-5f5e-7c3a-9b1e-3f4a5b6c7d8e")).toMatch(/^gst_[0-9a-z]{26}$/);
  });
});

describe("email", () => {
  it("builds a plain-text verification email that does not echo user input", () => {
    const m = guestVerificationEmail(
      "alice@example.com",
      "https://www.char.pub/guest/verify#token=abc",
      30,
    );
    expect(m.to).toBe("alice@example.com");
    expect(m.text).toContain("https://www.char.pub/guest/verify#token=abc");
    expect(m.text).toContain("30 minutes");
  });

  it("sends through the configured transport with the configured sender", async () => {
    const captured: { from?: unknown; to?: unknown; subject?: unknown; text?: unknown }[] = [];
    const sender = new SmtpEmailSender(
      {
        name: "capture",
        version: "1",
        send(mail, callback) {
          captured.push(mail.data);
          callback(null, { messageId: "test" });
        },
      },
      "char.pub <no-reply@char.test>",
    );
    await sender.send({ to: "alice@example.com", subject: "Hi", text: "Body" });
    expect(captured).toEqual([
      expect.objectContaining({
        from: "char.pub <no-reply@char.test>",
        to: "alice@example.com",
        subject: "Hi",
        text: "Body",
      }),
    ]);
  });
});
