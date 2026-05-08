use notify_debouncer_mini::notify::{RecommendedWatcher, RecursiveMode};
use notify_debouncer_mini::{new_debouncer, Debouncer, DebounceEventResult};
use std::sync::Mutex;
use std::time::Duration;
use tauri::Emitter;

pub struct WatcherState {
    pub debouncer: Mutex<Option<Debouncer<RecommendedWatcher>>>,
}

#[tauri::command]
pub fn watch_paths(
    paths: Vec<String>,
    state: tauri::State<WatcherState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    *state.debouncer.lock().unwrap() = None;

    let app_clone = app.clone();
    let mut debouncer = new_debouncer(
        Duration::from_millis(500),
        move |res: DebounceEventResult| {
            if let Ok(events) = res {
                for event in events {
                    let path = event.path.to_string_lossy().replace('\\', "/");
                    let _ = app_clone.emit("file-changed", path);
                }
            }
        },
    )
    .map_err(|e| e.to_string())?;

    for path in &paths {
        debouncer
            .watcher()
            .watch(
                std::path::Path::new(path),
                RecursiveMode::NonRecursive,
            )
            .map_err(|e| e.to_string())?;
    }

    *state.debouncer.lock().unwrap() = Some(debouncer);
    Ok(())
}

#[tauri::command]
pub fn unwatch_paths(state: tauri::State<WatcherState>) -> Result<(), String> {
    *state.debouncer.lock().unwrap() = None;
    Ok(())
}
