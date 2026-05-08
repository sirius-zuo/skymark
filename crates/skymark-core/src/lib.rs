//! Skymark markdown engine.
//!
//! Pure Rust. No UI, no Tauri, no JS dependencies. Builds for native and `wasm32-unknown-unknown`.

mod render;
mod sanitize;

pub use render::{render_html, RenderError};
