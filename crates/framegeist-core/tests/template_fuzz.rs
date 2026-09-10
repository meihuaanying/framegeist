use framegeist_core::load_template_from_str;

/// Template fuzzing (PRD N4): 100k mutated documents must produce `Result`s,
/// never panics. Deterministic LCG so failures reproduce.
const BASE: &str = r##"{
  "meta": {
    "id": "fuzz-target", "name": "Fuzz", "version": "0.1.0",
    "minEngineVersion": "0.1.0", "author": "t", "license": "CC0-1.0",
    "category": "minimal"
  },
  "canvas": { "mode": "extend", "padding": {"top": 0.05, "bottom": 0.1, "left": 0.05, "right": 0.05},
              "background": {"type": "solid", "color": "#FFFFFF"} },
  "layers": [
    {
      "type": "text", "id": "a", "anchor": "bottom-left",
      "font": { "family": ["JetBrains Mono"], "size": 0.03, "color": "#111111" },
      "content": [ { "expr": "exif.model", "fallback": "n/a" },
                   { "expr": "fmt('{focal}mm f/{aperture}', exif)", "fallback": null } ]
    }
  ]
}"##;

struct Lcg(u64);
impl Lcg {
    fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        self.0
    }
}

fn mutate(rng: &mut Lcg) -> String {
    let mut bytes = BASE.as_bytes().to_vec();
    let mutations = (rng.next() % 8) + 1;
    for _ in 0..mutations {
        if bytes.is_empty() {
            break;
        }
        match rng.next() % 5 {
            0 => {
                let pos = (rng.next() as usize) % bytes.len();
                bytes[pos] = (rng.next() % 256) as u8;
            }
            1 => {
                let pos = (rng.next() as usize) % bytes.len();
                bytes.remove(pos);
            }
            2 => {
                let pos = (rng.next() as usize) % bytes.len();
                bytes.insert(pos, b'"');
            }
            3 => {
                let pos = (rng.next() as usize) % bytes.len();
                bytes.insert(pos, b'\\');
            }
            _ => {
                let pos = (rng.next() as usize) % bytes.len();
                let payload: &[u8] = match rng.next() % 6 {
                    0 => b"http://evil",
                    1 => b"file://x",
                    2 => b"../",
                    3 => b"exif.SYSTEM",
                    4 => b"\x00",
                    _ => b"{",
                };
                let tail = bytes.split_off(pos);
                bytes.extend_from_slice(payload);
                bytes.extend(tail);
            }
        }
        if bytes.len() > 512 * 1024 {
            break;
        }
    }
    String::from_utf8_lossy(&bytes).into_owned()
}

#[test]
fn fuzz_100k_template_mutations_never_panic() {
    let iterations: u32 = std::env::var("FRAMEGEIST_FUZZ_ITERS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(100_000);
    let mut rng = Lcg(0xDEADBEEF);
    let mut accepted = 0u32;
    let mut rejected = 0u32;
    for _ in 0..iterations {
        let doc = mutate(&mut rng);
        match load_template_from_str(&doc) {
            Ok(_) => accepted += 1,
            Err(_) => rejected += 1,
        }
    }
    eprintln!("fuzz: {iterations} iterations, {accepted} accepted, {rejected} rejected");
    assert!(rejected > 0, "fuzz produced no rejections; mutations too weak");
}
