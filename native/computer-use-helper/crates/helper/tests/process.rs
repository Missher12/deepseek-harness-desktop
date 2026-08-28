use std::io::{Read, Write};
use std::process::{Command, Stdio};

use computer_use_protocol::{OuterFrame, decode_outer_frame, encode_length_prefixed};

#[test]
fn serves_one_strict_status_request_then_exits_cleanly_on_eof() {
    let mut child = Command::new(env!("CARGO_BIN_EXE_computer-use-helper"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn helper");
    let request = br#"{"protocolVersion":1,"messageKind":"request","requestKind":"status","requestId":"00000000-0000-4000-8000-000000000001","sessionId":"session-1","timeoutMs":1000}"#;
    let mut frame = vec![0x01];
    frame.extend_from_slice(request);
    child
        .stdin
        .as_mut()
        .expect("stdin")
        .write_all(&encode_length_prefixed(&frame).expect("framed request"))
        .expect("write request");

    let stdout = child.stdout.as_mut().expect("stdout");
    let mut header = [0_u8; 4];
    stdout.read_exact(&mut header).expect("response header");
    let mut body = vec![0_u8; u32::from_be_bytes(header) as usize];
    stdout.read_exact(&mut body).expect("response body");
    let OuterFrame::Json(response) = decode_outer_frame(&body).expect("strict response") else {
        panic!("response must be JSON")
    };
    assert_eq!(
        response.message.pointer("/result/supported"),
        Some(&serde_json::json!(false))
    );

    drop(child.stdin.take());
    let output = child.wait_with_output().expect("wait helper");
    assert!(
        output.status.success(),
        "stderr must stay generic: {:?}",
        output.stderr
    );
    assert!(output.stderr.is_empty());
}

#[test]
fn malformed_link_input_fails_closed_without_echoing_input() {
    let mut child = Command::new(env!("CARGO_BIN_EXE_computer-use-helper"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn helper");
    child
        .stdin
        .as_mut()
        .expect("stdin")
        .write_all(&1_u32.to_be_bytes())
        .expect("prefix");
    child
        .stdin
        .as_mut()
        .expect("stdin")
        .write_all(&[0xff])
        .expect("body");
    drop(child.stdin.take());
    let output = child.wait_with_output().expect("wait helper");
    assert!(!output.status.success());
    assert!(output.stdout.is_empty());
    assert!(!String::from_utf8_lossy(&output.stderr).contains("ff"));
}
