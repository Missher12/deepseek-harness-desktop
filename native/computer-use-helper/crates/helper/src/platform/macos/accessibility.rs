//! Read-only Accessibility traversal. No editable or secure field value is queried.

use std::ffi::c_void;
use std::ptr::NonNull;
use std::time::Instant;

use computer_use_core::{
    AccessibilityNode, AccessibilityNodeSource, AccessibilityProjection, CancellationToken,
    InputSafety, MAX_RAW_ACCESSIBILITY_NODES, ObservationBounds, ProjectionScope,
    project_accessibility_tree,
};

use super::{WindowDescriptor, close_bounds, process_identity};

const AX_SUCCESS: i32 = 0;
const AX_ERROR_INVALID_UI_ELEMENT: i32 = -25_202;
const AX_ERROR_CANNOT_COMPLETE: i32 = -25_204;
const UTF8_ENCODING: u32 = 0x0800_0100;

type CFTypeRef = *const c_void;
type AXUIElementRef = *const c_void;

#[repr(C)]
struct CGPoint {
    x: f64,
    y: f64,
}

#[repr(C)]
struct CGSize {
    width: f64,
    height: f64,
}

#[repr(C)]
struct CFRange {
    location: isize,
    length: isize,
}

struct OwnedCf(NonNull<c_void>);

impl OwnedCf {
    fn as_ptr(&self) -> CFTypeRef {
        self.0.as_ptr()
    }
}

impl Drop for OwnedCf {
    fn drop(&mut self) {
        // SAFETY: OwnedCf always represents one retained Core Foundation reference.
        unsafe { CFRelease(self.as_ptr()) };
    }
}

struct AxNode(NonNull<c_void>);

impl AxNode {
    unsafe fn from_owned(pointer: AXUIElementRef) -> Option<Self> {
        NonNull::new(pointer.cast_mut()).map(Self)
    }

    fn as_ptr(&self) -> AXUIElementRef {
        self.0.as_ptr()
    }
}

impl Clone for AxNode {
    fn clone(&self) -> Self {
        // SAFETY: The node is live and CFRetain returns an equivalent owned reference.
        let retained = unsafe { CFRetain(self.as_ptr()) };
        Self(NonNull::new(retained.cast_mut()).expect("retaining a live AX node"))
    }
}

impl Drop for AxNode {
    fn drop(&mut self) {
        // SAFETY: AxNode always owns one reference.
        unsafe { CFRelease(self.as_ptr()) };
    }
}

struct AxSource<'a> {
    epoch: &'a Instant,
    deadline_ms: u64,
    cancel: &'a CancellationToken,
    app_hidden: bool,
}

enum VisibilityRead<T> {
    Hidden,
    Minimized,
    Visible(T),
}

fn read_after_visibility<T, E>(
    app_hidden: bool,
    read_hidden: impl FnOnce() -> Result<bool, E>,
    read_minimized: impl FnOnce() -> Result<bool, E>,
    read_visible: impl FnOnce() -> Result<T, E>,
) -> Result<VisibilityRead<T>, E> {
    if app_hidden || read_hidden()? {
        return Ok(VisibilityRead::Hidden);
    }
    if read_minimized()? {
        return Ok(VisibilityRead::Minimized);
    }
    read_visible().map(VisibilityRead::Visible)
}

