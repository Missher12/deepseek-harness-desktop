//! Strict, bounded protocol-v1 framing shared by Electron and the native helper.

use std::collections::{HashSet, VecDeque};
use std::fmt;

use serde::Deserializer;
use serde::de::{self, DeserializeSeed, MapAccess, SeqAccess, Visitor};
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};

const JSON_TAG: u8 = 0x01;
const PNG_TAG: u8 = 0x02;
const MAX_JSON_PAYLOAD: usize = 65_536;
const MAX_OUTER_FRAME: usize = 4_194_321;
const MAX_PNG_BYTES: usize = 4_194_304;
const MIN_PNG_FRAME: usize = 18;
const PNG_SIGNATURE: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a];
const MANIFEST_TEXT: &str =
    include_str!("../../../../../packages/control/desktop-control-protocol/protocol-v1.json");

const HELPER_KINDS: &[&str] = &[
    "status",
    "list",
    "snapshot",
    "focus",
    "click",
    "double-click",
    "drag",
    "type",
    "key",
    "scroll",
    "wait",
    "stop",
    "lease.install",
    "input.release",
];
const CONTROL_KINDS: &[&str] = &[
    "request.cancel",
    "session.revoke",
    "lease.revoke",
    "parent.shutdown",
];
const ERROR_CODES: &[&str] = &[
    "NOT_SUPPORTED",
    "UNAUTHORIZED",
    "LEASE_EXPIRED",
    "LEASE_REVOKED",
    "STALE_REF",
    "TARGET_CLOSED",
    "PERMISSION_DENIED",
    "POLICY_DENIED",
    "DUPLICATE_REQUEST",
    "TOO_MANY_PENDING",
    "QUOTA_EXCEEDED",
    "BINARY_MISMATCH",
    "BUSY",
    "TIMEOUT",
    "CANCELLED",
    "DISCONNECTED",
    "INTERNAL",
];

/// A protocol violation. Callers must close only the dedicated helper link.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProtocolError(String);

impl ProtocolError {
    fn new(message: impl Into<String>) -> Self {
        Self(message.into())
    }
}

impl fmt::Display for ProtocolError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl std::error::Error for ProtocolError {}

type Result<T> = std::result::Result<T, ProtocolError>;

/// Validate that the helper was built against the exact checked-in manifest roster.
pub fn validate_embedded_manifest() -> Result<()> {
    let manifest: Value = serde_json::from_str(MANIFEST_TEXT)
        .map_err(|_| ProtocolError::new("embedded protocol manifest is invalid"))?;
    let root = object(&manifest, "manifest")?;
    integer(field(root, "protocolVersion")?, "protocolVersion", 1, 1)?;
    exact_string_array(field(root, "helperRequestKinds")?, HELPER_KINDS)?;
    exact_string_array(field(root, "controlKinds")?, CONTROL_KINDS)?;
    exact_string_array(field(root, "errorCodes")?, ERROR_CODES)?;
    let limits = object(field(root, "limits")?, "limits")?;
    for (name, expected) in [
        ("jsonPayloadBytes", MAX_JSON_PAYLOAD as u64),
        ("outerFrameBytes", MAX_OUTER_FRAME as u64),
        ("pngBytes", MAX_PNG_BYTES as u64),
        ("minPngFrameBytes", MIN_PNG_FRAME as u64),
    ] {
        integer(field(limits, name)?, name, expected, expected)?;
    }
    Ok(())
}

fn exact_string_array(value: &Value, expected: &[&str]) -> Result<()> {
    let actual = value
        .as_array()
        .ok_or_else(|| ProtocolError::new("manifest roster must be an array"))?;
    if actual.len() != expected.len()
        || actual
            .iter()
            .zip(expected)
            .any(|(item, expected)| item.as_str() != Some(expected))
    {
        return Err(ProtocolError::new("embedded protocol roster mismatch"));
    }
    Ok(())
}

struct StrictValue;

impl<'de> DeserializeSeed<'de> for StrictValue {
    type Value = Value;

    fn deserialize<D>(self, deserializer: D) -> std::result::Result<Value, D::Error>
    where
        D: Deserializer<'de>,
    {
        deserializer.deserialize_any(StrictValueVisitor)
    }
}

struct StrictValueVisitor;

impl<'de> Visitor<'de> for StrictValueVisitor {
    type Value = Value;

    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("an RFC 8259 JSON value")
    }

    fn visit_bool<E>(self, value: bool) -> std::result::Result<Value, E> {
        Ok(Value::Bool(value))
    }

    fn visit_i64<E>(self, value: i64) -> std::result::Result<Value, E> {
        Ok(Value::Number(value.into()))
    }

    fn visit_u64<E>(self, value: u64) -> std::result::Result<Value, E> {
        Ok(Value::Number(value.into()))
    }

    fn visit_f64<E>(self, value: f64) -> std::result::Result<Value, E>
    where
        E: de::Error,
    {
        serde_json::Number::from_f64(value)
            .map(Value::Number)
            .ok_or_else(|| E::custom("JSON number must be finite"))
    }

    fn visit_str<E>(self, value: &str) -> std::result::Result<Value, E>
    where
        E: de::Error,
    {
        self.visit_string(value.to_owned())
    }

    fn visit_string<E>(self, value: String) -> std::result::Result<Value, E> {
        Ok(Value::String(value))
    }

    fn visit_none<E>(self) -> std::result::Result<Value, E> {
        Ok(Value::Null)
    }

    fn visit_unit<E>(self) -> std::result::Result<Value, E> {
        Ok(Value::Null)
    }

    fn visit_seq<A>(self, mut sequence: A) -> std::result::Result<Value, A::Error>
    where
        A: SeqAccess<'de>,
    {
        let mut values = Vec::new();
        while let Some(value) = sequence.next_element_seed(StrictValue)? {
            values.push(value);
        }
        Ok(Value::Array(values))
    }

    fn visit_map<A>(self, mut map: A) -> std::result::Result<Value, A::Error>
    where
        A: MapAccess<'de>,
    {
        let mut values = Map::new();
        let mut seen = HashSet::new();
        while let Some(key) = map.next_key::<String>()? {
            if matches!(key.as_str(), "__proto__" | "prototype" | "constructor") {
                return Err(de::Error::custom("dangerous JSON key"));
            }
            if !seen.insert(key.clone()) {
                return Err(de::Error::custom("duplicate JSON key"));
            }
            values.insert(key, map.next_value_seed(StrictValue)?);
        }
        Ok(Value::Object(values))
    }
}

