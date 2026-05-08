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
