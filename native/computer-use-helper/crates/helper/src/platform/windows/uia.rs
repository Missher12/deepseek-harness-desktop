//! Bounded UI Automation semantic projection and redaction.

use super::scale::PhysicalRect;

#[cfg(target_os = "windows")]
use computer_use_core::CancellationToken;
#[cfg(target_os = "windows")]
use windows::Win32::Foundation::HWND;
#[cfg(target_os = "windows")]
use windows::Win32::System::Com::{CLSCTX_INPROC_SERVER, CoCreateInstance};
#[cfg(target_os = "windows")]
use windows::Win32::UI::Accessibility::{
    CUIAutomation8, IUIAutomation, IUIAutomationElement, IUIAutomationTreeWalker,
    UIA_ButtonControlTypeId, UIA_CheckBoxControlTypeId, UIA_ComboBoxControlTypeId,
    UIA_CustomControlTypeId, UIA_DataGridControlTypeId, UIA_DataItemControlTypeId,
    UIA_DocumentControlTypeId, UIA_EditControlTypeId, UIA_GroupControlTypeId,
    UIA_HeaderControlTypeId, UIA_HeaderItemControlTypeId, UIA_HyperlinkControlTypeId,
    UIA_ImageControlTypeId, UIA_ListControlTypeId, UIA_ListItemControlTypeId,
    UIA_MenuBarControlTypeId, UIA_MenuControlTypeId, UIA_MenuItemControlTypeId,
    UIA_PaneControlTypeId, UIA_RadioButtonControlTypeId, UIA_ScrollBarControlTypeId,
    UIA_SliderControlTypeId, UIA_SpinnerControlTypeId, UIA_SplitButtonControlTypeId,
    UIA_TabControlTypeId, UIA_TabItemControlTypeId, UIA_TableControlTypeId, UIA_TextControlTypeId,
    UIA_ToolBarControlTypeId, UIA_TreeControlTypeId, UIA_TreeItemControlTypeId,
    UIA_WindowControlTypeId,
};

#[cfg(target_os = "windows")]
const MAX_NATIVE_NODES: usize = 2_000;
#[cfg(target_os = "windows")]
const MAX_NATIVE_DEPTH: usize = 32;

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct RawUiaNode {
    pub(crate) runtime_id: Vec<i32>,
    pub(crate) role: String,
    pub(crate) name: Option<String>,
    pub(crate) value: Option<String>,
    pub(crate) bounds: Option<PhysicalRect>,
    pub(crate) enabled: bool,
    pub(crate) password: bool,
    pub(crate) focused: bool,
    pub(crate) editable: bool,
    pub(crate) children: Vec<Self>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct ProjectionLimits {
    pub(crate) max_nodes: usize,
    pub(crate) max_depth: usize,
    pub(crate) max_text_bytes: usize,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct SemanticNode {
    pub(crate) reference: String,
    pub(crate) role: String,
    pub(crate) name: Option<String>,
    pub(crate) value: Option<String>,
    pub(crate) bounds: Option<PhysicalRect>,
    pub(crate) enabled: bool,
    pub(crate) sensitive: bool,
    pub(crate) focused: bool,
    pub(crate) editable: bool,
}

pub(crate) fn project_semantics(
    identity_material: &[u8],
    snapshot_revision: u64,
    roots: &[RawUiaNode],
    limits: ProjectionLimits,
) -> Result<Vec<SemanticNode>, &'static str> {
    if identity_material.is_empty()
        || snapshot_revision == 0
        || limits.max_nodes == 0
        || limits.max_text_bytes == 0
    {
        return Err("POLICY_DENIED");
    }
    let mut projected = Vec::new();
    let mut text_bytes = 0_usize;
    for (root_index, root) in roots.iter().enumerate() {
        let mut path = vec![root_index];
        project_node(
            identity_material,
            snapshot_revision,
            root,
            &mut path,
            0,
            limits,
            &mut text_bytes,
            &mut projected,
        )?;
    }
    Ok(projected)
}

pub(crate) fn has_sensitive_surface(roots: &[RawUiaNode]) -> bool {
    roots
        .iter()
        .any(|node| node.password || has_sensitive_surface(&node.children))
}

#[allow(clippy::too_many_arguments)]
fn project_node(
    identity_material: &[u8],
    snapshot_revision: u64,
    node: &RawUiaNode,
    path: &mut Vec<usize>,
    depth: usize,
    limits: ProjectionLimits,
    text_bytes: &mut usize,
    projected: &mut Vec<SemanticNode>,
) -> Result<(), &'static str> {
    if depth > limits.max_depth || projected.len() >= limits.max_nodes {
        return Err("POLICY_DENIED");
    }
    let bounds = match node.bounds {
        Some(bounds) if bounds.right <= bounds.left || bounds.bottom <= bounds.top => {
            return Err("POLICY_DENIED");
        }
        bounds => bounds,
    };
    let sensitive = node.password || is_sensitive_role(&node.role);
    let (name, value) = if sensitive {
        (None, None)
    } else {
        account_text(&node.name, text_bytes, limits.max_text_bytes)?;
        account_text(&node.value, text_bytes, limits.max_text_bytes)?;
        (node.name.clone(), node.value.clone())
    };
    projected.push(SemanticNode {
        reference: semantic_reference(identity_material, snapshot_revision, &node.runtime_id, path),
        role: node.role.clone(),
        name,
        value,
        bounds,
        enabled: node.enabled && !sensitive,
        sensitive,
        focused: node.focused && !sensitive,
        editable: node.editable && !sensitive,
    });
    for (child_index, child) in node.children.iter().enumerate() {
        path.push(child_index);
        project_node(
            identity_material,
            snapshot_revision,
            child,
            path,
            depth + 1,
            limits,
            text_bytes,
            projected,
        )?;
        path.pop();
    }
    Ok(())
}

