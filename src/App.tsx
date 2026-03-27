import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useConfigStore } from "./stores/config-store";
import { useTranscriptionStore } from "./stores/transcription-store";
import { Card, CardContent, CardHeader, CardTitle } from "./components/ui/card";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./components/ui/select";
import { TranscriptionIndicator } from "./components/TranscriptionIndicator";
import "./App.css";

const LANGUAGES = [
  { value: "en", label: "English" },
  { value: "zh", label: "中文" },
  { value: "ja", label: "日本語" },
  { value: "ko", label: "한국어" },
  { value: "es", label: "Español" },
  { value: "fr", label: "Français" },
  { value: "de", label: "Deutsch" },
];

function App() {
  const { apiKey, language, loading, loadConfig, setApiKey, setLanguage } =
    useConfigStore();
  const { handleShortcutPressed, handleShortcutReleased } =
    useTranscriptionStore();

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  useEffect(() => {
    const setupShortcutListeners = async () => {
      const unlistenPressed = await listen("shortcut-pressed", () => {
        handleShortcutPressed();
      });

      const unlistenReleased = await listen("shortcut-released", () => {
        handleShortcutReleased();
      });

      return () => {
        unlistenPressed();
        unlistenReleased();
      };
    };

    const cleanupPromise = setupShortcutListeners();
    return () => {
      cleanupPromise.then((cleanup) => cleanup?.());
    };
  }, [handleShortcutPressed, handleShortcutReleased]);

  const handleClose = async () => {
    await getCurrentWindow().hide();
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground select-none">
      {/* Drag region */}
      <div
        data-tauri-drag-region
        className="flex items-center justify-between px-4 py-3 cursor-default"
      >
        <span className="text-sm font-medium">VoxFlow Settings</span>
        <button
          onClick={handleClose}
          className="text-muted-foreground hover:text-foreground transition-colors text-lg leading-none"
        >
          &times;
        </button>
      </div>

      <div className="px-4 pb-4 space-y-4">
        {/* API Key */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">ElevenLabs API Key</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="api-key" className="text-xs text-muted-foreground">
                API Key
              </Label>
              <Input
                id="api-key"
                type="password"
                placeholder="Enter your ElevenLabs API key"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                className="text-sm"
              />
            </div>
          </CardContent>
        </Card>

        {/* Shortcut */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Global Shortcut</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <kbd className="px-2 py-1 bg-muted rounded text-xs font-mono">
                Cmd
              </kbd>
              <span className="text-muted-foreground text-xs">+</span>
              <kbd className="px-2 py-1 bg-muted rounded text-xs font-mono">
                Shift
              </kbd>
              <span className="text-muted-foreground text-xs">+</span>
              <kbd className="px-2 py-1 bg-muted rounded text-xs font-mono">
                Backslash
              </kbd>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Hold to record, release to stop.
            </p>
          </CardContent>
        </Card>

        {/* Language */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Language</CardTitle>
          </CardHeader>
          <CardContent>
            <Select value={language} onValueChange={setLanguage}>
              <SelectTrigger className="text-sm">
                <SelectValue placeholder="Select language" />
              </SelectTrigger>
              <SelectContent>
                {LANGUAGES.map((lang) => (
                  <SelectItem key={lang.value} value={lang.value}>
                    {lang.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        {/* Transcription Status */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Status</CardTitle>
          </CardHeader>
          <CardContent>
            <TranscriptionIndicator />
          </CardContent>
        </Card>

        {/* Version */}
        <p className="text-xs text-muted-foreground text-center">
          VoxFlow v0.1.0
        </p>
      </div>
    </div>
  );
}

export default App;
