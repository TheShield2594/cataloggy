import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  SECRET_CONTEXT,
  decryptSecret,
  encryptIfPlaintext,
  encryptSecret,
  isEncryptedSecret,
  isSecretEncryptionAvailable,
  kvSecretContext,
} from "./secret-box.js";
import { present } from "./test-fixtures/present.js";

const originalToken = process.env.API_TOKEN;

beforeEach(() => {
  process.env.API_TOKEN = "test-api-token";
});

afterEach(() => {
  if (originalToken === undefined) delete process.env.API_TOKEN;
  else process.env.API_TOKEN = originalToken;
});

describe("encryptSecret", () => {
  it("produces something the plaintext cannot be read out of", () => {
    const stored = encryptSecret(SECRET_CONTEXT.traktAccessToken, "trakt-access-token");

    expect(stored).not.toContain("trakt-access-token");
    expect(isEncryptedSecret(stored)).toBe(true);
  });

  it("uses a fresh IV each time, so the same secret twice gives two ciphertexts", () => {
    const a = encryptSecret(SECRET_CONTEXT.stremioAuthKey, "same-key");
    const b = encryptSecret(SECRET_CONTEXT.stremioAuthKey, "same-key");

    expect(a).not.toBe(b);
    expect(decryptSecret(SECRET_CONTEXT.stremioAuthKey, a)).toBe("same-key");
    expect(decryptSecret(SECRET_CONTEXT.stremioAuthKey, b)).toBe("same-key");
  });

  it("round-trips the values actually stored — JSON blobs, unicode, empty strings", () => {
    const context = kvSecretContext("ai:config");
    for (const value of ['{"headers":{"Authorization":"Bearer sk-abc"}}', "clé-à-clef 🎬", ""]) {
      expect(decryptSecret(context, encryptSecret(context, value))).toBe(value);
    }
  });

  it("returns the plaintext unchanged with no API_TOKEN to derive from", () => {
    delete process.env.API_TOKEN;

    expect(isSecretEncryptionAvailable()).toBe(false);
    expect(encryptSecret(SECRET_CONTEXT.stremioAuthKey, "plain")).toBe("plain");
  });
});

describe("decryptSecret", () => {
  it("passes a value that was never encrypted straight through", () => {
    // Rows written before encryption at rest shipped stay readable, which is
    // what lets this deploy without a data migration to be correct.
    expect(decryptSecret(kvSecretContext("tmdb:apiKey"), "legacy-plaintext-key")).toBe("legacy-plaintext-key");
  });

  it("refuses a ciphertext moved into a different column", () => {
    const stored = encryptSecret(SECRET_CONTEXT.traktAccessToken, "access");

    expect(decryptSecret(SECRET_CONTEXT.traktRefreshToken, stored)).toBeNull();
    expect(decryptSecret(SECRET_CONTEXT.stremioAuthKey, stored)).toBeNull();
    expect(decryptSecret(SECRET_CONTEXT.traktAccessToken, stored)).toBe("access");
  });

  it("refuses a ciphertext written under a different API_TOKEN", () => {
    const stored = encryptSecret(SECRET_CONTEXT.stremioAuthKey, "authkey");

    process.env.API_TOKEN = "rotated-api-token";

    expect(decryptSecret(SECRET_CONTEXT.stremioAuthKey, stored)).toBeNull();
  });

  it("refuses a ciphertext when there is no API_TOKEN at all", () => {
    const stored = encryptSecret(SECRET_CONTEXT.stremioAuthKey, "authkey");

    delete process.env.API_TOKEN;

    expect(decryptSecret(SECRET_CONTEXT.stremioAuthKey, stored)).toBeNull();
  });

  it("refuses a tampered ciphertext rather than returning corrupted output", () => {
    const stored = encryptSecret(SECRET_CONTEXT.notificationChannelToken, "gotify-token");
    const [scheme, iv, tag, ciphertext] = stored.split(".");

    /*
     * One byte of `part` changed, via the bytes rather than the base64url text.
     *
     * Rewriting the last two characters — which this did — is not the same
     * thing. These parts are base64url, and 16 bytes of GCM tag encode as 22
     * characters carrying 132 bits, so the final character's low four bits
     * decode to nothing. When the tag happened to end in a character pair the
     * substitution left byte-identical (about one run in 256, since the encoder
     * only ever emits four values in that position), the "tampered" tag was the
     * real one, the value authenticated, and the assertion below failed on a
     * ciphertext nobody had tampered with.
     */
    const flip = (part: string | undefined) => {
      const bytes = Buffer.from(present(part, "ciphertext part"), "base64url");
      bytes.writeUInt8(bytes.readUInt8(0) ^ 0xff, 0);
      return bytes.toString("base64url");
    };
    const keep = (part: string | undefined) => present(part, "ciphertext part");

    expect(decryptSecret(SECRET_CONTEXT.notificationChannelToken, [keep(scheme), keep(iv), keep(tag), flip(ciphertext)].join("."))).toBeNull();
    expect(decryptSecret(SECRET_CONTEXT.notificationChannelToken, [keep(scheme), flip(iv), keep(tag), keep(ciphertext)].join("."))).toBeNull();
    expect(decryptSecret(SECRET_CONTEXT.notificationChannelToken, [keep(scheme), keep(iv), flip(tag), keep(ciphertext)].join("."))).toBeNull();
  });

  it("returns null rather than throwing on a value it can't parse at all", () => {
    const context = SECRET_CONTEXT.stremioAuthKey;

    expect(decryptSecret(context, "cgy1...")).toBeNull();
    expect(decryptSecret(context, "cgy1.!!!.!!!.!!!")).toBeNull();
    // Right shape, wrong IV/tag widths — createDecipheriv would throw on these.
    expect(decryptSecret(context, "cgy1.YWJj.YWJj.YWJj")).toBeNull();
  });
});

describe("encryptIfPlaintext", () => {
  it("encrypts a plaintext value and leaves an encrypted one alone", () => {
    const context = kvSecretContext("omdb:apiKey");
    const encrypted = encryptIfPlaintext(context, "raw-key");

    expect(encrypted).not.toBeNull();
    expect(decryptSecret(context, encrypted!)).toBe("raw-key");
    expect(encryptIfPlaintext(context, encrypted!)).toBeNull();
  });
});
