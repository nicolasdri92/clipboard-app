# Clipboard

App de escritorio para Linux (Tauri v2 + TypeScript sin frameworks) que guarda lo que copiás —textos e
imágenes— para volver a copiarlo con un clic. Mismo estilo que [Notes](https://github.com/nicolasdri92/notes-app).

## Qué hace

- **Guarda solo lo que copiás**: al abrir o enfocar la ventana, lo que haya en el portapapeles se agrega
  a la colección (con «Deshacer» por si era algo que no querías guardar).
- **Clic para copiar**; el elemento que está en el portapapeles se marca «En el portapapeles».
- Favoritos, etiquetas, filtros (Todo / Textos / Imágenes / Favoritos) y búsqueda.
- Imágenes: también se pueden agregar arrastrando archivos a la ventana.
- **Menú en la barra superior** con favoritos y recientes para copiar sin abrir la ventana.
- Recibe las capturas que se copian desde [Screenshot](https://github.com/nicolasdri92/screenshot-app)
  (`clipboard-app --importar <archivo>`), sin abrir la ventana.
- Límites: 1000 textos y 50 imágenes (los favoritos no cuentan y nunca se borran).
- Corre en segundo plano, arranca con la sesión y abre una sola instancia.

### Limitación en Wayland

En GNOME con Wayland una app solo puede leer el portapapeles cuando su ventana tiene el foco. Por eso
Clipboard guarda lo copiado **al abrir o enfocar la ventana**: si copiás varias cosas sin mirarla, se
guarda la última. La lectura y escritura se hacen con GTK, de forma nativa.

## Requisitos (Ubuntu)

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

## Uso

```bash
npm install
npm run tauri dev                    # desarrollo
npm run tauri build -- --bundles deb # paquete en src-tauri/target/release/bundle/deb/
sudo apt install ./src-tauri/target/release/bundle/deb/Clipboard_0.1.0_amd64.deb
```

`CLIPBOARD_DEBUG=1` muestra en la consola el tipo y tamaño de lo leído del portapapeles (nunca el contenido).

## Datos

Todo queda en `~/.local/share/com.nicolasdri.clipboard/`: `clipboard.json` (textos, títulos, etiquetas,
favoritos) e `imagenes/` (un PNG por imagen). Los textos se guardan sin cifrar.

## Estructura

- `src/main.ts`: lista, guardado automático, panel de edición, menú rápido
- `src/store.ts`: persistencia y puente con Rust
- `src-tauri/src/lib.rs`: datos, bandeja y menú rápido, instancia única
- `src-tauri/src/portapapeles.rs`: lectura/escritura del portapapeles con GTK
