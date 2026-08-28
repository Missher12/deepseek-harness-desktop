use std::collections::HashMap;
use std::io::{self, Read, Write};
use std::sync::{Arc, Mutex, mpsc};
use std::thread;
use std::time::Instant;

use computer_use_core::{
    CancellationToken, ComputerUseCore, MonotonicClock, NullObservationPlatform,
    ObservationPlatform,
};
use computer_use_protocol::{
    ControlMessage, Direction, EnvelopeDecoder, HelperInput, HelperRequest, LengthPrefixedDecoder,
    decode_helper_input, encode_json_value, encode_length_prefixed,
};

struct SystemMonotonicClock(Instant);

impl MonotonicClock for SystemMonotonicClock {
    fn now_ms(&self) -> u64 {
        u64::try_from(self.0.elapsed().as_millis()).unwrap_or(u64::MAX)
    }
}

fn main() {
    if run().is_err() {
        // The dedicated link closes on every protocol/I/O failure. Do not echo untrusted bytes.
        std::process::exit(2);
    }
}

fn run() -> Result<(), ()> {
    run_io(
        io::stdin(),
        io::stdout(),
        ComputerUseCore::new(
            SystemMonotonicClock(Instant::now()),
            NullObservationPlatform,
        ),
    )
}

enum WorkItem {
    Request(HelperRequest, CancellationToken),
    Control(ControlMessage),
    Eof,
    Fatal,
}

struct ActiveRequest {
    session_id: String,
    lease: Option<(String, u64)>,
    token: CancellationToken,
}

#[derive(Clone, Default)]
struct RequestRegistry(Arc<Mutex<HashMap<String, ActiveRequest>>>);

impl RequestRegistry {
    fn register(&self, request: &HelperRequest) -> CancellationToken {
        let token = CancellationToken::new();
        let lease = request
            .string("leaseId")
            .zip(request.integer("leaseRevision"));
        let entry = ActiveRequest {
            session_id: request.session_id().to_owned(),
            lease: lease.map(|(id, revision)| (id.to_owned(), revision)),
            token: token.clone(),
        };
        let mut requests = self.lock();
        if let Some(previous) = requests.insert(request.request_id().to_owned(), entry) {
            previous.token.cancel();
            token.cancel();
        }
        token
    }

    fn apply_control(&self, control: &ControlMessage) {
        let mut requests = self.lock();
        for (request_id, request) in requests.iter_mut() {
            let matches = match control.control_kind() {
                "request.cancel" => {
                    control.string("requestId") == Some(request_id.as_str())
                        && control.string("sessionId") == Some(request.session_id.as_str())
                }
                "session.revoke" => {
                    control.string("sessionId") == Some(request.session_id.as_str())
                }
                "lease.revoke" => request.lease.as_ref().is_some_and(|(lease_id, revision)| {
                    control.string("sessionId") == Some(request.session_id.as_str())
                        && control.string("leaseId") == Some(lease_id.as_str())
                        && control.integer("leaseRevision") == Some(*revision)
                }),
                "parent.shutdown" => true,
                _ => false,
            };
            if matches {
                request.token.cancel();
            }
        }
    }

    fn complete(&self, request_id: &str) {
        self.lock().remove(request_id);
    }

