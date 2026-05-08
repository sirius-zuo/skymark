use skymark_core::render_html;

#[test]
fn empty_input_returns_empty_html() {
    assert_eq!(render_html("").unwrap(), "");
}
