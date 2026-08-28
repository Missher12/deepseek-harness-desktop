//! Closed, bounded macOS input and held-input cleanup.

use std::ffi::c_void;
use std::ptr::NonNull;

use computer_use_core::NativeInputCost;

const MAX_UNICODE_UNITS_PER_EVENT: usize = 20;

#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) struct Point {
    pub(super) x: f64,
    pub(super) y: f64,
}

impl Point {
    fn valid(self) -> bool {
        self.x.is_finite()
            && self.y.is_finite()
            && self.x.abs() <= 1_000_000.0
            && self.y.abs() <= 1_000_000.0
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub(super) enum Button {
    Left,
    Middle,
    Right,
}

impl Button {
    pub(super) fn parse(value: &str) -> Result<Self, &'static str> {
        match value {
            "left" => Ok(Self::Left),
            "middle" => Ok(Self::Middle),
            "right" => Ok(Self::Right),
            _ => Err("POLICY_DENIED"),
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub(super) enum Event {
    MouseMove(Point),
    MouseDown(Button, Point, i64),
    MouseUp(Button, Point, i64),
    MouseDrag(Button, Point),
    KeyDown(u16, Vec<u16>, u64),
    KeyUp(u16, u64),
    Scroll(Point, i32, i32),
}

pub(super) trait EventSink {
    fn post(&mut self, pid: Option<i32>, event: &Event) -> Result<(), &'static str>;

    fn cursor(&mut self) -> Result<Point, &'static str> {
        Ok(Point { x: 0.0, y: 0.0 })
    }
}

pub(super) enum InputCommand {
    Focus(Point),
    Click {
        point: Point,
        button: Button,
        count: u8,
    },
    Drag {
        from: Point,
        to: Point,
        button: Button,
    },
    Unicode(String),
    Key {
        key: String,
        modifiers: Vec<String>,
    },
    Scroll {
        point: Point,
        delta_x: i32,
        delta_y: i32,
    },
}

struct PlannedEvent {
    event: Event,
    cost: NativeInputCost,
}

struct HeldKey {
    pid: i32,
    code: u16,
}

struct HeldButton {
    pid: i32,
    button: Button,
    point: Point,
}

pub(super) struct InputController<S> {
    sink: S,
    held_keys: Vec<HeldKey>,
    held_buttons: Vec<HeldButton>,
}

impl<S> InputController<S>
where
    S: EventSink,
{
    pub(super) fn new(sink: S) -> Self {
        Self {
            sink,
            held_keys: Vec::new(),
            held_buttons: Vec::new(),
        }
    }

    fn plan(command: InputCommand) -> Result<Vec<PlannedEvent>, &'static str> {
        let mut events = Vec::new();
        match command {
            InputCommand::Focus(point) => {
                ensure_point(point)?;
                push_pointer(&mut events, Event::MouseMove(point));
                push_pointer(&mut events, Event::MouseDown(Button::Left, point, 1));
                push_pointer(&mut events, Event::MouseUp(Button::Left, point, 1));
            }
            InputCommand::Click {
                point,
                button,
                count,
            } => {
                ensure_point(point)?;
                if !matches!(count, 1 | 2) {
                    return Err("POLICY_DENIED");
                }
                push_pointer(&mut events, Event::MouseMove(point));
                for click in 1..=count {
                    push_pointer(
                        &mut events,
                        Event::MouseDown(button, point, i64::from(click)),
                    );
                    push_pointer(&mut events, Event::MouseUp(button, point, i64::from(click)));
                }
            }
            InputCommand::Drag { from, to, button } => {
                ensure_point(from)?;
                ensure_point(to)?;
                push_pointer(&mut events, Event::MouseMove(from));
                push_pointer(&mut events, Event::MouseDown(button, from, 1));
                push_pointer(&mut events, Event::MouseDrag(button, to));
                push_pointer(&mut events, Event::MouseUp(button, to, 1));
            }
            InputCommand::Unicode(text) => {
                if text.len() > 49_152 {
                    return Err("POLICY_DENIED");
                }
                for chunk in unicode_chunks(&text) {
                    let text_bytes = chunk.iter().copied().collect::<String>().len() as u64;
                    let units = chunk.iter().collect::<String>().encode_utf16().collect();
                    events.push(PlannedEvent {
                        event: Event::KeyDown(0, units, 0),
                        cost: NativeInputCost::key(text_bytes),
                    });
                    events.push(PlannedEvent {
                        event: Event::KeyUp(0, 0),
                        cost: NativeInputCost::key(0),
                    });
                }
            }
            InputCommand::Key { key, modifiers } => {
                let key = key_code(&key).ok_or("POLICY_DENIED")?;
                let mut seen = Vec::new();
                let mut modifier_codes = Vec::with_capacity(modifiers.len());
                for modifier_name in modifiers {
                    if seen.iter().any(|item| item == &modifier_name) {
                        return Err("POLICY_DENIED");
                    }
                    seen.push(modifier_name.clone());
                    modifier_codes.push(modifier(&modifier_name).ok_or("POLICY_DENIED")?);
                }
                let mut flags = 0_u64;
                for (code, flag) in &modifier_codes {
                    flags |= flag;
                    push_key(&mut events, Event::KeyDown(*code, Vec::new(), flags));
                }
                push_key(&mut events, Event::KeyDown(key, Vec::new(), flags));
                push_key(&mut events, Event::KeyUp(key, flags));
                for (code, flag) in modifier_codes.into_iter().rev() {
                    flags &= !flag;
                    push_key(&mut events, Event::KeyUp(code, flags));
                }
            }
            InputCommand::Scroll {
                point,
                delta_x,
                delta_y,
            } => {
                ensure_point(point)?;
                if delta_x == 0 && delta_y == 0 {
                    return Err("POLICY_DENIED");
                }
                push_pointer(&mut events, Event::Scroll(point, delta_x, delta_y));
            }
        }
        Ok(events)
    }

    pub(super) fn execute(
        &mut self,
        pid: i32,
        command: InputCommand,
        validate: &mut dyn FnMut() -> Result<(), &'static str>,
        permit: &mut dyn FnMut(NativeInputCost) -> Result<(), &'static str>,
    ) -> Result<(), &'static str> {
        if pid <= 0 {
            return Err("TARGET_CLOSED");
        }
        let events = Self::plan(command)?;
        for planned in events {
            if let Err(code) = validate()
                .and_then(|()| permit(planned.cost))
                .and_then(|()| self.sink.post(Some(pid), &planned.event))
            {
                let _ = self.release_all();
                return Err(code);
            }
            self.commit(pid, &planned.event);
        }
        Ok(())
    }

    fn commit(&mut self, pid: i32, event: &Event) {
        match event {
            Event::KeyDown(code, _, _) => self.held_keys.push(HeldKey { pid, code: *code }),
            Event::KeyUp(code, _) => {
                if let Some(index) = self
                    .held_keys
                    .iter()
                    .rposition(|held| held.pid == pid && held.code == *code)
                {
                    self.held_keys.remove(index);
                }
            }
            Event::MouseDown(button, point, _) => self.held_buttons.push(HeldButton {
                pid,
                button: *button,
                point: *point,
            }),
            Event::MouseDrag(button, point) => {
                if let Some(held) = self
                    .held_buttons
                    .iter_mut()
                    .rfind(|held| held.pid == pid && held.button == *button)
                {
                    held.point = *point;
                }
            }
            Event::MouseUp(button, _, _) => {
                if let Some(index) = self
                    .held_buttons
                    .iter()
                    .rposition(|held| held.pid == pid && held.button == *button)
                {
                    self.held_buttons.remove(index);
                }
            }
            Event::MouseMove(_) | Event::Scroll(_, _, _) => {}
        }
    }

    pub(super) fn release_requested(
        &mut self,
        keys: &[String],
        buttons: &[Button],
    ) -> Result<(), &'static str> {
        let point = if buttons.is_empty() {
            None
        } else {
            Some(self.sink.cursor()?)
        };
        for key in keys {
            let code = modifier(key)
                .map(|(code, _)| code)
                .or_else(|| key_code(key))
                .ok_or("POLICY_DENIED")?;
            self.sink.post(None, &Event::KeyUp(code, 0))?;
        }
        for button in buttons {
            self.sink.post(
                None,
                &Event::MouseUp(
                    *button,
                    point.expect("cursor read for non-empty buttons"),
                    1,
                ),
            )?;
        }
        Ok(())
    }

