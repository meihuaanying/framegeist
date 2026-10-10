//! v1.4.0 audit regression: the free-collage spec must not be able to request
//! gigabytes of memory.
//!
//! The per-side limits (64-8192 px, item fractions in [0.01, 2]) look harmless
//! but multiply: a 8192x8192 canvas with one item at w = h = 2.0 asks for a
//! 16384x16384 RGBA buffer (~1.07 GB) and the rotation step then allocated a
//! second `hypot(w, h)`-square buffer on top of it (~2.15 GB). A few hundred
//! bytes of JSON could exhaust the host, so the caps live in `validate` and the
//! rotation buffer is bounded separately.
//!
//! Fixtures are synthesised in memory -- no dependency on gitignored derives.

use framegeist_core::free_collage::{FreeItem, FreeSpec};

fn spec(width: u32, height: u32, item: FreeItem) -> FreeSpec {
    FreeSpec {
        width,
        height,
        background: "#FFFFFF".into(),
        items: vec![item],
    }
}

fn item(w: f64, h: Option<f64>) -> FreeItem {
    FreeItem {
        photo: 0,
        x: 0.5,
        y: 0.5,
        w,
        h,
        rotation: 0.0,
        radius: None,
        border: None,
        crop: None,
        opacity: 1.0,
        z: 0,
    }
}

#[test]
fn huge_canvas_is_rejected_before_any_buffer_is_reserved() {
    // The original defect: 8192x8192 is inside the per-side range, and one item
    // at 2.0x2.0 pushed the working buffer to 16384x16384.
    let s = spec(8192, 8192, item(2.0, Some(2.0)));
    let err = s.validate().expect_err("8192x8192 must be rejected");
    let text = err.to_string();
    assert!(
        text.contains("40") || text.contains("must not exceed"),
        "error should name the pixel budget, got {text}"
    );
}

#[test]
fn pixel_budget_boundaries_are_exact() {
    // 40 MP exactly is still allowed (and is a realistic large canvas).
    let ok = spec(8000, 5000, item(1.0, Some(1.0))); // 40_000_000 px
    assert!(ok.validate().is_ok(), "40 MP must be accepted");

    // One pixel over is not.
    let over = spec(8000, 5001, item(1.0, Some(1.0))); // 40_008_000 px
    assert!(over.validate().is_err(), "40 MP + 8000 px must be rejected");

    // A square canvas at the cap: 6324^2 = 39_992_976.
    let square = spec(6324, 6324, item(1.0, Some(1.0)));
    assert!(square.validate().is_ok());
    let square_over = spec(6325, 6325, item(1.0, Some(1.0))); // 40_005_625
    assert!(square_over.validate().is_err());
}

#[test]
fn oversized_item_fractions_are_rejected_on_the_capped_canvas() {
    // Canvas is legal, but an item may still ask for more than its share.
    let s = spec(6400, 4000, item(2.0, Some(2.0))); // 12800x8000 = 102.4 MP item
    assert!(
        s.validate().is_ok(),
        "the canvas itself is 25.6 MP, within budget"
    );

    // Per-item pixels are bounded at render time, next to the allocation; the
    // fraction limits themselves still apply on top.
    let s2 = spec(6400, 4000, item(2.5, Some(2.5)));
    assert!(s2.validate().is_err(), "w = 2.5 is outside [0.01, 2]");
}

#[test]
fn rotation_allocation_stays_bounded() {
    use framegeist_core::free_collage::rotate_alloc_dims;

    // Quarter turns never need a square scratch buffer.
    for deg in [0.0f32, 90.0, 180.0, 270.0, -90.0, 360.0] {
        let (w, h) = rotate_alloc_dims(4000, 3000, deg);
        assert!(
            u64::from(w) * u64::from(h) <= 4000u64 * 3000,
            "quarter turn at {deg} deg must not allocate more than the source: got {w}x{h}"
        );
    }

    // Arbitrary angles are clamped to a constant multiple of the source instead
    // of the full hypot(w, h) square.
    let (w, h) = rotate_alloc_dims(4000, 3000, 37.0);
    assert_eq!(w, h, "clamped buffer is square");
    assert!(
        u64::from(w) <= 2 * 4000,
        "diagonal clamp must cap at 2*max(w,h), got {w}"
    );
    assert!(u64::from(w) * u64::from(h) <= (2 * 4000u64) * (2 * 4000u64));

    // Degenerate input must not panic or return zero.
    let (w, h) = rotate_alloc_dims(0, 0, 12.0);
    assert!(w >= 1 && h >= 1);
}

#[test]
fn quarter_turn_rotation_is_exact_and_axis_swapped() {
    // A 2x3 image with distinct corners; a 90-degree rotation must swap the axes
    // and move the pixels exactly, with no resampling blur.
    let mut img = image::RgbaImage::new(2, 3);
    for (x, y, p) in img.enumerate_pixels_mut() {
        *p = image::Rgba([(x * 90 + 10) as u8, (y * 80 + 20) as u8, 200, 255]);
    }
    let rotated = framegeist_core::free_collage::rotate_keep_for_tests(&img, 90.0);
    assert_eq!(rotated.dimensions(), (3, 2));
    // Bilinear resampling of a quarter turn would blend neighbours; an exact
    // rotation keeps every pixel value present somewhere in the output.
    let mut src: Vec<u8> = img.pixels().flat_map(|p| p.0).collect();
    let mut dst: Vec<u8> = rotated.pixels().flat_map(|p| p.0).collect();
    src.sort_unstable();
    dst.sort_unstable();
    assert_eq!(src, dst, "90 degree rotation must not resample pixels");
}
