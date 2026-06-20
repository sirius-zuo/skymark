use std::collections::VecDeque;
use std::ops::Range;
use std::sync::{LazyLock, Mutex};

use pulldown_cmark::{html, CodeBlockKind, Event, Options, Parser, Tag};
use serde_yaml::Value;
use thiserror::Error;

use crate::sanitize::sanitize;

#[derive(Debug, Error)]
pub enum RenderError {
    #[error("internal render error: {0}")]
    Internal(String),
}

/// Simple LRU cache for render results.
///
/// Keyed on FNV-1a content hash. Evicts oldest entries when capacity is exceeded.
/// Thread-safe via Mutex.
pub struct RenderCache {
    max_size: usize,
    entries: VecDeque<(String, String)>,
}

impl RenderCache {
    pub fn new(max_size: usize) -> Self {
        Self {
            max_size,
            entries: VecDeque::with_capacity(max_size),
        }
    }

    pub fn get(&self, key: &str) -> Option<String> {
        self.entries
            .iter()
            .find_map(|(k, v)| if k == key { Some(v.clone()) } else { None })
    }

    pub fn insert(&mut self, key: String, value: String) {
        // Remove existing entry if present
        self.entries.retain(|(k, _)| k != &key);
        // Insert at front
        self.entries.push_front((key, value));
        // Evict if over capacity
        if self.entries.len() > self.max_size {
            self.entries.pop_back();
        }
    }
}

/// Global render cache shared across all render calls.
pub static RENDER_CACHE: LazyLock<Mutex<RenderCache>> =
    LazyLock::new(|| Mutex::new(RenderCache::new(100)));

/// Compute FNV-1a hash of input string.
fn fnv1a_hash(input: &str) -> u64 {
    const FNV_PRIME: u64 = 0x0000_0100_0000_01b3;
    const FNV_OFFSET: u64 = 0xcbf2_9ce4_8422_2325;
    let mut hash = FNV_OFFSET;
    for byte in input.bytes() {
        hash ^= byte as u64;
        hash = hash.wrapping_mul(FNV_PRIME);
    }
    hash
}

fn cache_key(input: &str) -> String {
    format!("{:016x}", fnv1a_hash(input))
}

/// Convert heading text to a GitHub-style slug for use as an HTML id.
fn slugify(text: &str) -> String {
    let mut slug = String::new();
    for c in text.to_lowercase().chars() {
        if c.is_alphanumeric() {
            slug.push(c);
        } else if (c == ' ' || c == '-') && !slug.ends_with('-') {
            slug.push('-');
        }
    }
    slug.trim_end_matches('-').to_string()
}

/// Pre-pass: collect a slug for every heading in document order.
/// Duplicate slugs get a numeric suffix (-1, -2, …) matching GitHub's behaviour.
fn collect_heading_slugs(markdown: &str) -> Vec<String> {
    use pulldown_cmark::TagEnd;
    use std::collections::HashMap;

    let parser = Parser::new_ext(markdown, gfm_options());
    let mut slugs: Vec<String> = Vec::new();
    let mut counts: HashMap<String, usize> = HashMap::new();
    let mut in_heading = false;
    let mut text_buf = String::new();

    for event in parser {
        match event {
            Event::Start(Tag::Heading { .. }) => {
                in_heading = true;
                text_buf.clear();
            }
            Event::End(TagEnd::Heading(_)) if in_heading => {
                let base = slugify(&text_buf);
                let count = counts.entry(base.clone()).or_insert(0);
                let slug = if *count == 0 {
                    base.clone()
                } else {
                    format!("{base}-{count}")
                };
                *count += 1;
                slugs.push(slug);
                in_heading = false;
            }
            Event::Text(t) if in_heading => text_buf.push_str(&t),
            Event::Code(t) if in_heading => text_buf.push_str(&t),
            _ => {}
        }
    }
    slugs
}

/// Detects a leading YAML frontmatter block per GitHub's rule: the
/// document's first line is exactly `---`, and some later line is exactly
/// `---` or `...`. Returns the byte range of the YAML body between the
/// fences (excluding both fence lines) and the byte offset immediately
/// after the closing fence's line (including its trailing newline, if
/// present). Returns `None` if either condition isn't met.
fn frontmatter_span(markdown: &str) -> Option<(Range<usize>, usize)> {
    let mut lines = markdown.split('\n');
    let first = lines.next()?;
    if first.trim_end_matches('\r') != "---" {
        return None;
    }
    // The first line must be followed by a newline for a closing fence to
    // exist at all.
    if markdown.as_bytes().get(first.len()) != Some(&b'\n') {
        return None;
    }
    let yaml_start = first.len() + 1;
    let mut offset = yaml_start;
    for line in lines {
        let trimmed = line.trim_end_matches('\r');
        if trimmed == "---" || trimmed == "..." {
            let yaml_end = offset;
            let fence_end = offset + line.len();
            let frontmatter_end = if markdown.as_bytes().get(fence_end) == Some(&b'\n') {
                fence_end + 1
            } else {
                fence_end
            };
            return Some((yaml_start..yaml_end, frontmatter_end));
        }
        offset += line.len() + 1;
    }
    None
}