    pub(super) fn release_all(&mut self) -> Result<(), &'static str> {
        let mut first_error = None;
        while let Some(held) = self.held_buttons.pop() {
            if let Err(code) = self
                .sink
                .post(Some(held.pid), &Event::MouseUp(held.button, held.point, 1))
            {
                first_error.get_or_insert(code);
            }
        }
        while let Some(held) = self.held_keys.pop() {
            if let Err(code) = self.sink.post(Some(held.pid), &Event::KeyUp(held.code, 0)) {
                first_error.get_or_insert(code);
            }
        }
        first_error.map_or(Ok(()), Err)
    }

    #[cfg(test)]
    fn held_keys(&self) -> &[HeldKey] {
        &self.held_keys
    }

    #[cfg(test)]
    fn held_buttons(&self) -> &[HeldButton] {
        &self.held_buttons
    }

    #[cfg(test)]
    fn sink(&self) -> &S {
        &self.sink
    }
}

fn ensure_point(point: Point) -> Result<(), &'static str> {
    point.valid().then_some(()).ok_or("POLICY_DENIED")
}

fn push_pointer(events: &mut Vec<PlannedEvent>, event: Event) {
    events.push(PlannedEvent {
        event,
        cost: NativeInputCost::pointer(),
    });
}

fn push_key(events: &mut Vec<PlannedEvent>, event: Event) {
    events.push(PlannedEvent {
        event,
        cost: NativeInputCost::key(0),
    });
}