fn parse_strict_json(bytes: &[u8]) -> Result<Value> {
    let text = std::str::from_utf8(bytes)
        .map_err(|_| ProtocolError::new("JSON frame is not valid UTF-8"))?;
    let mut deserializer = serde_json::Deserializer::from_str(text);
    let value = StrictValue
        .deserialize(&mut deserializer)
        .map_err(|error| ProtocolError::new(format!("invalid JSON frame: {error}")))?;
    deserializer
        .end()
        .map_err(|_| ProtocolError::new("trailing JSON data"))?;
    Ok(value)
}

fn object<'a>(value: &'a Value, label: &str) -> Result<&'a Map<String, Value>> {
    value
        .as_object()
        .ok_or_else(|| ProtocolError::new(format!("{label} must be an object")))
}

fn field<'a>(object: &'a Map<String, Value>, key: &str) -> Result<&'a Value> {
    object
        .get(key)
        .ok_or_else(|| ProtocolError::new(format!("missing field {key}")))
}

fn string<'a>(value: &'a Value, label: &str, max_bytes: usize, empty: bool) -> Result<&'a str> {
    let value = value
        .as_str()
        .ok_or_else(|| ProtocolError::new(format!("{label} must be a string")))?;
    if (!empty && value.is_empty()) || value.len() > max_bytes {
        return Err(ProtocolError::new(format!("{label} is out of bounds")));
    }
    Ok(value)
}

fn integer(value: &Value, label: &str, minimum: u64, maximum: u64) -> Result<u64> {
    let value = value
        .as_u64()
        .ok_or_else(|| ProtocolError::new(format!("{label} must be an unsigned integer")))?;
    if value < minimum || value > maximum || value > 9_007_199_254_740_991 {
        return Err(ProtocolError::new(format!("{label} is out of bounds")));
    }
    Ok(value)
}

fn number(value: &Value, label: &str, minimum: f64, maximum: f64) -> Result<f64> {
    let value = value
        .as_f64()
        .ok_or_else(|| ProtocolError::new(format!("{label} must be a number")))?;
    if !value.is_finite() || value < minimum || value > maximum {
        return Err(ProtocolError::new(format!("{label} is out of bounds")));
    }
    Ok(value)
}

fn boolean(value: &Value, label: &str) -> Result<()> {
    value
        .is_boolean()
        .then_some(())
        .ok_or_else(|| ProtocolError::new(format!("{label} must be boolean")))
}

fn exact_keys(object: &Map<String, Value>, required: &[String], optional: &[&str]) -> Result<()> {
    let required_set: HashSet<&str> = required.iter().map(String::as_str).collect();
    let optional: HashSet<&str> = optional.iter().copied().collect();
    for key in object.keys() {
        if !required_set.contains(key.as_str()) && !optional.contains(key.as_str()) {
            return Err(ProtocolError::new(format!("unknown field {key}")));
        }
    }
    for key in required {
        if !object.contains_key(key) {
            return Err(ProtocolError::new(format!("missing field {key}")));
        }
    }
    Ok(())
}

fn uuid(value: &Value, label: &str) -> Result<String> {
    let value = string(value, label, 64, false)?;
    let bytes = value.as_bytes();
    let valid = bytes.len() == 36
        && [8, 13, 18, 23].iter().all(|index| bytes[*index] == b'-')
        && bytes[14] == b'4'
        && matches!(bytes[19], b'8' | b'9' | b'a' | b'b')
        && bytes.iter().enumerate().all(|(index, byte)| {
            [8, 13, 18, 23].contains(&index)
                || byte.is_ascii_digit()
                || (b'a'..=b'f').contains(byte)
        });
    if !valid {
        return Err(ProtocolError::new(format!(
            "{label} has invalid UUID format"
        )));
    }
    Ok(value.to_owned())
}

fn computer_ref(value: &Value, label: &str) -> Result<()> {
    let value = string(value, label, 64, false)?;
    let suffix = value
        .strip_prefix("computer:")
        .ok_or_else(|| ProtocolError::new(format!("{label} is not a computer ref")))?;
    if suffix.len() != 32
        || !suffix
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(ProtocolError::new(format!("{label} is not a computer ref")));
    }
    Ok(())
}

fn manifest() -> Result<Value> {
    serde_json::from_str(MANIFEST_TEXT)
        .map_err(|_| ProtocolError::new("embedded protocol manifest is invalid"))
}

fn manifest_strings(manifest: &Value, key: &str) -> Result<Vec<String>> {
    field(object(manifest, "manifest")?, key)?
        .as_array()
        .ok_or_else(|| ProtocolError::new("manifest roster must be an array"))?
        .iter()
        .map(|value| string(value, key, 128, false).map(ToOwned::to_owned))
        .collect()
}

fn matrix_fields(manifest: &Value, matrix: &str, kind: &str) -> Result<Vec<String>> {
    let matrix = object(field(object(manifest, "manifest")?, matrix)?, matrix)?;
    field(matrix, kind)?
        .as_array()
        .ok_or_else(|| ProtocolError::new("manifest field matrix must be an array"))?
        .iter()
        .map(|value| string(value, "field name", 128, false).map(ToOwned::to_owned))
        .collect()
}