/// Converts a YAML scalar key to its string form for use as a table row
/// label. Frontmatter keys are conventionally plain strings; the other
/// branches handle YAML's more permissive key types without panicking.
fn yaml_key_to_string(key: &Value) -> String {
    match key {
        Value::String(s) => s.clone(),
        Value::Bool(b) => b.to_string(),
        Value::Number(n) => n.to_string(),
        Value::Null => "null".to_string(),
        other => format!("{other:?}"),
    }
}

/// Renders a YAML value as HTML for a frontmatter table cell. Scalars
/// become HTML-escaped text; sequences become a comma-joined list; mappings
/// become one `key: value` line per entry (indented two spaces per nesting
/// level, joined with `<br>`), recursing for further nesting.
fn render_yaml_value(value: &Value, depth: usize) -> String {
    match value {
        Value::Null => String::new(),
        Value::Bool(b) => html_escape(&b.to_string()),
        Value::Number(n) => html_escape(&n.to_string()),
        Value::String(s) => html_escape(s),
        Value::Sequence(seq) => seq
            .iter()
            .map(|v| render_yaml_value(v, depth))
            .collect::<Vec<_>>()
            .join(", "),
        Value::Mapping(map) => {
            let indent = "&nbsp;&nbsp;".repeat(depth + 1);
            map.iter()
                .map(|(k, v)| {
                    let key = html_escape(&yaml_key_to_string(k));
                    let val = render_yaml_value(v, depth + 1);
                    format!("{indent}{key}: {val}")
                })
                .collect::<Vec<_>>()
                .join("<br>")
        }
        Value::Tagged(t) => render_yaml_value(&t.value, depth),
    }
}

/// Parses `yaml_body` and, if it is a non-empty YAML mapping, renders it as
/// an HTML table (one row per top-level key). Returns `None` for invalid
/// YAML, a non-mapping top-level value, or an empty mapping — callers
/// should treat `None` as "no frontmatter to render" and fall back to
/// normal Markdown rendering of the whole document.
fn render_frontmatter_table(yaml_body: &str) -> Option<String> {
    let value: Value = serde_yaml::from_str(yaml_body).ok()?;
    let Value::Mapping(map) = value else { return None };
    if map.is_empty() {
        return None;
    }
    let mut html = String::from("<table data-line=\"1\"><tbody>");
    for (k, v) in &map {
        let key = html_escape(&yaml_key_to_string(k));
        let val = render_yaml_value(v, 0);
        html.push_str(&format!("<tr><td>{key}</td><td>{val}</td></tr>"));
    }
    html.push_str("</tbody></table>");
    Some(html)
}