fn unicode_chunks(text: &str) -> Vec<Vec<char>> {
    let mut chunks = Vec::new();
    let mut current = Vec::new();
    let mut units = 0;
    for character in text.chars() {
        let needed = character.len_utf16();
        if units + needed > MAX_UNICODE_UNITS_PER_EVENT && !current.is_empty() {
            chunks.push(std::mem::take(&mut current));
            units = 0;
        }
        current.push(character);
        units += needed;
    }
    if !current.is_empty() {
        chunks.push(current);
    }
    chunks
}

fn modifier(value: &str) -> Option<(u16, u64)> {
    match value {
        "Alt" => Some((58, 1 << 19)),
        "Control" => Some((59, 1 << 18)),
        "Meta" => Some((55, 1 << 20)),
        "Shift" => Some((56, 1 << 17)),
        _ => None,
    }
}

fn key_code(value: &str) -> Option<u16> {
    Some(match value {
        "A" => 0,
        "S" => 1,
        "D" => 2,
        "F" => 3,
        "H" => 4,
        "G" => 5,
        "Z" => 6,
        "X" => 7,
        "C" => 8,
        "V" => 9,
        "B" => 11,
        "Q" => 12,
        "W" => 13,
        "E" => 14,
        "R" => 15,
        "Y" => 16,
        "T" => 17,
        "1" => 18,
        "2" => 19,
        "3" => 20,
        "4" => 21,
        "6" => 22,
        "5" => 23,
        "9" => 25,
        "7" => 26,
        "8" => 28,
        "0" => 29,
        "O" => 31,
        "U" => 32,
        "I" => 34,
        "P" => 35,
        "L" => 37,
        "J" => 38,
        "K" => 40,
        "N" => 45,
        "M" => 46,
        "Enter" => 36,
        "Tab" => 48,
        "Space" => 49,
        "Backspace" => 51,
        "Escape" => 53,
        "Delete" => 117,
        "Home" => 115,
        "End" => 119,
        "PageUp" => 116,
        "PageDown" => 121,
        "ArrowLeft" => 123,
        "ArrowRight" => 124,
        "ArrowDown" => 125,
        "ArrowUp" => 126,
        "F1" => 122,
        "F2" => 120,
        "F3" => 99,
        "F4" => 118,
        "F5" => 96,
        "F6" => 97,
        "F7" => 98,
        "F8" => 100,
        "F9" => 101,
        "F10" => 109,
        "F11" => 103,
        "F12" => 111,
        _ => return None,
    })
}

pub(super) fn ensure_safe_target(app_name: &str, window_title: &str) -> Result<(), &'static str> {
    let app = app_name.to_lowercase();
    let window = window_title.to_lowercase();
    let password_manager = [
        "passwords",
        "1password",
        "bitwarden",
        "lastpass",
        "dashlane",
        "keychain access",
        "密码",
        "钥匙串",
    ]
    .iter()
    .any(|needle| app.contains(needle));
    let privacy_settings = (app.contains("system settings") || app.contains("系统设置"))
        && ["privacy", "security", "隐私", "安全"]
            .iter()
            .any(|needle| window.contains(needle));
    if password_manager || privacy_settings || unsafe_text(&window) {
        Err("POLICY_DENIED")
    } else {
        Ok(())
    }
}

pub(super) fn ensure_safe_input_text(
    app_name: &str,
    window_title: &str,
    role: &str,
    name: &str,
) -> Result<(), &'static str> {
    ensure_safe_target(app_name, window_title)?;
    if role.is_empty()
        || name.is_empty()
        || role.to_ascii_lowercase().contains("secure")
        || unsafe_text(&name.to_lowercase())
    {
        Err("POLICY_DENIED")
    } else {
        Ok(())
    }
}