fn validate_message(value: &Value) -> Result<MessageFacts> {
    let message = object(value, "protocol message")?;
    integer(field(message, "protocolVersion")?, "protocolVersion", 1, 1)?;
    match string(field(message, "messageKind")?, "messageKind", 16, false)? {
        "request" => validate_request(message),
        "response" => validate_response(message),
        "control" => validate_control(message),
        _ => Err(ProtocolError::new("messageKind is unknown")),
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum MessageDirection {
    ElectronToHelper,
    HelperToElectron,
    Bridge,
}

#[derive(Clone)]
struct MessageFacts {
    direction: MessageDirection,
    image: Option<ImageMetadata>,
}

fn validate_request(message: &Map<String, Value>) -> Result<MessageFacts> {
    let kind = string(field(message, "requestKind")?, "requestKind", 64, false)?;
    let manifest = manifest()?;
    let helper = manifest_strings(&manifest, "helperRequestKinds")?;
    let bridge = manifest_strings(&manifest, "bridgeRequestKinds")?;
    let (base, matrix, direction) = if helper.iter().any(|candidate| candidate == kind) {
        (
            [
                "protocolVersion",
                "messageKind",
                "requestKind",
                "requestId",
                "sessionId",
                "timeoutMs",
            ],
            "helperRequestFields",
            MessageDirection::ElectronToHelper,
        )
    } else if bridge.iter().any(|candidate| candidate == kind) {
        (
            [
                "protocolVersion",
                "messageKind",
                "requestKind",
                "requestId",
                "sessionId",
                "deadlineUnixMs",
            ],
            "bridgeRequestFields",
            MessageDirection::Bridge,
        )
    } else {
        return Err(ProtocolError::new("unknown requestKind"));
    };
    let mut required = base
        .iter()
        .map(|field| (*field).to_owned())
        .collect::<Vec<_>>();
    required.extend(matrix_fields(&manifest, matrix, kind)?);
    let optional: &[&str] = match kind {
        "click"
        | "double-click"
        | "scroll"
        | "computer.click"
        | "computer.double-click"
        | "computer.scroll" => &["ref", "x", "y"],
        "browser.scroll" => &["ref"],
        "browser.wait" => &["durationMs"],
        _ => &[],
    };
    required.retain(|field| !optional.contains(&field.as_str()));
    exact_keys(message, &required, optional)?;
    uuid(field(message, "requestId")?, "requestId")?;
    string(field(message, "sessionId")?, "sessionId", 128, false)?;
    if direction == MessageDirection::ElectronToHelper {
        integer(field(message, "timeoutMs")?, "timeoutMs", 1, 30_000)?;
    } else {
        integer(
            field(message, "deadlineUnixMs")?,
            "deadlineUnixMs",
            0,
            9_007_199_254_740_991,
        )?;
    }
    validate_request_fields(message, kind)?;
    Ok(MessageFacts {
        direction,
        image: None,
    })
}

fn validate_request_fields(message: &Map<String, Value>, kind: &str) -> Result<()> {
    if matches!(
        kind,
        "status"
            | "list"
            | "desktop.status"
            | "browser.stop"
            | "computer.status"
            | "computer.list"
            | "computer.stop"
    ) {
        return Ok(());
    }
    if kind == "input.release" {
        validate_release_keys(field(message, "keys")?)?;
        validate_literals(
            field(message, "buttons")?,
            &["left", "middle", "right"],
            "buttons",
            64,
        )?;
        return Ok(());
    }
    if kind == "lease.install" {
        validate_lease_fields(message)?;
        string(field(message, "agentId")?, "agentId", 256, false)?;
        validate_targets(field(message, "targets")?, true)?;
        validate_literals(
            field(message, "capabilities")?,
            &["observe", "pointer", "keyboard"],
            "capabilities",
            3,
        )?;
        let quotas = object(field(message, "quotas")?, "quotas")?;
        let quota_fields = [
            "operations",
            "snapshots",
            "pointerActions",
            "keyActions",
            "textBytes",
        ]
        .map(str::to_owned);
        exact_keys(quotas, &quota_fields, &[])?;
        for field_name in quota_fields {
            integer(field(quotas, &field_name)?, &field_name, 0, 1_000_000)?;
        }
        integer(
            field(message, "idleExpiresAfterMs")?,
            "idleExpiresAfterMs",
            1,
            300_000,
        )?;
        integer(
            field(message, "hardExpiresAfterMs")?,
            "hardExpiresAfterMs",
            1,
            1_200_000,
        )?;
        return Ok(());
    }
    if kind == "control.lease.acquire" {
        let surface = string(field(message, "surfaceKind")?, "surfaceKind", 64, false)?;
        if !matches!(
            surface,
            "browser-ephemeral" | "browser-human-persistent" | "native-application"
        ) {
            return Err(ProtocolError::new("surfaceKind is unknown"));
        }
        validate_targets(field(message, "targets")?, surface == "native-application")?;
        validate_literals(
            field(message, "capabilities")?,
            &["observe", "pointer", "keyboard"],
            "capabilities",
            3,
        )?;
        return Ok(());
    }
    if kind == "control.lease.release" || kind == "stop" {
        return validate_lease_fields(message);
    }
    if kind.starts_with("browser.") {
        validate_lease_fields(message)?;
        if let Some(value) = message.get("ref") {
            let value = string(value, "ref", 64, false)?;
            if !valid_semantic_ref(value, "browser:") {
                return Err(ProtocolError::new("ref is not a browser ref"));
            }
        }
        if let Some(value) = message.get("durationMs") {
            integer(value, "durationMs", 0, 10_000)?;
        }
        return Ok(());
    }

    validate_target_fields(message)?;
    if let Some(value) = message.get("ref") {
        computer_ref(value, "ref")?;
    }
    if matches!(
        kind,
        "click"
            | "double-click"
            | "scroll"
            | "computer.click"
            | "computer.double-click"
            | "computer.scroll"
    ) {
        let has_ref = message.contains_key("ref");
        let has_x = message.contains_key("x");
        let has_y = message.contains_key("y");
        if has_ref == (has_x || has_y) || has_x != has_y {
            return Err(ProtocolError::new(
                "exactly one ref or coordinate pair is required",
            ));
        }
    }
    match kind {
        "snapshot" | "computer.snapshot" => {
            boolean(field(message, "includeImage")?, "includeImage")?;
        }
        "click" | "double-click" | "computer.click" | "computer.double-click" => {
            validate_literal(
                field(message, "button")?,
                &["left", "middle", "right"],
                "button",
            )?;
            validate_optional_pointer(message)?;
        }
        "drag" | "computer.drag" => {
            for name in ["fromX", "fromY", "toX", "toY"] {
                number(field(message, name)?, name, -1_000_000.0, 1_000_000.0)?;
            }
            validate_literal(
                field(message, "button")?,
                &["left", "middle", "right"],
                "button",
            )?;
        }
        "type" | "computer.type" => {
            string(field(message, "text")?, "text", 49_152, true)?;
        }
        "key" | "computer.key" => {
            let key = string(field(message, "key")?, "key", 64, false)?;
            if !valid_key(key) {
                return Err(ProtocolError::new("key is outside the closed vocabulary"));
            }
            validate_literals(
                field(message, "modifiers")?,
                &["Alt", "Control", "Meta", "Shift"],
                "modifiers",
                4,
            )?;
        }
        "scroll" | "computer.scroll" => {
            validate_optional_pointer(message)?;
            for name in ["deltaX", "deltaY"] {
                number(field(message, name)?, name, -1_000_000.0, 1_000_000.0)?;
            }
        }
        "wait" | "computer.wait" => {
            integer(field(message, "durationMs")?, "durationMs", 0, 10_000)?;
        }
        _ => {}
    }
    Ok(())
}

fn validate_optional_pointer(message: &Map<String, Value>) -> Result<()> {
    if message.contains_key("x") {
        number(field(message, "x")?, "x", -1_000_000.0, 1_000_000.0)?;
        number(field(message, "y")?, "y", -1_000_000.0, 1_000_000.0)?;
    }
    Ok(())
}

fn validate_literal(value: &Value, allowed: &[&str], label: &str) -> Result<()> {
    let value = string(value, label, 256, false)?;
    if !allowed.contains(&value) {
        return Err(ProtocolError::new(format!("{label} is unknown")));
    }
    Ok(())
}

fn valid_key(value: &str) -> bool {
    matches!(
        value,
        "A" | "B"
            | "C"
            | "D"
            | "E"
            | "F"
            | "G"
            | "H"
            | "I"
            | "J"
            | "K"
            | "L"
            | "M"
            | "N"
            | "O"
            | "P"
            | "Q"
            | "R"
            | "S"
            | "T"
            | "U"
            | "V"
            | "W"
            | "X"
            | "Y"
            | "Z"
            | "0"
            | "1"
            | "2"
            | "3"
            | "4"
            | "5"
            | "6"
            | "7"
            | "8"
            | "9"
            | "Enter"
            | "Tab"
            | "Space"
            | "Backspace"
            | "Escape"
            | "Delete"
            | "Home"
            | "End"
            | "PageUp"
            | "PageDown"
            | "ArrowLeft"
            | "ArrowRight"
            | "ArrowDown"
            | "ArrowUp"
            | "F1"
            | "F2"
            | "F3"
            | "F4"
            | "F5"
            | "F6"
            | "F7"
            | "F8"
            | "F9"
            | "F10"
            | "F11"
            | "F12"
    )
}

fn validate_lease_fields(message: &Map<String, Value>) -> Result<()> {
    uuid(field(message, "leaseId")?, "leaseId")?;
    integer(
        field(message, "leaseRevision")?,
        "leaseRevision",
        1,
        9_007_199_254_740_991,
    )?;
    Ok(())
}

fn validate_target_fields(message: &Map<String, Value>) -> Result<()> {
    validate_lease_fields(message)?;
    string(field(message, "appId")?, "appId", 256, false)?;
    string(field(message, "windowId")?, "windowId", 256, false)?;
    integer(
        field(message, "snapshotRevision")?,
        "snapshotRevision",
        1,
        9_007_199_254_740_991,
    )?;
    Ok(())
}

fn validate_targets(value: &Value, native: bool) -> Result<()> {
    let targets = value
        .as_array()
        .ok_or_else(|| ProtocolError::new("targets must be an array"))?;
    if targets.len() > 128 || (native && targets.is_empty()) || (!native && !targets.is_empty()) {
        return Err(ProtocolError::new("targets do not match surfaceKind"));
    }
    let mut apps = HashSet::new();
    let mut windows = HashSet::new();
    for target in targets {
        let target = object(target, "target")?;
        let fields = ["appId", "windowIds"].map(str::to_owned);
        exact_keys(target, &fields, &[])?;
        let app_id = string(field(target, "appId")?, "appId", 256, false)?;
        if !apps.insert(app_id) {
            return Err(ProtocolError::new("duplicate target appId"));
        }
        let window_ids = field(target, "windowIds")?
            .as_array()
            .ok_or_else(|| ProtocolError::new("windowIds must be an array"))?;
        if window_ids.is_empty() || window_ids.len() > 256 {
            return Err(ProtocolError::new("windowIds is out of bounds"));
        }
        for window_id in window_ids {
            let window_id = string(window_id, "windowId", 256, false)?;
            if !windows.insert(window_id) {
                return Err(ProtocolError::new("duplicate target windowId"));
            }
        }
    }
    Ok(())
}

fn validate_literals(value: &Value, allowed: &[&str], label: &str, maximum: usize) -> Result<()> {
    let values = value
        .as_array()
        .ok_or_else(|| ProtocolError::new(format!("{label} must be an array")))?;
    if values.len() > maximum || (label == "capabilities" && values.is_empty()) {
        return Err(ProtocolError::new(format!("{label} is out of bounds")));
    }
    let mut seen = HashSet::new();
    for value in values {
        let value = string(value, label, 256, false)?;
        if !allowed.contains(&value) || !seen.insert(value) {
            return Err(ProtocolError::new(format!(
                "{label} contains an invalid item"
            )));
        }
    }
    Ok(())
}

fn validate_release_keys(value: &Value) -> Result<()> {
    let values = value
        .as_array()
        .ok_or_else(|| ProtocolError::new("keys must be an array"))?;
    if values.len() > 64 {
        return Err(ProtocolError::new("keys is out of bounds"));
    }
    let mut seen = HashSet::new();
    for value in values {
        let value = string(value, "keys", 64, false)?;
        if (!valid_key(value) && !matches!(value, "Alt" | "Control" | "Meta" | "Shift"))
            || !seen.insert(value)
        {
            return Err(ProtocolError::new("keys contains an invalid item"));
        }
    }
    Ok(())
}

fn valid_semantic_ref(value: &str, prefix: &str) -> bool {
    value.strip_prefix(prefix).is_some_and(|suffix| {
        suffix.len() == 32
            && suffix
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    })
}

fn validate_response(message: &Map<String, Value>) -> Result<MessageFacts> {
    let kind = string(field(message, "requestKind")?, "requestKind", 64, false)?;
    let manifest = manifest()?;
    let mut all_kinds = manifest_strings(&manifest, "bridgeRequestKinds")?;
    all_kinds.extend(manifest_strings(&manifest, "helperRequestKinds")?);
    if !all_kinds.iter().any(|candidate| candidate == kind) {
        return Err(ProtocolError::new("unknown response requestKind"));
    }
    let response_kind = string(field(message, "responseKind")?, "responseKind", 16, false)?;
    let terminal = if response_kind == "ok" {
        "result"
    } else if response_kind == "error" {
        "error"
    } else {
        return Err(ProtocolError::new("responseKind is unknown"));
    };
    let required = [
        "protocolVersion",
        "messageKind",
        "responseKind",
        "requestKind",
        "requestId",
        terminal,
    ]
    .map(str::to_owned);
    exact_keys(message, &required, &[])?;
    uuid(field(message, "requestId")?, "requestId")?;
    let image = if response_kind == "ok" {
        validate_result(field(message, "result")?, kind, &manifest)?
    } else {
        validate_error(field(message, "error")?)?;
        None
    };
    let direction = if HELPER_KINDS.contains(&kind) {
        MessageDirection::HelperToElectron
    } else {
        MessageDirection::Bridge
    };
    Ok(MessageFacts { direction, image })
}

fn validate_result(value: &Value, kind: &str, manifest: &Value) -> Result<Option<ImageMetadata>> {
    let result = object(value, "result")?;
    let mut required = matrix_fields(manifest, "resultFields", kind)?;
    let optional = if matches!(kind, "browser.snapshot" | "computer.snapshot" | "snapshot") {
        required.retain(|field| field != "image");
        &["image"][..]
    } else {
        &[][..]
    };
    exact_keys(result, &required, optional)?;
    if let Some(image) = result.get("image") {
        return Ok(Some(validate_image_metadata(image)?));
    }
    Ok(None)
}

fn validate_error(value: &Value) -> Result<()> {
    let error = object(value, "error")?;
    let required = ["code", "message", "retryable"].map(str::to_owned);
    exact_keys(error, &required, &[])?;
    let code = string(field(error, "code")?, "error.code", 64, false)?;
    if !ERROR_CODES.contains(&code) {
        return Err(ProtocolError::new("unknown error code"));
    }
    string(field(error, "message")?, "error.message", 512, true)?;
    if !field(error, "retryable")?.is_boolean() {
        return Err(ProtocolError::new("retryable must be boolean"));
    }
    Ok(())
}

fn validate_control(message: &Map<String, Value>) -> Result<MessageFacts> {
    let kind = string(field(message, "controlKind")?, "controlKind", 64, false)?;
    if !CONTROL_KINDS.contains(&kind) {
        return Err(ProtocolError::new("unknown controlKind"));
    }
    let manifest = manifest()?;
    let mut required = ["protocolVersion", "messageKind", "controlKind"]
        .map(str::to_owned)
        .to_vec();
    required.extend(matrix_fields(&manifest, "controlFields", kind)?);
    exact_keys(message, &required, &[])?;
    if let Some(session_id) = message.get("sessionId") {
        string(session_id, "sessionId", 128, false)?;
    }
    if let Some(request_id) = message.get("requestId") {
        uuid(request_id, "requestId")?;
    }
    if message.contains_key("leaseId") {
        validate_lease_fields(message)?;
    }
    Ok(MessageFacts {
        direction: MessageDirection::ElectronToHelper,
        image: None,
    })
}

#[derive(Clone)]
struct ImageMetadata {
    transfer_id: String,
    byte_length: usize,
    sha256: String,
    width: u32,
    height: u32,
}

fn validate_image_metadata(value: &Value) -> Result<ImageMetadata> {
    let image = object(value, "image")?;
    let required = ["transferId", "byteLength", "sha256", "width", "height"].map(str::to_owned);
    exact_keys(image, &required, &[])?;
    let transfer_id = uuid(field(image, "transferId")?, "transferId")?;
    let byte_length = integer(
        field(image, "byteLength")?,
        "byteLength",
        1,
        MAX_PNG_BYTES as u64,
    )? as usize;
    let sha256 = string(field(image, "sha256")?, "sha256", 64, false)?;
    if sha256.len() != 64
        || !sha256
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(ProtocolError::new("sha256 must be lowercase hexadecimal"));
    }
    let width = integer(field(image, "width")?, "width", 1, 100_000)? as u32;
    let height = integer(field(image, "height")?, "height", 1, 100_000)? as u32;
    Ok(ImageMetadata {
        transfer_id,
        byte_length,
        sha256: sha256.to_owned(),
        width,
        height,
    })
}

/// A decoded JSON frame. `raw` is retained for a byte-exact fixture round trip.
#[derive(Clone)]
pub struct JsonFrame {
    raw: Vec<u8>,
    /// Strictly decoded JSON value.
    pub message: Value,
    facts: MessageFacts,
}

/// Immutable PNG bytes. Every reader receives a fresh copy.
#[derive(Clone)]
pub struct ImmutablePng(Vec<u8>);

impl ImmutablePng {
    /// Read a detached copy of the retained PNG.
    #[must_use]
    pub fn read(&self) -> Vec<u8> {
        self.0.clone()
    }
}

/// A helper-authored PNG and the metadata derived from its exact bytes.
pub struct AuthoredPng {
    transfer_id: String,
    png: Vec<u8>,
    width: u32,
    height: u32,
    sha256: String,
}

impl AuthoredPng {
    /// Create a deterministic, request-bound transfer without introducing a second protocol.
    pub fn for_request(request_id: &str, png: Vec<u8>) -> Result<Self> {
        uuid(&Value::String(request_id.to_owned()), "requestId")?;
        if png.is_empty() || png.len() > MAX_PNG_BYTES {
            return Err(ProtocolError::new("PNG payload is out of bounds"));
        }
        let (width, height) = png_dimensions(&png)?;
        let sha256 = format!("{:x}", Sha256::digest(&png));
        let mut transfer = Sha256::new();
        transfer.update(request_id.as_bytes());
        transfer.update(sha256.as_bytes());
        let digest = transfer.finalize();
        let mut bytes: [u8; 16] = digest[..16].try_into().expect("16-byte digest prefix");
        bytes[6] = (bytes[6] & 0x0f) | 0x40;
        bytes[8] = (bytes[8] & 0x3f) | 0x80;
        let transfer_id = bytes_to_uuid(&bytes)?;
        Ok(Self {
            transfer_id,
            png,
            width,
            height,
            sha256,
        })
    }

    /// Exact protocol image metadata for the adjacent frame.
    #[must_use]
    pub fn metadata(&self) -> Value {
        serde_json::json!({
            "transferId": self.transfer_id,
            "byteLength": self.png.len(),
            "sha256": self.sha256,
            "width": self.width,
            "height": self.height,
        })
    }

    /// Encode the bounded binary outer frame adjacent to the declaring JSON response.
    pub fn encode_frame(&self) -> Result<Vec<u8>> {
        let mut frame = Vec::with_capacity(self.png.len() + 17);
        frame.push(PNG_TAG);
        frame.extend_from_slice(&uuid_to_bytes(&self.transfer_id)?);
        frame.extend_from_slice(&self.png);
        decode_outer_frame(&frame)?;
        Ok(frame)
    }
}

/// A decoded PNG transfer frame.
#[derive(Clone)]
pub struct PngFrame {
    raw: Vec<u8>,
    transfer_id: String,
    png: ImmutablePng,
    width: u32,
    height: u32,
}

/// One complete protocol outer frame.
#[derive(Clone)]
pub enum OuterFrame {
    /// JSON frame.
    Json(JsonFrame),
    /// Binary PNG transfer frame.
    Png(PngFrame),
}

/// Strictly decode one complete tagged outer frame.
pub fn decode_outer_frame(bytes: &[u8]) -> Result<OuterFrame> {
    if bytes.is_empty() || bytes.len() > MAX_OUTER_FRAME {
        return Err(ProtocolError::new("outer frame is out of bounds"));
    }
    match bytes[0] {
        JSON_TAG => {
            if bytes.len() < 2 || bytes.len() - 1 > MAX_JSON_PAYLOAD {
                return Err(ProtocolError::new("JSON frame is out of bounds"));
            }
            let message = parse_strict_json(&bytes[1..])?;
            let facts = validate_message(&message)?;
            Ok(OuterFrame::Json(JsonFrame {
                raw: bytes.to_vec(),
                message,
                facts,
            }))
        }
        PNG_TAG => decode_png_frame(bytes).map(OuterFrame::Png),
        _ => Err(ProtocolError::new("outer frame tag is unknown")),
    }
}

fn decode_png_frame(bytes: &[u8]) -> Result<PngFrame> {
    if bytes.len() < MIN_PNG_FRAME || bytes.len() - 17 > MAX_PNG_BYTES {
        return Err(ProtocolError::new("PNG frame is out of bounds"));
    }
    let transfer_id = bytes_to_uuid(&bytes[1..17])?;
    let png = &bytes[17..];
    let (width, height) = png_dimensions(png)?;
    Ok(PngFrame {
        raw: bytes.to_vec(),
        transfer_id,
        png: ImmutablePng(png.to_vec()),
        width,
        height,
    })
}

/// Re-emit one decoded frame without changing fixture bytes.
pub fn encode_outer_frame(frame: &OuterFrame) -> Result<Vec<u8>> {
    let raw = match frame {
        OuterFrame::Json(frame) => frame.raw.clone(),
        OuterFrame::Png(frame) => frame.raw.clone(),
    };
    if raw.is_empty() || raw.len() > MAX_OUTER_FRAME {
        return Err(ProtocolError::new("outer frame is out of bounds"));
    }
    Ok(raw)
}

fn bytes_to_uuid(bytes: &[u8]) -> Result<String> {
    if bytes.len() != 16 {
        return Err(ProtocolError::new("transfer UUID must be 16 bytes"));
    }
    let hex = bytes
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    let value = format!(
        "{}-{}-{}-{}-{}",
        &hex[0..8],
        &hex[8..12],
        &hex[12..16],
        &hex[16..20],
        &hex[20..32]
    );
    uuid(&Value::String(value.clone()), "transferId")?;
    Ok(value)
}

fn uuid_to_bytes(value: &str) -> Result<[u8; 16]> {
    uuid(&Value::String(value.to_owned()), "transferId")?;
    let compact = value
        .bytes()
        .filter(|byte| *byte != b'-')
        .collect::<Vec<_>>();
    let mut result = [0_u8; 16];
    for (index, pair) in compact.chunks_exact(2).enumerate() {
        let text = std::str::from_utf8(pair)
            .map_err(|_| ProtocolError::new("transfer UUID is invalid"))?;
        result[index] = u8::from_str_radix(text, 16)
            .map_err(|_| ProtocolError::new("transfer UUID is invalid"))?;
    }
    Ok(result)
}

fn png_dimensions(bytes: &[u8]) -> Result<(u32, u32)> {
    if bytes.len() < 24 || bytes[..8] != PNG_SIGNATURE || &bytes[12..16] != b"IHDR" {
        return Err(ProtocolError::new("PNG structure is invalid"));
    }
    let width = u32::from_be_bytes(bytes[16..20].try_into().expect("four-byte width"));
    let height = u32::from_be_bytes(bytes[20..24].try_into().expect("four-byte height"));
    if width == 0 || height == 0 || width > 100_000 || height > 100_000 {
        return Err(ProtocolError::new("PNG dimensions are invalid"));
    }
    Ok((width, height))
}

/// Add the four-byte big-endian transport length prefix.
pub fn encode_length_prefixed(frame: &[u8]) -> Result<Vec<u8>> {
    if frame.is_empty() || frame.len() > MAX_OUTER_FRAME {
        return Err(ProtocolError::new("outer frame is out of bounds"));
    }
    let mut encoded = Vec::with_capacity(frame.len() + 4);
    encoded.extend_from_slice(&(frame.len() as u32).to_be_bytes());
    encoded.extend_from_slice(frame);
    Ok(encoded)
}

/// Incrementally decodes bounded four-byte length-prefixed outer frames.
#[derive(Default)]
pub struct LengthPrefixedDecoder {
    buffered: VecDeque<u8>,
    expected: Option<usize>,
    failed: bool,
}

impl LengthPrefixedDecoder {
    /// Construct an empty decoder without allocating a declared body.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Push an arbitrary transport chunk and return all complete detached frames.
    pub fn push(&mut self, chunk: &[u8]) -> Result<Vec<Vec<u8>>> {
        if self.failed {
            return Err(ProtocolError::new("length decoder is closed"));
        }
        if self.buffered.len().saturating_add(chunk.len()) > MAX_OUTER_FRAME.saturating_add(4) {
            self.failed = true;
            return Err(ProtocolError::new("transport buffer limit exceeded"));
        }
        self.buffered.extend(chunk.iter().copied());
        let mut frames = Vec::new();
        loop {
            if self.expected.is_none() {
                if self.buffered.len() < 4 {
                    break;
                }
                let prefix = [
                    self.buffered.pop_front().expect("length byte"),
                    self.buffered.pop_front().expect("length byte"),
                    self.buffered.pop_front().expect("length byte"),
                    self.buffered.pop_front().expect("length byte"),
                ];
                let expected = u32::from_be_bytes(prefix) as usize;
                if expected == 0 || expected > MAX_OUTER_FRAME {
                    self.failed = true;
                    return Err(ProtocolError::new("declared frame length is out of bounds"));
                }
                self.expected = Some(expected);
            }
            let expected = self.expected.expect("declared length");
            if self.buffered.len() < expected {
                break;
            }
            let frame = self.buffered.drain(..expected).collect::<Vec<_>>();
            self.expected = None;
            frames.push(frame);
        }
        Ok(frames)
    }

    /// Reject a truncated final prefix or body.
    pub fn finish(&mut self) -> Result<()> {
        if self.failed || self.expected.is_some() || !self.buffered.is_empty() {
            self.failed = true;
            return Err(ProtocolError::new("transport ended with a truncated frame"));
        }
        Ok(())
    }
}

/// Link direction enforced before accepting any declared image transfer.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Direction {
    /// Accept shared fixtures regardless of their transport owner.
    Any,
    /// Accept only Electron-authored helper requests and controls.
    ElectronToHelper,
    /// Accept only helper-authored responses.
    HelperToElectron,
}

