//! Closed, bounded Windows `SendInput` planning and held-input cleanup.

use std::collections::BTreeSet;

use computer_use_core::NativeInputCost;

use super::scale::{PhysicalPoint, VirtualDesktop};

#[cfg(target_os = "windows")]
use windows::Win32::UI::Input::KeyboardAndMouse::{
    INPUT, INPUT_0, INPUT_KEYBOARD, INPUT_MOUSE, KEYBDINPUT, KEYEVENTF_KEYUP, KEYEVENTF_UNICODE,
    MOUSEEVENTF_ABSOLUTE, MOUSEEVENTF_HWHEEL, MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP,
    MOUSEEVENTF_MIDDLEDOWN, MOUSEEVENTF_MIDDLEUP, MOUSEEVENTF_MOVE, MOUSEEVENTF_RIGHTDOWN,
    MOUSEEVENTF_RIGHTUP, MOUSEEVENTF_VIRTUALDESK, MOUSEEVENTF_WHEEL, MOUSEINPUT, SendInput,
    VIRTUAL_KEY,
};

const MAX_NATIVE_EVENTS: usize = 256;

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
pub(crate) enum MouseButton {
    Left,
    Right,
    Middle,
}

impl MouseButton {
    #[cfg_attr(not(target_os = "windows"), allow(dead_code))]
    pub(crate) fn parse(value: &str) -> Result<Self, &'static str> {
        match value {
            "left" => Ok(Self::Left),
            "right" => Ok(Self::Right),
            "middle" => Ok(Self::Middle),
            _ => Err("POLICY_DENIED"),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum ReleaseEvent {
    Key(u16),
    Unicode(u16),
    Button(MouseButton),
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum NativeInputEvent {
    AbsoluteMove { x: u16, y: u16 },
    ButtonDown(MouseButton),
    ButtonUp(MouseButton),
    KeyDown(u16),
    KeyUp(u16),
    UnicodeDown(u16),
    UnicodeUp(u16),
    Wheel { horizontal: i32, vertical: i32 },
}

pub(crate) enum InputCommand {
    Focus(PhysicalPoint),
    Click {
        point: PhysicalPoint,
        button: MouseButton,
        count: u8,
    },
    Drag {
        from: PhysicalPoint,
        to: PhysicalPoint,
        button: MouseButton,
    },
    Unicode(String),
    Key {
        key: String,
        modifiers: Vec<String>,
    },
    Scroll {
        point: PhysicalPoint,
        delta_x: i32,
        delta_y: i32,
    },
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct PlannedEvent {
    event: NativeInputEvent,
    cost: NativeInputCost,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct ClosedInputPlan {
    events: Vec<PlannedEvent>,
}

impl ClosedInputPlan {
    fn new(events: Vec<PlannedEvent>) -> Result<Self, &'static str> {
        if events.is_empty() || events.len() > MAX_NATIVE_EVENTS {
            return Err("POLICY_DENIED");
        }
        Ok(Self { events })
    }

    pub(crate) fn command(
        command: InputCommand,
        desktop: VirtualDesktop,
    ) -> Result<Self, &'static str> {
        let mut events = Vec::new();
        match command {
            InputCommand::Focus(point) => {
                push_move(&mut events, desktop, point)?;
                push_pointer(&mut events, NativeInputEvent::ButtonDown(MouseButton::Left));
                push_pointer(&mut events, NativeInputEvent::ButtonUp(MouseButton::Left));
            }
            InputCommand::Click {
                point,
                button,
                count,
            } => {
                if !matches!(count, 1 | 2) {
                    return Err("POLICY_DENIED");
                }
                push_move(&mut events, desktop, point)?;
                for _ in 0..count {
                    push_pointer(&mut events, NativeInputEvent::ButtonDown(button));
                    push_pointer(&mut events, NativeInputEvent::ButtonUp(button));
                }
            }
            InputCommand::Drag { from, to, button } => {
                push_move(&mut events, desktop, from)?;
                push_pointer(&mut events, NativeInputEvent::ButtonDown(button));
                push_move(&mut events, desktop, to)?;
                push_pointer(&mut events, NativeInputEvent::ButtonUp(button));
            }
            InputCommand::Unicode(text) => {
                if text.is_empty() || text.len() > 49_152 {
                    return Err("POLICY_DENIED");
                }
                for character in text.chars() {
                    let mut encoded = [0_u16; 2];
                    let units = character.encode_utf16(&mut encoded);
                    for (index, unit) in units.iter().copied().enumerate() {
                        events.push(PlannedEvent {
                            event: NativeInputEvent::UnicodeDown(unit),
                            cost: NativeInputCost::key(if index == 0 {
                                character.len_utf8() as u64
                            } else {
                                0
                            }),
                        });
                        push_key(&mut events, NativeInputEvent::UnicodeUp(unit));
                    }
                }
            }
            InputCommand::Key { key, modifiers } => {
                let key = virtual_key(&key).ok_or("POLICY_DENIED")?;
                let mut seen = BTreeSet::new();
                let mut modifier_keys = Vec::with_capacity(modifiers.len());
                for modifier in modifiers {
                    if !seen.insert(modifier.clone()) {
                        return Err("POLICY_DENIED");
                    }
                    modifier_keys.push(modifier_key(&modifier).ok_or("POLICY_DENIED")?);
                }
                for modifier in &modifier_keys {
                    push_key(&mut events, NativeInputEvent::KeyDown(*modifier));
                }
                push_key(&mut events, NativeInputEvent::KeyDown(key));
                push_key(&mut events, NativeInputEvent::KeyUp(key));
                for modifier in modifier_keys.into_iter().rev() {
                    push_key(&mut events, NativeInputEvent::KeyUp(modifier));
                }
            }
            InputCommand::Scroll {
                point,
                delta_x,
                delta_y,
            } => {
                if delta_x == 0 && delta_y == 0 {
                    return Err("POLICY_DENIED");
                }
                push_move(&mut events, desktop, point)?;
                if delta_y != 0 {
                    push_pointer(
                        &mut events,
                        NativeInputEvent::Wheel {
                            horizontal: 0,
                            vertical: delta_y,
                        },
                    );
                }
                if delta_x != 0 {
                    push_pointer(
                        &mut events,
                        NativeInputEvent::Wheel {
                            horizontal: delta_x,
                            vertical: 0,
                        },
                    );
                }
            }
        }
        Self::new(events)
    }
}

fn push_move(
    events: &mut Vec<PlannedEvent>,
    desktop: VirtualDesktop,
    point: PhysicalPoint,
) -> Result<(), &'static str> {
    let (x, y) = desktop
        .normalize_for_send_input(point)
        .ok_or("POLICY_DENIED")?;
    push_pointer(events, NativeInputEvent::AbsoluteMove { x, y });
    Ok(())
}

fn push_pointer(events: &mut Vec<PlannedEvent>, event: NativeInputEvent) {
    events.push(PlannedEvent {
        event,
        cost: NativeInputCost::pointer(),
    });
}

fn push_key(events: &mut Vec<PlannedEvent>, event: NativeInputEvent) {
    events.push(PlannedEvent {
        event,
        cost: NativeInputCost::key(0),
    });
}

pub(crate) trait SendInputSink {
    fn send_one(&mut self, event: NativeInputEvent) -> Result<(), &'static str>;
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub(crate) struct ReleaseJournal {
    keys: BTreeSet<u16>,
    unicodes: BTreeSet<u16>,
    buttons: BTreeSet<MouseButton>,
}

impl ReleaseJournal {
    fn commit(&mut self, event: NativeInputEvent) {
        match event {
            NativeInputEvent::ButtonDown(button) => {
                self.buttons.insert(button);
            }
            NativeInputEvent::ButtonUp(button) => {
                self.buttons.remove(&button);
            }
            NativeInputEvent::KeyDown(key) => {
                self.keys.insert(key);
            }
            NativeInputEvent::KeyUp(key) => {
                self.keys.remove(&key);
            }
            NativeInputEvent::UnicodeDown(code_unit) => {
                self.unicodes.insert(code_unit);
            }
            NativeInputEvent::UnicodeUp(code_unit) => {
                self.unicodes.remove(&code_unit);
            }
            NativeInputEvent::AbsoluteMove { .. } | NativeInputEvent::Wheel { .. } => {}
        }
    }

    pub(crate) fn plan_release(&self) -> Vec<ReleaseEvent> {
        self.keys
            .iter()
            .copied()
            .map(ReleaseEvent::Key)
            .chain(self.unicodes.iter().copied().map(ReleaseEvent::Unicode))
            .chain(self.buttons.iter().copied().map(ReleaseEvent::Button))
            .collect()
    }

    fn confirm_release(&mut self, event: ReleaseEvent) {
        match event {
            ReleaseEvent::Key(key) => {
                self.keys.remove(&key);
            }
            ReleaseEvent::Unicode(code_unit) => {
                self.unicodes.remove(&code_unit);
            }
            ReleaseEvent::Button(button) => {
                self.buttons.remove(&button);
            }
        }
    }
}

pub(crate) struct InputController<S> {
    sink: S,
    journal: ReleaseJournal,
}

impl<S: SendInputSink> InputController<S> {
    pub(crate) fn new(sink: S) -> Self {
        Self {
            sink,
            journal: ReleaseJournal::default(),
        }
    }

    pub(crate) fn execute(
        &mut self,
        plan: &ClosedInputPlan,
        validate: &mut dyn FnMut() -> Result<(), &'static str>,
        permit: &mut dyn FnMut(NativeInputCost) -> Result<(), &'static str>,
    ) -> Result<(), &'static str> {
        for planned in plan.events.iter().copied() {
            if let Err(code) = validate()
                .and_then(|()| permit(planned.cost))
                .and_then(|()| self.sink.send_one(planned.event))
            {
                let _ = self.release_all();
                return Err(code);
            }
            self.journal.commit(planned.event);
        }
        Ok(())
    }

    #[cfg_attr(not(target_os = "windows"), allow(dead_code))]
    pub(crate) fn release_requested(
        &mut self,
        keys: &[String],
        buttons: &[MouseButton],
    ) -> Result<(), &'static str> {
        for key in keys {
            let key = modifier_key(key)
                .or_else(|| virtual_key(key))
                .ok_or("POLICY_DENIED")?;
            self.sink.send_one(NativeInputEvent::KeyUp(key))?;
            self.journal.commit(NativeInputEvent::KeyUp(key));
        }
        for button in buttons {
            self.sink.send_one(NativeInputEvent::ButtonUp(*button))?;
            self.journal.commit(NativeInputEvent::ButtonUp(*button));
        }
        Ok(())
    }

    pub(crate) fn release_all(&mut self) -> Result<(), &'static str> {
        let mut first_error = None;
        for release in self.journal.plan_release() {
            let event = match release {
                ReleaseEvent::Key(key) => NativeInputEvent::KeyUp(key),
                ReleaseEvent::Unicode(code_unit) => NativeInputEvent::UnicodeUp(code_unit),
                ReleaseEvent::Button(button) => NativeInputEvent::ButtonUp(button),
            };
            match self.sink.send_one(event) {
                Ok(()) => self.journal.confirm_release(release),
                Err(code) => {
                    first_error.get_or_insert(code);
                }
            }
        }
        first_error.map_or(Ok(()), Err)
    }
}

