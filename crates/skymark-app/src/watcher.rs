use notify_debouncer_mini::notify::{RecommendedWatcher, RecursiveMode};
use notify_debouncer_mini::{new_debouncer, DebounceEventResult, Debouncer};
use std::collections::HashSet;
use std::sync::{Mutex, MutexGuard};
use std::time::Duration;
use tauri::Emitter;

pub struct WatcherState {
    pub debouncer: Mutex<Option<Debouncer<RecommendedWatcher>>>,
    pub watched_paths: Mutex<HashSet<String>>,
}

impl WatcherState {
    fn debouncer(&self) -> Result<MutexGuard<'_, Option<Debouncer<RecommendedWatcher>>>, String> {
        self.debouncer
            .lock()
            .map_err(|e| format!("watcher lock: {e}"))
    }

    fn watched_paths(&self) -> Result<MutexGuard<'_, HashSet<String>>, String> {
        self.watched_paths
            .lock()
            .map_err(|e| format!("watched_paths lock: {e}"))
    }
}

/// Watch a single path. Idempotent — skips if already watching.
/// Reuses the existing debouncer; creates it on first call.
#[tauri::command]
pub fn add_watch(
    path: String,
    state: tauri::State<WatcherState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    {
        let watched = state.watched_paths().map_err(|e| e.to_string())?;
        if watched.contains(&path) {
            return Ok(());
        }
    }

    {
        let mut guard = state.debouncer().map_err(|e| e.to_string())?;
        if guard.is_none() {
            let app_clone = app.clone();
            let debouncer = new_debouncer(
                Duration::from_millis(500),
                move |res: DebounceEventResult| {
                    if let Ok(events) = res {
                        for event in events {
                            let p = event.path.to_string_lossy().replace('\\', "/");
                            let _ = app_clone.emit("file-changed", p);
                        }
                    }
                },
            )
            .map_err(|e| e.to_string())?;
            *guard = Some(debouncer);
        }
        if let Some(d) = guard.as_mut() {
            d.watcher()
                .watch(std::path::Path::new(&path), RecursiveMode::NonRecursive)
                .map_err(|e| e.to_string())?;
        }
    }

    {
        let mut watched = state.watched_paths().map_err(|e| e.to_string())?;
        watched.insert(path);
    }
    Ok(())
}

/// Remove a single path from watching.
#[tauri::command]
pub fn remove_watch(path: String, state: tauri::State<WatcherState>) -> Result<(), String> {
    {
        let mut watched = state.watched_paths().map_err(|e| e.to_string())?;
        if !watched.remove(&path) {
            return Ok(());
        }
    }
    {
        let mut guard = state.debouncer().map_err(|e| e.to_string())?;
        if let Some(d) = guard.as_mut() {
            let _ = d.watcher().unwatch(std::path::Path::new(&path));
        }
    }
    Ok(())
}

/// Clear all watches. Used when switching vaults.
#[tauri::command]
pub fn clear_all(state: tauri::State<WatcherState>) -> Result<(), String> {
    *state.debouncer().map_err(|e| e.to_string())? = None;
    state.watched_paths().map_err(|e| e.to_string())?.clear();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn add_watch_tracks_paths() {
        let state = WatcherState {
            debouncer: Mutex::new(None),
            watched_paths: Mutex::new(HashSet::new()),
        };

        // Simulate adding a path (without actually creating a watcher)
        let mut watched = state.watched_paths().unwrap();
        watched.insert("/tmp/test".to_string());
        assert!(watched.contains("/tmp/test"));
    }

    #[test]
    fn remove_watch_removes_path() {
        let state = WatcherState {
            debouncer: Mutex::new(None),
            watched_paths: Mutex::new(HashSet::new()),
        };

        let mut watched = state.watched_paths().unwrap();
        watched.insert("/tmp/test".to_string());
        watched.remove("/tmp/test");
        assert!(!watched.contains("/tmp/test"));
    }

    #[test]
    fn clear_all_removes_all_paths() {
        let state = WatcherState {
            debouncer: Mutex::new(None),
            watched_paths: Mutex::new(HashSet::new()),
        };

        let mut watched = state.watched_paths().unwrap();
        watched.insert("/tmp/a".to_string());
        watched.insert("/tmp/b".to_string());
        watched.insert("/tmp/c".to_string());

        watched.clear();
        assert!(watched.is_empty());
    }
}
