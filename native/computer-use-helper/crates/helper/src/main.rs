use std::io::{self, Read, Write};
use std::time::Instant;

use computer_use_core::{ComputerUseCore, MonotonicClock, NullObservationPlatform};
use computer_use_protocol::{
    Direction, EnvelopeDecoder, HelperInput, LengthPrefixedDecoder, decode_helper_input,
    encode_json_value, encode_length_prefixed,
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
    let stdin = io::stdin();
    let stdout = io::stdout();
    let mut input = stdin.lock();
    let mut output = stdout.lock();
    let mut lengths = LengthPrefixedDecoder::new();
    let mut envelopes = EnvelopeDecoder::new(Direction::ElectronToHelper);
    let mut core = ComputerUseCore::new(
        SystemMonotonicClock(Instant::now()),
        NullObservationPlatform,
    );
    let mut chunk = [0_u8; 16 * 1024];

    loop {
        let read = input.read(&mut chunk).map_err(|_| ())?;
        if read == 0 {
            lengths.finish().map_err(|_| ())?;
            envelopes.finish().map_err(|_| ())?;
            return Ok(());
        }
        for raw in lengths.push(&chunk[..read]).map_err(|_| ())? {
            for envelope in envelopes.push(&raw).map_err(|_| ())? {
                if envelope.png.is_some() {
                    return Err(());
                }
                let helper_input = decode_helper_input(envelope.message).map_err(|_| ())?;
                let shutdown = matches!(
                    &helper_input,
                    HelperInput::Control(control) if control.control_kind() == "parent.shutdown"
                );
                if let Some(response) = core.handle(helper_input) {
                    let json = encode_json_value(response.value()).map_err(|_| ())?;
                    let framed = encode_length_prefixed(&json).map_err(|_| ())?;
                    output.write_all(&framed).map_err(|_| ())?;
                    output.flush().map_err(|_| ())?;
                }
                if shutdown {
                    return Ok(());
                }
            }
        }
    }
}
