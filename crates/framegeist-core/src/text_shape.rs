//! v0.5.0 shared text shaping/rasterization back end (cosmic-text 0.19 +
//! swash). The legacy `ab_glyph` path stays available behind
//! `RenderOptions::legacy_text_renderer` so tests can lock both paths.
//!
//! The engine renders a text block into an alpha mask; every text effect
//! (stroke/relief/fill/shadow) is a post-process over that mask, which keeps
//! CLI/WASM/desktop pixel-identical by construction.

use std::collections::HashMap;
use std::sync::Arc;

use cosmic_text::{Attrs, Buffer, Family, FontSystem, Metrics, Shaping, SwashCache, Weight};

use crate::text::FontBook;

/// Normalized family key (same convention as `FontBook`).
pub fn family_key(name: &str) -> String {
    name.split('-')
        .next()
        .unwrap_or(name)
        .replace([' ', '_'], "")
        .to_ascii_lowercase()
}

pub struct ShapeRequest<'a> {
    pub text: &'a str,
    pub families: &'a [String],
    pub weight: Option<u32>,
    pub size_px: f32,
    pub line_height: f32,
    pub letter_spacing_em: f32,
    pub align: &'a str,
    /// Wrap width in pixels (`None` = no wrapping).
    pub max_width: Option<f32>,
}

/// Rasterized text block: tight alpha mask, origin-normalized.
pub struct TextRaster {
    pub width: u32,
    pub height: u32,
    /// First-line baseline relative to the mask top (px).
    pub first_baseline: f32,
    /// Alpha coverage 0..=1 per pixel.
    pub alpha: Vec<f32>,
}

impl TextRaster {
    pub fn get(&self, x: u32, y: u32) -> f32 {
        if x >= self.width || y >= self.height {
            0.0
        } else {
            self.alpha[(y * self.width + x) as usize]
        }
    }
}

/// Owns the cosmic-text shaping system plus its raster cache. Built from a
/// `FontBook`; cheap to rebuild when the font set changes.
pub struct Shaper {
    system: FontSystem,
    cache: SwashCache,
    key_to_family: HashMap<String, String>,
    first_family: Option<String>,
}

impl Shaper {
    pub fn new(book: &FontBook) -> Shaper {
        let db = (*book.database()).clone();
        // Map FrameGeist family keys to the real family names fontdb parsed.
        let mut key_to_family = HashMap::new();
        for (key, bytes) in book.iter_entries() {
            if let Some(face) = db.faces().find(|f| source_matches(&f.source, bytes)) {
                if let Some((name, _)) = face.families.first() {
                    key_to_family.insert(key.clone(), name.clone());
                }
            }
        }
        let first_family = db
            .faces()
            .next()
            .and_then(|f| f.families.first().map(|(n, _)| n.clone()));
        Shaper {
            system: FontSystem::new_with_locale_and_db("en-US".into(), db),
            cache: SwashCache::new(),
            key_to_family,
            first_family,
        }
    }

    /// True when at least one font face is registered (avoids cosmic-text
    /// panics on an empty database).
    pub fn has_fonts(&self) -> bool {
        self.first_family.is_some()
    }

    fn family_for(&self, families: &[String]) -> Option<String> {
        if !self.has_fonts() {
            return None;
        }
        for family in families {
            if let Some(real) = self.key_to_family.get(&family_key(family)) {
                return Some(real.clone());
            }
        }
        self.first_family.clone()
    }

