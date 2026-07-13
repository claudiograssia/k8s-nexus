import { useCallback, useState } from "react";

// Remembered per-panel height (keyed by id) so it persists across open/close.
const cache: Record<string, number> = {};

/**
 * Drag-to-resize height for a bottom-docked panel. Dragging the handle upward
 * grows the panel; the value is clamped and remembered per `id`.
 */
export function useResizableHeight(id: string, fallback: number, min = 140) {
  const [height, setHeight] = useState<number>(() => cache[id] ?? fallback);

  const startResize = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startY = e.clientY;
      const startH = height;
      document.body.style.userSelect = "none";
      document.body.style.cursor = "row-resize";
      const onMove = (ev: MouseEvent) => {
        const next = Math.min(
          Math.max(min, startH + (startY - ev.clientY)),
          window.innerHeight - 120,
        );
        setHeight(next);
        cache[id] = next;
      };
      const onUp = () => {
        document.body.style.userSelect = "";
        document.body.style.cursor = "";
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [height, id, min],
  );

  return { height, startResize };
}