/// A validated JSON message plus its correlated immutable PNG when declared.
pub struct Envelope {
    /// Strict JSON message.
    pub message: Value,
    /// Exact correlated image; absent for text-only messages.
    pub png: Option<ImmutablePng>,
}

/// Stateful JSON/PNG correlator that permanently closes on any protocol error.
pub struct EnvelopeDecoder {
    direction: Direction,
    pending: Option<JsonFrame>,
    failed: bool,
}

/// One validated Electron-to-helper request.
#[derive(Clone)]
pub struct HelperRequest {
    value: Value,
    request_id: String,
    session_id: String,
    request_kind: String,
    timeout_ms: u64,
}

impl HelperRequest {
    /// Closed helper request discriminant.
    #[must_use]
    pub fn request_kind(&self) -> &str {
        &self.request_kind
    }

    /// Correlation UUID.
    #[must_use]
    pub fn request_id(&self) -> &str {
        &self.request_id
    }

    /// Session owner identifier.
    #[must_use]
    pub fn session_id(&self) -> &str {
        &self.session_id
    }

    /// Caller-owned relative timeout.
    #[must_use]
    pub fn timeout_ms(&self) -> u64 {
        self.timeout_ms
    }

    /// Read a validated string field.
    #[must_use]
    pub fn string(&self, key: &str) -> Option<&str> {
        self.value.get(key).and_then(Value::as_str)
    }