    /// Shape and rasterize a text block. Returns `None` when there is no
    /// visible glyph.
    pub fn shape(&mut self, req: &ShapeRequest) -> Option<TextRaster> {
        if req.text.is_empty() || req.size_px <= 0.0 || !self.has_fonts() {
            return None;
        }
        let family = self.family_for(req.families)?;
        let attrs = Attrs::new()
            .family(Family::Name(family.as_str()))
            .weight(Weight(req.weight.unwrap_or(400).clamp(100, 900) as u16))
            .letter_spacing(req.letter_spacing_em);
        let metrics = Metrics::new(req.size_px, req.size_px * req.line_height);
        let mut buffer = Buffer::new(&mut self.system, metrics);
        buffer.set_size(req.max_width, None);
        buffer.set_text(req.text, &attrs, Shaping::Advanced, None);
        buffer.shape_until_scroll(&mut self.system, false);

        // Collect physical glyphs plus rasterized images in one pass.
        struct Raster {
            x: i32,
            y: i32,
            w: u32,
            h: u32,
            data: Vec<u8>,
            run: usize,
        }
        let mut rasters: Vec<Raster> = Vec::new();
        let mut min_x = i32::MAX;
        let mut max_x = i32::MIN;
        let mut min_y = i32::MAX;
        let mut max_y = i32::MIN;
        let mut run_widths: Vec<(f32, f32)> = Vec::new(); // (run_w, line_y)
        for run in buffer.layout_runs() {
            let run_index = run_widths.len();
            let mut run_min = f32::MAX;
            let mut run_max = f32::MIN;
            for glyph in run.glyphs {
                let physical = glyph.physical((0.0, 0.0), 1.0);
                let image = self.cache.get_image(&mut self.system, physical.cache_key);
                let Some(image) = image.as_ref() else {
                    continue;
                };
                let x = physical.x + image.placement.left;
                let y = (run.line_y.round() as i32) - physical.y - image.placement.top;
                let (w, h) = (image.placement.width, image.placement.height);
                if w > 0 && h > 0 {
                    let alpha: Vec<u8> = match image.content {
                        cosmic_text::SwashContent::Mask => image.data.clone(),
                        _ => image.data.as_chunks::<4>().0.iter().map(|p| p[3]).collect(),
                    };
                    rasters.push(Raster {
                        x,
                        y,
                        w,
                        h,
                        data: alpha,
                        run: run_index,
                    });
                    min_x = min_x.min(x);
                    min_y = min_y.min(y);
                    max_x = max_x.max(x + w as i32);
                    max_y = max_y.max(y + h as i32);
                    run_min = run_min.min(x as f32);
                    run_max = run_max.max((x + w as i32) as f32);
                }
            }
            if run_min != f32::MAX {
                run_widths.push((run_max - run_min, run.line_y));
            }
        }
        if rasters.is_empty() || max_x <= min_x || max_y <= min_y {
            return None;
        }
        let width = (max_x - min_x).max(1) as u32;
        let height = (max_y - min_y).max(1) as u32;

        // Horizontal alignment: shift each run by (block_w - run_w) * factor.
        let block_w = run_widths.iter().map(|(w, _)| *w).fold(0.0f32, f32::max);
        let align_shift = |run_w: f32| -> f32 {
            match req.align {
                "center" => (block_w - run_w) / 2.0,
                "right" => block_w - run_w,
                _ => 0.0,
            }
        };

        let mut alpha = vec![0f32; (width * height) as usize];
        for r in &rasters {
            let (run_w, _) = run_widths.get(r.run).copied().unwrap_or((0.0, 0.0));
            let shift = align_shift(run_w).round() as i32;
            let x0 = r.x - min_x + shift;
            let y0 = r.y - min_y;
            for gy in 0..r.h {
                for gx in 0..r.w {
                    let px = x0 + gx as i32;
                    let py = y0 + gy as i32;
                    if px < 0 || py < 0 || px >= width as i32 || py >= height as i32 {
                        continue;
                    }
                    let cov = r.data[(gy * r.w + gx) as usize] as f32 / 255.0;
                    if cov <= 0.0 {
                        continue;
                    }
                    let idx = (py as u32 * width + px as u32) as usize;
                    alpha[idx] = (alpha[idx] + cov).min(1.0);
                }
            }
        }

        let first_baseline = run_widths
            .first()
            .map(|(_, y)| (*y - min_y as f32).max(0.0))
            .unwrap_or(req.size_px);
        Some(TextRaster {
            width,
            height,
            first_baseline,
            alpha,
        })
    }
}

fn source_matches(src: &cosmic_text::fontdb::Source, bytes: &[u8]) -> bool {
    match src {
        cosmic_text::fontdb::Source::Binary(data) => data.as_ref().as_ref() == bytes,
        _ => false,
    }
}

/// Thread-safe lazy database shared by all clones of a `FontBook`.
pub(crate) type SharedDb = Arc<std::sync::Mutex<Option<Arc<cosmic_text::fontdb::Database>>>>;
