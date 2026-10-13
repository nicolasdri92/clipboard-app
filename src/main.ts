import "@fontsource-variable/geist";
import "./styles.css";
import {
  actualizarMenu, type Entrada, copiarImagen, copiarTexto, guardarPendiente, importarImagen, isTauri, leerPortapapeles,
  load, prepararRutas, save as persist, urlArchivo,
} from "./store";
import { esc, fmtSize, haceCuanto, norm, parseTags, primeraLinea, type Item, type Lectura, type Tema } from "./util";

// ---------- Íconos ----------
const svg = (size: number, sw: number, body: string, extra = 'stroke-linecap="round" stroke-linejoin="round"') =>
  `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="${sw}" ${extra}>${body}</svg>`;
const ICON = {
  clipboard: (s = 16, sw = 1.4) => svg(s, sw, '<rect x="3.5" y="3" width="9" height="11" rx="1.6"/><path d="M6 3V2.4c0-.5.4-.9.9-.9h2.2c.5 0 .9.4.9.9V3"/><line x1="6" y1="7.5" x2="10" y2="7.5"/><line x1="6" y1="10" x2="9" y2="10"/>'),
  text: svg(16, 1.4, '<line x1="3" y1="4" x2="13" y2="4"/><line x1="3" y1="7" x2="13" y2="7"/><line x1="3" y1="10" x2="13" y2="10"/><line x1="3" y1="13" x2="9" y2="13"/>'),
  image: svg(16, 1.4, '<rect x="2" y="3" width="12" height="10" rx="1.6"/><circle cx="6" cy="6.5" r="1.2"/><path d="m2.5 12 3.8-3.6 2.7 2.4 2.1-1.8 2.4 2.4"/>'),
  plus: svg(14, 1.6, '<line x1="8" y1="3.5" x2="8" y2="12.5"/><line x1="3.5" y1="8" x2="12.5" y2="8"/>'),
  x: svg(14, 1.5, '<line x1="4" y1="4" x2="12" y2="12"/><line x1="12" y1="4" x2="4" y2="12"/>'),
  star: (on: boolean) =>
    `<svg width="15" height="15" viewBox="0 0 16 16" fill="${on ? "currentColor" : "none"}" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><path d="m8 2.2 1.75 3.6 3.95.55-2.86 2.77.68 3.93L8 11.2l-3.52 1.85.68-3.93L2.3 6.35l3.95-.55z"/></svg>`,
  edit: svg(14, 1.4, '<path d="M10.8 2.7a1.6 1.6 0 0 1 2.3 2.3L6 12.1l-3 .8.8-3z"/>'),
  copy: svg(14, 1.4, '<rect x="5" y="5" width="8.5" height="8.5" rx="1.5"/><path d="M11 5V3.8c0-.7-.6-1.3-1.3-1.3H3.8c-.7 0-1.3.6-1.3 1.3v5.9c0 .7.6 1.3 1.3 1.3H5"/>'),
  check: svg(13, 2, '<polyline points="3.5,8.5 6.5,11.5 12.5,4.5"/>'),
  trash: svg(14, 1.4, '<line x1="3" y1="4.5" x2="13" y2="4.5"/><path d="M4.8 4.5l.6 8.5h5.2l.6-8.5M6.5 4.5V3h3v1.5"/>'),
  sun: svg(15, 1.4, '<circle cx="8" cy="8" r="3"/><line x1="8" y1="1.5" x2="8" y2="2.8"/><line x1="8" y1="13.2" x2="8" y2="14.5"/><line x1="1.5" y1="8" x2="2.8" y2="8"/><line x1="13.2" y1="8" x2="14.5" y2="8"/><line x1="3.4" y1="3.4" x2="4.3" y2="4.3"/><line x1="11.7" y1="11.7" x2="12.6" y2="12.6"/><line x1="3.4" y1="12.6" x2="4.3" y2="11.7"/><line x1="11.7" y1="4.3" x2="12.6" y2="3.4"/>', 'stroke-linecap="round"'),
  moon: svg(15, 1.4, '<path d="M13 9.6A5.5 5.5 0 1 1 6.4 3a4.4 4.4 0 0 0 6.6 6.6z"/>'),
};

