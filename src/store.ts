import { convertFileSrc } from "@tauri-apps/api/core";
import type { Imagen, Item, Lectura, Tema } from "./util";

export type Datos = { items: Item[]; theme: Tema | null };

/** Fuera de Tauri (p. ej. `npm run dev` en el navegador) se usa localStorage. */
export const isTauri = "__TAURI_INTERNALS__" in window;

const LS_KEY = "clipboard-datos";

async function invoke<T>(cmd: string, args?: Record<string, unknown>) {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

export async function load(): Promise<Datos> {
  if (isTauri) return invoke<Datos>("load_data");
  try {
    const s = localStorage.getItem(LS_KEY);
    if (s) return JSON.parse(s);
  } catch {}
  return { items: [], theme: null };
}

// Las escrituras se encadenan para que nunca lleguen fuera de orden.
let cola: Promise<void> = Promise.resolve();

export function save(d: Datos) {
  const copia: Datos = { items: d.items.map((i) => ({ ...i, tags: [...i.tags] })), theme: d.theme };
  cola = cola
    .then(async () => {
      if (isTauri) await invoke("save_data", { data: copia });
      else localStorage.setItem(LS_KEY, JSON.stringify(copia));
    })
    .catch((e) => console.error("No se pudo guardar", e));
}

export async function leerPortapapeles(): Promise<Lectura> {
  if (isTauri) return invoke<Lectura>("leer_portapapeles");
  try {
    const text = await navigator.clipboard.readText();
    return text.trim() ? { kind: "texto", text } : { kind: "vacio" };
  } catch {
    return { kind: "vacio" };
  }
}

export type Entrada = { id: string; label: string; kind: "text" | "image"; text: string; activo: boolean };
export const actualizarMenu = (favoritos: Entrada[], recientes: Entrada[]) =>
  invoke<void>("actualizar_menu", { favoritos, recientes });

export const guardarPendiente = (id: string) => invoke<void>("guardar_pendiente", { id });
export const importarImagen = (path: string, id: string) => invoke<Imagen>("importar_imagen", { path, id });
export const copiarImagen = (id: string) => invoke<void>("copiar_imagen", { id });

export async function copiarTexto(text: string) {
  if (isTauri) return invoke<void>("copiar_texto", { text });
  await navigator.clipboard.writeText(text);
}

/** URLs de las imágenes guardadas (protocolo de archivos de Tauri). */
let base = "";
export async function prepararRutas() {
  if (!isTauri) return;
  const { appDataDir } = await import("@tauri-apps/api/path");
  base = await appDataDir();
}
export const urlArchivo = (relativo: string) => convertFileSrc(`${base.replace(/\/$/, "")}/${relativo}`);
