use std::collections::HashMap;
use std::io::{self, Read, Write};
use std::sync::{Arc, Mutex, mpsc};
use std::thread;
use std::time::Instant;

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
use computer_use_core::NullObservationPlatform;
use computer_use_core::{CancellationToken, ComputerUseCore, MonotonicClock, ObservationPlatform};
#[cfg(target_os = "macos")]
use computer_use_helper::platform::macos::MacObservationPlatform;
#[cfg(target_os = "windows")]
use computer_use_helper::platform::windows::observation_platform;
use computer_use_protocol::{
    ControlMessage, Direction, EnvelopeDecoder, HelperInput, HelperRequest, LengthPrefixedDecoder,
    decode_helper_input, encode_json_value, encode_length_prefixed,
};

const OUTPUT_CHUNK_BYTES: usize = 16 * 1024;

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
    let epoch = Instant::now();
    #[cfg(target_os = "macos")]
    let platform = MacObservationPlatform::new(epoch);
    #[cfg(target_os = "windows")]
    let platform = observation_platform(epoch);
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let platform = NullObservationPlatform;
    run_io(
        io::stdin(),
        io::stdout(),
        ComputerUseCore::new(SystemMonotonicClock(epoch), platform),
    )
}

enum WorkItem {
    Request(HelperRequest, RequestTicket),
    Control(ControlMessage),
    Eof,
    Fatal,
}

struct ActiveRequest {
    generation: u64,
    session_id: String,
    lease: Option<(String, u64)>,
    token: CancellationToken,
    output_claimed: bool,
}

struct RequestTicket {
    generation: u64,
    token: CancellationToken,
}

#[derive(Default)]
struct RegistryState {
    requests: HashMap<String, ActiveRequest>,
    last_generation: u64,
}

#[derive(Clone, Default)]
struct RequestRegistry(Arc<Mutex<RegistryState>>);

impl RequestRegistry {
    fn register(&self, request: &HelperRequest) -> Result<RequestTicket, ()> {
        let token = CancellationToken::new();
        let lease = request
            .string("leaseId")
            .zip(request.integer("leaseRevision"));
        let mut state = self.lock();
        let generation = state.last_generation.checked_add(1).ok_or(())?;
        state.last_generation = generation;
        let entry = ActiveRequest {
            generation,
            session_id: request.session_id().to_owned(),
            lease: lease.map(|(id, revision)| (id.to_owned(), revision)),
            token: token.clone(),
            output_claimed: false,
        };
        if let Some(previous) = state
            .requests
            .insert(request.request_id().to_owned(), entry)
        {
            previous.token.cancel();
            token.cancel();
        }
        Ok(RequestTicket { generation, token })
    }

