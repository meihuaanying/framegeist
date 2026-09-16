//! v0.6.0 photo metadata tooling: container-level EXIF/ICC operations that keep
//! the JPEG pixel stream untouched, plus sample-photo preparation helpers used
//! by the showcase-EXIF pipeline.

use img_parts::jpeg::Jpeg;
use img_parts::{Bytes, ImageEXIF, ImageICC};

use crate::{Error, Result};

fn parse_jpeg(data: &[u8], what: &str) -> Result<Jpeg> {
    Jpeg::from_bytes(Bytes::copy_from_slice(data)).map_err(|e| Error::Image(format!("{what}: {e}")))
}

/// Raw EXIF block of a JPEG container (`None` when absent).
pub fn jpeg_exif(data: &[u8]) -> Result<Option<Vec<u8>>> {
    Ok(parse_jpeg(data, "exif source")?.exif().map(|b| b.to_vec()))
}

/// Raw ICC profile of a JPEG container (`None` when absent).
pub fn jpeg_icc(data: &[u8]) -> Result<Option<Vec<u8>>> {
    Ok(parse_jpeg(data, "icc source")?
        .icc_profile()
        .map(|b| b.to_vec()))
}

/// v0.6.0: raw ICC profile for any container img-parts understands
/// (JPEG / PNG / WebP); `None` when the file carries no profile.
pub fn raw_icc(data: &[u8]) -> Option<Vec<u8>> {
    img_parts::DynImage::from_bytes(Bytes::copy_from_slice(data))
        .ok()??
        .icc_profile()
        .map(|b| b.to_vec())
}

/// Copy the EXIF block from `source` onto `target` without re-encoding pixels.
pub fn inject_exif(target: &[u8], source: &[u8]) -> Result<Vec<u8>> {
    let src = parse_jpeg(source, "exif source")?;
    let exif = src
        .exif()
        .ok_or_else(|| Error::Exif("source has no EXIF block".into()))?;
    let mut dst = parse_jpeg(target, "target image")?;
    dst.set_exif(Some(exif));
    let mut out = Vec::new();
    dst.encoder()
        .write_to(&mut out)
        .map_err(|e| Error::Encode(e.to_string()))?;
    Ok(out)
}

/// Resize a photo to `max_edge` on the long edge (never upscales) at JPEG
/// `quality`, carrying EXIF and ICC bytes over from the original container.
pub fn shrink_jpeg(photo: &[u8], max_edge: u32, quality: u8) -> Result<Vec<u8>> {
    if max_edge == 0 {
        return Err(Error::Encode("max_edge must be > 0".into()));
    }
    let img = image::load_from_memory(photo).map_err(|e| Error::Image(e.to_string()))?;
    let (w, h) = (img.width(), img.height());
    let scaled = if w.max(h) > max_edge {
        let scale = max_edge as f64 / w.max(h) as f64;
        let nw = ((w as f64) * scale).round().max(1.0) as u32;
        let nh = ((h as f64) * scale).round().max(1.0) as u32;
        img.resize_exact(nw, nh, image::imageops::FilterType::Lanczos3)
    } else {
        img
    };
    let rgb = scaled.to_rgb8();
    if rgb.width() > u16::MAX as u32 || rgb.height() > u16::MAX as u32 {
        return Err(Error::Encode(format!(
            "image dimension {}x{} exceeds JPEG 65535px edge limit",
            rgb.width(),
            rgb.height()
        )));
    }
    let mut out = Vec::new();
    let encoder = jpeg_encoder::Encoder::new(&mut out, quality);
    encoder
        .encode(
            rgb.as_raw(),
            rgb.width() as u16,
            rgb.height() as u16,
            jpeg_encoder::ColorType::Rgb,
        )
        .map_err(|e| Error::Encode(e.to_string()))?;
    if let Ok(src) = Jpeg::from_bytes(Bytes::copy_from_slice(photo)) {
        let mut dst = parse_jpeg(&out, "shrunken image")?;
        if let Some(exif) = src.exif() {
            dst.set_exif(Some(exif));
        }
        if let Some(icc) = src.icc_profile() {
            dst.set_icc_profile(Some(icc));
        }
        out.clear();
        dst.encoder()
            .write_to(&mut out)
            .map_err(|e| Error::Encode(e.to_string()))?;
    }
    Ok(out)
}
