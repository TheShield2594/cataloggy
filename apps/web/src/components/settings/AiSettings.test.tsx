import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AiSettings } from "./AiSettings";

vi.mock("../../api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api")>();
  return {
    ...actual,
    api: {
      getAiConfig: vi.fn(),
      saveAiConfig: vi.fn(),
      deleteAiConfig: vi.fn(),
      testAiConfig: vi.fn(),
    },
  };
});

const { api } = await import("../../api");
const getAiConfig = vi.mocked(api.getAiConfig);
const saveAiConfig = vi.mocked(api.saveAiConfig);
const deleteAiConfig = vi.mocked(api.deleteAiConfig);
const testAiConfig = vi.mocked(api.testAiConfig);

const field = {
  url: () => screen.getByLabelText("Endpoint URL"),
  key: () => screen.getByLabelText(/^API Key/),
  model: () => screen.getByLabelText("Model"),
  maxTokens: () => screen.getByLabelText("Max tokens"),
  provider: () => screen.getByLabelText("Provider"),
};

const save = () => screen.getByRole("button", { name: /save config/i });

/** Waits out the load, which every case has to do before touching a field. */
async function renderSettings() {
  render(<AiSettings />);
  await waitFor(() => expect(screen.queryByText("Loading...")).not.toBeInTheDocument());
}

beforeEach(() => {
  getAiConfig.mockResolvedValue({ configured: false, config: null, lastGeneratedAt: null });
  saveAiConfig.mockResolvedValue({ configured: true });
  deleteAiConfig.mockResolvedValue({ configured: false });
  testAiConfig.mockResolvedValue({ success: true, response: "pong" });
});

describe("AiSettings loading a stored config", () => {
  it("recognises the provider from its endpoint and unwraps the stored key", async () => {
    getAiConfig.mockResolvedValue({
      configured: true,
      lastGeneratedAt: null,
      config: {
        url: "https://api.groq.com/openai/v1/chat/completions",
        headers: { Authorization: "Bearer gsk-secret" },
        payload: { model: "llama-3.3-70b-versatile", max_tokens: 8000 },
      },
    });
    await renderSettings();

    expect(field.provider()).toHaveValue("groq");
    expect(field.key()).toHaveValue("gsk-secret");
    expect(field.maxTokens()).toHaveValue(8000);
    expect(screen.getByText("Configured")).toBeInTheDocument();
  });

  it("treats an endpoint it doesn't recognise as a custom one", async () => {
    getAiConfig.mockResolvedValue({
      configured: true,
      lastGeneratedAt: null,
      config: { url: "https://llm.example.internal/v1/chat", headers: {}, payload: { model: "m" } },
    });
    await renderSettings();

    expect(field.provider()).toHaveValue("custom");
    expect(field.url()).toHaveValue("https://llm.example.internal/v1/chat");
  });

  it("says why the panel is empty when the config couldn't be loaded", async () => {
    getAiConfig.mockRejectedValue(new Error("Config unavailable"));
    await renderSettings();

    expect(screen.getByText("Config unavailable")).toBeInTheDocument();
  });
});

describe("AiSettings validation", () => {
  it("won't post a config with no API key to a provider that needs one", async () => {
    const user = userEvent.setup();
    await renderSettings();

    await user.click(save());

    expect(await screen.findByText(/api key is required for this provider/i)).toBeInTheDocument();
    expect(saveAiConfig).not.toHaveBeenCalled();
  });

  it("catches a placeholder pasted out of a README", async () => {
    const user = userEvent.setup();
    await renderSettings();

    await user.type(field.key(), "your_key_here");
    await user.click(save());

    expect(await screen.findByText(/looks like a placeholder key/i)).toBeInTheDocument();
    expect(saveAiConfig).not.toHaveBeenCalled();
  });

  it("rejects an endpoint that isn't a URL, and a missing model", async () => {
    const user = userEvent.setup();
    await renderSettings();

    await user.clear(field.url());
    await user.type(field.url(), "not a url");
    await user.clear(field.model());
    await user.type(field.key(), "sk-real-key");
    await user.click(save());

    expect(await screen.findByText("Must be a valid URL")).toBeInTheDocument();
    expect(screen.getByText("Model name is required")).toBeInTheDocument();
    expect(saveAiConfig).not.toHaveBeenCalled();
  });

  // The server clamps anything below its floor, so a field that accepted 512
  // would be promising a value the API would quietly raise.
  it("holds max tokens at the floor the server enforces", async () => {
    await renderSettings();

    // Set rather than typed: the field clamps on every keystroke, so typing
    // "512" over a value would be read digit by digit.
    fireEvent.change(field.maxTokens(), { target: { value: "512" } });

    expect(field.maxTokens()).toHaveValue(2048);

    fireEvent.change(field.maxTokens(), { target: { value: "8000" } });

    expect(field.maxTokens()).toHaveValue(8000);
  });

  it("lets Ollama through without a key, and sends no auth header", async () => {
    const user = userEvent.setup();
    await renderSettings();

    await user.selectOptions(field.provider(), "ollama");
    await user.click(save());

    await waitFor(() => expect(saveAiConfig).toHaveBeenCalled());
    expect(saveAiConfig).toHaveBeenCalledWith({
      url: "http://localhost:11434/v1/chat/completions",
      headers: {},
      payload: { model: "llama3.2", max_tokens: 4096 },
    });
  });

  it("fills the endpoint and model from the provider picked", async () => {
    const user = userEvent.setup();
    await renderSettings();

    await user.selectOptions(field.provider(), "openrouter");

    expect(field.url()).toHaveValue("https://openrouter.ai/api/v1/chat/completions");
    expect(field.model()).toHaveValue("openai/gpt-4o-mini");
  });
});

