//! Lectura y escritura del portapapeles con GTK.
//!
//! En GNOME con Wayland solo la ventana con foco puede leer el portapapeles, y GTK lo hace de forma
//! nativa. Los comandos son síncronos: Tauri los ejecuta en el hilo principal, que es el de GTK.

use crate::{dir_datos, dir_imagenes, id_valido, Imagen};
use serde::Serialize;
use std::fs;
use tauri::AppHandle;

#[cfg(target_os = "linux")]
use gtk::gdk_pixbuf::Pixbuf;

const PENDIENTE: &str = "pendiente.png";

/// Lo que hay copiado ahora.
#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Lectura {
    Vacio,
    Texto { text: String },
    /// La imagen queda en `pendiente.png` hasta que se guarde.
    Imagen { w: u32, h: u32, size: u64, hash: String },
}

/// FNV-1a de 64 bits: huella estable de los píxeles.
fn huella(bytes: &[u8]) -> String {
    let mut h: u64 = 0xcbf29ce484222325;
    for b in bytes {
        h ^= *b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    format!("{h:016x}")
}

#[cfg(target_os = "linux")]
fn clipboard() -> gtk::Clipboard {
    gtk::Clipboard::get(&gtk::gdk::SELECTION_CLIPBOARD)
}

#[cfg(target_os = "linux")]
fn guardar_png(pb: &Pixbuf, ruta: &std::path::Path) -> Result<Imagen, String> {
    pb.savev(ruta, "png", &[]).map_err(|e| e.to_string())?;
    let size = fs::metadata(ruta).map_err(|e| e.to_string())?.len();
    Ok(Imagen {
        w: pb.width() as u32,
        h: pb.height() as u32,
        size,
        hash: huella(&pb.read_pixel_bytes()),
    })
}

#[tauri::command]
pub fn leer_portapapeles(app: AppHandle) -> Result<Lectura, String> {
    let r = leer(app);
    // CLIPBOARD_DEBUG=1 muestra qué se leyó (tipo y tamaño, nunca el contenido).
    if std::env::var_os("CLIPBOARD_DEBUG").is_some() {
        match &r {
            Ok(Lectura::Vacio) => eprintln!("[portapapeles] vacío"),
            Ok(Lectura::Texto { text }) => eprintln!("[portapapeles] texto de {} caracteres", text.chars().count()),
            Ok(Lectura::Imagen { w, h, .. }) => eprintln!("[portapapeles] imagen {w}x{h}"),
            Err(e) => eprintln!("[portapapeles] error: {e}"),
        }
    }
    r
}

fn leer(app: AppHandle) -> Result<Lectura, String> {
    #[cfg(target_os = "linux")]
    {
        let cb = clipboard();
        // Primero texto: muchas apps copian además una imagen del texto seleccionado.
        if let Some(t) = cb.wait_for_text() {
            if !t.trim().is_empty() {
                return Ok(Lectura::Texto { text: t.to_string() });
            }
        }
        if let Some(pb) = cb.wait_for_image() {
            let i = guardar_png(&pb, &dir_datos(&app)?.join(PENDIENTE))?;
            return Ok(Lectura::Imagen { w: i.w, h: i.h, size: i.size, hash: i.hash });
        }
        Ok(Lectura::Vacio)
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = app;
        Err("Solo disponible en Linux".into())
    }
}

/// Mueve la imagen leída del portapapeles a la colección.
#[tauri::command]
pub fn guardar_pendiente(app: AppHandle, id: String) -> Result<(), String> {
    if !id_valido(&id) {
        return Err("Id inválido".into());
    }
    let origen = dir_datos(&app)?.join(PENDIENTE);
    fs::rename(&origen, dir_imagenes(&app)?.join(format!("{id}.png"))).map_err(|e| e.to_string())
}

/// Agrega una imagen desde un archivo (selector o arrastrar y soltar). Se guarda como PNG.
#[tauri::command]
pub fn importar_imagen(app: AppHandle, path: String, id: String) -> Result<Imagen, String> {
    if !id_valido(&id) {
        return Err("Id inválido".into());
    }
    #[cfg(target_os = "linux")]
    {
        let pb = Pixbuf::from_file(&path).map_err(|_| "No es una imagen que se pueda abrir.".to_string())?;
        guardar_png(&pb, &dir_imagenes(&app)?.join(format!("{id}.png")))
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (app, path);
        Err("Solo disponible en Linux".into())
    }
}

#[tauri::command]
pub fn copiar_texto(text: String) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        clipboard().set_text(&text);
        Ok(())
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = text;
        Err("Solo disponible en Linux".into())
    }
}

#[tauri::command]
pub fn copiar_imagen(app: AppHandle, id: String) -> Result<(), String> {
    if !id_valido(&id) {
        return Err("Id inválido".into());
    }
    #[cfg(target_os = "linux")]
    {
        let ruta = dir_imagenes(&app)?.join(format!("{id}.png"));
        let pb = Pixbuf::from_file(&ruta).map_err(|_| "La imagen ya no existe.".to_string())?;
        clipboard().set_image(&pb);
        Ok(())
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = app;
        Err("Solo disponible en Linux".into())
    }
}

#[cfg(test)]
mod tests {
    use super::huella;

    #[test]
    fn huella_estable() {
        assert_eq!(huella(b""), "cbf29ce484222325");
        assert_ne!(huella(b"a"), huella(b"b"));
    }
}