impl AxSource<'_> {
    fn check(&self) -> Result<(), &'static str> {
        if self.cancel.is_cancelled() {
            return Err("CANCELLED");
        }
        let now_ms = u64::try_from(self.epoch.elapsed().as_millis()).unwrap_or(u64::MAX);
        if now_ms >= self.deadline_ms {
            return Err("TIMEOUT");
        }
        Ok(())
    }

    fn attribute(
        &self,
        node: &AxNode,
        name: &'static [u8],
    ) -> Result<Option<OwnedCf>, &'static str> {
        self.check()?;
        let attribute = unsafe {
            CFStringCreateWithCString(std::ptr::null(), name.as_ptr().cast(), UTF8_ENCODING)
        };
        let Some(attribute) = NonNull::new(attribute.cast_mut()) else {
            return Err("INTERNAL");
        };
        let mut value: CFTypeRef = std::ptr::null();
        // SAFETY: The node and created CFString are live for this fixed read-only call.
        let error =
            unsafe { AXUIElementCopyAttributeValue(node.as_ptr(), attribute.as_ptr(), &mut value) };
        // SAFETY: The created attribute string owns one reference.
        unsafe { CFRelease(attribute.as_ptr()) };
        match error {
            AX_SUCCESS if !value.is_null() => Ok(NonNull::new(value.cast_mut()).map(OwnedCf)),
            AX_SUCCESS => Ok(None),
            AX_ERROR_INVALID_UI_ELEMENT => Err("TARGET_CLOSED"),
            AX_ERROR_CANNOT_COMPLETE => Err("TIMEOUT"),
            _ => Ok(None),
        }
    }

    fn string(
        &self,
        node: &AxNode,
        name: &'static [u8],
        maximum: usize,
    ) -> Result<String, &'static str> {
        let Some(value) = self.attribute(node, name)? else {
            return Ok(String::new());
        };
        // SAFETY: Type IDs may be queried for every CF object.
        if unsafe { CFGetTypeID(value.as_ptr()) } != unsafe { CFStringGetTypeID() } {
            return Ok(String::new());
        }
        let length = unsafe { CFStringGetLength(value.as_ptr()) }.max(0);
        let mut buffer = vec![0_u8; maximum.saturating_add(4)];
        let mut used = 0_isize;
        // SAFETY: Buffer and range are bounded; Core Foundation reports exact used bytes.
        unsafe {
            CFStringGetBytes(
                value.as_ptr(),
                CFRange {
                    location: 0,
                    length,
                },
                UTF8_ENCODING,
                0,
                0,
                buffer.as_mut_ptr(),
                buffer.len() as isize,
                &mut used,
            );
        }
        buffer.truncate(usize::try_from(used).unwrap_or(0).min(buffer.len()));
        Ok(String::from_utf8_lossy(&buffer).into_owned())
    }

    fn boolean(&self, node: &AxNode, name: &'static [u8]) -> Result<bool, &'static str> {
        let Some(value) = self.attribute(node, name)? else {
            return Ok(false);
        };
        if unsafe { CFGetTypeID(value.as_ptr()) } != unsafe { CFBooleanGetTypeID() } {
            return Ok(false);
        }
        // SAFETY: Type ID was checked as CFBoolean.
        Ok(unsafe { CFBooleanGetValue(value.as_ptr()) != 0 })
    }

    fn bounds(&self, node: &AxNode) -> Result<Option<ObservationBounds>, &'static str> {
        let Some(position) = self.attribute(node, b"AXPosition\0")? else {
            return Ok(None);
        };
        let Some(size) = self.attribute(node, b"AXSize\0")? else {
            return Ok(None);
        };
        if unsafe { CFGetTypeID(position.as_ptr()) } != unsafe { AXValueGetTypeID() }
            || unsafe { CFGetTypeID(size.as_ptr()) } != unsafe { AXValueGetTypeID() }
            || unsafe { AXValueGetType(position.as_ptr()) } != 1
            || unsafe { AXValueGetType(size.as_ptr()) } != 2
        {
            return Ok(None);
        }
        let mut point = CGPoint { x: 0.0, y: 0.0 };
        let mut dimensions = CGSize {
            width: 0.0,
            height: 0.0,
        };
        // SAFETY: AX value types were checked before copying into matching structures.
        if unsafe { AXValueGetValue(position.as_ptr(), 1, (&mut point as *mut CGPoint).cast()) }
            == 0
            || unsafe { AXValueGetValue(size.as_ptr(), 2, (&mut dimensions as *mut CGSize).cast()) }
                == 0
        {
            return Ok(None);
        }
        let bounds = ObservationBounds {
            x: point.x,
            y: point.y,
            width: dimensions.width,
            height: dimensions.height,
        };
        if !bounds.x.is_finite()
            || !bounds.y.is_finite()
            || !bounds.width.is_finite()
            || !bounds.height.is_finite()
            || bounds.width <= 0.0
            || bounds.height <= 0.0
        {
            return Ok(None);
        }
        Ok(Some(bounds))
    }

    fn children(&self, node: &AxNode) -> Result<Vec<AxNode>, &'static str> {
        let Some(value) = self.attribute(node, b"AXChildren\0")? else {
            return Ok(Vec::new());
        };
        if unsafe { CFGetTypeID(value.as_ptr()) } != unsafe { CFArrayGetTypeID() } {
            return Ok(Vec::new());
        }
        let count = unsafe { CFArrayGetCount(value.as_ptr()) }
            .max(0)
            .min(MAX_RAW_ACCESSIBILITY_NODES as isize);
        let mut children = Vec::with_capacity(count as usize);
        for index in 0..count {
            let child = unsafe { CFArrayGetValueAtIndex(value.as_ptr(), index) };
            if child.is_null() || unsafe { CFGetTypeID(child) } != unsafe { AXUIElementGetTypeID() }
            {
                continue;
            }
            let retained = unsafe { CFRetain(child) };
            if let Some(child) = unsafe { AxNode::from_owned(retained) } {
                children.push(child);
            }
        }
        Ok(children)
    }
}