    /// Read a validated unsigned-integer field.
    #[must_use]
    pub fn integer(&self, key: &str) -> Option<u64> {
        self.value.get(key).and_then(Value::as_u64)
    }

    /// Read a validated boolean field.
    #[must_use]
    pub fn boolean(&self, key: &str) -> Option<bool> {
        self.value.get(key).and_then(Value::as_bool)
    }

    /// Read a validated structured field without mutating it.
    #[must_use]
    pub fn field(&self, key: &str) -> Option<&Value> {
        self.value.get(key)
    }
}

/// One validated Electron-authored control message.
#[derive(Clone)]
pub struct ControlMessage {
    value: Value,
    control_kind: String,
}

impl ControlMessage {
    /// Closed control discriminant.
    #[must_use]
    pub fn control_kind(&self) -> &str {
        &self.control_kind
    }

    /// Read a validated string field.
    #[must_use]
    pub fn string(&self, key: &str) -> Option<&str> {
        self.value.get(key).and_then(Value::as_str)
    }

    /// Read a validated integer field.
    #[must_use]
    pub fn integer(&self, key: &str) -> Option<u64> {
        self.value.get(key).and_then(Value::as_u64)
    }
}

/// Only messages accepted by the native helper stdin link.
pub enum HelperInput {
    /// Bounded helper request.
    Request(HelperRequest),
    /// Revocation/cancellation/shutdown control.
    Control(ControlMessage),
}

