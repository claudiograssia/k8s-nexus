// Kubernetes resource quantities ("250m", "1.5", "512Mi", "1G") as numbers.

/** CPU quantity in millicores: "500m", "2", "1.5", "250000000n", "250000u". */
export function parseCpuMilli(v: unknown): number {
  if (typeof v === "number") return v * 1000;
  if (typeof v !== "string" || v.trim() === "") return 0;
  const s = v.trim();
  const scale: Record<string, number> = { m: 1, u: 1e-3, n: 1e-6 };
  const unit = s.slice(-1);
  const n = parseFloat(unit in scale ? s.slice(0, -1) : s);
  if (!Number.isFinite(n)) return 0;
  return unit in scale ? n * scale[unit] : n * 1000;
}

const MEMORY_FACTORS: Record<string, number> = {
  "": 1,
  Ki: 1024,
  Mi: 1024 ** 2,
  Gi: 1024 ** 3,
  Ti: 1024 ** 4,
  Pi: 1024 ** 5,
  Ei: 1024 ** 6,
  k: 1e3,
  K: 1e3,
  M: 1e6,
  G: 1e9,
  T: 1e12,
  P: 1e15,
  E: 1e18,
};

/** Memory quantity in bytes: binary (Ki/Mi/Gi…), decimal (k/M/G…) or plain bytes. */
export function parseMemBytes(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v !== "string") return 0;
  const m = v.trim().match(/^([0-9.]+(?:e[0-9]+)?)\s*([A-Za-z]*)$/);
  if (!m) return 0;
  const value = parseFloat(m[1]);
  const factor = MEMORY_FACTORS[m[2]];
  return Number.isFinite(value) && factor !== undefined ? value * factor : 0;
}
