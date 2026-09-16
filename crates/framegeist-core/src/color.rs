//! v0.6.0 ICC color management: photos tagged with a non-sRGB profile
//! (Display P3, Adobe RGB, …) are converted to sRGB before layout, so previews,
//! exports and the tag we write all agree on the same color space.
//!
//! The conversion runs on already-oriented pixels (after the preview resize in
//! `decode_oriented`) and degrades silently to untouched pixels when the ICC
//! block is malformed or the transform cannot be built.

use image::RgbaImage;
use moxcms::{ColorProfile, Layout, TransformOptions};

use crate::{Error, Result};

/// Best-effort check whether a parsed profile already describes sRGB.
fn is_srgb(profile: &ColorProfile) -> bool {
    if let Some(desc) = &profile.description {
        let text = format!("{desc:?}").to_ascii_lowercase();
        if text.contains("srgb") {
            return true;
        }
    }
    false
}

/// Convert `img` (tagged with `icc`) into sRGB. Returns a clone of the input
/// when the profile is sRGB/unknown; errors only for genuine API failures.
pub fn convert_to_srgb_rgba(img: &RgbaImage, icc: &[u8]) -> Result<RgbaImage> {
    let src =
        ColorProfile::new_from_slice(icc).map_err(|e| Error::Image(format!("icc profile: {e}")))?;
    if is_srgb(&src) {
        return Ok(img.clone());
    }
    let dst = ColorProfile::new_srgb();
    let transform = src
        .create_transform_8bit(
            Layout::Rgba,
            &dst,
            Layout::Rgba,
            TransformOptions::default(),
        )
        .map_err(|e| Error::Image(format!("icc transform: {e}")))?;
    let mut out = img.clone();
    transform
        .transform(img.as_raw(), out.as_mut())
        .map_err(|e| Error::Image(format!("icc transform: {e}")))?;
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::Rgba;

    fn red_image() -> RgbaImage {
        // P3 primary red clips to sRGB red; use an in-gamut orange so the
        // transform result is comparable channel by channel.
        RgbaImage::from_pixel(4, 4, Rgba([255, 128, 0, 255]))
    }

    #[test]
    fn display_p3_red_converts_to_srgb() {
        let p3 = ColorProfile::new_display_p3().encode().expect("p3 icc");
        let out = convert_to_srgb_rgba(&red_image(), &p3).expect("convert");
        let px = out.get_pixel(0, 0).0;
        assert_eq!(px[3], 255, "alpha preserved");
        assert!(
            px != [255, 128, 0, 255],
            "P3-tagged orange must change when re-expressed in sRGB, got {px:?}"
        );
    }

    #[test]
    fn srgb_profile_is_a_no_op() {
        let srgb = ColorProfile::new_srgb().encode().expect("srgb icc");
        let src = red_image();
        let out = convert_to_srgb_rgba(&src, &srgb).expect("convert");
        assert_eq!(src.as_raw(), out.as_raw());
    }

    #[test]
    fn malformed_icc_errors_instead_of_panicking() {
        assert!(convert_to_srgb_rgba(&red_image(), b"not an icc profile").is_err());
    }
}
