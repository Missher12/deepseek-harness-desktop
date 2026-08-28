use std::fs;
use std::path::{Path, PathBuf};

use computer_use_protocol::{
    Direction, EnvelopeDecoder, LengthPrefixedDecoder, decode_outer_frame, encode_length_prefixed,
    encode_outer_frame, validate_embedded_manifest,
};

fn fixtures() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../../../packages/control/desktop-control-protocol/fixtures")
}

#[test]
fn validates_the_checked_in_manifest_and_byte_exact_shared_fixtures() {
    validate_embedded_manifest().expect("manifest must match protocol v1");
    for name in [
        "status-request.bin",
        "lease-acquire-request.bin",
        "lease-release-request.bin",
        "browser-snapshot-json.bin",
        "browser-snapshot-png.bin",
    ] {
        let bytes = fs::read(fixtures().join(name)).expect("fixture");
        let frame = decode_outer_frame(&bytes).expect("strict fixture frame");
        assert_eq!(encode_outer_frame(&frame).expect("encode"), bytes, "{name}");
    }
}

#[test]
fn rejects_duplicate_unknown_version_and_malformed_reference_json() {
    for json in [
        r#"{"protocolVersion":1,"protocolVersion":1,"messageKind":"request","requestKind":"status","requestId":"00000000-0000-4000-8000-000000000001","sessionId":"s","timeoutMs":1}"#,
        r#"{"protocolVersion":1,"messageKind":"request","requestKind":"status","requestId":"00000000-0000-4000-8000-000000000001","sessionId":"s","timeoutMs":1,"extra":true}"#,
        r#"{"protocolVersion":2,"messageKind":"request","requestKind":"status","requestId":"00000000-0000-4000-8000-000000000001","sessionId":"s","timeoutMs":1}"#,
        r#"{"protocolVersion":1,"messageKind":"request","requestKind":"type","requestId":"00000000-0000-4000-8000-000000000001","sessionId":"s","timeoutMs":1,"leaseId":"00000000-0000-4000-8000-000000000002","leaseRevision":1,"appId":"app","windowId":"window","snapshotRevision":1,"ref":"not-a-computer-ref","text":"x"}"#,
    ] {
        let mut frame = vec![0x01];
        frame.extend_from_slice(json.as_bytes());
        assert!(decode_outer_frame(&frame).is_err(), "accepted {json}");
    }
}

#[test]
fn length_prefix_decoder_rejects_before_allocation_and_handles_splits_and_batches() {
    let raw = fs::read(fixtures().join("status-request.bin")).expect("fixture");
    let framed = encode_length_prefixed(&raw).expect("prefix");
    let mut decoder = LengthPrefixedDecoder::new();
    assert!(decoder.push(&framed[..2]).expect("split header").is_empty());
    assert!(decoder.push(&framed[2..7]).expect("split body").is_empty());
    assert_eq!(
        decoder.push(&framed[7..]).expect("finish"),
        vec![raw.clone()]
    );
    decoder.finish().expect("complete stream");

    let mut batch = framed.clone();
    batch.extend_from_slice(&framed);
    let mut decoder = LengthPrefixedDecoder::new();
    assert_eq!(decoder.push(&batch).expect("batch"), vec![raw.clone(), raw]);

    for length in [0_u32, 4_194_322] {
        let mut decoder = LengthPrefixedDecoder::new();
        assert!(decoder.push(&length.to_be_bytes()).is_err());
    }
}

#[test]
fn correlates_an_immutable_png_and_fails_closed_on_orphan_mismatch_and_lateness() {
    let json = fs::read(fixtures().join("browser-snapshot-json.bin")).expect("json");
    let png = fs::read(fixtures().join("browser-snapshot-png.bin")).expect("png");
    let mut decoder = EnvelopeDecoder::new(Direction::Any);
    assert!(decoder.push(&json).expect("json").is_empty());
    let envelopes = decoder.push(&png).expect("png");
    let image = envelopes[0].png.as_ref().expect("image");
    let mut first = image.read();
    first[0] = 0;
    assert_eq!(image.read()[0], 0x89);

    let mut orphan = EnvelopeDecoder::new(Direction::Any);
    assert!(orphan.push(&png).is_err());
    assert!(orphan.push(&json).is_err(), "decoder must remain closed");

    let mut mismatched = png.clone();
    mismatched[16] ^= 1;
    let mut decoder = EnvelopeDecoder::new(Direction::Any);
    assert!(decoder.push(&json).expect("json").is_empty());
    assert!(decoder.push(&mismatched).is_err());

    let mut late = EnvelopeDecoder::new(Direction::Any);
    assert!(late.push(&json).expect("json").is_empty());
    assert!(late.finish().is_err());
}

#[test]
fn rejects_wrong_direction_before_waiting_for_a_declared_png() {
    let json = fs::read(fixtures().join("browser-snapshot-json.bin")).expect("json");
    let mut decoder = EnvelopeDecoder::new(Direction::ElectronToHelper);
    assert!(decoder.push(&json).is_err());
}
