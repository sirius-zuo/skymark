//! Storage abstraction for file I/O operations.
//!
//! Provides a trait that abstracts over `std::fs` calls, enabling future
//! swapping to encrypted storage, virtual file systems, or test doubles.

use std::path::Path;
use std::time::SystemTime;

/// Trait for file system operations used by Tauri commands and draft management.
pub trait Storage: Send + Sync {
    /// Read file contents as UTF-8 string.
    fn read(&self, path: &Path) -> Result<String, String>;
    
    /// Write bytes to file using atomic write (temp + rename).
    fn write(&self, path: &Path, content: &[u8]) -> Result<(), String>;
    
    /// List directory entries.
    fn list(&self, dir: &Path) -> Result<Vec<std::fs::DirEntry>, String>;
    
    /// Get file modification time.
    fn mtime(&self, path: &Path) -> Result<SystemTime, String>;
    
    /// Check if file exists.
    fn exists(&self, path: &Path) -> bool;
}

/// Adapter that wraps `std::fs` calls.
pub struct StdStorage;

impl Storage for StdStorage {
    fn read(&self, path: &Path) -> Result<String, String> {
        std::fs::read_to_string(path)
            .map_err(|e| format!("read {path:?}: {e}"))
    }
    
    fn write(&self, path: &Path, content: &[u8]) -> Result<(), String> {
        // Atomic write: write to temp file, then rename
        let parent = path
            .parent()
            .ok_or_else(|| format!("path has no parent: {path:?}"))?;
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("create dir {parent:?}: {e}"))?;
        
        let tmp = parent.join(format!(".{}.tmp", path.file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("skymark-write")));
        std::fs::write(&tmp, content)
            .map_err(|e| format!("write tmp {tmp:?}: {e}"))?;
        std::fs::rename(&tmp, path)
            .map_err(|e| format!("rename {tmp:?} -> {path:?}: {e}"))
    }
    
    fn list(&self, dir: &Path) -> Result<Vec<std::fs::DirEntry>, String> {
        std::fs::read_dir(dir)
            .map_err(|e| format!("read_dir {dir:?}: {e}"))
            .map(|entries| entries.flatten().collect())
    }
    
    fn mtime(&self, path: &Path) -> Result<SystemTime, String> {
        std::fs::metadata(path)
            .map_err(|e| format!("metadata {path:?}: {e}"))
            .and_then(|m| m.modified().map_err(|e| format!("modified {path:?}: {e}")))
    }
    
    fn exists(&self, path: &Path) -> bool {
        path.exists()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    fn tmpdir(label: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!("skymark-storage-{}-{}", label, std::process::id()))
    }
    
    #[test]
    fn std_storage_read_write() {
        let storage = StdStorage;
        let dir = tmpdir("rw");
        let path = dir.join("test.txt");
        
        storage.write(&path, b"hello world").unwrap();
        let content = storage.read(&path).unwrap();
        assert_eq!(content, "hello world");
        
        std::fs::remove_dir_all(&dir).ok();
    }
    
    #[test]
    fn std_storage_list() {
        let storage = StdStorage;
        let dir = tmpdir("list");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::File::create(dir.join("a.txt")).unwrap();
        std::fs::File::create(dir.join("b.txt")).unwrap();
        
        let entries = storage.list(&dir).unwrap();
        assert_eq!(entries.len(), 2);
        
        std::fs::remove_dir_all(&dir).ok();
    }
    
    #[test]
    fn std_storage_mtime() {
        let storage = StdStorage;
        let dir = tmpdir("mtime");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("test.txt");
        std::fs::write(&path, "content").unwrap();
        
        let mtime = storage.mtime(&path).unwrap();
        assert!(mtime.duration_since(SystemTime::UNIX_EPOCH).unwrap().as_secs() > 0);
        
        std::fs::remove_dir_all(&dir).ok();
    }
    
    #[test]
    fn std_storage_exists() {
        let storage = StdStorage;
        let dir = tmpdir("exists");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("test.txt");
        
        assert!(!storage.exists(&path));
        std::fs::write(&path, "content").unwrap();
        assert!(storage.exists(&path));
        
        std::fs::remove_dir_all(&dir).ok();
    }
}
