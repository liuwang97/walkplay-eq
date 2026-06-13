//! Walkplay DAC EQ — backend "daemon" layer.
//!
//! Single process, two logical layers:
//!  - Rust core (this crate): owns the one native HID handle, the system tray,
//!    autostart, single-instance.
//!  - React/shadcn WebView: the EQ editor window, hidden by default, shown from
//!    the tray.

mod firmware;
mod hid;

use std::sync::Mutex;

use hid::{ConnStatus, HidManager, HidState};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, State, WindowEvent,
};

/// Show & focus the main window, creating nothing (it always exists, hidden).
fn show_main_window(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
}

/// Hide the main window (keeps the process alive in the tray).
fn hide_main_window(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.hide();
    }
}

/// Human label for a connection status.
fn status_label(status: ConnStatus) -> &'static str {
    match status {
        ConnStatus::Disconnected => "Disconnected",
        ConnStatus::Connecting => "Connecting...",
        ConnStatus::Connected => "Connected",
        ConnStatus::Busy => "Busy",
    }
}

/// Update the tray tooltip + title to reflect the current connection status.
fn refresh_tray_status(app: &AppHandle, status: ConnStatus) {
    let text = format!("Walkplay EQ - {}", status_label(status));
    if let Some(tray) = app.tray_by_id("main-tray") {
        let _ = tray.set_tooltip(Some(&text));
        // Title is shown on macOS menu bar; harmless elsewhere.
        let _ = tray.set_title(Some(status_label(status)));
    }
}

/// Command the UI can call to push a new status to the tray (e.g. after connect).
#[tauri::command]
fn set_tray_status(app: AppHandle, state: State<'_, HidState>, status: ConnStatus) {
    if let Ok(mut mgr) = state.lock() {
        mgr.status = status;
    }
    refresh_tray_status(&app, status);
}

/// Build the tray menu. "Quick EQ" is a placeholder submenu later agents fill.
fn build_tray_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let show = MenuItem::with_id(app, "show", "Show Window", true, None::<&str>)?;
    let hide = MenuItem::with_id(app, "hide", "Hide Window", true, None::<&str>)?;

    let quick_placeholder =
        MenuItem::with_id(app, "quick_eq_placeholder", "(presets)", false, None::<&str>)?;
    let quick_eq =
        Submenu::with_id_and_items(app, "quick_eq", "Quick EQ", true, &[&quick_placeholder])?;

    let sep = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;

    Menu::with_items(app, &[&show, &hide, &quick_eq, &sep, &quit])
}

/// Handle a tray menu click.
fn on_menu_event(app: &AppHandle, id: &str) {
    match id {
        "show" => show_main_window(app),
        "hide" => hide_main_window(app),
        "quit" => app.exit(0),
        _ => { /* quick_eq placeholders - filled by EQ/PRESETS agents */ }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Single instance must be the FIRST plugin registered.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            show_main_window(app);
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![]),
        ))
        .manage::<HidState>(Mutex::new(HidManager::default()))
        .setup(|app| {
            let handle = app.handle();

            // Tray with menu + status tooltip.
            let menu = build_tray_menu(handle)?;
            let _tray = TrayIconBuilder::with_id("main-tray")
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Walkplay EQ - Disconnected")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| on_menu_event(app, event.id.as_ref()))
                .on_tray_icon_event(|tray, event| {
                    // Left click toggles the window.
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(win) = app.get_webview_window("main") {
                            if win.is_visible().unwrap_or(false) {
                                let _ = win.hide();
                            } else {
                                show_main_window(app);
                            }
                        }
                    }
                })
                .build(handle)?;

            // Start hidden - the app lives in the tray.
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.hide();
            }

            Ok(())
        })
        // Closing the window hides it instead of quitting (tray keeps running).
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            set_tray_status,
            hid::hid_connect,
            hid::hid_disconnect,
            hid::hid_read_eq,
            hid::hid_write_band,
            hid::hid_write_preamp,
            hid::hid_factory_reset,
            hid::hid_list_devices,
            firmware::fw_check,
            firmware::fw_upgrade,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
