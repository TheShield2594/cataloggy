import { describe, expect, it } from "vitest";
import {
  resolveAiProviderUrl,
  resolvePushEndpoint,
  validateAiProviderUrl,
  validatePushEndpoint,
  type HostResolver,
} from "./ssrf.js";

// Stub resolver so the tests never touch real DNS.
const resolvesTo = (...addresses: string[]): HostResolver => async () => addresses;
const failsToResolve: HostResolver = async () => {
  throw new Error("ENOTFOUND");
};

describe("validateAiProviderUrl", () => {
  it("allows public and LAN/localhost LLM endpoints", () => {
    // Local models (Ollama, LM Studio, self-hosted) are legitimate targets.
    expect(validateAiProviderUrl("https://api.openai.com/v1/chat/completions")).not.toBeNull();
    expect(validateAiProviderUrl("http://localhost:11434/v1/chat/completions")).not.toBeNull();
    expect(validateAiProviderUrl("http://192.168.1.50:1234/v1")).not.toBeNull();
    expect(validateAiProviderUrl("http://127.0.0.1:8080/")).not.toBeNull();
  });

  it("rejects non-HTTP schemes and unparseable URLs", () => {
    expect(validateAiProviderUrl("file:///etc/passwd")).toBeNull();
    expect(validateAiProviderUrl("gopher://x/")).toBeNull();
    expect(validateAiProviderUrl("not a url")).toBeNull();
  });

  it("blocks the cloud-metadata / link-local range and unspecified address", () => {
    expect(validateAiProviderUrl("http://169.254.169.254/latest/meta-data/")).toBeNull();
    expect(validateAiProviderUrl("http://0.0.0.0/")).toBeNull();
    expect(validateAiProviderUrl("http://[fe80::1]/")).toBeNull();
    expect(validateAiProviderUrl("http://[fd00:ec2::254]/")).toBeNull();
    expect(validateAiProviderUrl("http://[::]/")).toBeNull();
  });

  it("blocks the metadata address expressed as an IPv4-mapped IPv6 literal", () => {
    // Node normalizes these to "::ffff:a9fe:a9fe", which must still be blocked.
    expect(validateAiProviderUrl("http://[::ffff:169.254.169.254]/latest/meta-data/")).toBeNull();
    expect(validateAiProviderUrl("http://[::ffff:a9fe:a9fe]/")).toBeNull();
  });

  it("blocks the metadata address written in a non-dotted-quad notation", () => {
    // WHATWG URL parsing canonicalizes these back to 169.254.169.254.
    expect(validateAiProviderUrl("http://2852039166/latest/meta-data/")).toBeNull();
    expect(validateAiProviderUrl("http://0xA9FEA9FE/")).toBeNull();
    expect(validateAiProviderUrl("http://0251.0376.0251.0376/")).toBeNull();
  });
});

