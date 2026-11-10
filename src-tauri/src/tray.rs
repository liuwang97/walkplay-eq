//! System tray, plus the small state that has to outlive the WebView.
//!
//! The app starts with no window at all, so everything the tray needs — the
//! "Quick EQ" presets with their precomputed programs, the UI language, and the
//! program to replay on connect — is kept here and persisted to `state.json`.
//! The UI refreshes it through [`tray_sync`] whenever a window is open.

use std::path::PathBuf;
use std::sync::{Mutex, MutexGuard};

use serde::{Deserialize, Serialize};
use tauri::{
    menu::{CheckMenuItem, IsMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, Wry,
};
use tauri_plugin_autostart::ManagerExt;

use crate::hid::{self, ConnStatus, Program};

const TRAY_ID: &str = "main-tray";
/// Prefix of the dynamic "Quick EQ" menu ids; the rest is the preset id.
const QUICK_EQ_PREFIX: &str = "quick_eq::";

/// UI language, mirrored from the WebView so the tray speaks the same one.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Lang {
    #[default]
    Zh,
    En,
}

struct Labels {
    open: &'static str,
    quick_eq: &'static str,
    no_presets: &'static str,
    autostart: &'static str,
    quit: &'static str,
    connected: &'static str,
    disconnected: &'static str,
}

fn labels(lang: Lang) -> Labels {
    match lang {
        Lang::Zh => Labels {
            open: "打开 Walkplay EQ",
            quick_eq: "快速切换 EQ",
            no_presets: "（打开主窗口后可用）",
            autostart: "开机自启动",
            quit: "退出",
            connected: "已连接",
            disconnected: "未连接设备",
        },
        Lang::En => Labels {
            open: "Open Walkplay EQ",
            quick_eq: "Quick EQ",
            no_presets: "(open the window once)",
            autostart: "Launch at startup",
            quit: "Quit",
            connected: "Connected",
            disconnected: "No device",
        },
    }
}

/// A "Quick EQ" entry: its label and the full program that applies it, so the
/// tray can switch presets on the device with no WebView alive.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrayPreset {
    pub id: String,
    pub name: String,
    #[serde(flatten)]
    pub program: Program,
}

/// Everything persisted across restarts.
#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Saved {
    lang: Lang,
    presets: Vec<TrayPreset>,
    /// The program on the device; replayed on every (re)connect.
    pub program: Option<Program>,
    /// The preset `program` equals, if any — ticked in the "Quick EQ" menu.
    active_preset: Option<String>,
    /// A preset picked from the tray that no window has adopted yet.
    pending_preset: Option<String>,
    /// Whether launch-at-startup has been switched on by default once. After
    /// that the setting belongs to the user and is never forced again.
    autostart_decided: bool,
}

#[derive(Default)]
pub struct TrayData {
    saved: Saved,
    /// `saved` changed since the last [`flush`].
    dirty: bool,
}

pub type TrayState = Mutex<TrayData>;

fn lock(app: &AppHandle) -> MutexGuard<'_, TrayData> {
    app.state::<TrayState>()
        .inner()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
}

fn state_path(app: &AppHandle) -> Option<PathBuf> {
    Some(app.path().app_config_dir().ok()?.join("state.json"))
}

