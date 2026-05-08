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
pub fn open_file(_path: String) -> Result<OpenedFile, String> {
    Err("not implemented".into())
}

#[tauri::command]
pub fn save_file(_path: String, _content: String) -> Result<(), String> {
    Err("not implemented".into())
}

// Path validation helper used by Tasks 8 and 9.
#[allow(dead_code)]
pub(crate) fn validate_markdown_path(path: &str) -> Result<PathBuf, String> {
    let p = PathBuf::from(path);
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
}