// ---------- Estado ----------
type Filtro = "todo" | "text" | "image" | "fav";
type Form = { id: string; kind: "text" | "image"; title: string; text: string; tags: string };

const S = {
  items: [] as Item[],
  theme: "claro" as Tema,
  themeStored: false,
  query: "",
  filtro: "todo" as Filtro,
  tag: null as string | null,
  panel: null as null | "form",
  form: null as Form | null,
  confirm: false,
  /** Copiado que el usuario deshizo (no se vuelve a guardar solo). */
  descartado: "",
  /** Elemento recién copiado (muestra «Copiado» en la fila). */
  copiado: null as string | null,
  /** Elemento que está ahora en el portapapeles (null = otra cosa o no se sabe). */
  activo: null as string | null,
  flash: [] as string[],
  toast: null as null | { text: string; label?: string; fn?: () => void },
};

const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;
const content = $("#content");
const panelRoot = $("#panel-root");
const toastRoot = $("#toast-root");
const searchInput = $<HTMLInputElement>("#search");

let toastTimer = 0;
let copiadoTimer = 0;
let flashTimer = 0;

const commit = () => {
  persist({ items: S.items, theme: S.themeStored ? S.theme : null });
  sincronizarMenu();
};

/** Menú de la barra superior: hasta 10 favoritos y 10 recientes para copiar sin abrir la app. */
function sincronizarMenu() {
  if (!isTauri) return;
  const recorte = (t: string) => {
    const linea = t.replace(/\s+/g, " ").trim();
    return linea.length > 48 ? linea.slice(0, 47) + "…" : linea;
  };
  const entrada = (i: Item): Entrada =>
    ({ id: i.id, label: recorte(tituloDe(i)), kind: i.kind, text: i.text, activo: i.id === S.activo });
  const orden = [...S.items].sort((a, b) => ultimoUso(b).localeCompare(ultimoUso(a)));
  actualizarMenu(
    orden.filter((i) => i.pinned).slice(0, 10).map(entrada),
    orden.filter((i) => !i.pinned).slice(0, 10).map(entrada),
  ).catch((e) => console.error("No se pudo actualizar el menú", e));
}
const newId = () => (crypto.randomUUID ? crypto.randomUUID() : "i" + Date.now() + Math.random().toString(36).slice(2));
const ahora = () => new Date().toISOString();
const imgUrl = (id: string) => urlArchivo(`imagenes/${id}.png`);
const tituloDe = (i: Item) =>
  i.title || (i.kind === "image" ? `Imagen ${i.image?.w ?? ""}×${i.image?.h ?? ""}` : primeraLinea(i.text));
const claveCaptura = (c: Lectura) => (c.kind === "texto" ? "t:" + c.text : c.kind === "imagen" ? "i:" + c.hash : "");

// ---------- Tema y buscador ----------
function renderTheme() {
  document.documentElement.dataset.theme = S.theme;
  $("#theme").innerHTML = S.theme === "oscuro" ? ICON.sun : ICON.moon;
}

function renderSearch() {
  if (searchInput.value !== S.query) searchInput.value = S.query;
  $("#search-clear").hidden = !S.query;
  $("#search-kbd").hidden = !!S.query;
}

// ---------- Lista ----------
function visibles() {
  const q = norm(S.query.trim());
  return S.items.filter((i) => {
    if (S.filtro === "text" && i.kind !== "text") return false;
    if (S.filtro === "image" && i.kind !== "image") return false;
    if (S.filtro === "fav" && !i.pinned) return false;
    if (S.tag && !i.tags.includes(S.tag)) return false;
    return !q || norm(`${i.title} ${i.text} ${i.tags.join(" ")}`).includes(q);
  });
}