/// Convert one already strict-decoded JSON value into the helper-only input union.
pub fn decode_helper_input(value: Value) -> Result<HelperInput> {
    let facts = validate_message(&value)?;
    if facts.direction != MessageDirection::ElectronToHelper {
        return Err(ProtocolError::new(
            "message is not Electron-to-helper input",
        ));
    }
    let message = object(&value, "protocol message")?;
    match field(message, "messageKind")?.as_str() {
        Some("request") => Ok(HelperInput::Request(HelperRequest {
            request_id: string(field(message, "requestId")?, "requestId", 64, false)?.to_owned(),
            session_id: string(field(message, "sessionId")?, "sessionId", 128, false)?.to_owned(),
            request_kind: string(field(message, "requestKind")?, "requestKind", 64, false)?
                .to_owned(),
            timeout_ms: integer(field(message, "timeoutMs")?, "timeoutMs", 1, 30_000)?,
            value,
        })),
        Some("control") => Ok(HelperInput::Control(ControlMessage {
            control_kind: string(field(message, "controlKind")?, "controlKind", 64, false)?
                .to_owned(),
            value,
        })),
        _ => Err(ProtocolError::new("message is not helper input")),
    }
}

/// One helper-authored response, validated again immediately before encoding.
pub struct HelperResponse {
    value: Value,
    png: Option<AuthoredPng>,
}

