use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use computer_use_core::{
    AccessibilityNode, AccessibilityNodeSource, CancellationToken, InputSafety,
    MAX_RAW_ACCESSIBILITY_NODES, ObservationBounds, ProjectionScope, capture_dimensions,
    project_accessibility_tree,
};

#[derive(Clone)]
struct FakeNode {
    role: String,
    name: String,
    bounds: Option<ObservationBounds>,
    hidden: bool,
    minimized: bool,
    children: Vec<u32>,
}

struct FakeTree {
    nodes: HashMap<u32, FakeNode>,
}

impl AccessibilityNodeSource for FakeTree {
    type Node = u32;

    fn describe(
        &mut self,
        node: &Self::Node,
    ) -> Result<AccessibilityNode<Self::Node>, &'static str> {
        let node = self.nodes.get(node).ok_or("TARGET_CLOSED")?;
        Ok(AccessibilityNode {
            role: node.role.clone(),
            name: node.name.clone(),
            bounds: node.bounds,
            hidden: node.hidden,
            minimized: node.minimized,
            input_safety: InputSafety::default(),
            children: node.children.clone(),
        })
    }
}

fn bounds(x: f64, y: f64, width: f64, height: f64) -> ObservationBounds {
    ObservationBounds {
        x,
        y,
        width,
        height,
    }
}

#[test]
fn projects_breadth_first_and_skips_hidden_minimized_and_offscreen_nodes() {
    let mut tree = FakeTree {
        nodes: HashMap::from([
            (
                0,
                FakeNode {
                    role: "AXWindow".into(),
                    name: "Window".into(),
                    bounds: Some(bounds(0.0, 0.0, 800.0, 600.0)),
                    hidden: false,
                    minimized: false,
                    children: vec![1, 2, 3, 4],
                },
            ),
            (
                1,
                FakeNode {
                    role: "AXButton".into(),
                    name: "First".into(),
                    bounds: Some(bounds(10.0, 10.0, 80.0, 30.0)),
                    hidden: false,
                    minimized: false,
                    children: vec![5],
                },
            ),
            (
                2,
                FakeNode {
                    role: "AXButton".into(),
                    name: "Hidden secret".into(),
                    bounds: Some(bounds(20.0, 20.0, 80.0, 30.0)),
                    hidden: true,
                    minimized: false,
                    children: vec![],
                },
            ),
            (
                3,
                FakeNode {
                    role: "AXWindow".into(),
                    name: "Minimized secret".into(),
                    bounds: Some(bounds(30.0, 30.0, 80.0, 30.0)),
                    hidden: false,
                    minimized: true,
                    children: vec![],
                },
            ),
            (
                4,
                FakeNode {
                    role: "AXButton".into(),
                    name: "Offscreen secret".into(),
                    bounds: Some(bounds(900.0, 700.0, 80.0, 30.0)),
                    hidden: false,
                    minimized: false,
                    children: vec![],
                },
            ),
            (
                5,
                FakeNode {
                    role: "AXStaticText".into(),
                    name: "Second level".into(),
                    bounds: Some(bounds(12.0, 50.0, 120.0, 20.0)),
                    hidden: false,
                    minimized: false,
                    children: vec![],
                },
            ),
        ]),
    };

    let projection = project_accessibility_tree(
        &mut tree,
        0,
        ProjectionScope {
            app_id: "mac-app:1:10:0:aaaaaaaaaaaaaaaa",
            window_id: "mac-window:1:10:0:42",
            snapshot_revision: 7,
            window_bounds: bounds(0.0, 0.0, 800.0, 600.0),
        },
        &CancellationToken::new(),
    )
    .expect("bounded projection");

    assert_eq!(
        projection
            .refs
            .iter()
            .map(|item| item.name.as_str())
            .collect::<Vec<_>>(),
        ["Window", "First", "Second level"]
    );
    assert!(projection.semantic_text.contains("bounds=10,10,80,30"));
    assert!(!projection.semantic_text.contains("secret"));
}

#[test]
fn freezes_depth_node_ref_text_role_and_name_limits_on_utf8_boundaries() {
    let mut nodes = HashMap::new();
    nodes.insert(
        0,
        FakeNode {
            role: "r".repeat(200),
            name: "界".repeat(600),
            bounds: Some(bounds(0.0, 0.0, 10.0, 10.0)),
            hidden: false,
            minimized: false,
            children: (1..=2_100).collect(),
        },
    );
    for id in 1..=2_100 {
        nodes.insert(
            id,
            FakeNode {
                role: "AXButton".into(),
                name: format!("button-{id}"),
                bounds: Some(bounds(1.0, 1.0, 5.0, 5.0)),
                hidden: false,
                minimized: false,
                children: if id == 1 { vec![2_101] } else { vec![] },
            },
        );
    }
    nodes.insert(
        2_101,
        FakeNode {
            role: "AXButton".into(),
            name: "deep".into(),
            bounds: Some(bounds(1.0, 1.0, 5.0, 5.0)),
            hidden: false,
            minimized: false,
            children: vec![],
        },
    );
    let mut tree = FakeTree { nodes };

    let projection = project_accessibility_tree(
        &mut tree,
        0,
        ProjectionScope {
            app_id: "mac-app:1:10:0:aaaaaaaaaaaaaaaa",
            window_id: "mac-window:1:10:0:42",
            snapshot_revision: 1,
            window_bounds: bounds(0.0, 0.0, 100.0, 100.0),
        },
        &CancellationToken::new(),
    )
    .expect("bounded projection");

    assert_eq!(projection.raw_nodes, 2_000);
    assert!(projection.refs.len() <= 300);
    assert!(projection.semantic_text.len() <= 49_152);
    assert!(projection.refs[0].role.len() <= 128);
    assert!(projection.refs[0].name.len() <= 1_024);
    assert!(std::str::from_utf8(projection.refs[0].name.as_bytes()).is_ok());
    assert!(
        projection
            .refs
            .iter()
            .all(|item| item.ref_id.starts_with("computer:") && item.ref_id.len() == 41)
    );
}