fn account_text(
    text: &Option<String>,
    total: &mut usize,
    maximum: usize,
) -> Result<(), &'static str> {
    let length = text.as_ref().map_or(0, |value| value.len());
    *total = total.checked_add(length).ok_or("POLICY_DENIED")?;
    if *total > maximum {
        return Err("POLICY_DENIED");
    }
    Ok(())
}

fn is_sensitive_role(role: &str) -> bool {
    let role = role.to_ascii_lowercase();
    ["password", "passcode", "otp", "payment", "credit-card"]
        .iter()
        .any(|sensitive| role.contains(sensitive))
}

fn semantic_reference(
    identity_material: &[u8],
    snapshot_revision: u64,
    runtime_id: &[i32],
    path: &[usize],
) -> String {
    let mut first = 0xcbf2_9ce4_8422_2325_u64;
    let mut second = 0x8422_2325_cbf2_9ce4_u64;
    for byte in identity_material
        .iter()
        .copied()
        .chain(snapshot_revision.to_le_bytes())
        .chain(runtime_id.iter().flat_map(|part| part.to_le_bytes()))
        .chain(path.iter().flat_map(|part| part.to_le_bytes()))
    {
        first = (first ^ u64::from(byte)).wrapping_mul(0x0000_0100_0000_01b3);
        second = (second ^ u64::from(byte.rotate_left(1))).wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("computer:{first:016x}{second:016x}")
}

#[cfg(target_os = "windows")]
pub(crate) fn observe_exact_window(
    hwnd: HWND,
    expected_pid: u32,
    cancel: &CancellationToken,
) -> Result<Vec<RawUiaNode>, &'static str> {
    check_cancel(cancel)?;
    let automation: IUIAutomation = unsafe {
        CoCreateInstance(&CUIAutomation8, None, CLSCTX_INPROC_SERVER)
            .map_err(|_| "PERMISSION_DENIED")?
    };
    let root = unsafe {
        automation
            .ElementFromHandle(hwnd)
            .map_err(|_| "PERMISSION_DENIED")?
    };
    if unsafe { root.CurrentProcessId() }
        .ok()
        .and_then(|pid| u32::try_from(pid).ok())
        != Some(expected_pid)
        || unsafe { root.CurrentNativeWindowHandle() }.ok() != Some(hwnd)
    {
        return Err("TARGET_CLOSED");
    }
    let walker = unsafe {
        automation
            .ControlViewWalker()
            .map_err(|_| "PERMISSION_DENIED")?
    };
    let mut visited = 0_usize;
    Ok(vec![read_node(
        &walker,
        root,
        expected_pid,
        0,
        &mut visited,
        cancel,
    )?])
}