describe("AiSettings saving and testing", () => {
  it("saves the config assembled from the fields", async () => {
    const user = userEvent.setup();
    await renderSettings();

    await user.type(field.key(), "sk-real-key");
    await user.click(save());

    await waitFor(() =>
      expect(saveAiConfig).toHaveBeenCalledWith({
        url: "https://api.openai.com/v1/chat/completions",
        headers: { Authorization: "Bearer sk-real-key" },
        payload: { model: "gpt-4o-mini", max_tokens: 4096 },
      })
    );
    expect(await screen.findByText("Saved")).toBeInTheDocument();
  });

  it("reports a save the server refused", async () => {
    const user = userEvent.setup();
    saveAiConfig.mockRejectedValue(new Error("Endpoint resolves to a private address"));
    await renderSettings();

    await user.type(field.key(), "sk-real-key");
    await user.click(save());

    expect(await screen.findByText("Endpoint resolves to a private address")).toBeInTheDocument();
  });

  it("quotes what the model replied to a connection test", async () => {
    const user = userEvent.setup();
    await renderSettings();

    await user.type(field.key(), "sk-real-key");
    await user.click(screen.getByRole("button", { name: /test connection/i }));

    expect(await screen.findByText(/Connected\. Model replied: "pong"/)).toBeInTheDocument();
  });

  it("passes on the reason a test failed instead of just failing", async () => {
    const user = userEvent.setup();
    testAiConfig.mockResolvedValue({ success: false, error: "401 Unauthorized" });
    await renderSettings();

    await user.type(field.key(), "sk-real-key");
    await user.click(screen.getByRole("button", { name: /test connection/i }));

    expect(await screen.findByText("401 Unauthorized")).toBeInTheDocument();
  });

  it("validates before testing, so a bad form never reaches the network", async () => {
    const user = userEvent.setup();
    await renderSettings();

    await user.click(screen.getByRole("button", { name: /test connection/i }));

    expect(await screen.findByText(/api key is required/i)).toBeInTheDocument();
    expect(testAiConfig).not.toHaveBeenCalled();
  });

  it("removes a stored config and empties the form", async () => {
    const user = userEvent.setup();
    getAiConfig.mockResolvedValue({
      configured: true,
      lastGeneratedAt: null,
      config: {
        url: "https://api.groq.com/openai/v1/chat/completions",
        headers: { Authorization: "Bearer gsk-secret" },
        payload: { model: "llama-3.3-70b-versatile", max_tokens: 8000 },
      },
    });
    await renderSettings();

    await user.click(screen.getByRole("button", { name: /^remove$/i }));

    await waitFor(() => expect(deleteAiConfig).toHaveBeenCalled());
    expect(await screen.findByText("Not configured")).toBeInTheDocument();
    expect(field.key()).toHaveValue("");
    expect(screen.queryByRole("button", { name: /^remove$/i })).not.toBeInTheDocument();
  });
});

describe("AiSettings raw JSON escape hatch", () => {
  it("hands the JSON straight to the server, bypassing the form's own rules", async () => {
    const user = userEvent.setup();
    await renderSettings();

    await user.click(screen.getByRole("button", { name: /advanced: edit raw json/i }));
    const raw = screen.getByLabelText("Raw JSON configuration");
    await user.clear(raw);
    await user.type(raw, '{{"url":"https://x.test/v1","headers":{{},"payload":{{"model":"m"}}');
    await user.click(save());

    await waitFor(() =>
      expect(saveAiConfig).toHaveBeenCalledWith({
        url: "https://x.test/v1",
        headers: {},
        payload: { model: "m" },
      })
    );
  });

  it("won't save JSON that doesn't parse", async () => {
    const user = userEvent.setup();
    await renderSettings();

    await user.click(screen.getByRole("button", { name: /advanced: edit raw json/i }));
    const raw = screen.getByLabelText("Raw JSON configuration");
    await user.clear(raw);
    await user.type(raw, "{{not json");
    await user.click(save());

    expect(await screen.findByText("Invalid JSON")).toBeInTheDocument();
    expect(saveAiConfig).not.toHaveBeenCalled();
  });
});
