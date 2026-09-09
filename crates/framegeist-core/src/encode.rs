use image::{DynamicImage, ImageFormat, RgbaImage};
use std::io::Cursor;

use crate::{Error, Result};

/// Encode RGBA pixels as JPEG with quality 100 and 4:4:4 chroma (PRD B1).
pub fn encode_jpeg_quality100(img: &RgbaImage) -> Result<Vec<u8>> {
    let rgb = DynamicImage::ImageRgba8(img.clone()).to_rgb8();
    let mut out = Vec::new();
    let mut encoder = jpeg_encoder::Encoder::new(&mut out, 100);
    encoder.set_sampling_factor(jpeg_encoder::SamplingFactor::R_4_4_4);
    encoder
        .encode(
            rgb.as_raw(),
            rgb.width().min(u16::MAX as u32) as u16,
            rgb.height().min(u16::MAX as u32) as u16,
            jpeg_encoder::ColorType::Rgb,
        )
        .map_err(|e| Error::Encode(e.to_string()))?;
    Ok(out)
}

/// Encode RGBA pixels as lossless PNG (PRD B1).
pub fn encode_png(img: &RgbaImage) -> Result<Vec<u8>> {
    let mut out = Vec::new();
    DynamicImage::ImageRgba8(img.clone())
        .write_to(&mut Cursor::new(&mut out), ImageFormat::Png)
        .map_err(Error::from)?;
    Ok(out)
}

/// Insert an EXIF TIFF blob as an APP1 segment right after SOI (PRD B2).
pub fn splice_exif_app1(jpeg: &mut Vec<u8>, exif_tiff: &[u8]) -> Result<()> {
    if jpeg.len() < 2 || jpeg[0] != 0xFF || jpeg[1] != 0xD8 {
        return Err(Error::Encode("not a JPEG stream (missing SOI)".into()));
    }
    let mut payload = Vec::with_capacity(6 + exif_tiff.len());
    payload.extend_from_slice(b"Exif\0\0");
    payload.extend_from_slice(exif_tiff);
    let segment_len = payload.len() + 2;
    if segment_len > u16::MAX as usize || segment_len > 65533 {
        return Err(Error::Encode(format!(
            "EXIF APP1 too large: {segment_len} bytes"
        )));
    }
    let mut out = Vec::with_capacity(jpeg.len() + payload.len() + 4);
    out.extend_from_slice(&jpeg[0..2]);
    out.push(0xFF);
    out.push(0xE1);
    out.extend_from_slice(&(segment_len as u16).to_be_bytes());
    out.extend_from_slice(&payload);
    out.extend_from_slice(&jpeg[2..]);
    *jpeg = out;
    Ok(())
}
