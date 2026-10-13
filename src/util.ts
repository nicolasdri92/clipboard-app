export type Imagen = { w: number; h: number; size: number; hash: string };

export type Item = {
  id: string;
  kind: "text" | "image";
  title: string;
  text: string;
  image?: Imagen;
  tags: string[];
  pinned: boolean;
  /** Fechas ISO 8601. */
  created: string;
  used: string | null;
  uses: number;
};

export type Tema = "claro" | "oscuro";

/** Lo que hay copiado ahora (lo lee Rust con GTK). */
export type Lectura =
  | { kind: "vacio" }
  | { kind: "texto"; text: string }
  | ({ kind: "imagen" } & Imagen);

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (s: string) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);
export const norm = (s: string) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

export const fmtSize = (b: number) =>
  b < 1024 ? `${b} B`
  : b < 1048576 ? `${Math.round(b / 1024).toLocaleString("es-AR")} KB`
  : `${(b / 1048576).toLocaleString("es-AR", { maximumFractionDigits: 1 })} MB`;

/** "cbu, Banco ,cbu" → ["cbu", "banco"] */
export const parseTags = (s: string) =>
  [...new Set(s.split(",").map((t) => t.trim().replace(/^#/, "").toLowerCase()).filter(Boolean))];

/** Primera línea no vacía, para títulos automáticos. */
export const primeraLinea = (s: string) => s.split("\n").map((l) => l.trim()).find(Boolean) ?? "";

/** «hace 3 min», «ayer», «12 oct». */
export function haceCuanto(iso: string) {
  const d = new Date(iso);
  const s = Math.round((Date.now() - d.getTime()) / 1000);
  if (s < 60) return "recién";
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
  if (s < 172800) return "ayer";
  return d.toLocaleDateString("es-AR", { day: "numeric", month: "short" });
}
