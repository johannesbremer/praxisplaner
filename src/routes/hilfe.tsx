import {
  formatForDisplay,
  formatKeyForDebuggingDisplay,
  formatWithLabels,
  normalizeHotkey,
  parseHotkey,
  validateHotkey,
} from "@tanstack/react-hotkeys";
import { createFileRoute, Link } from "@tanstack/react-router";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/hilfe")({
  component: HotkeysHelpPage,
});

function HotkeysHelpPage() {
  const parsedExample = parseHotkey("Mod+Shift+S");
  const validationValid = validateHotkey("Alt+A");
  const validationInvalid = validateHotkey("InvalidKey+S");

  const appShortcuts = [
    { action: "Rückgängig", hotkey: "Mod+Z" },
    { action: "Wiederholen", hotkey: "Mod+Shift+Z" },
    { action: "Wiederholen (Alt.)", hotkey: "Mod+Y" },
    { action: "Zurück (Buchung)", hotkey: "Alt+ArrowLeft" },
    { action: "Vor (Buchung)", hotkey: "Alt+ArrowRight" },
  ];

  const symbolRows = [
    { key: "Meta (Cmd)", mac: "⌘", winLinux: "Win / Super" },
    { key: "Control", mac: "⌃", winLinux: "Ctrl" },
    { key: "Alt/Option", mac: "⌥", winLinux: "Alt" },
    { key: "Shift", mac: "⇧", winLinux: "Shift" },
  ];

  return (
    <div className="container mx-auto max-w-5xl p-6 space-y-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold">Hotkeys Hilfe</h1>
        <p className="text-muted-foreground">
          Anzeige und Formatierung von Tastenkombinationen mit TanStack Hotkeys.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Kurzbefehle in dieser App</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {appShortcuts.map((item) => (
            <div
              className="flex items-center justify-between rounded-md border p-3"
              key={`${item.action}-${item.hotkey}`}
            >
              <span>{item.action}</span>
              <ShortcutBadge hotkey={item.hotkey} />
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>formatForDisplay</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex items-center justify-between rounded-md border p-3">
            <span>Mod+S</span>
            <ShortcutBadge hotkey="Mod+S" />
          </div>
          <div className="flex items-center justify-between rounded-md border p-3">
            <span>Mod+Shift+Z</span>
            <ShortcutBadge hotkey="Mod+Shift+Z" />
          </div>
          <div className="flex items-center justify-between rounded-md border p-3">
            <span>Control+Alt+D</span>
            <ShortcutBadge hotkey="Control+Alt+D" />
          </div>
          <p className="text-muted-foreground">
            macOS zeigt Symbole (z. B. ⌘, ⇧), Windows/Linux zeigt Labels mit
            <code>+</code>.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Labels und Debugging</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="rounded-md border p-3">
            <div>
              <strong>formatWithLabels(Mod+S):</strong>{" "}
              {formatWithLabels("Mod+S")}
            </div>
            <div>
              <strong>formatWithLabels(Mod+Shift+Z):</strong>{" "}
              {formatWithLabels("Mod+Shift+Z")}
            </div>
          </div>
          <div className="rounded-md border p-3">
            <div>
              <strong>formatKeyForDebuggingDisplay(Meta):</strong>{" "}
              {formatKeyForDebuggingDisplay("Meta")}
            </div>
            <div>
              <strong>formatKeyForDebuggingDisplay(Shift):</strong>{" "}
              {formatKeyForDebuggingDisplay("Shift")}
            </div>
            <div>
              <strong>formatKeyForDebuggingDisplay(Control):</strong>{" "}
              {formatKeyForDebuggingDisplay("Control")}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Parsing, Normalisierung, Validation</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="rounded-md border p-3 space-y-1">
            <div>
              <strong>parseHotkey(Mod+Shift+S)</strong>
            </div>
            <pre className="overflow-x-auto text-xs">
              {JSON.stringify(parsedExample, null, 2)}
            </pre>
          </div>
          <div className="rounded-md border p-3">
            <div>
              <strong>normalizeHotkey(Cmd+S):</strong>{" "}
              {normalizeHotkey("Cmd+S")}
            </div>
            <div>
              <strong>normalizeHotkey(Ctrl+Shift+s):</strong>{" "}
              {normalizeHotkey("Ctrl+Shift+s")}
            </div>
            <div>
              <strong>normalizeHotkey(Mod+S):</strong>{" "}
              {normalizeHotkey("Mod+S")}
            </div>
          </div>
          <div className="rounded-md border p-3 space-y-2">
            <div className="flex items-center gap-2">
              <strong>validateHotkey(Alt+A)</strong>
              <Badge
                variant={validationValid.valid ? "default" : "destructive"}
              >
                {validationValid.valid ? "valid" : "invalid"}
              </Badge>
            </div>
            {validationValid.warnings.map((warning) => (
              <div className="text-muted-foreground" key={warning}>
                {warning}
              </div>
            ))}
            <div className="flex items-center gap-2 pt-2">
              <strong>validateHotkey(InvalidKey+S)</strong>
              <Badge
                variant={validationInvalid.valid ? "default" : "destructive"}
              >
                {validationInvalid.valid ? "valid" : "invalid"}
              </Badge>
            </div>
            {validationInvalid.errors.map((error) => (
              <div className="text-destructive" key={error}>
                {error}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Platform Symbole</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {symbolRows.map((row) => (
            <div
              className="grid grid-cols-3 gap-2 rounded-md border p-3"
              key={row.key}
            >
              <span>{row.key}</span>
              <span>{row.mac}</span>
              <span>{row.winLinux}</span>
            </div>
          ))}
        </CardContent>
      </Card>

      <div>
        <Link className="text-sm underline underline-offset-4" to="/">
          Zur Startseite
        </Link>
      </div>
    </div>
  );
}

function ShortcutBadge({ hotkey }: { hotkey: string }) {
  return (
    <kbd className="inline-flex min-w-16 items-center justify-center rounded-md border px-2 py-1 text-xs font-medium">
      {formatForDisplay(hotkey)}
    </kbd>
  );
}
