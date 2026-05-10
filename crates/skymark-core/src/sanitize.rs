//! HTML sanitization for the canonical render pipeline.
//!
//! The allowlist matches spec §5.1: standard markdown elements plus the
//! attributes needed for tasklists and links/images. Inline event handlers,
//! script/iframe/object/embed elements, and javascript:/data: URLs are stripped.
//! The sanitizer always runs - even when (post-Phase-1) a future setting
//! relaxes which elements are allowed, event handlers and URI schemes are
//! never relaxed.

use ammonia::Builder;
use std::collections::{HashMap, HashSet};

pub fn sanitize(input: &str) -> String {
    builder().clean(input).to_string()
}

fn builder() -> Builder<'static> {
    let mut b = Builder::new();

    let tags: HashSet<&'static str> = [
        // block
        "p", "h1", "h2", "h3", "h4", "h5", "h6",
        "ul", "ol", "li", "blockquote",
        "pre", "code",
        "table", "thead", "tbody", "tr", "th", "td",
        "hr", "br",
        // inline
        "em", "strong", "del", "a", "img",
        "input",
        // KaTeX/Mermaid hooks - Phase 4 fills these in. Keep `span` allowed
        // so the future math/code-highlighter wrappers slot in without a
        // sanitizer migration.
        "span",
    ]
    .into_iter()
    .collect();
    b.tags(tags);

    let mut tag_attrs: HashMap<&'static str, HashSet<&'static str>> = HashMap::new();
    tag_attrs.insert("a", ["href", "title"].into_iter().collect());
    tag_attrs.insert("img", ["src", "alt", "title"].into_iter().collect());
    tag_attrs.insert("input", ["type", "checked", "disabled"].into_iter().collect());
    tag_attrs.insert("th", ["align"].into_iter().collect());
    tag_attrs.insert("td", ["align"].into_iter().collect());
    tag_attrs.insert("code", ["class"].into_iter().collect());
    tag_attrs.insert("span", ["class"].into_iter().collect());
    tag_attrs.insert("ol", ["start"].into_iter().collect());
    b.tag_attributes(tag_attrs);

    let generic_attrs: HashSet<&'static str> = ["data-line"].into_iter().collect();
    b.generic_attributes(generic_attrs);

    let url_schemes: HashSet<&'static str> = ["http", "https", "mailto"].into_iter().collect();
    b.url_schemes(url_schemes);

    // Allow image-relative paths (no scheme) so attachments render in preview.
    b.url_relative(ammonia::UrlRelative::PassThrough);

    // Default behavior already strips <script>, <iframe>, <object>, <embed>,
    // and inline event handler attributes (on*). Do not relax these.

    b
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn data_line_survives_sanitizer() {
        let html = sanitize(r#"<p data-line="3">hello</p>"#);
        assert!(
            html.contains(r#"data-line="3""#),
            "data-line was stripped: {html}"
        );
    }
}