impl HelperResponse {
    /// Construct a successful response bound to its exact request.
    #[must_use]
    pub fn ok(request: &HelperRequest, result: Value) -> Self {
        Self {
            value: serde_json::json!({
                "protocolVersion": 1,
                "messageKind": "response",
                "responseKind": "ok",
                "requestKind": request.request_kind,
                "requestId": request.request_id,
                "result": result
            }),
            png: None,
        }
    }

    /// Construct a successful response and bind exact image metadata to its adjacent PNG.
    #[must_use]
    pub fn ok_with_png(request: &HelperRequest, mut result: Value, png: Vec<u8>) -> Self {
        let Ok(authored) = AuthoredPng::for_request(request.request_id(), png) else {
            return Self::error(request, "INTERNAL", false);
        };
        let Some(result) = result.as_object_mut() else {
            return Self::error(request, "INTERNAL", false);
        };
        result.insert("image".to_owned(), authored.metadata());
        Self {
            value: serde_json::json!({
                "protocolVersion": 1,
                "messageKind": "response",
                "responseKind": "ok",
                "requestKind": request.request_kind,
                "requestId": request.request_id,
                "result": Value::Object(result.clone())
            }),
            png: Some(authored),
        }
    }

    /// Construct a bounded generic error without carrying provider or OS text.
    #[must_use]
    pub fn error(request: &HelperRequest, code: &str, retryable: bool) -> Self {
        let code = if ERROR_CODES.contains(&code) {
            code
        } else {
            "INTERNAL"
        };
        Self {
            value: serde_json::json!({
                "protocolVersion": 1,
                "messageKind": "response",
                "responseKind": "error",
                "requestKind": request.request_kind,
                "requestId": request.request_id,
                "error": {
                    "code": code,
                    "message": "Native Computer Use request was not completed.",
                    "retryable": retryable
                }
            }),
            png: None,
        }
    }

