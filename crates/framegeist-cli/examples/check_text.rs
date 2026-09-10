use framegeist_core::{load_template, render_rgba, RenderOptions};

/// Visual sanity probe: render a template and report how many non-background
/// pixels land in each padding band. Used to catch silently-clipped text.
fn main() {
    let dir = std::path::PathBuf::from("templates");
    let photo = std::fs::read("templates/assets/test-photos/sample-landscape.jpg").unwrap();
    let mut bad = Vec::new();
    for entry in std::fs::read_dir(&dir).unwrap() {
        let path = entry.unwrap().path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let Ok(bytes) = std::fs::read(&path) else { continue };
        let Ok(tpl) = load_template(&bytes) else { continue };
        if !tpl.layers.iter().any(|l| matches!(l, framegeist_core::template::Layer::Text(_))) {
            continue;
        }
        let opts = RenderOptions {
            assets_dir: Some(dir.join("assets")),
            ..RenderOptions::default()
        };
        let img = render_rgba(&photo, &tpl, &opts).unwrap();
        let (w, h) = img.dimensions();
        let band = (h as f64 * 0.10) as u32;
        let mut nonbg = 0u32;
        for y in (h - band)..h {
            for x in 0..w {
                let p = img.get_pixel(x, y).0;
                let bg = p[0].max(p[1]).max(p[2]) < 250
                    || (p[0] as i16 - p[1] as i16).abs() > 6
                    || (p[1] as i16 - p[2] as i16).abs() > 6;
                if bg {
                    nonbg += 1;
                }
            }
        }
        let total = w * band;
        let ratio = nonbg as f64 / total as f64;
        // any bottom-anchored text layer must produce pixels in the band
        let has_bottom_text = tpl.layers.iter().any(|l| match l {
            framegeist_core::template::Layer::Text(t) => matches!(
                t.anchor,
                framegeist_core::template::Anchor::BottomLeft
                    | framegeist_core::template::Anchor::BottomCenter
                    | framegeist_core::template::Anchor::BottomRight
            ),
            _ => false,
        });
        if has_bottom_text && ratio < 0.0005 {
            bad.push((tpl.meta.id, nonbg, ratio));
        }
    }
    if bad.is_empty() {
        println!("OK: every template with bottom-anchored text renders pixels in the bottom band");
    } else {
        println!("{} templates have NO visible bottom text:", bad.len());
        for (id, n, r) in bad {
            println!("  {id}: nonbg={n} ratio={r:.6}");
        }
        std::process::exit(1);
    }
}
