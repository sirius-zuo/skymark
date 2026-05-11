use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Debug, Serialize, Clone)]
pub struct VaultFile {
    pub abs_path: String,
    pub rel_path: String,
    pub name: String,
}

/// Default maximum directory depth for vault scan.
const DEFAULT_MAX_DEPTH: usize = 20;

/// Testable scan helper. `max_files` lets tests use a small cap.
/// `max_depth` prevents stack overflow on deeply nested directories.
pub fn scan_dir(root: &Path, max_files: usize, max_depth: usize) -> Result<Vec<VaultFile>, String> {
    let mut files = Vec::new();
    collect_files(root, root, &mut files, max_files, max_depth, 0)?;
    files.sort_by_cached_key(|f| f.rel_path.to_ascii_lowercase());
    Ok(files)
}

fn collect_files(
    root: &Path,
    dir: &Path,
    out: &mut Vec<VaultFile>,
    max_files: usize,
    max_depth: usize,
    depth: usize,
) -> Result<(), String> {
    // Prevent stack overflow on deeply nested directories
    if depth > max_depth {
        return Ok(());
    }
    let entries = std::fs::read_dir(dir).map_err(|e| format!("read_dir {dir:?}: {e}"))?;
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let os_name = entry.file_name();
        let name = os_name.to_string_lossy();
        if name.starts_with('.') {
            continue;
        }
        let path = entry.path();
        let ft = entry.file_type().map_err(|e| e.to_string())?;
        if ft.is_dir() {
            collect_files(root, &path, out, max_files, max_depth, depth + 1)?;
        } else if ft.is_file() {
            let ext = path
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("")
                .to_ascii_lowercase();
            if matches!(ext.as_str(), "md" | "markdown" | "txt") {
                let rel = path
                    .strip_prefix(root)
                    .map_err(|e| e.to_string())?
                    .to_string_lossy()
                    .replace('\\', "/"); // normalise Windows separators
                out.push(VaultFile {
                    abs_path: path.to_string_lossy().into_owned(),
                    rel_path: rel,
                    name: name.into_owned(),
                });
                if out.len() > max_files {
                    return Err(format!(
                        "vault too large: more than {max_files} files found"
                    ));
                }
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub fn scan_vault(path: String) -> Result<Vec<VaultFile>, String> {
    let p = PathBuf::from(&path);
    if !p.is_absolute() {
        return Err("vault path must be absolute".into());
    }
    if !p.is_dir() {
        return Err(format!("not a directory: {path}"));
    }
    scan_dir(&p, 5_000, DEFAULT_MAX_DEPTH)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn tmpdir(label: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir()
            .join(format!("skymark-vault-{}-{}", label, std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn scan_finds_md_files_recursively() {
        let dir = tmpdir("finds-md");
        let sub = dir.join("notes");
        fs::create_dir_all(&sub).unwrap();
        fs::write(dir.join("readme.md"), "").unwrap();
        fs::write(sub.join("intro.markdown"), "").unwrap();
        fs::write(dir.join("notes.txt"), "").unwrap();
        fs::write(sub.join("skip.rs"), "").unwrap();

        let files = scan_dir(&dir, 5_000, DEFAULT_MAX_DEPTH).unwrap();
        assert_eq!(files.len(), 3);
        assert!(files.iter().any(|f| f.name == "readme.md"));
        assert!(files.iter().any(|f| f.name == "intro.markdown"));
        assert!(files.iter().any(|f| f.name == "notes.txt"));

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn scan_skips_hidden_files_and_dirs() {
        let dir = tmpdir("skips-hidden");
        let git = dir.join(".git");
        fs::create_dir_all(&git).unwrap();
        fs::write(dir.join("visible.md"), "").unwrap();
        fs::write(dir.join(".hidden.md"), "").unwrap();
        fs::write(git.join("inside.md"), "").unwrap();

        let files = scan_dir(&dir, 5_000, DEFAULT_MAX_DEPTH).unwrap();
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].name, "visible.md");

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn scan_returns_sorted_by_rel_path() {
        let dir = tmpdir("sorted");
        fs::write(dir.join("z-last.md"), "").unwrap();
        fs::write(dir.join("a-first.md"), "").unwrap();
        fs::write(dir.join("m-middle.md"), "").unwrap();

        let files = scan_dir(&dir, 5_000, DEFAULT_MAX_DEPTH).unwrap();
        assert_eq!(files[0].name, "a-first.md");
        assert_eq!(files[1].name, "m-middle.md");
        assert_eq!(files[2].name, "z-last.md");

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn scan_errors_when_exceeds_max_files() {
        let dir = tmpdir("cap");
        for i in 0..11u32 {
            fs::write(dir.join(format!("f{i}.md")), "").unwrap();
        }

        let result = scan_dir(&dir, 10, DEFAULT_MAX_DEPTH);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("vault too large"));

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn scan_respects_max_depth() {
        let dir = tmpdir("depth");
        // Create a deeply nested directory structure
        let deep = dir.clone();
        for i in 0..30 {
            let next = deep.join(format!("d{i}"));
            fs::create_dir_all(&next).unwrap();
            fs::write(next.join("deep.md"), "").unwrap();
        }

        // With a depth limit of 3, we should only find files up to 3 levels deep
        let result = scan_dir(&dir, 10_000, 3);
        assert!(result.is_ok(), "scan should succeed with depth limit");
        let files = result.unwrap();
        // Only files within 3 levels should be found
        for f in &files {
            let depth = f.rel_path.matches('/').count();
            assert!(
                depth <= 3,
                "file {} exceeds depth limit 3 (actual depth: {})",
                f.rel_path,
                depth
            );
        }

        fs::remove_dir_all(&dir).ok();
    }
}
