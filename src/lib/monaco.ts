// Configure Monaco to run fully offline (Tauri CSP blocks CDN loads). We hand
// the bundled `monaco-editor` to @monaco-editor/react and wire up web workers
// via Vite's `?worker` imports instead of the default CDN loader.

import * as monaco from "monaco-editor";
import { loader } from "@monaco-editor/react";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(self as unknown as { MonacoEnvironment: monaco.Environment }).MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    if (label === "json") return new jsonWorker();
    return new editorWorker();
  },
};

loader.config({ monaco });

export { monaco };
