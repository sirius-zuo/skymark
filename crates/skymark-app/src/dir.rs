use crate::storage::Storage;
use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Debug, Serialize, Clone)]
pub struct DirEntry {
    pub name: String,
    pub abs_path: String,
    pub is_dir: bool,
    pub is_supported: bool,
}

#[tauri::command]
pub fn list_dir(path: String) -> Result<Vec<DirEntry>, String> {
    let p = PathBuf::from(&path);
    if !p.is_absolute() {
        return Err("path must be absolute".into());
    }
    if !p.is_dir() {
        return Err(format!("not a directory: {path}"));
    }
    list_dir_inner(&p)
}

pub(crate) fn list_dir_inner(dir: &Path) -> Result<Vec<DirEntry>, String> {
    let storage = crate::storage::StdStorage;
    let raw = storage.list(dir)?;

    let mut dirs: Vec<DirEntry> = Vec::new();
    let mut files: Vec<DirEntry> = Vec::new();

    for entry in raw {
        let name_os = entry.file_name();
        let name = name_os.to_string_lossy();
        if name.starts_with('.') {
            continue;
        }
        let path = entry.path();
        let Ok(ft) = entry.file_type() else { continue };
        let abs_path = path.to_string_lossy().into_owned();

        if ft.is_dir() {
            dirs.push(DirEntry {
                name: name.into_owned(),
                abs_path,
                is_dir: true,
                is_supported: false,
            });
        } else if ft.is_file() {
            let ext = path
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("")
                .to_ascii_lowercase();
            let is_supported = matches!(ext.as_str(), "md" | "markdown" | "txt");
            files.push(DirEntry {
                name: name.into_owned(),
                abs_path,
                is_dir: false,
                is_supported,
            });
        }
    }

    dirs.sort_by(|a, b| a.name.to_ascii_lowercase().cmp(&b.name.to_ascii_lowercase()));
    files.sort_by(|a, b| a.name.to_ascii_lowercase().cmp(&b.name.to_ascii_lowercase()));
    dirs.extend(files);
    Ok(dirs)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn tmpdir(label: &str) -> PathBuf {
        let dir = std::env::temp_dir()
            .join(format!("skymark-dir-{}-{}", label, std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn list_dir_returns_files_and_dirs() {
        let dir = tmpdir("basic");
        let sub = dir.join("sub");
        fs::create_dir_all(&sub).unwrap();
        fs::write(dir.join("a.md"), "").unwrap();
        fs::write(dir.join("b.txt"), "").unwrap();

        let entries = list_dir_inner(&dir).unwrap();
        assert_eq!(entries.len(), 3);
        assert!(entries.iter().any(|e| e.name == "sub" && e.is_dir));
        assert!(entries.iter().any(|e| e.name == "a.md" && !e.is_dir && e.is_supported));
        assert!(entries.iter().any(|e| e.name == "b.txt" && !e.is_dir && e.is_supported));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn list_dir_dirs_before_files() {
        let dir = tmpdir("order");
        let sub = dir.join("z-sub");
        fs::create_dir_all(&sub).unwrap();
        fs::write(dir.join("a-file.md"), "").unwrap();

        let entries = list_dir_inner(&dir).unwrap();
        assert_eq!(entries[0].name, "z-sub", "dir should come before files");
        assert_eq!(entries[1].name, "a-file.md");
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn list_dir_skips_hidden() {
        let dir = tmpdir("hidden");
        fs::create_dir_all(dir.join(".git")).unwrap();
        fs::write(dir.join(".hidden.md"), "").unwrap();
        fs::write(dir.join("visible.md"), "").unwrap();

        let entries = list_dir_inner(&dir).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].name, "visible.md");
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn list_dir_marks_unsupported_files() {
        let dir = tmpdir("unsupported");
        fs::write(dir.join("doc.md"), "").unwrap();
        fs::write(dir.join("image.png"), "").unwrap();

        let entries = list_dir_inner(&dir).unwrap();
        let md = entries.iter().find(|e| e.name == "doc.md").unwrap();
        let png = entries.iter().find(|e| e.name == "image.png").unwrap();
        assert!(md.is_supported);
        assert!(!png.is_supported);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn list_dir_rejects_relative_path() {
        let result = list_dir("relative/path".into());
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("absolute"));
    }

    #[test]
    fn list_dir_rejects_non_dir() {
        let dir = tmpdir("nondir");
        let file = dir.join("file.md");
        fs::write(&file, "").unwrap();
        let result = list_dir(file.to_string_lossy().into_owned());
        assert!(result.is_err());
        fs::remove_dir_all(&dir).ok();
    }
}
