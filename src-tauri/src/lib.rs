mod portapapeles;

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::Mutex;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, State, WindowEvent};

const ARCHIVO: &str = "clipboard.json";
const IMAGENES: &str = "imagenes";

#[derive(Serialize, Deserialize, Clone)]
pub struct Imagen {
    pub w: u32,
    pub h: u32,
    pub size: u64,
    /// Huella de los píxeles, para no guardar dos veces la misma imagen.
    pub hash: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct Item {
    pub id: String,
    /// "text" | "image"
    pub kind: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub image: Option<Imagen>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub pinned: bool,
    /// Fechas ISO 8601.
    pub created: String,
    #[serde(default)]
    pub used: Option<String>,
    #[serde(default)]
    pub uses: u32,
}

#[derive(Serialize, Deserialize, Default)]
pub struct Datos {
    #[serde(default)]
    pub items: Vec<Item>,
    /// "claro" | "oscuro"; `None` = seguir al sistema.
    #[serde(default)]
    pub theme: Option<String>,
}

pub(crate) fn dir_datos(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

pub(crate) fn dir_imagenes(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = dir_datos(app)?.join(IMAGENES);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// Los ids los genera el frontend; se validan para que nunca salgan de la carpeta de imágenes.
pub(crate) fn id_valido(id: &str) -> bool {
    !id.is_empty() && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

/// Borra las imágenes que ya no usa ningún elemento.
fn limpiar_imagenes(dir: &Path, datos: &Datos) {
    let usados: HashSet<String> = datos
        .items
        .iter()
        .filter(|i| i.image.is_some())
        .map(|i| format!("{}.png", i.id))
        .collect();
    let Ok(entradas) = fs::read_dir(dir) else { return };
    for e in entradas.flatten() {
        if !usados.contains(e.file_name().to_string_lossy().as_ref()) {
            let _ = fs::remove_file(e.path());
        }
    }
}

#[tauri::command]
fn load_data(app: AppHandle) -> Result<Datos, String> {
    let p = dir_datos(&app)?.join(ARCHIVO);
    if !p.exists() {
        return Ok(Datos::default());
    }
    let texto = fs::read_to_string(&p).map_err(|e| e.to_string())?;
    match serde_json::from_str::<Datos>(&texto) {
        Ok(d) => {
            if let Ok(dir) = dir_imagenes(&app) {
                limpiar_imagenes(&dir, &d);
            }
            Ok(d)
        }
        Err(_) => {
            // Archivo dañado: se aparta en vez de pisarlo con la próxima escritura.
            let _ = fs::rename(&p, p.with_file_name("clipboard.danado.json"));
            Ok(Datos::default())
        }
    }
}

#[tauri::command]
fn save_data(app: AppHandle, data: Datos) -> Result<(), String> {
    let p = dir_datos(&app)?.join(ARCHIVO);
    let tmp = p.with_extension("json.tmp");
    let texto = serde_json::to_string_pretty(&data).map_err(|e| e.to_string())?;
    fs::write(&tmp, texto).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &p).map_err(|e| e.to_string())
}

fn mostrar_ventana(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

/// Elemento del menú rápido de la barra superior (lo arma el frontend).
#[derive(Deserialize, Clone)]
pub struct Entrada {
    id: String,
    label: String,
    /// "text" | "image"
    kind: String,
    #[serde(default)]
    text: String,
    /// Es lo que está ahora en el portapapeles.
    #[serde(default)]
    activo: bool,
}

/// Lo que se copia al elegir cada elemento del menú.
#[derive(Default)]
struct MenuRapido(Mutex<HashMap<String, Entrada>>);

fn armar_menu(app: &AppHandle, favoritos: &[Entrada], recientes: &[Entrada]) -> tauri::Result<Menu<tauri::Wry>> {
    let menu = Menu::new(app)?;
    let seccion = |titulo: &str, lista: &[Entrada], estrella: bool| -> tauri::Result<()> {
        if lista.is_empty() {
            return Ok(());
        }
        menu.append(&MenuItem::with_id(app, format!("h:{titulo}"), titulo, false, None::<&str>)?)?;
        for e in lista {
            let tipo = if e.kind == "image" { "🖼  " } else if estrella { "★  " } else { "" };
            let prefijo = if e.activo { format!("✓  {tipo}") } else { tipo.to_string() };
            // En los menús, «&» marca el atajo de teclado: se duplica para que se vea tal cual.
            let texto = format!("{prefijo}{}", e.label).replace('&', "&&");
            menu.append(&MenuItem::with_id(app, format!("c:{}", e.id), texto, true, None::<&str>)?)?;
        }
        menu.append(&PredefinedMenuItem::separator(app)?)?;
        Ok(())
    };
    seccion("Favoritos", favoritos, true)?;
    seccion("Recientes", recientes, false)?;
    menu.append(&MenuItem::with_id(app, "abrir", "Abrir Clipboard", true, None::<&str>)?)?;
    menu.append(&MenuItem::with_id(app, "salir", "Salir", true, None::<&str>)?)?;
    Ok(menu)
}

/// Rearma el menú de la barra superior con los favoritos y recientes actuales.
#[tauri::command]
fn actualizar_menu(
    app: AppHandle,
    estado: State<'_, MenuRapido>,
    favoritos: Vec<Entrada>,
    recientes: Vec<Entrada>,
) -> Result<(), String> {
    let menu = armar_menu(&app, &favoritos, &recientes).map_err(|e| e.to_string())?;
    if let Some(t) = app.tray_by_id("principal") {
        t.set_menu(Some(menu)).map_err(|e| e.to_string())?;
    }
    let mut m = estado.0.lock().unwrap();
    m.clear();
    for e in favoritos.into_iter().chain(recientes) {
        m.insert(e.id.clone(), e);
    }
    Ok(())
}

fn al_elegir(app: &AppHandle, id: &str) {
    match id {
        "abrir" => mostrar_ventana(app),
        "salir" => app.exit(0),
        _ => {
            let Some(item) = id.strip_prefix("c:") else { return };
            let Some(e) = app.state::<MenuRapido>().0.lock().unwrap().get(item).cloned() else { return };
            let r = if e.kind == "image" {
                portapapeles::copiar_imagen(app.clone(), e.id.clone())
            } else {
                portapapeles::copiar_texto(e.text.clone())
            };
            if std::env::var_os("CLIPBOARD_DEBUG").is_some() {
                eprintln!("[menu] copiar {} → {:?}", e.kind, r);
            }
            if r.is_ok() {
                // El frontend registra el uso (fecha y contador).
                let _ = app.emit("copiado-menu", &e.id);
            }
        }
    }
}

/// Ícono en la barra superior con el menú rápido; la app sigue corriendo (y sirviendo lo copiado)
/// aunque se cierre la ventana.
fn crear_bandeja(app: &tauri::App) -> tauri::Result<()> {
    let menu = armar_menu(app.handle(), &[], &[])?;
    let mut bandeja = TrayIconBuilder::with_id("principal")
        .tooltip("Clipboard")
        .menu(&menu)
        .on_menu_event(|app, e| al_elegir(app, e.id().as_ref()))
        .on_tray_icon_event(|tray, e| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = e {
                mostrar_ventana(tray.app_handle());
            }
        });
    if let Some(icono) = app.default_window_icon() {
        bandeja = bandeja.icon(icono.clone());
    }
    bandeja.build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Una sola instancia: abrirla de nuevo trae al frente la que ya está.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| mostrar_ventana(app)))
        .manage(MenuRapido::default())
        .setup(|app| {
            crear_bandeja(app)?;
            // Con --hidden (inicio automático) arranca solo en la barra superior.
            if !std::env::args().any(|a| a == "--hidden") {
                mostrar_ventana(app.handle());
            }
            Ok(())
        })
        // Cerrar la ventana la esconde; para salir del todo está «Salir» en la barra superior.
        .on_window_event(|w, e| {
            if let WindowEvent::CloseRequested { api, .. } = e {
                api.prevent_close();
                let _ = w.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            load_data,
            save_data,
            actualizar_menu,
            portapapeles::leer_portapapeles,
            portapapeles::guardar_pendiente,
            portapapeles::importar_imagen,
            portapapeles::copiar_texto,
            portapapeles::copiar_imagen
        ])
        .run(tauri::generate_context!())
        .expect("error al iniciar la aplicación");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_validos() {
        assert!(id_valido("3f2a-91"));
        assert!(!id_valido(""));
        assert!(!id_valido("../clipboard"));
    }

    #[test]
    fn limpiar_borra_solo_imagenes_sin_uso() {
        let dir = std::env::temp_dir().join(format!("clipboard-test-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("a.png"), b"x").unwrap();
        fs::write(dir.join("b.png"), b"x").unwrap();
        let datos = Datos {
            items: vec![Item {
                id: "a".into(),
                kind: "image".into(),
                title: String::new(),
                text: String::new(),
                image: Some(Imagen { w: 1, h: 1, size: 1, hash: "h".into() }),
                tags: vec![],
                pinned: false,
                created: "2026-10-13T00:00:00Z".into(),
                used: None,
                uses: 0,
            }],
            theme: None,
        };
        limpiar_imagenes(&dir, &datos);
        assert!(dir.join("a.png").exists());
        assert!(!dir.join("b.png").exists());
        fs::remove_dir_all(&dir).unwrap();
    }
}