#[cfg(target_os = "windows")]
#[derive(Default)]
pub(crate) struct WinSendInputSink;

#[cfg(target_os = "windows")]
impl SendInputSink for WinSendInputSink {
    fn send_one(&mut self, event: NativeInputEvent) -> Result<(), &'static str> {
        let input = native_input(event);
        let sent = unsafe {
            SendInput(
                &[input],
                i32::try_from(core::mem::size_of::<INPUT>()).map_err(|_| "INTERNAL")?,
            )
        };
        (sent == 1).then_some(()).ok_or("PERMISSION_DENIED")
    }
}

#[cfg(target_os = "windows")]
fn native_input(event: NativeInputEvent) -> INPUT {
    match event {
        NativeInputEvent::AbsoluteMove { x, y } => mouse_input(
            i32::from(x),
            i32::from(y),
            0,
            MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK,
        ),
        NativeInputEvent::ButtonDown(button) => mouse_input(0, 0, 0, button_flags(button, true)),
        NativeInputEvent::ButtonUp(button) => mouse_input(0, 0, 0, button_flags(button, false)),
        NativeInputEvent::Wheel {
            horizontal: 0,
            vertical,
        } => mouse_input(0, 0, vertical as u32, MOUSEEVENTF_WHEEL),
        NativeInputEvent::Wheel {
            horizontal,
            vertical: 0,
        } => mouse_input(0, 0, horizontal as u32, MOUSEEVENTF_HWHEEL),
        NativeInputEvent::Wheel { .. } => unreachable!("planner emits one wheel axis at a time"),
        NativeInputEvent::KeyDown(key) => keyboard_input(key, 0, Default::default()),
        NativeInputEvent::KeyUp(key) => keyboard_input(key, 0, KEYEVENTF_KEYUP),
        NativeInputEvent::UnicodeDown(code_unit) => keyboard_input(0, code_unit, KEYEVENTF_UNICODE),
        NativeInputEvent::UnicodeUp(code_unit) => {
            keyboard_input(0, code_unit, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP)
        }
    }
}

