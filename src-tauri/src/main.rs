#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod bridge;

use bridge::Pending;
use std::sync::Arc;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{Emitter, LogicalPosition, LogicalSize, Manager, State};

struct AppState {
    pending: Arc<Pending>,
}

/// UI -> backend: the user clicked Allow / Deny / (let Claude Code ask in the terminal).
#[tauri::command]
fn decide(state: State<AppState>, id: String, decision: String) -> bool {
    state.pending.resolve(&id, &decision)
}

/// UI -> backend: grow the window for the approval card, shrink it back to a pill.
#[tauri::command]
fn set_size(app: tauri::AppHandle, width: f64, height: f64) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.set_size(LogicalSize::new(width, height));
        place_top_center(&win, width);
    }
}

fn place_top_center(win: &tauri::WebviewWindow, width: f64) {
    if let Ok(Some(mon)) = win.current_monitor().or_else(|_| win.primary_monitor()) {
        let scale = mon.scale_factor();
        let mon_x = mon.position().x as f64 / scale;
        let mon_w = mon.size().width as f64 / scale;
        let mon_y = mon.position().y as f64 / scale;
        let _ = win.set_position(LogicalPosition::new(mon_x + (mon_w - width) / 2.0, mon_y + 6.0));
    }
}

fn main() {
    let pending = Arc::new(Pending::default());

    tauri::Builder::default()
        .manage(AppState { pending: pending.clone() })
        .invoke_handler(tauri::generate_handler![decide, set_size])
        .setup(move |app| {
            // Hook bridge: events from tuki-hook become UI events.
            let handle = app.handle().clone();
            if let Err(e) = bridge::serve(bridge::ADDR, pending.clone(), move |name, payload| {
                let _ = handle.emit(name, payload);
            }) {
                eprintln!("Tuki: could not listen on {} ({e}). Is another Tuki running?", bridge::ADDR);
            }

            // Window: small pill at the top center.
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.set_size(LogicalSize::new(220.0, 64.0));
                place_top_center(&win, 220.0);
                let _ = win.show();
            }

            // Tray icon with a Quit entry (the window has no taskbar button).
            let quit = MenuItem::with_id(app, "quit", "Quit Tuki", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&quit])?;
            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Tuki")
                .menu(&menu)
                .on_menu_event(|app, event| {
                    if event.id.as_ref() == "quit" {
                        app.exit(0);
                    }
                })
                .build(app)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Tuki");
}