describe("resolveAiProviderUrl", () => {
  it("allows a hostname that resolves to a public or LAN address", async () => {
    const url = await resolveAiProviderUrl("https://api.openai.com/v1", resolvesTo("104.18.6.192"));
    expect(url?.host).toBe("api.openai.com");
    expect(await resolveAiProviderUrl("http://ollama.lan:11434/v1", resolvesTo("192.168.1.50"))).not.toBeNull();
  });

  it("blocks a public hostname that resolves to the metadata service", async () => {
    // The whole point: an ordinary-looking name passes every syntactic check,
    // and only its A record gives it away.
    expect(validateAiProviderUrl("http://metadata.google.internal/")).not.toBeNull();
    expect(
      await resolveAiProviderUrl("http://metadata.google.internal/", resolvesTo("169.254.169.254"))
    ).toBeNull();
    expect(
      await resolveAiProviderUrl("http://llm.attacker.example/v1", resolvesTo("169.254.169.254"))
    ).toBeNull();
  });

  it("blocks when only one of several resolved addresses is a blocked target", async () => {
    expect(
      await resolveAiProviderUrl("https://llm.example.com/v1", resolvesTo("93.184.216.34", "169.254.169.254"))
    ).toBeNull();
  });

  it("blocks a hostname resolving to a link-local IPv6 or mapped IPv4 address", async () => {
    expect(await resolveAiProviderUrl("https://llm.example.com/v1", resolvesTo("fe80::1"))).toBeNull();
    expect(
      await resolveAiProviderUrl("https://llm.example.com/v1", resolvesTo("::ffff:169.254.169.254"))
    ).toBeNull();
  });

  it("fails closed on an unresolvable or empty-answer hostname", async () => {
    expect(await resolveAiProviderUrl("https://nope.example.com/v1", failsToResolve)).toBeNull();
    expect(await resolveAiProviderUrl("https://nope.example.com/v1", resolvesTo())).toBeNull();
  });

  it("still rejects everything the syntactic check rejects, without resolving", async () => {
    const resolver: HostResolver = async () => {
      throw new Error("should not be called for an IP literal");
    };
    expect(await resolveAiProviderUrl("http://169.254.169.254/", resolver)).toBeNull();
    expect(await resolveAiProviderUrl("file:///etc/passwd", resolver)).toBeNull();
    // IP literals skip DNS entirely — the literal check already covered them.
    expect(await resolveAiProviderUrl("http://127.0.0.1:8080/", resolver)).not.toBeNull();
    expect(await resolveAiProviderUrl("http://[::1]:8080/", resolver)).not.toBeNull();
  });
});

describe("validatePushEndpoint", () => {
  it("allows real browser push services", () => {
    expect(validatePushEndpoint("https://fcm.googleapis.com/fcm/send/abc")).not.toBeNull();
    expect(validatePushEndpoint("https://updates.push.services.mozilla.com/wpush/v2/abc")).not.toBeNull();
  });

  it("rejects non-https and private/loopback/link-local literals", () => {
    expect(validatePushEndpoint("http://fcm.googleapis.com/fcm/send/abc")).toBeNull();
    expect(validatePushEndpoint("https://localhost/push")).toBeNull();
    expect(validatePushEndpoint("https://127.0.0.1/push")).toBeNull();
    expect(validatePushEndpoint("https://10.0.0.5/push")).toBeNull();
    expect(validatePushEndpoint("https://192.168.1.5/push")).toBeNull();
    expect(validatePushEndpoint("https://172.20.0.1/push")).toBeNull();
    expect(validatePushEndpoint("https://169.254.169.254/push")).toBeNull();
    expect(validatePushEndpoint("https://[::1]/push")).toBeNull();
    expect(validatePushEndpoint("https://[fd00::1]/push")).toBeNull();
    expect(validatePushEndpoint("not a url")).toBeNull();
  });
});

describe("resolvePushEndpoint", () => {
  it("allows a push service resolving to a public address", async () => {
    expect(
      await resolvePushEndpoint("https://fcm.googleapis.com/fcm/send/abc", resolvesTo("142.250.185.10"))
    ).not.toBeNull();
  });

  it("blocks a public hostname that resolves to a private or loopback address", async () => {
    // "localtest.me" and friends are public names pointing at 127.0.0.1.
    expect(validatePushEndpoint("https://localtest.me/push")).not.toBeNull();
    expect(await resolvePushEndpoint("https://localtest.me/push", resolvesTo("127.0.0.1"))).toBeNull();
    expect(await resolvePushEndpoint("https://push.example.com/x", resolvesTo("10.1.2.3"))).toBeNull();
    expect(await resolvePushEndpoint("https://push.example.com/x", resolvesTo("::1"))).toBeNull();
  });

  it("fails closed when the hostname cannot be resolved", async () => {
    expect(await resolvePushEndpoint("https://push.example.com/x", failsToResolve)).toBeNull();
  });
});
