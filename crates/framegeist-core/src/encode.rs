use image::{DynamicImage, ImageFormat, RgbaImage};
use std::io::Cursor;

use crate::{Error, Result};

/// Encode RGBA pixels as JPEG with quality 100 and 4:4:4 chroma (PRD B1).
pub fn encode_jpeg_quality100(img: &RgbaImage) -> Result<Vec<u8>> {
    let rgb = DynamicImage::ImageRgba8(img.clone()).to_rgb8();
    let (w, h) = (rgb.width(), rgb.height());
    if w > u16::MAX as u32 || h > u16::MAX as u32 {
        return Err(Error::Encode(format!(
            "image dimension {w}x{h} exceeds JPEG 65535px edge limit"
        )));
    }
    let mut out = Vec::new();
    let mut encoder = jpeg_encoder::Encoder::new(&mut out, 100);
    encoder.set_sampling_factor(jpeg_encoder::SamplingFactor::R_4_4_4);
    encoder
        .encode(rgb.as_raw(), w as u16, h as u16, jpeg_encoder::ColorType::Rgb)
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

fn crc32(data: &[&[u8]]) -> u32 {
    let mut crc: u32 = 0xFFFF_FFFF;
    for part in data {
        for &byte in *part {
            crc ^= byte as u32;
            for _ in 0..8 {
                let mask = (crc & 1).wrapping_neg();
                crc = (crc >> 1) ^ (0xEDB8_8320 & mask);
            }
        }
    }
    !crc
}

/// Insert an EXIF TIFF blob as a `eXIf` chunk right after IHDR (PRD B2).
pub fn splice_png_exif(png: &mut Vec<u8>, exif_tiff: &[u8]) -> Result<()> {
    const PNG_SIG: [u8; 8] = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
    if png.len() < 8 + 25 || png[0..8] != PNG_SIG {
        return Err(Error::Encode("not a PNG stream".into()));
    }
    // eXIf is allowed anywhere after IHDR; place it right after the first chunk.
    let ihdr_len =
        u32::from_be_bytes([png[8], png[9], png[10], png[11]]) as usize;
    let insert_at = 8 + 12 + ihdr_len;
    if insert_at > png.len() {
        return Err(Error::Encode("PNG stream truncated (bad IHDR)".into()));
    }
    let mut chunk = Vec::with_capacity(12 + exif_tiff.len());
    chunk.extend_from_slice(&(exif_tiff.len() as u32).to_be_bytes());
    chunk.extend_from_slice(b"eXIf");
    chunk.extend_from_slice(exif_tiff);
    chunk.extend_from_slice(&crc32(&[b"eXIf", exif_tiff]).to_be_bytes());
    png.splice(insert_at..insert_at, chunk);
    Ok(())
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
