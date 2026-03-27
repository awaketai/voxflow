import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

interface ConfigState {
  apiKey: string;
  language: string;
  loading: boolean;
  loadConfig: () => Promise<void>;
  setApiKey: (key: string) => Promise<void>;
  setLanguage: (lang: string) => Promise<void>;
}

export const useConfigStore = create<ConfigState>((set) => ({
  apiKey: "",
  language: "en",
  loading: true,

  loadConfig: async () => {
    try {
      const apiKey = await invoke<string | null>("get_config", {
        key: "api_key",
      });
      const language = await invoke<string | null>("get_config", {
        key: "language",
      });
      set({
        apiKey: (apiKey as string) || "",
        language: (language as string) || "en",
        loading: false,
      });
    } catch {
      set({ loading: false });
    }
  },

  setApiKey: async (key: string) => {
    await invoke("set_config", { key: "api_key", value: key });
    set({ apiKey: key });
  },

  setLanguage: async (lang: string) => {
    await invoke("set_config", { key: "language", value: lang });
    set({ language: lang });
  },
}));