fn unsafe_text(value: &str) -> bool {
    [
        "password",
        "passcode",
        "one-time",
        "one time",
        "otp",
        "verification code",
        "biometric",
        "touch id",
        "face id",
        "keychain",
        "password manager",
        "privacy",
        "pay now",
        "payment",
        "credit card",
        "bank transfer",
        "send",
        "submit",
        "confirm purchase",
        "confirm delete",
        "delete account",
        "erase all",
        "factory reset",
        "uninstall",
        "install update",
        "密码",
        "口令",
        "验证码",
        "一次性",
        "生物识别",
        "指纹",
        "面容",
        "钥匙串",
        "隐私",
        "立即支付",
        "付款",
        "银行卡",
        "转账",
        "发送",
        "提交",
        "确认购买",
        "确认删除",
        "删除账户",
        "抹掉所有",
        "恢复出厂",
        "卸载",
        "安装更新",
    ]
    .iter()
    .any(|needle| value.contains(needle))
}

#[derive(Default)]
pub(super) struct CoreGraphicsSink;

impl EventSink for CoreGraphicsSink {
    fn post(&mut self, pid: Option<i32>, event: &Event) -> Result<(), &'static str> {
        let event = create_event(event)?;
        // SAFETY: The event is a live CoreGraphics object and the PID, when present, was
        // freshly identity-checked by the caller immediately before this post.
        unsafe {
            if let Some(pid) = pid {
                CGEventPostToPid(pid, event.as_ptr());
            } else {
                CGEventPost(0, event.as_ptr());
            }
        }
        Ok(())
    }

    fn cursor(&mut self) -> Result<Point, &'static str> {
        // SAFETY: A null source requests a detached event containing the current cursor point.
        let event = unsafe { CGEventCreate(std::ptr::null()) };
        let event = OwnedEvent(NonNull::new(event.cast_mut()).ok_or("INTERNAL")?);
        // SAFETY: The event remains live for the location query.
        let point = unsafe { CGEventGetLocation(event.as_ptr()) };
        let point = Point {
            x: point.x,
            y: point.y,
        };
        ensure_point(point)?;
        Ok(point)
    }
}

struct OwnedEvent(NonNull<c_void>);

impl OwnedEvent {
    fn as_ptr(&self) -> *const c_void {
        self.0.as_ptr()
    }
}

impl Drop for OwnedEvent {
    fn drop(&mut self) {
        // SAFETY: OwnedEvent always owns exactly one Core Foundation reference.
        unsafe { CFRelease(self.as_ptr()) };
    }
}

#[repr(C)]
#[derive(Clone, Copy)]
struct CgPoint {
    x: f64,
    y: f64,
}

fn create_event(event: &Event) -> Result<OwnedEvent, &'static str> {
    let pointer = match event {
        Event::MouseMove(point) => unsafe {
            CGEventCreateMouseEvent(std::ptr::null(), 5, cg_point(*point), 0)
        },
        Event::MouseDown(button, point, clicks) => {
            let event = unsafe {
                CGEventCreateMouseEvent(
                    std::ptr::null(),
                    mouse_type(*button, true, false),
                    cg_point(*point),
                    mouse_button(*button),
                )
            };
            if !event.is_null() {
                // SAFETY: Field 1 is the public kCGMouseEventClickState field.
                unsafe { CGEventSetIntegerValueField(event, 1, *clicks) };
            }
            event
        }
        Event::MouseUp(button, point, clicks) => {
            let event = unsafe {
                CGEventCreateMouseEvent(
                    std::ptr::null(),
                    mouse_type(*button, false, false),
                    cg_point(*point),
                    mouse_button(*button),
                )
            };
            if !event.is_null() {
                unsafe { CGEventSetIntegerValueField(event, 1, *clicks) };
            }
            event
        }
        Event::MouseDrag(button, point) => unsafe {
            CGEventCreateMouseEvent(
                std::ptr::null(),
                mouse_type(*button, true, true),
                cg_point(*point),
                mouse_button(*button),
            )
        },
        Event::KeyDown(code, unicode, flags) => {
            let event = unsafe { CGEventCreateKeyboardEvent(std::ptr::null(), *code, true) };
            if !event.is_null() {
                unsafe { CGEventSetFlags(event, *flags) };
                if !unicode.is_empty() {
                    unsafe {
                        CGEventKeyboardSetUnicodeString(event, unicode.len(), unicode.as_ptr());
                    }
                }
            }
            event
        }
        Event::KeyUp(code, flags) => {
            let event = unsafe { CGEventCreateKeyboardEvent(std::ptr::null(), *code, false) };
            if !event.is_null() {
                unsafe { CGEventSetFlags(event, *flags) };
            }
            event
        }
        Event::Scroll(point, delta_x, delta_y) => {
            let event = unsafe {
                CGEventCreateScrollWheelEvent(
                    std::ptr::null(),
                    0,
                    2,
                    delta_y.saturating_neg(),
                    delta_x.saturating_neg(),
                )
            };
            if !event.is_null() {
                unsafe { CGEventSetLocation(event, cg_point(*point)) };
            }
            event
        }
    };
    Ok(OwnedEvent(
        NonNull::new(pointer.cast_mut()).ok_or("INTERNAL")?,
    ))
}

