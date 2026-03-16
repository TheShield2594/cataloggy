import { FormEvent, useState } from "react";
import { runtimeConfig } from "../api";

export function SettingsPage() {
  const [apiBaseOverride, setApiBaseOverride] = useState(runtimeConfig.getApiBaseOverride());
  const [token, setToken] = useState(runtimeConfig.getToken());
  const [showToken, setShowToken] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const saveSettings = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    runtimeConfig.setApiBaseOverride(apiBaseOverride);
    runtimeConfig.setToken(token);
    setMessage("Settings saved.");
  };

  const clearOverride = () => {
    setApiBaseOverride("");
    runtimeConfig.setApiBaseOverride("");
    setMessage("API base override cleared.");
  };

  return (
    <div className="max-w-3xl space-y-4 rounded-lg border border-slate-800 bg-slate-900 p-4">
      <h2 className="text-xl font-semibold">Settings</h2>
      <p className="text-sm text-slate-300">
        Env default API base: <span className="font-mono text-sky-300">{runtimeConfig.apiBaseDefault}</span>
      </p>
      <p className="text-sm text-slate-300">
        Effective API base: <span className="font-mono text-emerald-300">{runtimeConfig.getApiBase()}</span>
      </p>

      <form onSubmit={saveSettings} className="space-y-4">
        <label className="block space-y-1">
          <span className="text-sm text-slate-300">API base URL override (localStorage: cataloggy_api_base_override)</span>
          <input
            value={apiBaseOverride}
            onChange={(event) => setApiBaseOverride(event.target.value)}
            placeholder="http://192.168.1.20:7000"
            className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2"
          />
        </label>

        <div className="block space-y-1">
          <span className="text-sm text-slate-300">Cataloggy token (localStorage: cataloggy_token)</span>
          <div className="relative">
            <input
              type={showToken ? "text" : "password"}
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder="Paste API token"
              className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 pr-16"
            />
            <button
              type="button"
              onClick={() => setShowToken((prev) => !prev)}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded bg-slate-700 px-2 py-1 text-xs text-slate-300"
            >
              {showToken ? "Hide" : "Show"}
            </button>
          </div>
          <p className="text-xs text-amber-400">
            Token is stored in localStorage. Only use this on trusted devices.
          </p>
        </div>

        <div className="flex gap-2">
          <button type="submit" className="rounded bg-sky-600 px-4 py-2 text-sm font-medium">
            Save settings
          </button>
          <button type="button" onClick={clearOverride} className="rounded bg-slate-700 px-4 py-2 text-sm font-medium">
            Clear API override
          </button>
        </div>
      </form>

      {message && <p className="text-sm text-emerald-300">{message}</p>}
    </div>
  );
}
