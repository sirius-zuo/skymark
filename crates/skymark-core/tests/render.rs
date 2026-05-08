use skymark_core::render_html;

#[test]
fn empty_input_returns_empty_html() {
    assert_eq!(render_html("").unwrap(), "");
}

#[test]
fn renders_paragraph() {
    let html = render_html("hello world").unwrap();
    assert!(html.contains("<p>hello world</p>"), "got: {html}");
}

#[test]
fn renders_heading_levels() {
    let md = "# H1\n\n## H2\n\n### H3";
    let html = render_html(md).unwrap();
    assert!(html.contains("<h1>H1</h1>"), "got: {html}");
    assert!(html.contains("<h2>H2</h2>"), "got: {html}");
    assert!(html.contains("<h3>H3</h3>"), "got: {html}");
}

#[test]
fn renders_unordered_list() {
    let html = render_html("- a\n- b\n- c").unwrap();
    assert!(html.contains("<ul>"), "got: {html}");
    assert!(html.contains("<li>a</li>"), "got: {html}");
}

#[test]
fn renders_ordered_list() {
    let html = render_html("1. one\n2. two").unwrap();
    assert!(html.contains("<ol>"), "got: {html}");
    assert!(html.contains("<li>one</li>"), "got: {html}");
}

#[test]
fn renders_inline_emphasis_and_link() {
    let md = "*em* **strong** [link](https://example.com)";
    let html = render_html(md).unwrap();
    assert!(html.contains("<em>em</em>"), "got: {html}");
    assert!(html.contains("<strong>strong</strong>"), "got: {html}");
    assert!(html.contains("href=\"https://example.com\""), "got: {html}");
}

#[test]
fn renders_fenced_code_block() {
    let md = "```\nfn main() {}\n```";
    let html = render_html(md).unwrap();
    assert!(html.contains("<pre>"), "got: {html}");
    assert!(html.contains("<code>"), "got: {html}");
    assert!(html.contains("fn main()"), "got: {html}");
}

#[test]
fn renders_gfm_table() {
    let md = "| a | b |\n|---|---|\n| 1 | 2 |";
    let html = render_html(md).unwrap();
    assert!(html.contains("<table>"), "got: {html}");
    assert!(html.contains("<th>a</th>"), "got: {html}");
    assert!(html.contains("<td>1</td>"), "got: {html}");
}

#[test]
fn renders_gfm_strikethrough() {
    let html = render_html("~~gone~~").unwrap();
    assert!(html.contains("<del>gone</del>"), "got: {html}");
}

#[test]
fn renders_gfm_tasklist() {
    let md = "- [ ] open\n- [x] done";
    let html = render_html(md).unwrap();
    assert!(html.contains("type=\"checkbox\""), "got: {html}");
    assert!(html.matches("type=\"checkbox\"").count() >= 2, "got: {html}");
    assert!(html.contains("checked"), "got: {html}");
}