fn cg_point(point: Point) -> CgPoint {
    CgPoint {
        x: point.x,
        y: point.y,
    }
}

fn mouse_button(button: Button) -> u32 {
    match button {
        Button::Left => 0,
        Button::Right => 1,
        Button::Middle => 2,
    }
}

fn mouse_type(button: Button, down: bool, dragged: bool) -> u32 {
    match (button, down, dragged) {
        (Button::Left, true, false) => 1,
        (Button::Left, false, _) => 2,
        (Button::Right, true, false) => 3,
        (Button::Right, false, _) => 4,
        (Button::Left, true, true) => 6,
        (Button::Right, true, true) => 7,
        (Button::Middle, true, false) => 25,
        (Button::Middle, false, _) => 26,
        (Button::Middle, true, true) => 27,
    }
}

#[link(name = "ApplicationServices", kind = "framework")]
unsafe extern "C" {
    fn CGEventCreate(source: *const c_void) -> *const c_void;
    fn CGEventCreateMouseEvent(
        source: *const c_void,
        event_type: u32,
        position: CgPoint,
        button: u32,
    ) -> *const c_void;
    fn CGEventCreateKeyboardEvent(
        source: *const c_void,
        virtual_key: u16,
        key_down: bool,
    ) -> *const c_void;
    fn CGEventKeyboardSetUnicodeString(event: *const c_void, length: usize, string: *const u16);
    fn CGEventCreateScrollWheelEvent(
        source: *const c_void,
        units: u32,
        wheel_count: u32,
        ...
    ) -> *const c_void;
    fn CGEventSetIntegerValueField(event: *const c_void, field: u32, value: i64);
    fn CGEventSetFlags(event: *const c_void, flags: u64);
    fn CGEventSetLocation(event: *const c_void, location: CgPoint);
    fn CGEventGetLocation(event: *const c_void) -> CgPoint;
    fn CGEventPost(location: u32, event: *const c_void);
    fn CGEventPostToPid(pid: i32, event: *const c_void);
}

#[link(name = "CoreFoundation", kind = "framework")]
unsafe extern "C" {
    fn CFRelease(value: *const c_void);
}

#[cfg(test)]
mod tests {
    use computer_use_core::NativeInputCost;

    use super::{
        Button, Event, EventSink, InputCommand, InputController, Point, ensure_safe_input_text,
    };

    #[derive(Default)]
    struct FakeSink {
        events: Vec<Event>,
    }