#[cfg(target_os = "windows")]
fn read_node(
    walker: &IUIAutomationTreeWalker,
    element: IUIAutomationElement,
    expected_pid: u32,
    depth: usize,
    visited: &mut usize,
    cancel: &CancellationToken,
) -> Result<RawUiaNode, &'static str> {
    check_cancel(cancel)?;
    if depth > MAX_NATIVE_DEPTH || *visited >= MAX_NATIVE_NODES {
        return Err("POLICY_DENIED");
    }
    *visited += 1;
    let process_matches = unsafe { element.CurrentProcessId() }
        .ok()
        .and_then(|pid| u32::try_from(pid).ok())
        == Some(expected_pid);
    let control_type = unsafe { element.CurrentControlType() }.map_err(|_| "PERMISSION_DENIED")?;
    let role = control_role(control_type.0).to_owned();
    let offscreen = unsafe { element.CurrentIsOffscreen() }
        .map_err(|_| "PERMISSION_DENIED")?
        .as_bool();
    let password = unsafe { element.CurrentIsPassword() }
        .map_err(|_| "PERMISSION_DENIED")?
        .as_bool();
    let enabled = unsafe { element.CurrentIsEnabled() }
        .map_err(|_| "PERMISSION_DENIED")?
        .as_bool();
    let focused = unsafe { element.CurrentHasKeyboardFocus() }
        .map_err(|_| "PERMISSION_DENIED")?
        .as_bool();
    let editable = matches!(role.as_str(), "edit" | "document");
    let raw_name = if password || offscreen || !process_matches {
        None
    } else {
        let value = unsafe { element.CurrentName() }.map_err(|_| "PERMISSION_DENIED")?;
        let value = truncate_utf8(&value.to_string(), 1_024);
        (!value.is_empty()).then_some(value)
    };
    let label_sensitive = raw_name
        .as_deref()
        .is_some_and(|name| sensitive_label(&role, name));
    let sensitive = password
        || label_sensitive
        || raw_name.is_none() && !offscreen && process_matches && editable;
    let name = (!sensitive).then_some(raw_name).flatten();
    let rect = unsafe { element.CurrentBoundingRectangle() }.map_err(|_| "PERMISSION_DENIED")?;
    let bounds = PhysicalRect {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
    };
    let bounds = (bounds.right > bounds.left && bounds.bottom > bounds.top).then_some(bounds);
    let mut children = Vec::new();
    if !offscreen && process_matches && depth < MAX_NATIVE_DEPTH {
        let mut child = unsafe { walker.GetFirstChildElement(&element) }.ok();
        while let Some(current) = child {
            if *visited >= MAX_NATIVE_NODES {
                return Err("POLICY_DENIED");
            }
            children.push(read_node(
                walker,
                current.clone(),
                expected_pid,
                depth + 1,
                visited,
                cancel,
            )?);
            child = unsafe { walker.GetNextSiblingElement(&current) }.ok();
        }
    }
    Ok(RawUiaNode {
        runtime_id: vec![
            i32::try_from(expected_pid).unwrap_or(i32::MAX),
            control_type.0,
            i32::try_from(*visited).unwrap_or(i32::MAX),
        ],
        role,
        name,
        value: None,
        bounds,
        enabled: enabled && process_matches,
        password: sensitive,
        focused: focused && process_matches,
        editable,
        children,
    })
}

#[cfg(target_os = "windows")]
fn control_role(control_type: i32) -> &'static str {
    match control_type {
        value if value == UIA_ButtonControlTypeId.0 => "button",
        value if value == UIA_CheckBoxControlTypeId.0 => "checkbox",
        value if value == UIA_ComboBoxControlTypeId.0 => "combobox",
        value if value == UIA_EditControlTypeId.0 => "edit",
        value if value == UIA_HyperlinkControlTypeId.0 => "link",
        value if value == UIA_ListControlTypeId.0 => "list",
        value if value == UIA_ListItemControlTypeId.0 => "listitem",
        value if value == UIA_MenuControlTypeId.0 => "menu",
        value if value == UIA_MenuBarControlTypeId.0 => "menubar",
        value if value == UIA_MenuItemControlTypeId.0 => "menuitem",
        value if value == UIA_RadioButtonControlTypeId.0 => "radiobutton",
        value if value == UIA_ScrollBarControlTypeId.0 => "scrollbar",
        value if value == UIA_SliderControlTypeId.0 => "slider",
        value if value == UIA_SpinnerControlTypeId.0 => "spinner",
        value if value == UIA_SplitButtonControlTypeId.0 => "splitbutton",
        value if value == UIA_TabControlTypeId.0 => "tab",
        value if value == UIA_TabItemControlTypeId.0 => "tabitem",
        value if value == UIA_TableControlTypeId.0 => "table",
        value if value == UIA_DataGridControlTypeId.0 => "datagrid",
        value if value == UIA_DataItemControlTypeId.0 => "dataitem",
        value if value == UIA_DocumentControlTypeId.0 => "document",
        value if value == UIA_TextControlTypeId.0 => "text",
        value if value == UIA_TreeControlTypeId.0 => "tree",
        value if value == UIA_TreeItemControlTypeId.0 => "treeitem",
        value if value == UIA_WindowControlTypeId.0 => "window",
        value if value == UIA_PaneControlTypeId.0 => "pane",
        value if value == UIA_GroupControlTypeId.0 => "group",
        value if value == UIA_HeaderControlTypeId.0 => "header",
        value if value == UIA_HeaderItemControlTypeId.0 => "headeritem",
        value if value == UIA_ToolBarControlTypeId.0 => "toolbar",
        value if value == UIA_ImageControlTypeId.0 => "image",
        value if value == UIA_CustomControlTypeId.0 => "custom",
        _ => "control",
    }
}