    fn apply_control(&self, control: &ControlMessage) {
        let mut state = self.lock();
        for (request_id, request) in &mut state.requests {
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

    fn try_begin_output(&self, request_id: &str, generation: u64) -> bool {
        let mut state = self.lock();
        let Some(request) = state.requests.get_mut(request_id) else {
            return false;
        };
        if request.generation != generation
            || request.output_claimed
            || request.token.is_cancelled()
        {
            return false;
        }
        request.output_claimed = true;
        true
    }

    fn complete(&self, request_id: &str, generation: u64) {
        let mut state = self.lock();
        if state
            .requests
            .get(request_id)
            .is_some_and(|request| request.generation == generation)
        {
            state.requests.remove(request_id);
        }
    }

    fn cancel_all(&self) {
        for request in self.lock().requests.values() {
            request.token.cancel();
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, RegistryState> {
        self.0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum OutputWrite {
    Complete,
    Canceled,
}

fn write_cancelable<W: Write>(
    output: &mut W,
    framed: &[u8],
    token: &CancellationToken,
) -> Result<OutputWrite, ()> {
    let mut wrote_any = false;
    for chunk in framed.chunks(OUTPUT_CHUNK_BYTES) {
        let mut offset = 0;
        while offset < chunk.len() {
            if token.is_cancelled() {
                return if wrote_any {
                    Err(())
                } else {
                    Ok(OutputWrite::Canceled)
                };
            }
            let written = output.write(&chunk[offset..]).map_err(|_| ())?;
            if written == 0 {
                return Err(());
            }
            wrote_any = true;
            offset += written;
        }
    }
    if token.is_cancelled() {
        return if wrote_any {
            Err(())
        } else {
            Ok(OutputWrite::Canceled)
        };
    }
    output.flush().map_err(|_| ())?;
    Ok(OutputWrite::Complete)
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

    let run_result = (|| -> Result<(), ()> {
        while let Ok(work) = receiver.recv() {
            match work {
                WorkItem::Request(request, ticket) => {
                    let request_id = request.request_id().to_owned();
                    let response =
                        core.handle_with_cancellation(HelperInput::Request(request), &ticket.token);
                    if ticket.token.is_cancelled() {
                        registry.complete(&request_id, ticket.generation);
                        continue;
                    }
                    if let Some(response) = response {
                        let json = encode_json_value(response.value()).map_err(|_| ())?;
                        let mut framed = encode_length_prefixed(&json).map_err(|_| ())?;
                        if let Some(png) = response.png() {
                            let png = png.encode_frame().map_err(|_| ())?;
                            framed
                                .extend_from_slice(&encode_length_prefixed(&png).map_err(|_| ())?);
                        }
                        if !registry.try_begin_output(&request_id, ticket.generation) {
                            registry.complete(&request_id, ticket.generation);
                            continue;
                        }
                        match write_cancelable(&mut output, &framed, &ticket.token) {
                            Ok(OutputWrite::Complete) => {}
                            Ok(OutputWrite::Canceled) => {
                                registry.complete(&request_id, ticket.generation);
                                continue;
                            }
                            Err(()) => {
                                registry.complete(&request_id, ticket.generation);
                                return Err(());
                            }
                        }
                    }
                    registry.complete(&request_id, ticket.generation);
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
    })();
    let cleanup_result = core.shutdown().map_err(|_| ());
    run_result.and(cleanup_result)
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
                        let ticket = registry.register(&request)?;
                        sender
                            .send(WorkItem::Request(request, ticket))
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
    use computer_use_protocol::{
        Direction, EnvelopeDecoder, HelperRequest, LengthPrefixedDecoder, encode_json_value,
        encode_length_prefixed,
    };
    use serde_json::{Value, json};

    use super::{OUTPUT_CHUNK_BYTES, RequestRegistry, run_io, write_cancelable};

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

    struct PngPlatform {
        png: Vec<u8>,
        pending: Option<Vec<u8>>,
    }

    struct ReleasePlatform(Arc<AtomicU64>);

    impl ObservationPlatform for ReleasePlatform {
        fn status(&mut self, _deadline_ms: u64, _cancel: &CancellationToken) -> PlatformResult {
            unreachable!()
        }

        fn list(&mut self, _deadline_ms: u64, _cancel: &CancellationToken) -> PlatformResult {
            unreachable!()
        }

        fn snapshot(
            &mut self,
            _request: &HelperRequest,
            _snapshot_revision: u64,
            _deadline_ms: u64,
            _cancel: &CancellationToken,
        ) -> PlatformResult {
            unreachable!()
        }

        fn release_all_input(
            &mut self,
            _deadline_ms: u64,
            _cancel: &CancellationToken,
        ) -> Result<(), &'static str> {
            self.0.fetch_add(1, Ordering::SeqCst);
            Ok(())
        }
    }

    impl ObservationPlatform for PngPlatform {
        fn status(&mut self, _deadline_ms: u64, _cancel: &CancellationToken) -> PlatformResult {
            unreachable!()
        }

        fn list(&mut self, _deadline_ms: u64, _cancel: &CancellationToken) -> PlatformResult {
            unreachable!()
        }

        fn snapshot(
            &mut self,
            request: &HelperRequest,
            snapshot_revision: u64,
            _deadline_ms: u64,
            _cancel: &CancellationToken,
        ) -> PlatformResult {
            self.pending = Some(self.png.clone());
            Ok(json!({
                "appId": request.string("appId").expect("app"),
                "windowId": request.string("windowId").expect("window"),
                "snapshotRevision": snapshot_revision,
                "semanticText": "",
                "refs": [],
            }))
        }

        fn take_png(&mut self) -> Option<Vec<u8>> {
            self.pending.take()
        }
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
            _snapshot_revision: u64,
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

    #[test]
    fn eof_releases_held_input_before_the_helper_exits() {
        let releases = Arc::new(AtomicU64::new(0));
        run_io(
            Cursor::new(Vec::<u8>::new()),
            Vec::<u8>::new(),
            ComputerUseCore::new(
                AtomicClock(Arc::new(AtomicU64::new(0))),
                ReleasePlatform(releases.clone()),
            ),
        )
        .expect("clean EOF");
        assert_eq!(releases.load(Ordering::SeqCst), 1);
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

    #[test]
    fn writes_declaring_json_and_exact_png_as_one_adjacent_response() {
        struct SignallingWriter {
            bytes: Arc<Mutex<Vec<u8>>>,
            flushed: mpsc::Sender<()>,
        }

        impl Write for SignallingWriter {
            fn write(&mut self, buffer: &[u8]) -> io::Result<usize> {
                self.bytes
                    .lock()
                    .expect("writer lock")
                    .extend_from_slice(buffer);
                Ok(buffer.len())
            }

            fn flush(&mut self) -> io::Result<()> {
                self.flushed
                    .send(())
                    .map_err(|_| io::ErrorKind::BrokenPipe.into())
            }
        }

        let fixture = std::fs::read(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../../../packages/control/desktop-control-protocol/fixtures/browser-snapshot-png.bin"
        ))
        .expect("shared PNG fixture");
        let png = fixture[17..].to_vec();
        let mut snapshot = snapshot_request();
        snapshot["includeImage"] = json!(true);
        let (input_tx, input_rx) = mpsc::channel();
        let reader = ChannelReader {
            receiver: input_rx,
            current: Cursor::new(Vec::new()),
        };
        let bytes = Arc::new(Mutex::new(Vec::new()));
        let (flush_tx, flush_rx) = mpsc::channel();
        let output = SignallingWriter {
            bytes: bytes.clone(),
            flushed: flush_tx,
        };
        let platform_png = png.clone();
        let runtime = thread::spawn(move || {
            run_io(
                reader,
                output,
                ComputerUseCore::new(
                    AtomicClock(Arc::new(AtomicU64::new(10))),
                    PngPlatform {
                        png: platform_png,
                        pending: None,
                    },
                ),
            )
        });
        input_tx
            .send(Some(framed(&install_request())))
            .expect("install");
        flush_rx.recv().expect("install response");
        input_tx.send(Some(framed(&snapshot))).expect("snapshot");
        flush_rx.recv().expect("snapshot response");
        input_tx.send(None).expect("eof");
        runtime
            .join()
            .expect("runtime thread")
            .expect("bounded runtime");

        let bytes = bytes.lock().expect("output lock").clone();
        let mut lengths = LengthPrefixedDecoder::new();
        let frames = lengths.push(&bytes).expect("framed output");
        lengths.finish().expect("complete frames");
        assert_eq!(frames.len(), 3, "install JSON plus snapshot JSON/PNG");
        let mut envelopes = EnvelopeDecoder::new(Direction::HelperToElectron);
        assert_eq!(envelopes.push(&frames[0]).expect("install").len(), 1);
        assert!(
            envelopes
                .push(&frames[1])
                .expect("snapshot JSON")
                .is_empty()
        );
        let snapshot = envelopes.push(&frames[2]).expect("snapshot PNG");
        assert_eq!(
            snapshot[0].png.as_ref().expect("correlated PNG").read(),
            png
        );
    }

    #[test]
    fn canceled_or_stale_generations_cannot_commit_output() {
        let registry = RequestRegistry::default();
        let request = match computer_use_protocol::decode_helper_input(snapshot_request())
            .expect("snapshot")
        {
            computer_use_protocol::HelperInput::Request(request) => request,
            computer_use_protocol::HelperInput::Control(_) => unreachable!(),
        };
        let first = registry.register(&request).expect("first generation");
        registry.complete(request.request_id(), first.generation);
        let second = registry.register(&request).expect("second generation");

        assert!(!registry.try_begin_output(request.request_id(), first.generation));
        second.token.cancel();
        assert!(!registry.try_begin_output(request.request_id(), second.generation));

        let mut output = Vec::new();
        let outcome = write_cancelable(&mut output, b"must not be written", &second.token)
            .expect("cancel before write is clean");
        assert_eq!(outcome, super::OutputWrite::Canceled);
        assert!(output.is_empty());
    }

    #[test]
    fn response_writes_are_cancelable_between_bounded_chunks() {
        struct CancelAfterFirstChunk {
            token: CancellationToken,
            bytes: Vec<u8>,
            writes: usize,
        }

        impl Write for CancelAfterFirstChunk {
            fn write(&mut self, buffer: &[u8]) -> io::Result<usize> {
                self.bytes.extend_from_slice(buffer);
                self.writes += 1;
                if self.writes == 1 {
                    self.token.cancel();
                }
                Ok(buffer.len())
            }

            fn flush(&mut self) -> io::Result<()> {
                Ok(())
            }
        }

        let token = CancellationToken::new();
        let mut output = CancelAfterFirstChunk {
            token: token.clone(),
            bytes: Vec::new(),
            writes: 0,
        };
        let framed = vec![7_u8; OUTPUT_CHUNK_BYTES * 3];

        assert!(write_cancelable(&mut output, &framed, &token).is_err());
        assert_eq!(output.bytes.len(), OUTPUT_CHUNK_BYTES);
    }
}