    impl EventSink for FakeSink {
        fn post(&mut self, _pid: Option<i32>, event: &Event) -> Result<(), &'static str> {
            self.events.push(event.clone());
            Ok(())
        }
    }

    #[test]
    fn click_drag_key_and_unicode_have_closed_sequences_and_release_journal() {
        let mut input = InputController::new(FakeSink::default());
        let mut validate = || Ok(());
        let mut costs = Vec::new();
        let mut permit = |cost| {
            costs.push(cost);
            Ok(())
        };

        input
            .execute(
                7,
                InputCommand::Click {
                    point: Point { x: 10.0, y: 20.0 },
                    button: Button::Left,
                    count: 2,
                },
                &mut validate,
                &mut permit,
            )
            .expect("double click");
        input
            .execute(
                7,
                InputCommand::Drag {
                    from: Point { x: 1.0, y: 2.0 },
                    to: Point { x: 3.0, y: 4.0 },
                    button: Button::Left,
                },
                &mut validate,
                &mut permit,
            )
            .expect("drag");
        input
            .execute(
                7,
                InputCommand::Key {
                    key: "A".to_owned(),
                    modifiers: vec!["Meta".to_owned(), "Shift".to_owned()],
                },
                &mut validate,
                &mut permit,
            )
            .expect("key chord");
        input
            .execute(
                7,
                InputCommand::Unicode("A🚀".to_owned()),
                &mut validate,
                &mut permit,
            )
            .expect("unicode");

        assert!(input.held_keys().is_empty());
        assert!(input.held_buttons().is_empty());
        assert!(
            costs
                .iter()
                .all(|cost: &NativeInputCost| { cost.pointer_events + cost.key_events == 1 })
        );
        assert_eq!(
            input.sink().events,
            vec![
                Event::MouseMove(Point { x: 10.0, y: 20.0 }),
                Event::MouseDown(Button::Left, Point { x: 10.0, y: 20.0 }, 1),
                Event::MouseUp(Button::Left, Point { x: 10.0, y: 20.0 }, 1),
                Event::MouseDown(Button::Left, Point { x: 10.0, y: 20.0 }, 2),
                Event::MouseUp(Button::Left, Point { x: 10.0, y: 20.0 }, 2),
                Event::MouseMove(Point { x: 1.0, y: 2.0 }),
                Event::MouseDown(Button::Left, Point { x: 1.0, y: 2.0 }, 1),
                Event::MouseDrag(Button::Left, Point { x: 3.0, y: 4.0 }),
                Event::MouseUp(Button::Left, Point { x: 3.0, y: 4.0 }, 1),
                Event::KeyDown(55, Vec::new(), 1 << 20),
                Event::KeyDown(56, Vec::new(), (1 << 20) | (1 << 17)),
                Event::KeyDown(0, Vec::new(), (1 << 20) | (1 << 17)),
                Event::KeyUp(0, (1 << 20) | (1 << 17)),
                Event::KeyUp(56, 1 << 20),
                Event::KeyUp(55, 0),
                Event::KeyDown(0, "A🚀".encode_utf16().collect(), 0),
                Event::KeyUp(0, 0),
            ]
        );
    }

    #[test]
    fn cancellation_between_native_events_releases_held_input_without_more_permits() {
        let mut input = InputController::new(FakeSink::default());
        let mut validation_count = 0;
        let mut validate = || {
            validation_count += 1;
            if validation_count == 4 {
                Err("CANCELLED")
            } else {
                Ok(())
            }
        };
        let mut permits = 0;
        let mut permit = |_cost| {
            permits += 1;
            Ok(())
        };

        assert_eq!(
            input.execute(
                7,
                InputCommand::Key {
                    key: "A".to_owned(),
                    modifiers: vec!["Meta".to_owned()],
                },
                &mut validate,
                &mut permit,
            ),
            Err("CANCELLED")
        );
        assert_eq!(permits, 3);
        assert!(input.held_keys().is_empty());
        assert_eq!(
            input.sink().events,
            vec![
                Event::KeyDown(55, Vec::new(), 1 << 20),
                Event::KeyDown(0, Vec::new(), 1 << 20),
                Event::KeyUp(0, 1 << 20),
                Event::KeyUp(55, 0),
            ]
        );
    }

    #[test]
    fn sensitive_and_high_impact_targets_fail_before_any_event() {
        for (app, window, role, name) in [
            ("Passwords", "Passwords", "AXTextField", "Search"),
            ("System Settings", "Privacy & Security", "AXButton", "Allow"),
            ("Example", "Checkout", "AXButton", "Pay now"),
            ("Example", "Account", "AXButton", "Delete account"),
            ("Example", "Sign in", "AXSecureTextField", "Password"),
            ("Example", "登录", "AXTextField", "验证码"),
        ] {
            assert_eq!(
                ensure_safe_input_text(app, window, role, name),
                Err("POLICY_DENIED")
            );
        }
        assert_eq!(
            ensure_safe_input_text("TextEdit", "Untitled", "AXTextArea", "editor"),
            Ok(())
        );

        let mut input = InputController::new(FakeSink::default());
        let mut validate =
            || ensure_safe_input_text("System Settings", "Privacy & Security", "AXButton", "Allow");
        let mut permit = |_cost| Ok(());
        assert_eq!(
            input.execute(
                7,
                InputCommand::Key {
                    key: "Enter".to_owned(),
                    modifiers: Vec::new(),
                },
                &mut validate,
                &mut permit,
            ),
            Err("POLICY_DENIED")
        );
        assert!(input.sink().events.is_empty());
    }
}