const ultimoUso = (i: Item) => i.used ?? i.created;

function rowHTML(i: Item) {
  const cls = ["row", "clip"];
  if (S.flash.includes(i.id)) cls.push("flash");
  if (S.copiado === i.id) cls.push("copiado");
  if (S.activo === i.id) cls.push("activo");
  const miniatura = i.kind === "image"
    ? `<span class="thumb"><img src="${esc(imgUrl(i.id))}" alt="" loading="lazy"></span>`
    : `<span class="thumb icono">${ICON.text}</span>`;
  const sub = i.kind === "image"
    ? `${i.image ? `${i.image.w}×${i.image.h} · ${fmtSize(i.image.size)}` : "Imagen"}`
    : i.title ? primeraLinea(i.text) : i.text.split("\n").map((l) => l.trim()).filter(Boolean).slice(1).join(" ");
  return `<div class="${cls.join(" ")}" data-id="${esc(i.id)}" title="Clic para copiar">
    ${miniatura}
    <div class="texts">
      <div class="title-line"><span class="title">${esc(tituloDe(i))}</span>
        ${i.tags.map((t) => `<span class="rep-chip">#${esc(t)}</span>`).join("")}</div>
      ${sub ? `<div class="sub">${esc(sub)}</div>` : ""}
    </div>
    <span class="meta tab">${S.copiado === i.id
      ? `<span class="copiado-txt">${ICON.check}Copiado</span>`
      : S.activo === i.id
        ? `<span class="activo-txt">${ICON.clipboard(13, 1.5)}En el portapapeles</span>`
        : esc(haceCuanto(ultimoUso(i)))}</span>
    <div class="acciones">
      <button class="icon-btn star${i.pinned ? " on" : ""}" data-pin="${esc(i.id)}" aria-label="${i.pinned ? "Quitar de favoritos" : "Agregar a favoritos"}" title="${i.pinned ? "Quitar de favoritos" : "Favorito"}">${ICON.star(i.pinned)}</button>
      <button class="icon-btn" data-edit="${esc(i.id)}" aria-label="Editar" title="Editar">${ICON.edit}</button>
    </div>
  </div>`;
}

function chipsHTML() {
  const cuenta = new Map<string, number>();
  for (const i of S.items) for (const t of i.tags) cuenta.set(t, (cuenta.get(t) ?? 0) + 1);
  const tags = [...cuenta.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 8).map(([t]) => t);
  const filtros: [Filtro, string][] = [["todo", "Todo"], ["text", "Textos"], ["image", "Imágenes"], ["fav", "Favoritos"]];
  return `<div class="chips filtros">
    ${filtros.map(([k, l]) => `<button class="chip${S.filtro === k ? " on" : ""}" data-filtro="${k}">${l}</button>`).join("")}
    ${tags.length ? '<span class="chips-sep"></span>' : ""}
    ${tags.map((t) => `<button class="chip${S.tag === t ? " on" : ""}" data-tag="${esc(t)}">#${esc(t)}</button>`).join("")}
  </div>`;
}

function renderList() {
  let html: string;
  if (S.items.length === 0) {
    html = `<div class="empty">
      <div class="empty-icon">${ICON.clipboard(24, 1)}</div>
      <div class="empty-texts">
        <div class="empty-title">Tu portapapeles está vacío</div>
        <div class="empty-sub">Copiá un texto o una imagen y volvé a esta ventana: se guarda solo.</div>
      </div>
    </div>`;
  } else {
    const items = visibles().sort((a, b) => ultimoUso(b).localeCompare(ultimoUso(a)));
    const fav = items.filter((i) => i.pinned);
    const resto = items.filter((i) => !i.pinned);
    const grupo = (nombre: string, lista: Item[]) => lista.length
      ? `<section class="group"><div class="group-h"><span>${nombre}</span><span class="count tab">${lista.length}</span></div>
          <div class="items">${lista.map(rowHTML).join("")}</div></section>`
      : "";
    const cuerpo = items.length
      ? grupo("Favoritos", fav) + grupo(S.filtro === "fav" ? "" : "Recientes", resto)
      : `<div class="noresults">
          <div class="noresults-title">${S.query.trim() ? `Sin resultados para “${esc(S.query.trim())}”` : "Nada por acá"}</div>
          <div class="noresults-sub">Probá con otra palabra u otro filtro.</div>
        </div>`;
    html = chipsHTML() + cuerpo;
  }
  content.innerHTML = `<div class="column">${html}</div>`;
}

content.addEventListener("click", (e) => {
  const el = e.target as HTMLElement;
  const f = el.closest<HTMLElement>("[data-filtro]");
  if (f) {
    S.filtro = f.dataset.filtro as Filtro;
    return renderList();
  }
  const t = el.closest<HTMLElement>("[data-tag]");
  if (t) {
    S.tag = S.tag === t.dataset.tag ? null : t.dataset.tag!;
    return renderList();
  }
  const pin = el.closest<HTMLElement>("[data-pin]");
  if (pin) {
    S.items = S.items.map((i) => (i.id === pin.dataset.pin ? { ...i, pinned: !i.pinned } : i));
    commit();
    return renderList();
  }
  const ed = el.closest<HTMLElement>("[data-edit]");
  if (ed) return openEdit(ed.dataset.edit!);
  const row = el.closest<HTMLElement>(".row");
  if (row) copiar(row.dataset.id!);
});

// ---------- Copiar ----------
async function copiar(id: string) {
  const i = S.items.find((x) => x.id === id);
  if (!i) return;
  try {
    if (i.kind === "image") await copiarImagen(i.id);
    else await copiarTexto(i.text);
  } catch (e) {
    console.error(e);
    return showToast(i.kind === "image" ? "No se pudo copiar la imagen" : "No se pudo copiar");
  }
  S.activo = id;
  S.items = S.items.map((x) => (x.id === id ? { ...x, used: ahora(), uses: x.uses + 1 } : x));
  commit();
  S.copiado = id;
  renderList();
  clearTimeout(copiadoTimer);
  copiadoTimer = window.setTimeout(() => {
    S.copiado = null;
    renderList();
  }, 1600);
}

// ---------- Guardado automático de lo copiado ----------
/** Guarda lo que haya copiado si todavía no está en la colección. */
async function guardarCopiado() {
  let c: Lectura;
  try {
    c = await leerPortapapeles();
  } catch (e) {
    console.error(e);
    return;
  }
  const previo = S.activo;
  const marcar = (id: string | null) => {
    S.activo = id;
    if (id !== previo) {
      renderList();
      sincronizarMenu();
    }
  };
  if (c.kind === "vacio") return marcar(null);
  const clave = claveCaptura(c);
  const existente = c.kind === "texto"
    ? S.items.find((i) => i.kind === "text" && i.text === c.text)
    : S.items.find((i) => i.image?.hash === c.hash);
  if (existente) return marcar(existente.id);
  if (clave === S.descartado) return marcar(null);
  const id = newId();
  S.activo = id;
  const base = { id, title: "", text: "", tags: [], pinned: false, created: ahora(), used: null, uses: 0 };
  try {
    if (c.kind === "texto") agregar([{ ...base, kind: "text", text: c.text }]);
    else {
      await guardarPendiente(id);
      agregar([{ ...base, kind: "image", image: { w: c.w, h: c.h, size: c.size, hash: c.hash } }]);
    }
  } catch (e) {
    console.error(e);
    return showToast("No se pudo guardar lo copiado");
  }
  showToast(c.kind === "texto" ? "Guardado lo copiado" : "Guardada la imagen copiada", "Deshacer", () => {
    // Deshacer lo saca y evita que se vuelva a guardar mientras siga copiado.
    S.descartado = clave;
    if (S.activo === id) S.activo = null;
    S.items = S.items.filter((i) => i.id !== id);
    commit();
    renderList();
  });
}

/** Límites de lo guardado; los favoritos no cuentan y nunca se borran. */
const LIMITE = { text: 1000, image: 50 };

/** Borra los textos e imágenes más viejos (por último uso) que pasen del límite. */
function podar(items: Item[]): Item[] {
  const sobran = new Set<string>();
  for (const kind of ["text", "image"] as const) {
    items
      .filter((i) => i.kind === kind && !i.pinned)
      .sort((a, b) => ultimoUso(b).localeCompare(ultimoUso(a)))
      .slice(LIMITE[kind])
      .forEach((i) => sobran.add(i.id));
  }
  // Las imágenes borradas se eliminan del disco al reiniciar la app.
  return sobran.size ? items.filter((i) => !sobran.has(i.id)) : items;
}

function agregar(nuevos: Item[]) {
  S.items = podar([...nuevos, ...S.items]);
  commit();
  S.filtro = S.filtro === "fav" ? "todo" : S.filtro;
  S.flash = nuevos.map((i) => i.id);
  renderList();
  content.scrollTop = 0;
  clearTimeout(flashTimer);
  flashTimer = window.setTimeout(() => {
    S.flash = [];
    content.querySelectorAll(".row.flash").forEach((r) => r.classList.remove("flash"));
  }, 1800);
}

async function agregarImagenes(paths: string[]) {
  const nuevos: Item[] = [];
  for (const path of paths) {
    const id = newId();
    try {
      const image = await importarImagen(path, id);
      if (S.items.some((i) => i.image?.hash === image.hash)) continue;
      nuevos.push({ id, kind: "image", title: path.split("/").pop()!.replace(/\.[^.]+$/, ""), text: "", image, tags: [],
        pinned: false, created: ahora(), used: null, uses: 0 });
    } catch (e) {
      console.error(e);
      showToast("Alguno de los archivos no es una imagen");
    }
  }
  if (nuevos.length) {
    agregar(nuevos);
    showToast(nuevos.length > 1 ? `${nuevos.length} imágenes guardadas` : "Imagen guardada");
  }
}

// ---------- Panel ----------
function openEdit(id: string) {
  const i = S.items.find((x) => x.id === id);
  if (!i) return;
  Object.assign(S, { panel: "form", confirm: false, form: { id, kind: i.kind, title: i.title, text: i.text, tags: i.tags.join(", ") } });
  renderPanel();
}

function close() {
  Object.assign(S, { panel: null, form: null, confirm: false });
  renderPanel();
}

function renderPanel() {
  const f = S.form;
  if (!S.panel || !f) {
    panelRoot.innerHTML = "";
    return;
  }
  const item = S.items.find((i) => i.id === f.id);
  const contenido = f.kind === "image" && item
    ? `<div class="field">
        <span class="lbl">Imagen</span>
        <div class="img-grande"><img src="${esc(imgUrl(item.id))}" alt=""></div>
        ${item.image ? `<span class="hint tab">${item.image.w}×${item.image.h} · ${fmtSize(item.image.size)}</span>` : ""}
      </div>`
    : `<div class="field">
        <label class="lbl" for="f-text">Contenido</label>
        <textarea id="f-text" class="textarea mono" rows="9" placeholder="Pegá o escribí el texto…">${esc(f.text)}</textarea>
        <span id="f-err" class="errmsg" hidden>Escribí el contenido.</span>
      </div>`;
  const footer = S.confirm
    ? `<div class="panel-f confirm">
        <span class="confirm-q">¿Eliminar?</span>
        <div class="btns">
          <button class="btn btn-plain" data-act="cancel-delete">Cancelar</button>
          <button class="btn btn-red" data-act="delete">Eliminar</button>
        </div>
      </div>`
    : `<div class="panel-f">
        <button class="btn btn-danger" data-act="ask-delete">${ICON.trash}Eliminar</button>
        <div class="btns">
          <button class="btn btn-secondary" data-act="copy">${ICON.copy}Copiar</button>
          <button class="btn btn-primary" data-act="save">Guardar</button>
        </div>
      </div>`;
  panelRoot.innerHTML = `<div class="scrim" data-act="close"></div>
    <aside class="panel">
      <div class="panel-h">
        <h2>${f.kind === "image" ? "Imagen" : "Texto"}</h2>
        <button class="icon-btn" data-act="close" aria-label="Cerrar">${ICON.x}</button>
      </div>
      <div class="panel-b">
        <div class="field">
          <div class="lbl-row"><label class="lbl" for="f-title">Título</label><span class="opt">Opcional</span></div>
          <input id="f-title" class="input" value="${esc(f.title)}" placeholder="${f.kind === "image" ? "Ej. Logo de la empresa" : "Ej. CBU cuenta sueldo"}" autocomplete="off" />
        </div>
        ${contenido}
        <div class="field">
          <div class="lbl-row"><label class="lbl" for="f-tags">Etiquetas</label><span class="opt">Separadas por coma</span></div>
          <input id="f-tags" class="input" value="${esc(f.tags)}" placeholder="banco, trabajo" autocomplete="off" spellcheck="false" />
        </div>
        ${item ? `<span class="hint">Guardado ${esc(haceCuanto(item.created))}${item.uses ? ` · copiado ${item.uses} ${item.uses === 1 ? "vez" : "veces"}` : ""}</span>` : ""}
      </div>
      ${footer}
    </aside>`;
  const bind = (sel: string, k: "title" | "text" | "tags") =>
    panelRoot.querySelector<HTMLInputElement>(sel)?.addEventListener("input", (e) => (f[k] = (e.target as HTMLInputElement).value));
  bind("#f-title", "title");
  bind("#f-text", "text");
  bind("#f-tags", "tags");
}

function saveForm() {
  const f = S.form;
  if (!f) return;
  if (f.kind === "text" && !f.text.trim()) {
    $("#f-err", panelRoot).hidden = false;
    return panelRoot.querySelector<HTMLTextAreaElement>("#f-text")?.focus();
  }
  const datos = { title: f.title.trim(), tags: parseTags(f.tags), ...(f.kind === "text" ? { text: f.text } : {}) };
  S.items = S.items.map((i) => (i.id === f.id ? { ...i, ...datos } : i));
  commit();
  close();
  renderList();
}

function del() {
  const f = S.form;
  const i = f && S.items.find((x) => x.id === f.id);
  if (!i) return;
  const idx = S.items.indexOf(i);
  S.items = S.items.filter((x) => x !== i);
  commit();
  close();
  renderList();
  // La imagen en disco se borra recién al reiniciar la app, así «Deshacer» la recupera.
  showToast("Eliminado", "Deshacer", () => {
    S.items = [...S.items.slice(0, idx), i, ...S.items.slice(idx)];
    commit();
    renderList();
  });
}

panelRoot.addEventListener("click", (e) => {
  const act = (e.target as HTMLElement).closest<HTMLElement>("[data-act]")?.dataset.act;
  switch (act) {
    case "close": return close();
    case "save": return saveForm();
    case "copy": {
      const id = S.form?.id;
      close();
      return id && copiar(id);
    }
    case "ask-delete": S.confirm = true; return renderPanel();
    case "cancel-delete": S.confirm = false; return renderPanel();
    case "delete": return del();
  }
});

// ---------- Toast ----------
function showToast(text: string, label?: string, fn?: () => void) {
  S.toast = { text, label, fn };
  renderToast();
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    S.toast = null;
    renderToast();
  }, 4000);
}

function renderToast() {
  const t = S.toast;
  toastRoot.innerHTML = t
    ? `<div class="toast${t.label ? "" : " solo"}" role="status">${esc(t.text)}${t.label ? `<button data-toast>${esc(t.label)}</button>` : ""}</div>`
    : "";
}
toastRoot.addEventListener("click", (e) => {
  if (!(e.target as HTMLElement).closest("[data-toast]")) return;
  const fn = S.toast?.fn;
  S.toast = null;
  clearTimeout(toastTimer);
  renderToast();
  fn?.();
});

// ---------- Barra superior ----------
$("#theme").addEventListener("click", () => {
  S.theme = S.theme === "oscuro" ? "claro" : "oscuro";
  S.themeStored = true;
  try { localStorage.setItem("clipboard-theme", S.theme); } catch {}
  renderTheme();
  commit();
});

searchInput.addEventListener("input", () => {
  S.query = searchInput.value;
  renderSearch();
  renderList();
});
searchInput.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    e.stopPropagation();
    S.query = "";
    renderSearch();
    renderList();
    searchInput.blur();
  } else if (e.key === "Enter") {
    // Enter copia el primer resultado.
    const primero = content.querySelector<HTMLElement>(".row");
    if (primero) copiar(primero.dataset.id!);
  }
});
$("#search-clear").addEventListener("click", (e) => {
  e.preventDefault();
  S.query = "";
  renderSearch();
  renderList();
  searchInput.focus();
});

if (isTauri) {
  import("@tauri-apps/api/window").then(({ getCurrentWindow }) => {
    const w = getCurrentWindow();
    $("#win-min").addEventListener("click", () => w.minimize());
    $("#win-close").addEventListener("click", () => w.close());
    // Cada vez que la ventana toma el foco, mira qué hay copiado.
    w.onFocusChanged(({ payload: foco }) => {
      if (foco) guardarCopiado();
    });
  });
  // Copiado desde el menú de la barra superior: se registra el uso.
  import("@tauri-apps/api/event").then(({ listen }) =>
    listen<string>("copiado-menu", ({ payload: id }) => {
      S.activo = id;
      S.items = S.items.map((x) => (x.id === id ? { ...x, used: ahora(), uses: x.uses + 1 } : x));
      commit();
      renderList();
    }));
  // Arrastrar imágenes a la ventana las guarda.
  import("@tauri-apps/api/webview").then(({ getCurrentWebview }) =>
    getCurrentWebview().onDragDropEvent(({ payload: p }) => {
      if (p.type === "drop" && p.paths.length) agregarImagenes(p.paths);
    }));
} else {
  $(".winctl").style.display = "none";
  window.addEventListener("focus", () => guardarCopiado());
}

// ---------- Atajos ----------
window.addEventListener("keydown", (e) => {
  const mod = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();
  if (mod && k === "k") {
    e.preventDefault();
    searchInput.focus();
    searchInput.select();
  } else if (mod && k === "enter" && S.panel) {
    e.preventDefault();
    saveForm();
  } else if (k === "escape") {
    if (S.confirm) {
      S.confirm = false;
      renderPanel();
    } else if (S.panel) close();
  }
});

// ---------- Inicio ----------
async function init() {
  const pre = document.documentElement.dataset.theme;
  S.theme = pre === "oscuro" ? "oscuro" : "claro";
  renderTheme();
  try {
    await prepararRutas();
    const d = await load();
    S.items = Array.isArray(d.items) ? d.items : [];
    if (d.theme === "claro" || d.theme === "oscuro") {
      S.theme = d.theme;
      S.themeStored = true;
      try { localStorage.setItem("clipboard-theme", d.theme); } catch {}
      renderTheme();
    }
  } catch (e) {
    console.error("No se pudo cargar", e);
  }
  renderSearch();
  renderList();
  sincronizarMenu();
  if (document.hasFocus()) guardarCopiado();
}

init();