    fn cancel_all(&self) {
        for request in self.lock().values() {
            request.token.cancel();
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, ActiveRequest>> {
        self.0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }
}

fn run_io<R, W, C, P>(input: R, mut output: W, mut core: ComputerUseCore<C, P>) -> Result<(), ()>
where
    R: Read + Send + 'static,
    W: Write,
    C: MonotonicClock,
    P: ObservationPlatform,
{
    let registry = RequestRegistry::default();
    let (sender, receiver) = mpsc::channel();
    spawn_reader(input, sender, registry.clone());

    while let Ok(work) = receiver.recv() {
        match work {
            WorkItem::Request(request, token) => {
                let request_id = request.request_id().to_owned();
                let response = core.handle_with_cancellation(HelperInput::Request(request), &token);
                if token.is_cancelled() {
                    registry.complete(&request_id);
                    continue;
                }
                if let Some(response) = response {
                    let json = encode_json_value(response.value()).map_err(|_| ())?;
                    let framed = encode_length_prefixed(&json).map_err(|_| ())?;
                    if token.is_cancelled() {
                        registry.complete(&request_id);
                        continue;
                    }
                    output.write_all(&framed).map_err(|_| ())?;
                    output.flush().map_err(|_| ())?;
                }
                registry.complete(&request_id);
            }
            WorkItem::Control(control) => {
                let shutdown = control.control_kind() == "parent.shutdown";
                core.handle(HelperInput::Control(control));
                if shutdown {
                    return Ok(());
                }
            }
            WorkItem::Eof => return Ok(()),
            WorkItem::Fatal => return Err(()),
        }
    }
    Err(())
}

fn spawn_reader<R>(input: R, sender: mpsc::Sender<WorkItem>, registry: RequestRegistry)
where
    R: Read + Send + 'static,
{
    thread::spawn(move || {
        if read_frames(input, &sender, &registry).is_err() {
            registry.cancel_all();
            let _ = sender.send(WorkItem::Fatal);
        }
    });
}

fn read_frames<R>(
    mut input: R,
    sender: &mpsc::Sender<WorkItem>,
    registry: &RequestRegistry,
) -> Result<(), ()>
where
    R: Read,
{
    let mut lengths = LengthPrefixedDecoder::new();
    let mut envelopes = EnvelopeDecoder::new(Direction::ElectronToHelper);
    let mut chunk = [0_u8; 16 * 1024];
    loop {
        let read = input.read(&mut chunk).map_err(|_| ())?;
        if read == 0 {
            registry.cancel_all();
            lengths.finish().map_err(|_| ())?;
            envelopes.finish().map_err(|_| ())?;
            sender.send(WorkItem::Eof).map_err(|_| ())?;
            return Ok(());
        }
        for raw in lengths.push(&chunk[..read]).map_err(|_| ())? {
            for envelope in envelopes.push(&raw).map_err(|_| ())? {
                if envelope.png.is_some() {
                    return Err(());
                }
                match decode_helper_input(envelope.message).map_err(|_| ())? {
                    HelperInput::Request(request) => {
                        let token = registry.register(&request);
                        sender
                            .send(WorkItem::Request(request, token))
                            .map_err(|_| ())?;
                    }
                    HelperInput::Control(control) => {
                        registry.apply_control(&control);
                        sender.send(WorkItem::Control(control)).map_err(|_| ())?;
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use std::io::{self, Cursor, Read, Write};
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::{Arc, Mutex, mpsc};
    use std::thread;
    use std::time::Duration;

    use computer_use_core::{
        CancellationToken, ComputerUseCore, MonotonicClock, ObservationPlatform, PlatformResult,
    };
    use computer_use_protocol::{HelperRequest, encode_json_value, encode_length_prefixed};
    use serde_json::{Value, json};

    use super::run_io;

    #[derive(Clone)]
    struct AtomicClock(Arc<AtomicU64>);

    impl MonotonicClock for AtomicClock {
        fn now_ms(&self) -> u64 {
            self.0.load(Ordering::SeqCst)
        }
    }

    struct BlockingPlatform {
        entered: mpsc::Sender<()>,
        cancelled: mpsc::Sender<()>,
    }

    impl ObservationPlatform for BlockingPlatform {
        fn status(&mut self, _deadline_ms: u64, _cancel: &CancellationToken) -> PlatformResult {
            unreachable!()
        }

        fn list(&mut self, _deadline_ms: u64, _cancel: &CancellationToken) -> PlatformResult {
            unreachable!()
        }

        fn snapshot(
            &mut self,
            _request: &HelperRequest,
            _deadline_ms: u64,
            cancel: &CancellationToken,
        ) -> PlatformResult {
            self.entered.send(()).expect("snapshot entered");
            while !cancel.is_cancelled() {
                thread::yield_now();
            }
            self.cancelled.send(()).expect("snapshot cancelled");
            Ok(json!({"revision":1,"elements":[]}))
        }
    }

    struct ChannelReader {
        receiver: mpsc::Receiver<Option<Vec<u8>>>,
        current: Cursor<Vec<u8>>,
    }

    impl Read for ChannelReader {
        fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
            if self.current.position() < self.current.get_ref().len() as u64 {
                return self.current.read(buffer);
            }
            match self
                .receiver
                .recv()
                .map_err(|_| io::ErrorKind::BrokenPipe)?
            {
                Some(bytes) => {
                    self.current = Cursor::new(bytes);
                    self.current.read(buffer)
                }
                None => Ok(0),
            }
        }
    }

    #[derive(Clone, Default)]
    struct CapturingWriter(Arc<Mutex<Vec<u8>>>);

    impl Write for CapturingWriter {
        fn write(&mut self, buffer: &[u8]) -> io::Result<usize> {
            self.0
                .lock()
                .expect("writer lock")
                .extend_from_slice(buffer);
            Ok(buffer.len())
        }

        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }

    fn framed(value: &Value) -> Vec<u8> {
        let json = encode_json_value(value).expect("strict message");
        encode_length_prefixed(&json).expect("length-prefixed message")
    }

    fn install_request() -> Value {
        json!({
            "protocolVersion":1,
            "messageKind":"request",
            "requestKind":"lease.install",
            "requestId":"00000000-0000-4000-8000-000000000001",
            "sessionId":"session-1",
            "timeoutMs":1000,
            "leaseId":"00000000-0000-4000-8000-000000000002",
            "leaseRevision":1,
            "agentId":"agent-1",
            "targets":[{"appId":"app","windowIds":["window"]}],
            "capabilities":["observe"],
            "quotas":{"operations":3,"snapshots":2,"pointerActions":0,"keyActions":0,"textBytes":0},
            "idleExpiresAfterMs":50000,
            "hardExpiresAfterMs":200000
        })
    }

    fn snapshot_request() -> Value {
        json!({
            "protocolVersion":1,
            "messageKind":"request",
            "requestKind":"snapshot",
            "requestId":"00000000-0000-4000-8000-000000000003",
            "sessionId":"session-1",
            "timeoutMs":1000,
            "leaseId":"00000000-0000-4000-8000-000000000002",
            "leaseRevision":1,
            "appId":"app",
            "windowId":"window",
            "snapshotRevision":1,
            "includeImage":false
        })
    }

    fn assert_high_priority_termination(control: Option<Value>) {
        let (input_tx, input_rx) = mpsc::channel();
        let reader = ChannelReader {
            receiver: input_rx,
            current: Cursor::new(Vec::new()),
        };
        let output = CapturingWriter::default();
        let retained_output = output.clone();
        let (entered_tx, entered_rx) = mpsc::channel();
        let (cancelled_tx, cancelled_rx) = mpsc::channel();
        let core = ComputerUseCore::new(
            AtomicClock(Arc::new(AtomicU64::new(10))),
            BlockingPlatform {
                entered: entered_tx,
                cancelled: cancelled_tx,
            },
        );
        let runtime = thread::spawn(move || run_io(reader, output, core));

        input_tx
            .send(Some(framed(&install_request())))
            .expect("install");
        input_tx
            .send(Some(framed(&snapshot_request())))
            .expect("snapshot");
        entered_rx.recv().expect("snapshot entered");
        let shuts_down = control
            .as_ref()
            .is_some_and(|value| value.pointer("/controlKind") == Some(&json!("parent.shutdown")));
        let has_control = control.is_some();
        if let Some(control) = control {
            input_tx.send(Some(framed(&control))).expect("control");
        } else {
            input_tx.send(None).expect("eof");
        }
        cancelled_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("platform observed cancel");
        if !shuts_down && has_control {
            input_tx
                .send(Some(framed(&json!({
                    "protocolVersion":1,
                    "messageKind":"control",
                    "controlKind":"parent.shutdown"
                }))))
                .expect("shutdown");
        }
        if has_control {
            input_tx.send(None).expect("eof");
        }
        runtime
            .join()
            .expect("runtime thread")
            .expect("runtime success");

        let bytes = retained_output.0.lock().expect("output lock").clone();
        let text = String::from_utf8_lossy(&bytes);
        assert!(text.contains("00000000-0000-4000-8000-000000000001"));
        assert!(!text.contains("00000000-0000-4000-8000-000000000003"));
    }

    #[test]
    fn high_priority_cancel_reaches_blocked_platform_and_suppresses_late_result() {
        assert_high_priority_termination(Some(json!({
            "protocolVersion":1,
            "messageKind":"control",
            "controlKind":"request.cancel",
            "sessionId":"session-1",
            "requestId":"00000000-0000-4000-8000-000000000003"
        })));
    }

    #[test]
    fn high_priority_revocations_and_shutdown_cancel_blocked_platform_work() {
        for control in [
            json!({
                "protocolVersion":1,
                "messageKind":"control",
                "controlKind":"lease.revoke",
                "sessionId":"session-1",
                "leaseId":"00000000-0000-4000-8000-000000000002",
                "leaseRevision":1
            }),
            json!({
                "protocolVersion":1,
                "messageKind":"control",
                "controlKind":"session.revoke",
                "sessionId":"session-1"
            }),
            json!({
                "protocolVersion":1,
                "messageKind":"control",
                "controlKind":"parent.shutdown"
            }),
        ] {
            assert_high_priority_termination(Some(control));
        }
    }

    #[test]
    fn eof_cancels_blocked_platform_work_before_worker_shutdown() {
        assert_high_priority_termination(None);
    }
}