impl AccessibilityNodeSource for AxSource<'_> {
    type Node = AxNode;

    fn describe(
        &mut self,
        node: &Self::Node,
    ) -> Result<AccessibilityNode<Self::Node>, &'static str> {
        self.check()?;
        match read_after_visibility(
            self.app_hidden,
            || self.boolean(node, b"AXHidden\0"),
            || self.boolean(node, b"AXMinimized\0"),
            || {
                let role = self.string(node, b"AXRole\0", 256)?;
                let subrole = self.string(node, b"AXSubrole\0", 256)?;
                let title = self.string(node, b"AXTitle\0", 2_048)?;
                let name = if title.is_empty() {
                    self.string(node, b"AXDescription\0", 2_048)?
                } else {
                    title
                };
                let mut input_safety = classify_input(&role, &subrole, &name);
                if input_safety.editable || input_safety.sensitive {
                    input_safety.focused = self.boolean(node, b"AXFocused\0")?;
                }
                Ok(AccessibilityNode {
                    role,
                    name,
                    bounds: self.bounds(node)?,
                    hidden: false,
                    minimized: false,
                    input_safety,
                    children: self.children(node)?,
                })
            },
        )? {
            VisibilityRead::Hidden => Ok(AccessibilityNode {
                role: String::new(),
                name: String::new(),
                bounds: None,
                hidden: true,
                minimized: false,
                input_safety: InputSafety::default(),
                children: Vec::new(),
            }),
            VisibilityRead::Minimized => Ok(AccessibilityNode {
                role: String::new(),
                name: String::new(),
                bounds: None,
                hidden: false,
                minimized: true,
                input_safety: InputSafety::default(),
                children: Vec::new(),
            }),
            VisibilityRead::Visible(description) => Ok(description),
        }
    }
}

fn classify_input(role: &str, subrole: &str, name: &str) -> InputSafety {
    let role = role.to_ascii_lowercase();
    let subrole = subrole.to_ascii_lowercase();
    let name = name.to_lowercase();
    let sensitive = subrole.contains("secure")
        || role.contains("secure")
        || [
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
            "payment",
            "credit card",
            "bank transfer",
            "密码",
            "口令",
            "验证码",
            "一次性",
            "生物识别",
            "指纹",
            "面容",
            "钥匙串",
            "隐私",
            "支付",
            "银行卡",
            "转账",
        ]
        .iter()
        .any(|needle| name.contains(needle));
    let editable = !sensitive && matches!(role.as_str(), "axtextfield" | "axtextarea");
    InputSafety {
        sensitive,
        editable,
        focused: false,
    }
}

