use serde::Serialize;
use std::path::PathBuf;

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
    let content = std::fs::read_to_string(&validated).map_err(|e| format!("read failed: {e}"))?;
    Ok(OpenedFile {
        path: validated.to_string_lossy().into_owned(),
        content,
    })
}

#[tauri::command]
pub fn save_file(_path: String, _content: String) -> Result<(), String> {
    Err("not implemented".into())
}

// Path validation helper used by Tasks 8 and 9.
#[allow(dead_code)]
pub(crate) fn validate_markdown_path(path: &str) -> Result<PathBuf, String> {
    let p = PathBuf::from(path);
    if !p.is_absolute() {
        return Err("path must be absolute".into());
    }
    match p.extension().and_then(|e| e.to_str()) {
        Some(ext) if matches!(ext.to_ascii_lowercase().as_str(), "md" | "markdown" | "txt") => Ok(p),
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
        assert!(html.contains("<h1>Title</h1>"), "got: {html}");
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
        std::fs::File::create(&path).unwrap().write_all(b"# hello\n").unwrap();

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
}