#[cfg(target_os = "windows")]
fn mouse_input(
    dx: i32,
    dy: i32,
    data: u32,
    flags: windows::Win32::UI::Input::KeyboardAndMouse::MOUSE_EVENT_FLAGS,
) -> INPUT {
    INPUT {
        r#type: INPUT_MOUSE,
        Anonymous: INPUT_0 {
            mi: MOUSEINPUT {
                dx,
                dy,
                mouseData: data,
                dwFlags: flags,
                time: 0,
                dwExtraInfo: 0,
            },
        },
    }
}

#[cfg(target_os = "windows")]
fn keyboard_input(
    key: u16,
    scan: u16,
    flags: windows::Win32::UI::Input::KeyboardAndMouse::KEYBD_EVENT_FLAGS,
) -> INPUT {
    INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: VIRTUAL_KEY(key),
                wScan: scan,
                dwFlags: flags,
                time: 0,
                dwExtraInfo: 0,
            },
        },
    }
}

#[cfg(target_os = "windows")]
fn button_flags(
    button: MouseButton,
    down: bool,
) -> windows::Win32::UI::Input::KeyboardAndMouse::MOUSE_EVENT_FLAGS {
    match (button, down) {
        (MouseButton::Left, true) => MOUSEEVENTF_LEFTDOWN,
        (MouseButton::Left, false) => MOUSEEVENTF_LEFTUP,
        (MouseButton::Right, true) => MOUSEEVENTF_RIGHTDOWN,
        (MouseButton::Right, false) => MOUSEEVENTF_RIGHTUP,
        (MouseButton::Middle, true) => MOUSEEVENTF_MIDDLEDOWN,
        (MouseButton::Middle, false) => MOUSEEVENTF_MIDDLEUP,
    }
}