#[test]
fn converts_point_scale_into_deterministic_bounded_capture_dimensions() {
    assert_eq!(
        capture_dimensions(
            ObservationBounds {
                x: 0.0,
                y: 0.0,
                width: 1_024.0,
                height: 1_024.0
            },
            2.0
        ),
        Some((2_048, 2_048))
    );
    let (width, height) = capture_dimensions(
        ObservationBounds {
            x: 0.0,
            y: 0.0,
            width: 3_000.0,
            height: 2_000.0,
        },
        2.0,
    )
    .expect("bounded dimensions");
    assert_eq!((width, height), (2_048, 1_365));
    assert!(u64::from(width) * u64::from(height) <= 4_194_304);
    assert_eq!(
        capture_dimensions(
            ObservationBounds {
                x: 0.0,
                y: 0.0,
                width: 0.0,
                height: 10.0
            },
            2.0
        ),
        None
    );
}

#[test]
fn stops_after_depth_32_and_revision_binds_every_reference() {
    let make_tree = || {
        let mut nodes = HashMap::new();
        for depth in 0..=40 {
            nodes.insert(
                depth,
                FakeNode {
                    role: "AXGroup".into(),
                    name: format!("depth-{depth}"),
                    bounds: Some(bounds(0.0, 0.0, 10.0, 10.0)),
                    hidden: false,
                    minimized: false,
                    children: if depth < 40 { vec![depth + 1] } else { vec![] },
                },
            );
        }
        FakeTree { nodes }
    };
    let project = |revision| {
        project_accessibility_tree(
            &mut make_tree(),
            0,
            ProjectionScope {
                app_id: "mac-app:1:10:0:aaaaaaaaaaaaaaaa",
                window_id: "mac-window:1:10:0:42",
                snapshot_revision: revision,
                window_bounds: bounds(0.0, 0.0, 100.0, 100.0),
            },
            &CancellationToken::new(),
        )
        .expect("bounded projection")
    };
    let first = project(1);
    let revised = project(2);
    assert_eq!(first.raw_nodes, 33);
    assert!(first.semantic_text.contains("depth-32"));
    assert!(!first.semantic_text.contains("depth-33"));
    assert_ne!(first.refs[0].ref_id, revised.refs[0].ref_id);
}

#[derive(Default)]
struct LiveNodes {
    current: AtomicUsize,
    peak: AtomicUsize,
}

struct TrackedNode(Arc<LiveNodes>);

impl TrackedNode {
    fn new(live: &Arc<LiveNodes>) -> Self {
        let current = live.current.fetch_add(1, Ordering::SeqCst) + 1;
        live.peak.fetch_max(current, Ordering::SeqCst);
        Self(live.clone())
    }
}

impl Clone for TrackedNode {
    fn clone(&self) -> Self {
        Self::new(&self.0)
    }
}

impl Drop for TrackedNode {
    fn drop(&mut self) {
        self.0.current.fetch_sub(1, Ordering::SeqCst);
    }
}

struct BranchingTree {
    live: Arc<LiveNodes>,
}

impl AccessibilityNodeSource for BranchingTree {
    type Node = TrackedNode;

    fn describe(
        &mut self,
        _node: &Self::Node,
    ) -> Result<AccessibilityNode<Self::Node>, &'static str> {
        Ok(AccessibilityNode {
            role: "AXGroup".into(),
            name: String::new(),
            bounds: Some(bounds(0.0, 0.0, 10.0, 10.0)),
            hidden: false,
            minimized: false,
            input_safety: InputSafety::default(),
            children: (0..3).map(|_| TrackedNode::new(&self.live)).collect(),
        })
    }
}

#[test]
fn bounds_the_pending_breadth_first_queue_by_the_raw_node_budget() {
    let live = Arc::new(LiveNodes::default());
    let root = TrackedNode::new(&live);
    let projection = project_accessibility_tree(
        &mut BranchingTree { live: live.clone() },
        root,
        ProjectionScope {
            app_id: "mac-app:1:10:0:aaaaaaaaaaaaaaaa",
            window_id: "mac-window:1:10:0:42",
            snapshot_revision: 1,
            window_bounds: bounds(0.0, 0.0, 100.0, 100.0),
        },
        &CancellationToken::new(),
    )
    .expect("bounded projection");

    assert_eq!(projection.raw_nodes, MAX_RAW_ACCESSIBILITY_NODES);
    assert!(
        live.peak.load(Ordering::SeqCst) <= MAX_RAW_ACCESSIBILITY_NODES + 4,
        "pending native handles must stay within the raw-node budget"
    );
}