/// Bind one exact SCK target to one unique AX window, then project it breadth-first.
pub fn observe_exact_window(
    target: &WindowDescriptor,
    app_id: &str,
    window_id: &str,
    snapshot_revision: u64,
    epoch: &Instant,
    deadline_ms: u64,
    cancel: &CancellationToken,
) -> Result<AccessibilityProjection, &'static str> {
    if cancel.is_cancelled() {
        return Err("CANCELLED");
    }
    // SAFETY: Returns an owned AX application reference for a positive, freshly checked PID.
    let application = unsafe { AXUIElementCreateApplication(target.identity.pid) };
    let application = unsafe { AxNode::from_owned(application) }.ok_or("TARGET_CLOSED")?;
    // Limit each provider call; the immutable request deadline is still checked between calls.
    let timeout_seconds = ((deadline_ms
        .saturating_sub(u64::try_from(epoch.elapsed().as_millis()).unwrap_or(u64::MAX)))
        as f64
        / 1_000.0)
        .clamp(0.01, 0.10) as f32;
    if unsafe { AXUIElementSetMessagingTimeout(application.as_ptr(), timeout_seconds) }
        != AX_SUCCESS
    {
        return Err("TARGET_CLOSED");
    }
    let mut pid = 0_i32;
    if unsafe { AXUIElementGetPid(application.as_ptr(), &mut pid) } != AX_SUCCESS
        || pid != target.identity.pid
    {
        return Err("TARGET_CLOSED");
    }

    let source = AxSource {
        epoch,
        deadline_ms,
        cancel,
        app_hidden: false,
    };
    let app_hidden = source.boolean(&application, b"AXHidden\0")?;
    if app_hidden {
        return Err("TARGET_CLOSED");
    }
    let windows = source.children_for_attribute(&application, b"AXWindows\0", 256)?;
    let mut matching = Vec::new();
    for window in windows {
        source.check()?;
        let mut window_pid = 0_i32;
        if unsafe { AXUIElementGetPid(window.as_ptr(), &mut window_pid) } != AX_SUCCESS
            || window_pid != target.identity.pid
            || source.boolean(&window, b"AXHidden\0")?
            || source.boolean(&window, b"AXMinimized\0")?
        {
            continue;
        }
        let title = source.string(&window, b"AXTitle\0", 1_024)?;
        let Some(bounds) = source.bounds(&window)? else {
            continue;
        };
        if title == target.title && close_bounds(bounds, target.bounds) {
            matching.push(window);
        }
    }
    if matching.len() != 1 {
        return Err("TARGET_CLOSED");
    }
    let root = matching.pop().expect("exactly one AX window");
    let mut source = AxSource {
        epoch,
        deadline_ms,
        cancel,
        app_hidden,
    };
    let projection = project_accessibility_tree(
        &mut source,
        root,
        ProjectionScope {
            app_id,
            window_id,
            snapshot_revision,
            window_bounds: target.bounds,
        },
        cancel,
    )?;
    if process_identity(target.identity.pid, &target.identity.bundle_id).as_ref()
        != Some(&target.identity)
    {
        return Err("TARGET_CLOSED");
    }
    Ok(projection)
}

impl AxSource<'_> {
    fn children_for_attribute(
        &self,
        node: &AxNode,
        attribute: &'static [u8],
        maximum: usize,
    ) -> Result<Vec<AxNode>, &'static str> {
        let Some(value) = self.attribute(node, attribute)? else {
            return Ok(Vec::new());
        };
        if unsafe { CFGetTypeID(value.as_ptr()) } != unsafe { CFArrayGetTypeID() } {
            return Ok(Vec::new());
        }
        let count = unsafe { CFArrayGetCount(value.as_ptr()) }
            .max(0)
            .min(maximum as isize);
        let mut children = Vec::with_capacity(count as usize);
        for index in 0..count {
            let child = unsafe { CFArrayGetValueAtIndex(value.as_ptr(), index) };
            if child.is_null() || unsafe { CFGetTypeID(child) } != unsafe { AXUIElementGetTypeID() }
            {
                continue;
            }
            let retained = unsafe { CFRetain(child) };
            if let Some(child) = unsafe { AxNode::from_owned(retained) } {
                children.push(child);
            }
        }
        Ok(children)
    }
}

#[link(name = "ApplicationServices", kind = "framework")]
unsafe extern "C" {
    fn AXUIElementCreateApplication(pid: i32) -> AXUIElementRef;
    fn AXUIElementCopyAttributeValue(
        element: AXUIElementRef,
        attribute: CFTypeRef,
        value: *mut CFTypeRef,
    ) -> i32;
    fn AXUIElementSetMessagingTimeout(element: AXUIElementRef, timeout: f32) -> i32;
    fn AXUIElementGetPid(element: AXUIElementRef, pid: *mut i32) -> i32;
    fn AXUIElementGetTypeID() -> usize;
    fn AXValueGetTypeID() -> usize;
    fn AXValueGetType(value: CFTypeRef) -> u32;
    fn AXValueGetValue(value: CFTypeRef, value_type: u32, output: *mut c_void) -> u8;
}

