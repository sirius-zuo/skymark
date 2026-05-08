/// What should happen when Enter is pressed at the end of a line.
#[derive(Debug, PartialEq, Eq)]
pub enum ContinueAction {
    /// Insert this string at the start of the new line.
    Continue(String),
    /// The list item is empty — delete the last `remove_chars` characters on the
    /// current line and insert a plain newline instead.
    Cancel { remove_chars: usize },
}

/// Given the text of the current editor line, return how Enter should behave.
/// Returns `None` when the line is not a list item or blockquote.
pub fn continue_list(line: &str) -> Option<ContinueAction> {
    let indent_len = line.len()
        - line.trim_start_matches([' ', '\t']).len();
    let indent = &line[..indent_len];
    let rest = &line[indent_len..];

    // Unordered bullets: -, *, +
    for bullet in ['-', '*', '+'] {
        let marker = format!("{bullet} ");
        if let Some(after) = rest.strip_prefix(marker.as_str()) {
            let content = after.trim_end();
            if content.is_empty() {
                return Some(ContinueAction::Cancel { remove_chars: indent_len + 2 });
            }
            let continuation = if after.starts_with("[ ] ") || after.starts_with("[x] ") || after.starts_with("[X] ") {
                format!("{indent}{bullet} [ ] ")
            } else {
                format!("{indent}{bullet} ")
            };
            return Some(ContinueAction::Continue(continuation));
        }
    }

    // Ordered list: one-or-more digits followed by ". "
    let digit_end = rest.find(|c: char| !c.is_ascii_digit()).unwrap_or(rest.len());
    if digit_end > 0 {
        if let Some(after_dot) = rest[digit_end..].strip_prefix(". ") {
            if let Ok(n) = rest[..digit_end].parse::<u64>() {
                if after_dot.trim_end().is_empty() {
                    return Some(ContinueAction::Cancel { remove_chars: indent_len + digit_end + 2 });
                }
                return Some(ContinueAction::Continue(format!("{indent}{}. ", n + 1)));
            }
        }
    }

    // Blockquote: "> "
    if let Some(after) = rest.strip_prefix("> ") {
        if after.trim_end().is_empty() {
            return Some(ContinueAction::Cancel { remove_chars: indent_len + 2 });
        }
        return Some(ContinueAction::Continue(format!("{indent}> ")));
    }
    if rest == ">" {
        return Some(ContinueAction::Cancel { remove_chars: indent_len + 1 });
    }

    None
}

/// Returns `true` if `s` begins with a URL scheme (http, https, ftp, mailto).
pub fn is_url(s: &str) -> bool {
    s.starts_with("http://")
        || s.starts_with("https://")
        || s.starts_with("ftp://")
        || s.starts_with("mailto:")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unordered_bullet_continues() {
        assert_eq!(continue_list("- hello"), Some(ContinueAction::Continue("- ".into())));
    }

    #[test]
    fn unordered_bullet_with_indent_continues() {
        assert_eq!(continue_list("  - hello"), Some(ContinueAction::Continue("  - ".into())));
    }

    #[test]
    fn unordered_bullet_star_continues() {
        assert_eq!(continue_list("* text"), Some(ContinueAction::Continue("* ".into())));
    }

    #[test]
    fn unordered_bullet_plus_continues() {
        assert_eq!(continue_list("+ text"), Some(ContinueAction::Continue("+ ".into())));
    }

    #[test]
    fn empty_bullet_cancels() {
        assert_eq!(continue_list("- "), Some(ContinueAction::Cancel { remove_chars: 2 }));
    }

    #[test]
    fn indented_empty_bullet_cancels_with_correct_offset() {
        assert_eq!(continue_list("  - "), Some(ContinueAction::Cancel { remove_chars: 4 }));
    }

    #[test]
    fn task_list_open_continues_with_open_checkbox() {
        assert_eq!(
            continue_list("- [ ] todo"),
            Some(ContinueAction::Continue("- [ ] ".into()))
        );
    }

    #[test]
    fn task_list_checked_continues_with_open_checkbox() {
        assert_eq!(
            continue_list("- [x] done"),
            Some(ContinueAction::Continue("- [ ] ".into()))
        );
    }

    #[test]
    fn ordered_list_increments() {
        assert_eq!(continue_list("1. first"), Some(ContinueAction::Continue("2. ".into())));
        assert_eq!(continue_list("9. ninth"), Some(ContinueAction::Continue("10. ".into())));
    }

    #[test]
    fn ordered_list_with_indent_increments() {
        assert_eq!(
            continue_list("   3. item"),
            Some(ContinueAction::Continue("   4. ".into()))
        );
    }

    #[test]
    fn empty_ordered_item_cancels() {
        assert_eq!(continue_list("1. "), Some(ContinueAction::Cancel { remove_chars: 3 }));
    }

    #[test]
    fn blockquote_continues() {
        assert_eq!(continue_list("> hello"), Some(ContinueAction::Continue("> ".into())));
    }

    #[test]
    fn empty_blockquote_cancels() {
        assert_eq!(continue_list("> "), Some(ContinueAction::Cancel { remove_chars: 2 }));
    }

    #[test]
    fn plain_paragraph_returns_none() {
        assert_eq!(continue_list("just a paragraph"), None);
    }

    #[test]
    fn heading_returns_none() {
        assert_eq!(continue_list("## heading"), None);
    }

    #[test]
    fn https_is_url() {
        assert!(is_url("https://example.com"));
    }

    #[test]
    fn http_is_url() {
        assert!(is_url("http://example.com/path?q=1"));
    }

    #[test]
    fn ftp_is_url() {
        assert!(is_url("ftp://files.example.com"));
    }

    #[test]
    fn mailto_is_url() {
        assert!(is_url("mailto:user@example.com"));
    }

    #[test]
    fn plain_text_not_url() {
        assert!(!is_url("not a url"));
        assert!(!is_url("example.com"));
    }
}
