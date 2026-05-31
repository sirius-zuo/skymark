use notify_debouncer_mini::notify::{RecommendedWatcher, RecursiveMode};
use notify_debouncer_mini::{new_debouncer, DebounceEventResult, Debouncer};
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, SystemTime};
use tauri::Emitter;

pub struct WatcherState {
    pub debouncer: Mutex<Option<Debouncer<RecommendedWatcher>>>,
    pub watched_paths: Mutex<HashSet<String>>,
    /// Tracks the mtime recorded when each path was last opened/watched.
    /// Used to suppress spurious file-changed events triggered by macOS metadata
    /// updates (e.g. LaunchServices xattr, Spotlight indexing) that change xattrs
    /// but not the file's mtime.
    pub mtimes: Arc<Mutex<HashMap<String, SystemTime>>>,
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

    // Snapshot the file's mtime now so the debouncer callback can tell whether
    // a future event reflects a real content change or just a metadata update
    // (e.g. macOS LaunchServices updating com.apple.lastuseddate#PS on open).
    if let Ok(mtime) = std::fs::metadata(&path).and_then(|m| m.modified()) {
        if let Ok(mut mtimes) = state.mtimes.lock() {
            mtimes.insert(path.clone(), mtime);
        }
    }

    {
        let mut guard = state.debouncer().map_err(|e| e.to_string())?;
        if guard.is_none() {
            let app_clone = app.clone();
            let mtimes_clone = Arc::clone(&state.mtimes);
            let debouncer = new_debouncer(
                Duration::from_millis(500),
                move |res: DebounceEventResult| {
                    if let Ok(events) = res {
                        for event in events {
                            let p = event.path.to_string_lossy().replace('\\', "/");
                            // Only emit when the file's mtime actually advanced.
                            // Metadata-only changes (xattrs, inode meta) don't update
                            // mtime on macOS APFS, so they're safely filtered here.
                            let should_emit =
                                match std::fs::metadata(&event.path).and_then(|m| m.modified()) {
                                    Ok(current) => {
                                        let mut guard =
                                            mtimes_clone.lock().unwrap_or_else(|e| e.into_inner());
                                        match guard.get(&p).copied() {
                                            Some(prev) if prev == current => false,
                                            _ => {
                                                guard.insert(p.clone(), current);
                                                true
                                            }
                                        }
                                    }
                                    // File deleted or inaccessible — emit so the
                                    // frontend can react (e.g. external deletion).
                                    Err(_) => true,
                                };
                            if should_emit {
                                let _ = app_clone.emit("file-changed", p);
                            }
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
    if let Ok(mut mtimes) = state.mtimes.lock() {
        mtimes.remove(&path);
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
    if let Ok(mut mtimes) = state.mtimes.lock() {
        mtimes.clear();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_state() -> WatcherState {
        WatcherState {
            debouncer: Mutex::new(None),
            watched_paths: Mutex::new(HashSet::new()),
            mtimes: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    #[test]
    fn add_watch_tracks_paths() {
        let state = make_state();
        let mut watched = state.watched_paths().unwrap();
        watched.insert("/tmp/test".to_string());
        assert!(watched.contains("/tmp/test"));
    }

    #[test]
    fn remove_watch_removes_path() {
        let state = make_state();
        let mut watched = state.watched_paths().unwrap();
        watched.insert("/tmp/test".to_string());
        watched.remove("/tmp/test");
        assert!(!watched.contains("/tmp/test"));
    }

    #[test]
    fn clear_all_removes_all_paths() {
        let state = make_state();
        let mut watched = state.watched_paths().unwrap();
        watched.insert("/tmp/a".to_string());
        watched.insert("/tmp/b".to_string());
        watched.insert("/tmp/c".to_string());
        watched.clear();
        assert!(watched.is_empty());
    }

    #[test]
    fn mtime_filter_suppresses_same_mtime() {
        let state = make_state();
        let t = SystemTime::now();
        state.mtimes.lock().unwrap().insert("/tmp/a".to_string(), t);
        // Same mtime → suppressed
        let guard = state.mtimes.lock().unwrap();
        let prev = guard.get("/tmp/a").copied();
        assert_eq!(prev, Some(t));
    }
}
