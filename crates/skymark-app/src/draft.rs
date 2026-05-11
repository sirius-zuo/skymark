use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Manager;

/// Global write lock for draft operations to prevent race conditions
/// between auto-save timer and explicit Cmd+S saves.
pub struct DraftState {
    pub write_lock: Mutex<()>,
}

pub type DraftKey = String;

#[derive(Debug, Serialize, Deserialize)]
pub struct DraftMeta {
    pub original_path: Option<String>,
    pub saved_at_unix: u64,
    pub source_mtime_unix: Option<u64>,
}

#[derive(Debug, Serialize, Clone)]
pub struct DraftInfo {
    pub draft_key: DraftKey,
    pub original_path: Option<String>,
    pub saved_at_unix: u64,
    /// True when the source file changed externally since the draft was saved.
    pub needs_resolution: bool,
}

/// FNV-1a 64-bit — deterministic, no external crate.
fn fnv1a(s: &str) -> String {
    const FNV_PRIME: u64 = 0x0000_0100_0000_01b3;
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in s.bytes() {
        h ^= b as u64;
        h = h.wrapping_mul(FNV_PRIME);
    }
    format!("{h:016x}")
}

fn validate_key(key: &str) -> Result<(), String> {
    if key.is_empty() || key.contains('/') || key.contains('\\') || key.contains("..") {
        return Err(format!("invalid draft key: {key:?}"));
    }
    Ok(())
}

fn atomic_write(tmp: &Path, target: &Path, content: &[u8]) -> Result<(), String> {
    std::fs::write(tmp, content).map_err(|e| format!("write {tmp:?}: {e}"))?;
    std::fs::rename(tmp, target).map_err(|e| format!("rename to {target:?}: {e}"))?;
    Ok(())
}

fn now_unix() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn file_mtime(path: &str) -> Option<u64> {
    std::fs::metadata(path)
        .ok()?
        .modified()
        .ok()?
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|d| d.as_secs())
}

// ── Path-based helpers (used by tests and the Tauri command wrappers) ─────────

/// Save a draft to `drafts_dir`. Returns the draft key.
pub fn save_draft_to_dir(
    drafts_dir: &Path,
    original_path: Option<&str>,
    content: &str,
) -> Result<DraftKey, String> {
    let key: DraftKey = match original_path {
        Some(p) => fnv1a(p),
        None => format!("unsaved_{}", now_unix()),
    };
    std::fs::create_dir_all(drafts_dir)
        .map_err(|e| format!("create drafts dir: {e}"))?;

    let meta = DraftMeta {
        original_path: original_path.map(String::from),
        saved_at_unix: now_unix(),
        source_mtime_unix: original_path.and_then(file_mtime),
    };
    let meta_json = serde_json::to_string(&meta).map_err(|e| format!("meta json: {e}"))?;

    atomic_write(
        &drafts_dir.join(format!(".{key}.meta.tmp")),
        &drafts_dir.join(format!("{key}.meta.json")),
        meta_json.as_bytes(),
    )?;
    atomic_write(
        &drafts_dir.join(format!(".{key}.draft.tmp")),
        &drafts_dir.join(format!("{key}.draft.md")),
        content.as_bytes(),
    )?;
    Ok(key)
}

pub fn load_draft_from_dir(drafts_dir: &Path, key: &str) -> Result<String, String> {
    validate_key(key)?;
    std::fs::read_to_string(drafts_dir.join(format!("{key}.draft.md")))
        .map_err(|e| format!("read draft {key}: {e}"))
}

pub fn discard_draft_from_dir(drafts_dir: &Path, key: &str) -> Result<(), String> {
    validate_key(key)?;
    for suffix in &[".draft.md", ".meta.json"] {
        let path = drafts_dir.join(format!("{key}{suffix}"));
        if path.exists() {
            std::fs::remove_file(&path).map_err(|e| format!("remove {suffix}: {e}"))?;
        }
    }
    Ok(())
}

pub fn list_drafts_in_dir(drafts_dir: &Path) -> Result<Vec<DraftInfo>, String> {
    if !drafts_dir.exists() {
        return Ok(vec![]);
    }
    let mut infos = Vec::new();
    for entry in std::fs::read_dir(drafts_dir).map_err(|e| format!("read dir: {e}"))? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if !name.ends_with(".meta.json") {
            continue;
        }
        let key = name.trim_end_matches(".meta.json").to_string();
        // Skip orphaned meta files (draft content missing).
        if !drafts_dir.join(format!("{key}.draft.md")).exists() {
            continue;
        }
        let bytes = std::fs::read(entry.path()).map_err(|e| e.to_string())?;
        let meta: DraftMeta = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
        let needs_resolution = meta.original_path.as_deref().map(|p| {
            let cur = file_mtime(p);
            matches!((meta.source_mtime_unix, cur), (Some(d), Some(c)) if d != c)
        }).unwrap_or(false);
        infos.push(DraftInfo {
            draft_key: key,
            original_path: meta.original_path,
            saved_at_unix: meta.saved_at_unix,
            needs_resolution,
        });
    }
    Ok(infos)
}

const GC_DAYS: u64 = 30;

pub fn gc_old_drafts_in_dir(drafts_dir: &Path) -> Result<(), String> {
    if !drafts_dir.exists() {
        return Ok(());
    }
    let cutoff = now_unix().saturating_sub(GC_DAYS * 24 * 60 * 60);
    for entry in std::fs::read_dir(drafts_dir).map_err(|e| format!("gc read dir: {e}"))? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if !name.ends_with(".meta.json") {
            continue;
        }
        let key = name.trim_end_matches(".meta.json").to_string();
        let Ok(bytes) = std::fs::read(entry.path()) else { continue };
        let Ok(meta) = serde_json::from_slice::<DraftMeta>(&bytes) else { continue };
        if meta.saved_at_unix >= cutoff {
            continue;
        }
        // Only GC when source file is unchanged or absent (gone = no longer relevant).
        let safe = meta.original_path.as_deref().map(|p| {
            let cur = file_mtime(p);
            !matches!((meta.source_mtime_unix, cur), (Some(d), Some(c)) if d != c)
        }).unwrap_or(true);
        if safe {
            let _ = discard_draft_from_dir(drafts_dir, &key);
        }
    }
    Ok(())
}

// ── Tauri command wrappers ─────────────────────────────────────────────────

fn app_drafts_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|d| d.join("drafts"))
        .map_err(|e| format!("app_data_dir: {e}"))
}

#[tauri::command]
pub fn save_draft(
    state: tauri::State<DraftState>,
    app: tauri::AppHandle,
    path: Option<String>,
    content: String,
) -> Result<DraftKey, String> {
    // Serialize draft writes to prevent race conditions with explicit saves
    let _lock = state.write_lock.lock().map_err(|e| format!("draft lock: {e}"))?;
    save_draft_to_dir(&app_drafts_dir(&app)?, path.as_deref(), &content)
}

#[tauri::command]
pub fn load_draft(app: tauri::AppHandle, draft_key: String) -> Result<String, String> {
    load_draft_from_dir(&app_drafts_dir(&app)?, &draft_key)
}

#[tauri::command]
pub fn list_drafts(app: tauri::AppHandle) -> Result<Vec<DraftInfo>, String> {
    list_drafts_in_dir(&app_drafts_dir(&app)?)
}

#[tauri::command]
pub fn discard_draft(app: tauri::AppHandle, draft_key: String) -> Result<(), String> {
    discard_draft_from_dir(&app_drafts_dir(&app)?, &draft_key)
}
