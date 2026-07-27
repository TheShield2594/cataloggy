import { describe, expect, it } from "vitest";
import { validateAiProviderUrl } from "./ssrf.js";

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
});
