use serde::Serialize;
use std::path::PathBuf;

use crate::storage::Storage;

#[derive(Debug, Serialize)]
pub struct OpenedFile {
    pub path: String,
    pub content: String,
}

#[tauri::command]
pub fn render(text: String) -> Result<String, String> {
    skymark_core::render_html(&text).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn open_file(path: String) -> Result<OpenedFile, String> {
    let validated = validate_markdown_path(&path)?;
    let storage = crate::storage::StdStorage;
    let content = storage.read(&validated)?;
    Ok(OpenedFile {
        path: validated.to_string_lossy().into_owned(),
        content,
    })
}

#[tauri::command]
pub fn save_file(path: String, content: String) -> Result<(), String> {
    let validated = validate_markdown_path(&path)?;
    let storage = crate::storage::StdStorage;
    storage.write(&validated, content.as_bytes())
}

#[tauri::command]
pub fn export_file(path: String, content: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if !p.is_absolute() {
        return Err("path must be absolute".into());
    }
    match p.extension().and_then(|e| e.to_str()) {
        Some(ext) if ext.eq_ignore_ascii_case("html") => {}
        _ => return Err("only .html extension is supported for export".into()),
    }
    let storage = crate::storage::StdStorage;
    storage.write(&p, content.as_bytes())
}

// Path validation helper used by Tasks 8 and 9.
pub(crate) fn validate_markdown_path(path: &str) -> Result<PathBuf, String> {
    let p = PathBuf::from(path);
    if !p.is_absolute() {
        return Err("path must be absolute".into());
    }
    match p.extension().and_then(|e| e.to_str()) {
        Some(ext) if matches!(ext.to_ascii_lowercase().as_str(), "md" | "markdown" | "txt") => {
            Ok(p)
        }
        Some(other) => Err(format!("unsupported extension: {other}")),
        None => Err("path has no extension".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn render_command_round_trips_markdown_to_sanitized_html() {
        let html = render("# Title\n\n<script>alert(1)</script>".into()).unwrap();
        assert!(
            html.contains("Title</h1>") && html.contains("<h1 "),
            "got: {html}"
        );
        assert!(!html.contains("<script>"), "got: {html}");
    }

    #[test]
    fn validate_markdown_path_accepts_md() {
        assert!(validate_markdown_path("/tmp/x.md").is_ok());
        assert!(validate_markdown_path("/tmp/x.markdown").is_ok());
    }

    #[test]
    fn validate_markdown_path_rejects_other_extensions() {
        assert!(validate_markdown_path("/tmp/x.exe").is_err());
        assert!(validate_markdown_path("/tmp/x").is_err());
    }

    #[test]
    fn validate_markdown_path_accepts_txt() {
        assert!(validate_markdown_path("/tmp/x.txt").is_ok());
    }

    #[test]
    fn validate_markdown_path_rejects_relative_path() {
        assert!(validate_markdown_path("relative/x.md").is_err());
        assert!(validate_markdown_path("../../etc/passwd.md").is_err());
    }

    #[test]
    fn open_file_reads_existing_markdown() {
        use std::io::Write;
        let dir = std::env::temp_dir().join(format!("skymark-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("hello.md");
        std::fs::File::create(&path)
            .unwrap()
            .write_all(b"# hello\n")
            .unwrap();

        let opened = open_file(path.to_string_lossy().into_owned()).unwrap();
        assert_eq!(opened.path, path.to_string_lossy());
        assert_eq!(opened.content, "# hello\n");

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn open_file_rejects_non_markdown_extension() {
        let r = open_file("/tmp/foo.exe".into());
        assert!(r.is_err());
    }

    #[test]
    fn open_file_rejects_missing_file() {
        let r = open_file("/tmp/skymark-does-not-exist-xyz123.md".into());
        assert!(r.is_err());
    }

    #[test]
    fn save_file_writes_atomically() {
        let dir = std::env::temp_dir().join(format!("skymark-save-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("out.md");

        save_file(path.to_string_lossy().into_owned(), "# hello\n".into()).unwrap();

        let read_back = std::fs::read_to_string(&path).unwrap();
        assert_eq!(read_back, "# hello\n");

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn save_file_rejects_non_markdown_extension() {
        let r = save_file("/tmp/foo.exe".into(), "x".into());
        assert!(r.is_err());
    }

    #[test]
    fn draft_save_and_load_round_trip() {
        use crate::draft::{load_draft_from_dir, save_draft_to_dir};
        let dir = std::env::temp_dir().join(format!("skymark-draft-rtrip-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();

        let key = save_draft_to_dir(&dir, Some("/tmp/test.md"), "# hello draft\n").unwrap();
        let content = load_draft_from_dir(&dir, &key).unwrap();
        assert_eq!(content, "# hello draft\n");

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn draft_discard_removes_both_files() {
        use crate::draft::{discard_draft_from_dir, load_draft_from_dir, save_draft_to_dir};
        let dir =
            std::env::temp_dir().join(format!("skymark-draft-discard-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();

        let key = save_draft_to_dir(&dir, Some("/tmp/test.md"), "content").unwrap();
        discard_draft_from_dir(&dir, &key).unwrap();
        assert!(load_draft_from_dir(&dir, &key).is_err());

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn draft_invalid_key_rejected() {
        use crate::draft::load_draft_from_dir;
        let dir = std::env::temp_dir();
        assert!(load_draft_from_dir(&dir, "../../etc/passwd").is_err());
        assert!(load_draft_from_dir(&dir, "../traversal").is_err());
    }

    #[test]
    fn draft_gc_removes_old_drafts() {
        use crate::draft::{
            gc_old_drafts_in_dir, load_draft_from_dir, save_draft_to_dir, DraftMeta,
        };
        let dir = std::env::temp_dir().join(format!("skymark-draft-gc-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();

        let key = save_draft_to_dir(&dir, None, "old content").unwrap();

        // Back-date the meta to 31 days ago.
        let meta_path = dir.join(format!("{key}.meta.json"));
        let old_unix = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs()
            .saturating_sub(31 * 24 * 60 * 60);
        let meta = DraftMeta {
            original_path: None,
            saved_at_unix: old_unix,
            source_mtime_unix: None,
        };
        let json = serde_json::to_string(&meta).unwrap();
        std::fs::write(&meta_path, json.as_bytes()).unwrap();

        gc_old_drafts_in_dir(&dir).unwrap();
        assert!(
            load_draft_from_dir(&dir, &key).is_err(),
            "old draft should be GC'd"
        );

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn export_file_writes_html_content() {
        let dir = std::env::temp_dir().join(format!("skymark-export-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("out.html");
        let content = "<h1>Hello</h1>".to_string();

        let result = export_file(path.to_string_lossy().into_owned(), content.clone());
        assert!(result.is_ok(), "expected ok, got: {:?}", result);

        let written = std::fs::read_to_string(&path).unwrap();
        assert_eq!(written, content);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn export_file_rejects_relative_path() {
        let result = export_file("relative/out.html".into(), "x".into());
        assert!(result.is_err());
        assert!(
            result.unwrap_err().contains("absolute"),
            "error should mention absolute"
        );
    }

    #[test]
    fn export_file_rejects_non_html_extension() {
        let result = export_file("/tmp/out.pdf".into(), "x".into());
        assert!(result.is_err());
        assert!(
            result.unwrap_err().contains("html"),
            "error should mention html"
        );
    }

    #[test]
    fn scan_subdir_requires_absolute_path() {
        let result = crate::vault::scan_subdir("relative/path".into(), 2);
        assert!(result.is_err());
    }
}