#[cfg(target_os = "windows")]
fn sensitive_label(role: &str, name: &str) -> bool {
    let label = format!("{role} {name}").to_ascii_lowercase();
    [
        "password",
        "passcode",
        "one-time",
        "otp",
        "credit card",
        "payment",
        "security code",
        "credential",
        "biometric",
        "privacy",
        "uninstall",
        "delete permanently",
    ]
    .iter()
    .any(|needle| label.contains(needle))
}

#[cfg(target_os = "windows")]
fn truncate_utf8(value: &str, maximum: usize) -> String {
    if value.len() <= maximum {
        return value.to_owned();
    }
    let mut end = maximum;
    while !value.is_char_boundary(end) {
        end -= 1;
    }
    value[..end].to_owned()
}

#[cfg(target_os = "windows")]
fn check_cancel(cancel: &CancellationToken) -> Result<(), &'static str> {
    if cancel.is_cancelled() {
        return Err("CANCELLED");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{ProjectionLimits, RawUiaNode, has_sensitive_surface, project_semantics};
    use crate::platform::windows::scale::PhysicalRect;

    fn node(role: &str, password: bool, children: Vec<RawUiaNode>) -> RawUiaNode {
        RawUiaNode {
            runtime_id: vec![42, children.len() as i32],
            role: role.to_owned(),
            name: Some("visible name".to_owned()),
            value: Some("sensitive value".to_owned()),
            bounds: Some(PhysicalRect {
                left: -10,
                top: 5,
                right: 30,
                bottom: 25,
            }),
            enabled: true,
            password,
            focused: false,
            editable: matches!(role, "edit" | "document"),
            children,
        }
    }

    #[test]
    fn projects_bounded_preorder_nodes_and_redacts_password_content() {
        let roots = [node(
            "window",
            false,
            vec![node("password", true, Vec::new())],
        )];
        let projected = project_semantics(
            b"5:7:11",
            9,
            &roots,
            ProjectionLimits {
                max_nodes: 2,
                max_depth: 2,
                max_text_bytes: 128,
            },
        )
        .expect("bounded projection");

        assert!(has_sensitive_surface(&roots));

        assert_eq!(projected.len(), 2);
        assert!(
            projected
                .iter()
                .all(|node| node.reference.starts_with("computer:"))
        );
        assert_ne!(projected[0].reference, projected[1].reference);
        assert_eq!(projected[0].name.as_deref(), Some("visible name"));
        assert_eq!(projected[1].name, None);
        assert_eq!(projected[1].value, None);
    }

    #[test]
    fn rejects_tree_depth_node_count_and_text_overflow() {
        let roots = [node(
            "window",
            false,
            vec![node("button", false, Vec::new())],
        )];
        for limits in [
            ProjectionLimits {
                max_nodes: 1,
                max_depth: 2,
                max_text_bytes: 128,
            },
            ProjectionLimits {
                max_nodes: 2,
                max_depth: 0,
                max_text_bytes: 128,
            },
            ProjectionLimits {
                max_nodes: 2,
                max_depth: 2,
                max_text_bytes: 3,
            },
        ] {
            assert_eq!(
                project_semantics(b"identity", 1, &roots, limits),
                Err("POLICY_DENIED")
            );
        }
    }

    #[test]
    fn keeps_refs_unique_when_runtime_ids_repeat_in_different_tree_branches() {
        let roots = [
            node("group", false, vec![node("button", false, Vec::new())]),
            node("group", false, vec![node("button", false, Vec::new())]),
        ];
        let projected = project_semantics(
            b"identity",
            1,
            &roots,
            ProjectionLimits {
                max_nodes: 4,
                max_depth: 2,
                max_text_bytes: 256,
            },
        )
        .expect("projection");
        let unique = projected
            .iter()
            .map(|node| node.reference.as_str())
            .collect::<std::collections::HashSet<_>>();
        assert_eq!(unique.len(), projected.len());
    }
}