/// Convert a Markdown source string to a sanitized HTML fragment.
///
/// Pipeline: pulldown-cmark (CommonMark + GFM extensions) -> HTML buffer -> sanitizer.
/// Block-level open tags carry a `data-line="N"` attribute (1-based source line)
/// for editor-preview scroll sync. Heading tags additionally carry an `id` attribute
/// (GitHub-style slug) so that `#anchor` links navigate correctly.
///
/// Results are cached by content hash to skip re-parsing unchanged content.
pub fn render_html(markdown: &str) -> Result<String, RenderError> {
    if markdown.is_empty() {
        return Ok(String::new());
    }

    // Check cache first
    let key = cache_key(markdown);
    {
        let cache = RENDER_CACHE
            .lock()
            .map_err(|e| RenderError::Internal(e.to_string()))?;
        if let Some(cached) = cache.get(&key) {
            return Ok(cached);
        }
    }

    // Full render pipeline
    let line_starts: Vec<usize> = std::iter::once(0)
        .chain(markdown.match_indices('\n').map(|(i, _)| i + 1))
        .collect();
    let heading_slugs = collect_heading_slugs(markdown);
    let mut heading_idx = 0;
    let mut html_buf = String::new();
    let parser = Parser::new_ext(markdown, gfm_options());
    for (event, range) in parser.into_offset_iter() {
        if let Event::Start(ref tag) = event {
            if is_block_tag(tag) {
                let line = byte_to_line(range.start, &line_starts);
                if matches!(tag, Tag::Heading { .. }) {
                    let slug = heading_slugs
                        .get(heading_idx)
                        .map(String::as_str)
                        .unwrap_or("");
                    heading_idx += 1;
                    html_buf.push_str(&heading_open_tag(tag, line, slug));
                } else {
                    html_buf.push_str(&block_open_tag(tag, line));
                }
                continue;
            }
        }
        html::push_html(&mut html_buf, std::iter::once(event));
    }
    let result = sanitize(&html_buf);

    // Store in cache
    let mut cache = RENDER_CACHE
        .lock()
        .map_err(|e| RenderError::Internal(e.to_string()))?;
    cache.insert(key, result.clone());

    Ok(result)
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

fn heading_open_tag(tag: &Tag, line: usize, id: &str) -> String {
    let Tag::Heading { level, .. } = tag else {
        unreachable!()
    };
    if id.is_empty() {
        format!("<h{} data-line=\"{line}\">", *level as u8)
    } else {
        format!("<h{} id=\"{id}\" data-line=\"{line}\">", *level as u8)
    }
}

fn block_open_tag(tag: &Tag, line: usize) -> String {
    match tag {
        Tag::Paragraph => format!("<p data-line=\"{line}\">"),
        Tag::CodeBlock(CodeBlockKind::Indented) => {
            format!("<pre data-line=\"{line}\"><code>")
        }
        Tag::CodeBlock(CodeBlockKind::Fenced(lang)) => {
            if lang.is_empty() {
                format!("<pre data-line=\"{line}\"><code>")
            } else {
                let safe_lang = html_escape(lang);
                format!("<pre data-line=\"{line}\"><code class=\"language-{safe_lang}\">")
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

fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('"', "&quot;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
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

    #[test]
    fn render_code_block_lang_is_html_escaped() {
        let html = render_html("```<script>\ncode\n```\n").unwrap();
        // The lang is escaped in the class attribute, not containing unescaped < > characters
        assert!(
            !html.contains("class=\"<script>"),
            "lang was not HTML-escaped: {html}"
        );
        // The sanitizer removes classes with unescaped < > so verify the tag is safe
        assert!(
            html.contains("class=\"language-"),
            "class attribute missing: {html}"
        );
    }

    #[test]
    fn frontmatter_span_detects_basic_block() {
        let md = "---\nname: skill\n---\n\nbody\n";
        let (yaml_range, end) = frontmatter_span(md).expect("expected frontmatter");
        assert_eq!(&md[yaml_range], "name: skill\n");
        assert_eq!(&md[end..], "\nbody\n");
    }

    #[test]
    fn frontmatter_span_accepts_dots_closing_fence() {
        let md = "---\nname: skill\n...\nbody\n";
        let (yaml_range, end) = frontmatter_span(md).expect("expected frontmatter");
        assert_eq!(&md[yaml_range], "name: skill\n");
        assert_eq!(&md[end..], "body\n");
    }

    #[test]
    fn frontmatter_span_none_when_dashes_not_first_line() {
        let md = "# Heading\n\n---\nnot frontmatter\n---\n";
        assert!(frontmatter_span(md).is_none());
    }

    #[test]
    fn frontmatter_span_none_without_closing_fence() {
        let md = "---\nname: skill\n\nbody\n";
        assert!(frontmatter_span(md).is_none());
    }

    #[test]
    fn frontmatter_span_handles_empty_yaml_body() {
        let md = "---\n---\n\nbody\n";
        let (yaml_range, end) = frontmatter_span(md).expect("expected frontmatter");
        assert_eq!(&md[yaml_range], "");
        assert_eq!(&md[end..], "\nbody\n");
    }

    #[test]
    fn frontmatter_span_handles_crlf_line_endings() {
        let md = "---\r\nname: skill\r\n---\r\n\r\nbody\r\n";
        let (yaml_range, end) = frontmatter_span(md).expect("expected frontmatter");
        assert_eq!(&md[yaml_range], "name: skill\r\n");
        assert_eq!(&md[end..], "\r\nbody\r\n");
    }

    #[test]
    fn render_frontmatter_table_simple_mapping() {
        let html = render_frontmatter_table("name: skill\ndescription: a test\n").unwrap();
        assert_eq!(
            html,
            "<table data-line=\"1\"><tbody><tr><td>name</td><td>skill</td></tr><tr><td>description</td><td>a test</td></tr></tbody></table>"
        );
    }

    #[test]
    fn render_frontmatter_table_nested_mapping() {
        let html = render_frontmatter_table("metadata:\n  type: feedback\n").unwrap();
        assert_eq!(
            html,
            "<table data-line=\"1\"><tbody><tr><td>metadata</td><td>&nbsp;&nbsp;type: feedback</td></tr></tbody></table>"
        );
    }

    #[test]
    fn render_frontmatter_table_sequence_value() {
        let html = render_frontmatter_table("tags:\n  - a\n  - b\n").unwrap();
        assert_eq!(
            html,
            "<table data-line=\"1\"><tbody><tr><td>tags</td><td>a, b</td></tr></tbody></table>"
        );
    }

    #[test]
    fn render_frontmatter_table_escapes_html() {
        let html = render_frontmatter_table("title: \"<script>alert(1)</script>\"\n").unwrap();
        assert!(html.contains("&lt;script&gt;alert(1)&lt;/script&gt;"));
        assert!(!html.contains("<script>"));
    }

    #[test]
    fn render_frontmatter_table_none_for_non_mapping() {
        assert!(render_frontmatter_table("just a string\n").is_none());
    }

    #[test]
    fn render_frontmatter_table_none_for_invalid_yaml() {
        assert!(render_frontmatter_table("key: [unclosed\n").is_none());
    }

    #[test]
    fn render_frontmatter_table_none_for_empty_mapping() {
        assert!(render_frontmatter_table("").is_none());
        assert!(render_frontmatter_table("{}\n").is_none());
    }
}
