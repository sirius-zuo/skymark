use pulldown_cmark::{html, CodeBlockKind, Event, Options, Parser, Tag};
use thiserror::Error;

use crate::sanitize::sanitize;

#[derive(Debug, Error)]
pub enum RenderError {
    #[error("internal render error: {0}")]
    Internal(String),
}

/// Convert a Markdown source string to a sanitized HTML fragment.
///
/// Pipeline: pulldown-cmark (CommonMark + GFM extensions) -> HTML buffer -> sanitizer.
/// Block-level open tags carry a `data-line="N"` attribute (1-based source line)
/// for editor-preview scroll sync.
pub fn render_html(markdown: &str) -> Result<String, RenderError> {
    if markdown.is_empty() {
        return Ok(String::new());
    }
    let line_starts: Vec<usize> = std::iter::once(0)
        .chain(markdown.match_indices('\n').map(|(i, _)| i + 1))
        .collect();
    let mut html_buf = String::new();
    let parser = Parser::new_ext(markdown, gfm_options());
    for (event, range) in parser.into_offset_iter() {
        if let Event::Start(ref tag) = event {
            if is_block_tag(tag) {
                let line = byte_to_line(range.start, &line_starts);
                html_buf.push_str(&block_open_tag(tag, line));
                continue;
            }
        }
        html::push_html(&mut html_buf, std::iter::once(event));
    }
    Ok(sanitize(&html_buf))
}

fn gfm_options() -> Options {
    Options::ENABLE_TABLES
        | Options::ENABLE_STRIKETHROUGH
        | Options::ENABLE_TASKLISTS
        | Options::ENABLE_MATH
}

/// Returns the 1-based line number for a given byte offset.
fn byte_to_line(offset: usize, line_starts: &[usize]) -> usize {
    line_starts.partition_point(|&s| s <= offset)
}

fn is_block_tag(tag: &Tag) -> bool {
    matches!(
        tag,
        Tag::Paragraph
            | Tag::Heading { .. }
            | Tag::CodeBlock(_)
            | Tag::BlockQuote(_)
            | Tag::List(_)
            | Tag::Item
            | Tag::Table(_)
    )
}

fn block_open_tag(tag: &Tag, line: usize) -> String {
    match tag {
        Tag::Paragraph => format!("<p data-line=\"{line}\">"),
        Tag::Heading { level, .. } => {
            format!("<h{} data-line=\"{line}\">", *level as u8)
        }
        Tag::CodeBlock(CodeBlockKind::Indented) => {
            format!("<pre data-line=\"{line}\"><code>")
        }
        Tag::CodeBlock(CodeBlockKind::Fenced(lang)) => {
            if lang.is_empty() {
                format!("<pre data-line=\"{line}\"><code>")
            } else {
                format!("<pre data-line=\"{line}\"><code class=\"language-{lang}\">")
            }
        }
        Tag::BlockQuote(_) => format!("<blockquote data-line=\"{line}\">"),
        Tag::List(None) => format!("<ul data-line=\"{line}\">"),
        Tag::List(Some(n)) => format!("<ol start=\"{n}\" data-line=\"{line}\">"),
        Tag::Item => format!("<li data-line=\"{line}\">"),
        Tag::Table(_) => format!("<table data-line=\"{line}\">"),
        _ => unreachable!("block_open_tag called with non-block tag"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn render_emits_data_line_on_blocks() {
        let html = render_html("# Hello\n\nA paragraph.\n").unwrap();
        assert!(
            html.contains(r#"data-line="1""#),
            "missing data-line=1 on heading: {html}"
        );
        assert!(
            html.contains(r#"data-line="3""#),
            "missing data-line=3 on paragraph: {html}"
        );
    }

    #[test]
    fn render_code_block_data_line() {
        let html = render_html("```rust\nfn main() {}\n```\n").unwrap();
        assert!(
            html.contains(r#"data-line="1""#),
            "missing data-line=1 on pre: {html}"
        );
        assert!(
            html.contains("language-rust"),
            "missing language-rust class: {html}"
        );
    }

    #[test]
    fn render_code_block_no_lang() {
        let html = render_html("```\ncode here\n```\n").unwrap();
        assert!(
            html.contains(r#"data-line="1""#),
            "missing data-line=1: {html}"
        );
        assert!(
            !html.contains("class="),
            "unexpected class attribute on code: {html}"
        );
    }
}
