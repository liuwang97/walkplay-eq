//! Walkplay DAC EQ — backend.
//!
//! One process, two layers:
//!  - This Rust core is the resident part: it owns the HID handle, the system
//!    tray, autostart and single-instance, and keeps the device's EQ alive.
//!  - The React WebView is only the editor. It does not exist until the user
//!    opens it (tray click or launching the app a second time) and is destroyed
//!    again on close, so an idle app holds no browser engine in memory.

mod hid;
mod tray;

use std::sync::Mutex;
use std::time::Duration;

use hid::{ConnStatus, DeviceInfo, HidManager, HidState};
use serde::Serialize;
use tauri::{webview::PageLoadEvent, AppHandle, Manager, RunEvent, WebviewWindowBuilder};

const MAIN_WINDOW: &str = "main";

/// What a freshly created window needs to catch up with the backend, which may
/// have connected, replayed or switched presets while no window existed.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Snapshot {
    status: ConnStatus,
    device: Option<DeviceInfo>,
    /// A preset picked from the tray that no window has adopted yet.
    pending_preset: Option<String>,
    autostart: bool,
}

#[tauri::command]
async fn snapshot(app: AppHandle) -> Snapshot {
    let (status, device) = hid::connection(&app);
    Snapshot {
        status,
        device,
        pending_preset: tray::pending_preset(&app),
        autostart: tray::autostart_enabled(&app),
    }
}

/// Show the editor window, creating it first if it does not exist.
///
/// The window is configured hidden and revealed once its page has loaded, so it
/// appears fully drawn instead of flashing an empty frame.
pub(crate) fn show_main_window(app: &AppHandle) {
    if let Some(win) = app.get_webview_window(MAIN_WINDOW) {
        let _ = win.unminimize();
        let _ = win.show();
        let _ = win.set_focus();
        return;
    }
    // Build on a separate thread: creating a WebView from inside an event
    // handler (tray click, single-instance callback) can deadlock on Windows.
    let app = app.clone();
    std::thread::spawn(move || {
        let Some(cfg) = app
            .config()
            .app
            .windows
            .iter()
            .find(|w| w.label == MAIN_WINDOW)
            .cloned()
        else {
            return;
        };
        // Fails harmlessly if a second click raced us to create the window.
        let _ = WebviewWindowBuilder::from_config(&app, &cfg).and_then(|builder| {
            builder
                .on_page_load(|win, payload| {
                    if matches!(payload.event(), PageLoadEvent::Finished) {
                        let _ = win.show();
                        let _ = win.set_focus();
                    }
                })
                .build()
        });
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Single instance must be the FIRST plugin registered. Launching the
        // app again is how the user asks for the window.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            show_main_window(app);
        }))
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .setup(|app| {
            let handle = app.handle().clone();

            // Pick up where the last session left off: the tray's presets and
            // language, and the EQ program to replay on the first connect.
            let saved = tray::load(&handle);
            app.manage::<HidState>(Mutex::new(HidManager::with_program(
                saved.program.clone(),
            )));
            tray::manage(&handle, saved);
            tray::default_autostart(&handle);
            tray::init(&handle)?;

            // Background poller: auto-connect, hot-plug, and the debounced state
            // save. Runs for the life of the process, window or no window.
            std::thread::spawn(move || loop {
                hid::poll_tick(&handle);
                tray::flush(&handle);
                std::thread::sleep(Duration::from_secs(2));
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            snapshot,
            tray::tray_sync,
            tray::set_autostart,
            hid::hid_connect,
            hid::hid_disconnect,
            hid::hid_apply_program,
            hid::hid_send,
            hid::hid_query,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| match event {
            // Closing the last window (code == None) destroys its WebView but
            // must not quit: the app lives in the tray. Only the tray's "Quit"
            // (`app.exit(0)`, code == Some) is allowed through.
            RunEvent::ExitRequested {
                code: None, api, ..
            } => api.prevent_exit(),
            RunEvent::Exit => {
                // Do not lose a save the user asked for moments before quitting.
                hid::save_if_due(app, true);
                tray::flush(app);
            }
            _ => {}
        });
}
