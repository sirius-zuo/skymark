use pulldown_cmark::{html, Options, Parser};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum RenderError {
    #[error("internal render error: {0}")]
    Internal(String),
}

/// Convert a Markdown source string to a sanitized HTML fragment.
///
/// Pipeline: pulldown-cmark (CommonMark + GFM extensions) -> HTML buffer -> sanitizer.
/// The sanitizer is wired in by Task 5; for now the raw HTML is returned.
pub fn render_html(markdown: &str) -> Result<String, RenderError> {
    if markdown.is_empty() {
        return Ok(String::new());
    }
    let mut html_buf = String::new();
    let parser = Parser::new_ext(markdown, gfm_options());
    html::push_html(&mut html_buf, parser);
    Ok(html_buf)
}

fn gfm_options() -> Options {
    Options::ENABLE_TABLES | Options::ENABLE_STRIKETHROUGH | Options::ENABLE_TASKLISTS
}