    /// Consume the response as a JSON wire value.
    #[must_use]
    pub fn into_value(self) -> Value {
        self.value
    }

    /// Borrow the response for strict encoding.
    #[must_use]
    pub fn value(&self) -> &Value {
        &self.value
    }

    /// Borrow the correlated authored PNG, when this is an image snapshot.
    #[must_use]
    pub fn png(&self) -> Option<&AuthoredPng> {
        self.png.as_ref()
    }
}

/// Encode a newly-authored JSON protocol message after strict validation.
pub fn encode_json_value(value: &Value) -> Result<Vec<u8>> {
    validate_message(value)?;
    let payload = serde_json::to_vec(value)
        .map_err(|_| ProtocolError::new("JSON message could not be serialized"))?;
    if payload.len() > MAX_JSON_PAYLOAD {
        return Err(ProtocolError::new("JSON frame exceeds the payload limit"));
    }
    let mut frame = Vec::with_capacity(payload.len() + 1);
    frame.push(JSON_TAG);
    frame.extend_from_slice(&payload);
    decode_outer_frame(&frame)?;
    Ok(frame)
}

impl EnvelopeDecoder {
    /// Create an empty direction-bound correlator.
    #[must_use]
    pub fn new(direction: Direction) -> Self {
        Self {
            direction,
            pending: None,
            failed: false,
        }
    }

    /// Push one complete unprefixed outer frame.
    pub fn push(&mut self, bytes: &[u8]) -> Result<Vec<Envelope>> {
        if self.failed {
            return Err(ProtocolError::new("envelope decoder is closed"));
        }
        let result = self.push_open(bytes);
        if result.is_err() {
            self.pending = None;
            self.failed = true;
        }
        result
    }

    fn push_open(&mut self, bytes: &[u8]) -> Result<Vec<Envelope>> {
        match decode_outer_frame(bytes)? {
            OuterFrame::Json(frame) => {
                if self.pending.is_some() {
                    return Err(ProtocolError::new("declared PNG did not arrive next"));
                }
                self.validate_direction(&frame.facts)?;
                if frame.facts.image.is_some() {
                    self.pending = Some(frame);
                    Ok(Vec::new())
                } else {
                    Ok(vec![Envelope {
                        message: frame.message,
                        png: None,
                    }])
                }
            }
            OuterFrame::Png(frame) => {
                let json = self
                    .pending
                    .take()
                    .ok_or_else(|| ProtocolError::new("orphan PNG frame"))?;
                let metadata = json.facts.image.as_ref().expect("pending image metadata");
                if frame.transfer_id != metadata.transfer_id
                    || frame.png.0.len() != metadata.byte_length
                    || frame.width != metadata.width
                    || frame.height != metadata.height
                    || format!("{:x}", Sha256::digest(&frame.png.0)) != metadata.sha256
                {
                    return Err(ProtocolError::new("PNG correlation mismatch"));
                }
                Ok(vec![Envelope {
                    message: json.message,
                    png: Some(frame.png),
                }])
            }
        }
    }

    fn validate_direction(&self, facts: &MessageFacts) -> Result<()> {
        let accepted = match self.direction {
            Direction::Any => true,
            Direction::ElectronToHelper => facts.direction == MessageDirection::ElectronToHelper,
            Direction::HelperToElectron => facts.direction == MessageDirection::HelperToElectron,
        };
        if !accepted {
            return Err(ProtocolError::new("message direction is invalid"));
        }
        Ok(())
    }

    /// Reject a stream that ends while an image is pending.
    pub fn finish(&mut self) -> Result<()> {
        if self.failed || self.pending.is_some() {
            self.failed = true;
            self.pending = None;
            return Err(ProtocolError::new("envelope stream ended incomplete"));
        }
        Ok(())
    }
}