fn modifier_key(value: &str) -> Option<u16> {
    Some(match value {
        "Alt" => 0x12,
        "Control" => 0x11,
        "Meta" => 0x5b,
        "Shift" => 0x10,
        _ => return None,
    })
}

fn virtual_key(value: &str) -> Option<u16> {
    if value.len() == 1
        && value
            .as_bytes()
            .first()
            .is_some_and(|byte| byte.is_ascii_uppercase() || byte.is_ascii_digit())
    {
        return value.as_bytes().first().copied().map(u16::from);
    }
    Some(match value {
        "Enter" => 0x0d,
        "Tab" => 0x09,
        "Space" => 0x20,
        "Backspace" => 0x08,
        "Escape" => 0x1b,
        "Delete" => 0x2e,
        "Home" => 0x24,
        "End" => 0x23,
        "PageUp" => 0x21,
        "PageDown" => 0x22,
        "ArrowLeft" => 0x25,
        "ArrowUp" => 0x26,
        "ArrowRight" => 0x27,
        "ArrowDown" => 0x28,
        "F1" => 0x70,
        "F2" => 0x71,
        "F3" => 0x72,
        "F4" => 0x73,
        "F5" => 0x74,
        "F6" => 0x75,
        "F7" => 0x76,
        "F8" => 0x77,
        "F9" => 0x78,
        "F10" => 0x79,
        "F11" => 0x7a,
        "F12" => 0x7b,
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use computer_use_core::NativeInputCost;

    use super::{
        ClosedInputPlan, InputCommand, InputController, MouseButton, NativeInputEvent,
        ReleaseEvent, SendInputSink,
    };
    use crate::platform::windows::scale::{PhysicalPoint, PhysicalRect, VirtualDesktop};

    #[derive(Default)]
    struct FakeSink {
        sent: Vec<NativeInputEvent>,
        fail_at: Option<usize>,
    }

    impl SendInputSink for FakeSink {
        fn send_one(&mut self, event: NativeInputEvent) -> Result<(), &'static str> {
            if self.fail_at == Some(self.sent.len()) {
                return Err("PERMISSION_DENIED");
            }
            self.sent.push(event);
            Ok(())
        }
    }

    fn desktop() -> VirtualDesktop {
        VirtualDesktop {
            bounds: PhysicalRect {
                left: -100,
                top: -100,
                right: 100,
                bottom: 100,
            },
        }
    }

    #[test]
    fn plans_closed_double_click_unicode_key_and_scroll_sequences() {
        let click = ClosedInputPlan::command(
            InputCommand::Click {
                point: PhysicalPoint { x: -20, y: 20 },
                button: MouseButton::Left,
                count: 2,
            },
            desktop(),
        )
        .expect("click plan");
        assert_eq!(click.events.len(), 5);

        let unicode = ClosedInputPlan::command(InputCommand::Unicode("A🚀".to_owned()), desktop())
            .expect("unicode plan");
        assert_eq!(unicode.events.len(), 6);
        assert_eq!(
            unicode
                .events
                .iter()
                .map(|item| item.cost.text_bytes)
                .sum::<u64>(),
            5,
        );

        let key = ClosedInputPlan::command(
            InputCommand::Key {
                key: "A".to_owned(),
                modifiers: vec!["Control".to_owned(), "Shift".to_owned()],
            },
            desktop(),
        )
        .expect("key plan");
        assert_eq!(key.events.len(), 6);

        let scroll = ClosedInputPlan::command(
            InputCommand::Scroll {
                point: PhysicalPoint { x: 0, y: 0 },
                delta_x: -120,
                delta_y: 120,
            },
            desktop(),
        )
        .expect("scroll plan");
        assert_eq!(scroll.events.len(), 3);
    }

    #[test]
    fn revalidates_and_permits_each_event_then_retains_failed_release() {
        let plan = ClosedInputPlan::command(
            InputCommand::Drag {
                from: PhysicalPoint { x: 0, y: 0 },
                to: PhysicalPoint { x: 20, y: 20 },
                button: MouseButton::Left,
            },
            desktop(),
        )
        .expect("drag plan");
        let mut controller = InputController::new(FakeSink {
            fail_at: Some(2),
            ..FakeSink::default()
        });
        let mut validations = 0;
        let mut permits = Vec::<NativeInputCost>::new();
        assert_eq!(
            controller.execute(
                &plan,
                &mut || {
                    validations += 1;
                    Ok(())
                },
                &mut |cost| {
                    permits.push(cost);
                    Ok(())
                },
            ),
            Err("PERMISSION_DENIED"),
        );
        assert_eq!(validations, 3);
        assert_eq!(permits.len(), 3);
        assert_eq!(
            controller.journal.plan_release(),
            vec![ReleaseEvent::Button(MouseButton::Left)],
        );
    }

    #[test]
    fn rejects_duplicate_modifiers_outside_desktop_and_unbounded_sequences() {
        assert_eq!(
            ClosedInputPlan::command(
                InputCommand::Key {
                    key: "A".to_owned(),
                    modifiers: vec!["Alt".to_owned(), "Alt".to_owned()],
                },
                desktop(),
            ),
            Err("POLICY_DENIED"),
        );
        assert_eq!(
            ClosedInputPlan::command(
                InputCommand::Focus(PhysicalPoint { x: 100, y: 0 }),
                desktop(),
            ),
            Err("POLICY_DENIED"),
        );
        assert_eq!(
            ClosedInputPlan::command(InputCommand::Unicode("x".repeat(129)), desktop()),
            Err("POLICY_DENIED"),
        );
    }
}