#[link(name = "CoreFoundation", kind = "framework")]
unsafe extern "C" {
    fn CFRetain(value: CFTypeRef) -> CFTypeRef;
    fn CFRelease(value: CFTypeRef);
    fn CFGetTypeID(value: CFTypeRef) -> usize;
    fn CFStringCreateWithCString(
        allocator: CFTypeRef,
        value: *const libc::c_char,
        encoding: u32,
    ) -> CFTypeRef;
    fn CFStringGetTypeID() -> usize;
    fn CFStringGetLength(value: CFTypeRef) -> isize;
    fn CFStringGetBytes(
        value: CFTypeRef,
        range: CFRange,
        encoding: u32,
        loss_byte: u8,
        external_representation: u8,
        buffer: *mut u8,
        maximum: isize,
        used: *mut isize,
    ) -> isize;
    fn CFBooleanGetTypeID() -> usize;
    fn CFBooleanGetValue(value: CFTypeRef) -> u8;
    fn CFArrayGetTypeID() -> usize;
    fn CFArrayGetCount(value: CFTypeRef) -> isize;
    fn CFArrayGetValueAtIndex(value: CFTypeRef, index: isize) -> CFTypeRef;
}

#[cfg(test)]
mod tests {
    use std::cell::Cell;

    use super::{VisibilityRead, read_after_visibility};

    #[test]
    fn hidden_and_minimized_nodes_never_read_content() {
        let hidden_reads = Cell::new(0);
        let minimized_reads = Cell::new(0);
        let content_reads = Cell::new(0);

        let app_hidden = read_after_visibility(
            true,
            || {
                hidden_reads.set(hidden_reads.get() + 1);
                Ok::<_, ()>(false)
            },
            || {
                minimized_reads.set(minimized_reads.get() + 1);
                Ok::<_, ()>(false)
            },
            || {
                content_reads.set(content_reads.get() + 1);
                Ok::<_, ()>(())
            },
        )
        .expect("app visibility");
        assert!(matches!(app_hidden, VisibilityRead::Hidden));
        assert_eq!(
            (
                hidden_reads.get(),
                minimized_reads.get(),
                content_reads.get()
            ),
            (0, 0, 0)
        );

        let ax_hidden = read_after_visibility(
            false,
            || {
                hidden_reads.set(hidden_reads.get() + 1);
                Ok::<_, ()>(true)
            },
            || {
                minimized_reads.set(minimized_reads.get() + 1);
                Ok::<_, ()>(false)
            },
            || {
                content_reads.set(content_reads.get() + 1);
                Ok::<_, ()>(())
            },
        )
        .expect("AX hidden");
        assert!(matches!(ax_hidden, VisibilityRead::Hidden));
        assert_eq!(
            (
                hidden_reads.get(),
                minimized_reads.get(),
                content_reads.get()
            ),
            (1, 0, 0)
        );

        let minimized = read_after_visibility(
            false,
            || {
                hidden_reads.set(hidden_reads.get() + 1);
                Ok::<_, ()>(false)
            },
            || {
                minimized_reads.set(minimized_reads.get() + 1);
                Ok::<_, ()>(true)
            },
            || {
                content_reads.set(content_reads.get() + 1);
                Ok::<_, ()>(())
            },
        )
        .expect("AX minimized");
        assert!(matches!(minimized, VisibilityRead::Minimized));
        assert_eq!(
            (
                hidden_reads.get(),
                minimized_reads.get(),
                content_reads.get()
            ),
            (2, 1, 0)
        );

        let visible = read_after_visibility(
            false,
            || Ok::<_, ()>(false),
            || Ok::<_, ()>(false),
            || {
                content_reads.set(content_reads.get() + 1);
                Ok::<_, ()>(7)
            },
        )
        .expect("visible");
        assert!(matches!(visible, VisibilityRead::Visible(7)));
        assert_eq!(content_reads.get(), 1);
    }
}