/// Read the persisted state (defaults when missing or unreadable).
pub fn load(app: &AppHandle) -> Saved {
    state_path(app)
        .and_then(|p| std::fs::read(p).ok())
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

pub fn manage(app: &AppHandle, saved: Saved) {
    app.manage::<TrayState>(Mutex::new(TrayData {
        saved,
        dirty: false,
    }));
}

/// Write the state to disk if it changed. Called from the poller tick (so a
/// slider drag does not hit the disk on every frame) and on exit.
pub fn flush(app: &AppHandle) {
    let json = {
        let mut data = lock(app);
        if !data.dirty {
            return;
        }
        data.dirty = false;
        serde_json::to_vec(&data.saved)
    };
    let (Ok(json), Some(path)) = (json, state_path(app)) else {
        return;
    };
    // Write-then-rename so a crash mid-write cannot leave a truncated file.
    let tmp = path.with_extension("json.tmp");
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    if std::fs::write(&tmp, json).is_ok() {
        let _ = std::fs::rename(&tmp, &path);
    }
}

/// Launch at startup is on by default: switch it on the first time the app
/// runs. Development builds never register themselves.
pub fn default_autostart(app: &AppHandle) {
    if cfg!(debug_assertions) {
        return;
    }
    let first_run = {
        let mut data = lock(app);
        let first_run = !data.saved.autostart_decided;
        data.saved.autostart_decided = true;
        data.dirty |= first_run;
        first_run
    };
    if first_run {
        let _ = app.autolaunch().enable();
    }
}

pub fn autostart_enabled(app: &AppHandle) -> bool {
    app.autolaunch().is_enabled().unwrap_or(false)
}

/// Turn launch-at-startup on or off; returns the state actually in effect.
#[tauri::command]
pub fn set_autostart(app: AppHandle, enabled: bool) -> bool {
    let auto = app.autolaunch();
    let _ = if enabled { auto.enable() } else { auto.disable() };
    refresh(&app);
    autostart_enabled(&app)
}

pub fn pending_preset(app: &AppHandle) -> Option<String> {
    lock(app).saved.pending_preset.clone()
}

/// Remember the program now on the device and which preset (if any) it is.
/// `from_tray` marks it as not yet reflected in any window's editor.
pub fn record_program(app: &AppHandle, program: &Program, preset: Option<String>, from_tray: bool) {
    let changed = {
        let mut data = lock(app);
        let saved = &mut data.saved;
        let changed = saved.active_preset != preset;
        saved.pending_preset = if from_tray { preset.clone() } else { None };
        saved.active_preset = preset;
        saved.program = Some(program.clone());
        data.dirty = true;
        changed
    };
    // A click also flips the native check mark, so always redraw after one.
    if changed || from_tray {
        refresh(app);
    }
}

/// The UI pushes its language and preset library (names already localized).
#[tauri::command]
pub fn tray_sync(app: AppHandle, lang: Lang, presets: Vec<TrayPreset>) {
    {
        let mut data = lock(&app);
        data.saved.lang = lang;
        data.saved.presets = presets;
        data.dirty = true;
    }
    refresh(&app);
}

/// Rebuild the tray menu + tooltip from the current state.
pub fn refresh(app: &AppHandle) {
    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        return;
    };
    // Snapshot under the locks, then build with none held: menu calls hop to
    // the main thread, which may itself be waiting on these locks.
    let (lang, presets, active) = {
        let data = lock(app);
        let s = &data.saved;
        let presets: Vec<(String, String)> = s
            .presets
            .iter()
            .map(|p| (p.id.clone(), p.name.clone()))
            .collect();
        (s.lang, presets, s.active_preset.clone())
    };
    let (status, device) = hid::connection(app);

    let l = labels(lang);
    let status_text = match (status, device) {
        (ConnStatus::Connected, Some(d)) => format!("{} · {}", l.connected, d.name),
        (ConnStatus::Connected, None) => l.connected.to_string(),
        (ConnStatus::Disconnected, _) => l.disconnected.to_string(),
    };
    let _ = tray.set_tooltip(Some(format!("Walkplay EQ · {status_text}")));
    if let Ok(menu) = build_menu(app, &l, &status_text, &presets, active.as_deref()) {
        let _ = tray.set_menu(Some(menu));
    }
}

fn build_menu(
    app: &AppHandle,
    l: &Labels,
    status_text: &str,
    presets: &[(String, String)],
    active: Option<&str>,
) -> tauri::Result<Menu<Wry>> {
    let status = MenuItem::with_id(app, "status", status_text, false, None::<&str>)?;
    let open = MenuItem::with_id(app, "open", l.open, true, None::<&str>)?;

    let quick_eq = if presets.is_empty() {
        let hint = MenuItem::with_id(app, "quick_eq_hint", l.no_presets, false, None::<&str>)?;
        Submenu::with_id_and_items(app, "quick_eq", l.quick_eq, true, &[&hint])?
    } else {
        let items = presets
            .iter()
            .map(|(id, name)| {
                let checked = active == Some(id.as_str());
                let menu_id = format!("{QUICK_EQ_PREFIX}{id}");
                CheckMenuItem::with_id(app, menu_id, name, true, checked, None::<&str>)
            })
            .collect::<tauri::Result<Vec<_>>>()?;
        let refs: Vec<&dyn IsMenuItem<Wry>> =
            items.iter().map(|i| i as &dyn IsMenuItem<Wry>).collect();
        Submenu::with_id_and_items(app, "quick_eq", l.quick_eq, true, &refs)?
    };

    let autostart_on = autostart_enabled(app);
    let autostart =
        CheckMenuItem::with_id(app, "autostart", l.autostart, true, autostart_on, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", l.quit, true, None::<&str>)?;

    Menu::with_items(
        app,
        &[
            &status,
            &PredefinedMenuItem::separator(app)?,
            &open,
            &quick_eq,
            &PredefinedMenuItem::separator(app)?,
            &autostart,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )
}

fn on_menu_event(app: &AppHandle, id: &str) {
    match id {
        "open" => crate::show_main_window(app),
        "quit" => app.exit(0),
        "autostart" => {
            set_autostart(app.clone(), !autostart_enabled(app));
        }
        other => {
            if let Some(preset_id) = other.strip_prefix(QUICK_EQ_PREFIX) {
                apply_preset(app, preset_id);
            }
        }
    }
}

/// Switch the device to a preset straight from the tray. Works with no window;
/// an open window is told too so its editor follows.
fn apply_preset(app: &AppHandle, preset_id: &str) {
    let program = lock(app)
        .saved
        .presets
        .iter()
        .find(|p| p.id == preset_id)
        .map(|p| p.program.clone());
    let Some(program) = program else {
        return;
    };
    record_program(app, &program, Some(preset_id.to_string()), true);
    let _ = hid::apply_program(app, program);
    let _ = app.emit("apply-preset", preset_id);
}

/// Create the tray icon. Left click opens the window; right click the menu.
pub fn init(app: &AppHandle) -> tauri::Result<()> {
    TrayIconBuilder::with_id(TRAY_ID)
        // Dedicated glyph (bolder bars, legible at 16px), embedded at compile time.
        .icon(tauri::include_image!("./icons/tray.png"))
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| on_menu_event(app, event.id.as_ref()))
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                crate::show_main_window(tray.app_handle());
            }
        })
        .build(app)?;
    refresh(app);
    Ok(())
}
