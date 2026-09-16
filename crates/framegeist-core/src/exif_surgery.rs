//! v0.6.0 M3: byte-level EXIF surgery (export EXIF passthrough).
//!
//! The whitelist rebuild in [`crate::exif`] drops every tag it does not know
//! about (MakerNote, Fujifilm recipe, vendor tags). This module edits the
//! original TIFF blob instead: the GPS IFD pointer and the camera
//! owner/serial tags are dropped and `Orientation` is normalized to 1, while
//! every other byte — out-of-line data such as MakerNotes, unknown tags and
//! the IFD1 thumbnail — is copied verbatim.
//!
//! Mechanism: the source blob is copied as-is and only the IFD tables are
//! rebuilt in an appended region. Out-of-line values keep their original
//! offsets, so MakerNotes whose internal pointers are relative to the TIFF
//! header (or to the note itself) stay valid.
//!
//! The parser is bounds-checked, endian-aware and depth limited: malformed
//! input always yields `Err`, never a panic.

use crate::exif::MetadataReport;
use crate::{Error, Result};

/// JPEG APP1 EXIF payload prefix (`splice_exif_app1` writes it back).
pub(crate) const EXIF_PREFIX: &[u8] = b"Exif\0\0";

const TAG_ORIENTATION: u16 = 0x0112;
const TAG_EXIF_IFD: u16 = 0x8769;
const TAG_GPS_IFD: u16 = 0x8825;
const TAG_INTEROP_IFD: u16 = 0xA005;
/// Camera owner + body/lens serials (PRD B3). XPTitle/XPKeywords stay.
const SENSITIVE_TAGS: [u16; 3] = [0xA430, 0xA431, 0xA435];
const MAX_IFD_DEPTH: usize = 8;
const MAX_IFD_ENTRIES: usize = 4096;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Endian {
    Little,
    Big,
}

impl Endian {
    fn from_marker(marker: &[u8]) -> Option<Endian> {
        match marker {
            b"II" => Some(Endian::Little),
            b"MM" => Some(Endian::Big),
            _ => None,
        }
    }

    fn u16_at(self, data: &[u8], off: usize) -> Option<u16> {
        let end = off.checked_add(2)?;
        let b: [u8; 2] = data.get(off..end)?.try_into().ok()?;
        Some(match self {
            Endian::Little => u16::from_le_bytes(b),
            Endian::Big => u16::from_be_bytes(b),
        })
    }

    fn u32_at(self, data: &[u8], off: usize) -> Option<u32> {
        let end = off.checked_add(4)?;
        let b: [u8; 4] = data.get(off..end)?.try_into().ok()?;
        Some(self.u32_from_bytes(b))
    }

    fn u32_from_bytes(self, b: [u8; 4]) -> u32 {
        match self {
            Endian::Little => u32::from_le_bytes(b),
            Endian::Big => u32::from_be_bytes(b),
        }
    }

    fn u16_inline(self, v: u16) -> [u8; 4] {
        let b = match self {
            Endian::Little => v.to_le_bytes(),
            Endian::Big => v.to_be_bytes(),
        };
        [b[0], b[1], 0, 0]
    }

    fn u32_bytes(self, v: u32) -> [u8; 4] {
        match self {
            Endian::Little => v.to_le_bytes(),
            Endian::Big => v.to_be_bytes(),
        }
    }

    fn put_u16(self, out: &mut [u8], off: usize, v: u16) {
        let b = match self {
            Endian::Little => v.to_le_bytes(),
            Endian::Big => v.to_be_bytes(),
        };
        if let Some(slot) = out.get_mut(off..off + 2) {
            slot.copy_from_slice(&b);
        }
    }

    fn put_u32(self, out: &mut [u8], off: usize, v: u32) {
        if let Some(slot) = out.get_mut(off..off + 4) {
            slot.copy_from_slice(&self.u32_bytes(v));
        }
    }
}

/// A raw 12-byte IFD entry (value field kept verbatim so data offsets stay
/// valid).
#[derive(Debug, Clone, Copy)]
struct Entry {
    tag: u16,
    typ: u16,
    count: u32,
    value: [u8; 4],
}

#[derive(Debug, Clone)]
struct IfdNode {
    entries: Vec<Entry>,
    /// `(entry index, child)` pointer entries that were followed and rebuilt.
    children: Vec<(usize, IfdNode)>,
    next: Option<Box<IfdNode>>,
    /// Original next-IFD offset kept when the chain could not be rebuilt.
    next_raw: u32,
}

/// Out-of-line data ranges. `wipe` holds data belonging to removed GPS/serial
/// tags (scrubbed to zero so the bytes cannot be recovered even though the
/// original blob prefix is preserved); `keep` holds every range referenced by
/// surviving tags, which must never be touched.
#[derive(Debug, Default)]
struct Scrub {
    wipe: Vec<(usize, usize)>,
    keep: Vec<(usize, usize)>,
}

fn type_size(typ: u16) -> Option<usize> {
    Some(match typ {
        1 | 2 | 6 | 7 => 1,
        3 | 8 => 2,
        4 | 9 | 11 | 13 => 4,
        5 | 10 | 12 => 8,
        _ => return None,
    })
}

/// Range of an entry's out-of-line value (`None` when stored inline, the type
/// is unknown, or the arithmetic overflows).
fn value_range(endian: Endian, typ: u16, count: u32, value: [u8; 4]) -> Option<(usize, usize)> {
    let size = type_size(typ)?.checked_mul(count as usize)?;
    if size <= 4 {
        return None;
    }
    Some((endian.u32_from_bytes(value) as usize, size))
}

/// Zero the wipe ranges, minus everything still referenced by surviving tags.
fn scrub_ranges(out: &mut [u8], scrub: &Scrub, tiff_len: usize) {
    for &(start, len) in &scrub.wipe {
        let mut segments = vec![(start, start.saturating_add(len))];
        for &(ks, kl) in &scrub.keep {
            let ke = ks.saturating_add(kl);
            let mut next = Vec::new();
            for (s, e) in segments {
                if ke <= s || ks >= e {
                    next.push((s, e));
                    continue;
                }
                if s < ks {
                    next.push((s, ks));
                }
                if e > ke {
                    next.push((ke, e));
                }
            }
            segments = next;
        }
        for (s, e) in segments {
            let s = s.max(8).min(tiff_len);
            let e = e.min(tiff_len);
            if s < e {
                out[s..e].fill(0);
            }
        }
    }
}

/// Sanitized EXIF block: same wrapper form as the input (`Exif\0\0` prefix
/// preserved when present) plus the metadata report.
#[derive(Debug, Clone)]
pub struct SanitizedExif {
    blob: Vec<u8>,
    prefix: bool,
    pub report: MetadataReport,
}

impl SanitizedExif {
    /// Modified blob, same wrapper form as the input.
    pub fn blob(&self) -> &[u8] {
        &self.blob
    }

    pub fn into_blob(self) -> Vec<u8> {
        self.blob
    }

    /// TIFF payload without the `Exif\0\0` wrapper (APP1 / eXIf splice input).
    pub fn tiff(&self) -> &[u8] {
        if self.prefix {
            self.blob.get(EXIF_PREFIX.len()..).unwrap_or_default()
        } else {
            &self.blob
        }
    }

    pub fn into_tiff(self) -> Vec<u8> {
        if self.prefix {
            self.blob[EXIF_PREFIX.len()..].to_vec()
        } else {
            self.blob
        }
    }
}

fn count_ifd_entries(data: &[u8], endian: Endian, off: u32) -> Option<usize> {
    let off = off as usize;
    let count = endian.u16_at(data, off)? as usize;
    if count > MAX_IFD_ENTRIES {
        return None;
    }
    let end = off.checked_add(2)?.checked_add(count.checked_mul(12)?)?;
    if end > data.len() {
        return None;
    }
    Some(count)
}

fn merge_report(dst: &mut MetadataReport, src: MetadataReport) {
    dst.kept += src.kept;
    dst.gps_stripped += src.gps_stripped;
    dst.serial_stripped += src.serial_stripped;
}

/// Parse one IFD, dropping GPS (unless `keep_gps`), serial/owner tags, and
/// normalizing Orientation. Unknown tags and out-of-line values are kept.
/// `chain` holds the offsets on the current ancestor path: revisiting one is
/// a cycle and fails the surgery.
#[allow(clippy::too_many_arguments)]
fn build_ifd(
    data: &[u8],
    endian: Endian,
    off: usize,
    keep_gps: bool,
    chain: &mut Vec<usize>,
    scrub: &mut Scrub,
    report: &mut MetadataReport,
) -> Result<IfdNode> {
    if chain.len() > MAX_IFD_DEPTH {
        return Err(Error::Exif("EXIF IFD nesting too deep".into()));
    }
    if chain.contains(&off) {
        return Err(Error::Exif("EXIF IFD cycle detected".into()));
    }
    let count = endian
        .u16_at(data, off)
        .ok_or_else(|| Error::Exif("EXIF IFD offset out of bounds".into()))?
        as usize;
    if count > MAX_IFD_ENTRIES {
        return Err(Error::Exif("EXIF IFD entry count out of range".into()));
    }
    let table_end = off
        .checked_add(2)
        .and_then(|v| v.checked_add(count * 12))
        .ok_or_else(|| Error::Exif("EXIF IFD offset overflow".into()))?;
    let next_raw = endian
        .u32_at(data, table_end)
        .ok_or_else(|| Error::Exif("EXIF IFD table truncated".into()))?;

    chain.push(off);
    let mut entries: Vec<Entry> = Vec::with_capacity(count);
    let mut children: Vec<(usize, IfdNode)> = Vec::new();
    for i in 0..count {
        let eoff = off + 2 + i * 12;
        let tag = endian
            .u16_at(data, eoff)
            .ok_or_else(|| Error::Exif("EXIF IFD entry truncated".into()))?;
        let typ = endian
            .u16_at(data, eoff + 2)
            .ok_or_else(|| Error::Exif("EXIF IFD entry truncated".into()))?;
        let cnt = endian
            .u32_at(data, eoff + 4)
            .ok_or_else(|| Error::Exif("EXIF IFD entry truncated".into()))?;
        let value: [u8; 4] = data
            .get(eoff + 8..eoff + 12)
            .and_then(|s| s.try_into().ok())
            .ok_or_else(|| Error::Exif("EXIF IFD entry truncated".into()))?;

        if SENSITIVE_TAGS.contains(&tag) {
            report.serial_stripped += 1;
            if let Some(range) = value_range(endian, typ, cnt, value) {
                scrub.wipe.push(range);
            }
            continue;
        }
        if tag == TAG_GPS_IFD && !keep_gps {
            match count_ifd_entries(data, endian, endian.u32_from_bytes(value)) {
                Some(gps_count) => {
                    report.gps_stripped += gps_count;
                    let gps_off = endian.u32_from_bytes(value) as usize;
                    scrub.wipe.push((gps_off, 2 + gps_count * 12 + 4));
                    // First-level out-of-line GPS values (rationals, strings).
                    for i in 0..gps_count {
                        let geoff = gps_off + 2 + i * 12;
                        let (Some(gtyp), Some(gcnt), Some(gval)) = (
                            endian.u16_at(data, geoff + 2),
                            endian.u32_at(data, geoff + 4),
                            data.get(geoff + 8..geoff + 12)
                                .and_then(|s| s.try_into().ok()),
                        ) else {
                            break;
                        };
                        if let Some(range) = value_range(endian, gtyp, gcnt, gval) {
                            scrub.wipe.push(range);
                        }
                    }
                }
                None => report.gps_stripped += 1,
            }
            continue;
        }
        if tag == TAG_ORIENTATION {
            entries.push(Entry {
                tag,
                typ: 3,
                count: 1,
                value: endian.u16_inline(1),
            });
            continue;
        }

        let idx = entries.len();
        entries.push(Entry {
            tag,
            typ,
            count: cnt,
            value,
        });
        if let Some(range) = value_range(endian, typ, cnt, value) {
            scrub.keep.push(range);
        }
        let pointer = endian.u32_from_bytes(value);
        if pointer != 0
            && typ == 4
            && cnt == 1
            && matches!(tag, TAG_EXIF_IFD | TAG_GPS_IFD | TAG_INTEROP_IFD)
        {
            let mut child_report = MetadataReport {
                keep_gps,
                ..MetadataReport::default()
            };
            if let Ok(child) = build_ifd(
                data,
                endian,
                pointer as usize,
                keep_gps,
                chain,
                scrub,
                &mut child_report,
            ) {
                merge_report(report, child_report);
                children.push((idx, child));
            }
        }
    }

    // A malformed/cyclic next-IFD chain fails the whole surgery: keeping the
    // raw pointer for an unparseable thumbnail IFD could produce loops.
    let next = if next_raw != 0 {
        let mut next_report = MetadataReport {
            keep_gps,
            ..MetadataReport::default()
        };
        match build_ifd(
            data,
            endian,
            next_raw as usize,
            keep_gps,
            chain,
            scrub,
            &mut next_report,
        ) {
            Ok(node) => {
                merge_report(report, next_report);
                Some(Box::new(node))
            }
            Err(e) => {
                chain.pop();
                return Err(e);
            }
        }
    } else {
        None
    };
    chain.pop();

    // IFD1 thumbnail: the data blob is referenced by the 0x0201/0x0202 pair,
    // not by an entry value, so protect it explicitly.
    let thumb = (
        entries
            .iter()
            .find(|e| e.tag == 0x0201 && e.typ == 4 && e.count == 1),
        entries
            .iter()
            .find(|e| e.tag == 0x0202 && e.typ == 4 && e.count == 1),
    );
    if let (Some(offset_entry), Some(length_entry)) = thumb {
        let thumb_off = endian.u32_from_bytes(offset_entry.value) as usize;
        let thumb_len = endian.u32_from_bytes(length_entry.value) as usize;
        if thumb_len > 0 {
            scrub.keep.push((thumb_off, thumb_len));
        }
    }

    report.kept += entries.len();
    Ok(IfdNode {
        entries,
        children,
        next,
        next_raw,
    })
}

fn ifd_len(node: &IfdNode) -> usize {
    let own = 2 + node.entries.len() * 12 + 4;
    let kids: usize = node.children.iter().map(|(_, c)| ifd_len(c)).sum();
    let next = node.next.as_deref().map(ifd_len).unwrap_or(0);
    own + kids + next
}

/// Append the rebuilt IFD (and its subtree) at `offset`; returns the end
/// offset. The parent table is written after the children so pointer entries
/// can be patched to their new locations.
fn write_ifd(node: &IfdNode, out: &mut Vec<u8>, offset: usize, endian: Endian) -> usize {
    let table_len = 2 + node.entries.len() * 12 + 4;
    let mut cursor = offset + table_len;
    let mut child_offsets = Vec::with_capacity(node.children.len());
    for (_, child) in &node.children {
        child_offsets.push(cursor);
        cursor = write_ifd(child, out, cursor, endian);
    }
    let next_offset = match &node.next {
        Some(next) => {
            let start = cursor;
            cursor = write_ifd(next, out, start, endian);
            start as u32
        }
        None => node.next_raw,
    };
    if out.len() < offset + table_len {
        out.resize(offset + table_len, 0);
    }
    endian.put_u16(out, offset, node.entries.len() as u16);
    for (i, entry) in node.entries.iter().enumerate() {
        let eoff = offset + 2 + i * 12;
        endian.put_u16(out, eoff, entry.tag);
        endian.put_u16(out, eoff + 2, entry.typ);
        endian.put_u32(out, eoff + 4, entry.count);
        let value = node
            .children
            .iter()
            .position(|(idx, _)| *idx == i)
            .map(|pos| endian.u32_bytes(child_offsets[pos] as u32))
            .unwrap_or(entry.value);
        if let Some(slot) = out.get_mut(eoff + 8..eoff + 12) {
            slot.copy_from_slice(&value);
        }
    }
    endian.put_u32(out, offset + 2 + node.entries.len() * 12, next_offset);
    cursor
}

/// Byte-level EXIF sanitation. `raw` may or may not carry the `Exif\0\0`
/// wrapper; the returned blob keeps the same form. Returns `Err` when the
/// TIFF structure is malformed (callers fall back to the whitelist rebuild).
pub fn sanitize_exif_block(raw: &[u8], keep_gps: bool) -> Result<SanitizedExif> {
    let (prefix, tiff) = match raw.strip_prefix(EXIF_PREFIX) {
        Some(rest) => (true, rest),
        None => (false, raw),
    };
    let endian = tiff
        .get(0..2)
        .and_then(Endian::from_marker)
        .ok_or_else(|| Error::Exif("EXIF block: bad TIFF byte order".into()))?;
    if endian.u16_at(tiff, 2) != Some(42) {
        return Err(Error::Exif("EXIF block: bad TIFF magic".into()));
    }
    let ifd0 = endian
        .u32_at(tiff, 4)
        .ok_or_else(|| Error::Exif("EXIF block: truncated TIFF header".into()))?
        as usize;

    let mut report = MetadataReport {
        keep_gps,
        passthrough: true,
        ..MetadataReport::default()
    };
    let mut chain = Vec::new();
    let mut scrub = Scrub::default();
    let node = build_ifd(
        tiff,
        endian,
        ifd0,
        keep_gps,
        &mut chain,
        &mut scrub,
        &mut report,
    )?;

    let base = tiff.len() + (tiff.len() & 1);
    let total = base
        .checked_add(ifd_len(&node))
        .ok_or_else(|| Error::Exif("EXIF block too large".into()))?;
    if total as u64 > u32::MAX as u64 {
        return Err(Error::Exif("EXIF block exceeds TIFF offset range".into()));
    }
    let mut out = Vec::with_capacity(total);
    out.extend_from_slice(tiff);
    out.resize(base, 0);
    scrub_ranges(&mut out[..tiff.len()], &scrub, tiff.len());
    write_ifd(&node, &mut out, base, endian);
    endian.put_u32(&mut out, 4, base as u32);

    let blob = if prefix {
        let mut blob = Vec::with_capacity(EXIF_PREFIX.len() + out.len());
        blob.extend_from_slice(EXIF_PREFIX);
        blob.extend_from_slice(&out);
        blob
    } else {
        out
    };
    Ok(SanitizedExif {
        blob,
        prefix,
        report,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn be(endian: Endian, v: u16) -> Vec<u8> {
        match endian {
            Endian::Little => v.to_le_bytes().to_vec(),
            Endian::Big => v.to_be_bytes().to_vec(),
        }
    }

    fn be32(endian: Endian, v: u32) -> Vec<u8> {
        match endian {
            Endian::Little => v.to_le_bytes().to_vec(),
            Endian::Big => v.to_be_bytes().to_vec(),
        }
    }

    fn entry(endian: Endian, tag: u16, typ: u16, count: u32, value: &[u8]) -> Vec<u8> {
        let mut out = Vec::new();
        out.extend(be(endian, tag));
        out.extend(be(endian, typ));
        out.extend(be32(endian, count));
        let mut v = value.to_vec();
        v.resize(4, 0);
        out.extend(&v[..4]);
        out
    }

    /// Minimal hand-built TIFF: IFD0(Make, Orientation, custom, ExifIFD, GPS)
    /// -> ExifIFD(serial, MakerNote) / GPS(version) / IFD1(thumbnail).
    fn build_fixture(endian: Endian) -> (Vec<u8>, Vec<u8>) {
        let makernote = b"FUJIFILM-fake-recipe-note".to_vec();
        let thumbnail = vec![0xAA, 0xBB, 0xCC, 0xDD, 0xEE];
        let make = b"FUJIFILM\0".to_vec();
        let serial = b"SN-12345678\0".to_vec();

        let ifd0_off = 8u32;
        let ifd0_len = 2 + 5 * 12 + 4; // Make, Orientation, custom, ExifIFD, GPS
        let exif_off = ifd0_off + ifd0_len;
        let exif_len = 2 + 2 * 12 + 4; // serial, MakerNote
        let gps_off = exif_off + exif_len;
        let gps_len = 2 + 12 + 4; // GPSVersionID
        let ifd1_off = gps_off + gps_len;
        let ifd1_len = 2 + 2 * 12 + 4; // ThumbnailOffset, ThumbnailLength
        let data_off = ifd1_off + ifd1_len;

        let make_off = data_off;
        let serial_off = make_off + make.len() as u32;
        let mn_off = serial_off + serial.len() as u32;
        let thumb_off = mn_off + makernote.len() as u32;

        let mut out = Vec::new();
        out.extend(match endian {
            Endian::Little => b"II",
            Endian::Big => b"MM",
        });
        out.extend(be(endian, 42));
        out.extend(be32(endian, ifd0_off));

        out.extend(be(endian, 5));
        out.extend(entry(
            endian,
            0x010F,
            2,
            make.len() as u32,
            &be32(endian, make_off),
        ));
        out.extend(entry(endian, 0x0112, 3, 1, &be(endian, 6)));
        out.extend(entry(endian, 0xC7A1, 4, 1, &be32(endian, 0xDEAD_BEEF)));
        out.extend(entry(endian, 0x8769, 4, 1, &be32(endian, exif_off)));
        out.extend(entry(endian, 0x8825, 4, 1, &be32(endian, gps_off)));
        out.extend(be32(endian, ifd1_off));

        out.extend(be(endian, 2));
        out.extend(entry(
            endian,
            0xA431,
            2,
            serial.len() as u32,
            &be32(endian, serial_off),
        ));
        out.extend(entry(
            endian,
            0x927C,
            7,
            makernote.len() as u32,
            &be32(endian, mn_off),
        ));
        out.extend(be32(endian, 0));

        out.extend(be(endian, 1));
        out.extend(entry(endian, 0x0000, 1, 4, &[2, 3, 0, 0]));
        out.extend(be32(endian, 0));

        out.extend(be(endian, 2));
        out.extend(entry(endian, 0x0201, 4, 1, &be32(endian, thumb_off)));
        out.extend(entry(
            endian,
            0x0202,
            4,
            1,
            &be32(endian, thumbnail.len() as u32),
        ));
        out.extend(be32(endian, 0));

        out.extend(make);
        out.extend(serial);
        out.extend(&makernote);
        out.extend(&thumbnail);
        (out, makernote)
    }

    fn field_numbers(tiff: &[u8]) -> Vec<u16> {
        let reader = exif::Reader::new();
        match reader.read_raw(tiff.to_vec()) {
            Ok(container) => container.fields().map(|f| f.tag.number()).collect(),
            Err(_) => Vec::new(),
        }
    }

    #[test]
    fn strips_gps_serials_and_normalizes_orientation() {
        for endian in [Endian::Little, Endian::Big] {
            let (fixture, _) = build_fixture(endian);
            let out = sanitize_exif_block(&fixture, false).expect("surgery");
            assert!(out.report.passthrough);
            assert_eq!(out.report.serial_stripped, 1);
            assert_eq!(out.report.gps_stripped, 1);
            let numbers = field_numbers(out.tiff());
            assert!(numbers.contains(&0x010F), "Make kept");
            assert!(numbers.contains(&0xC7A1), "unknown tag kept");
            assert!(numbers.contains(&0x927C), "MakerNote kept");
            assert!(!numbers.contains(&0x8825), "GPS pointer removed");
            assert!(!numbers.contains(&0xA431), "serial removed");
            assert!(!numbers.iter().any(|n| *n <= 0x001F), "no GPS entry");
            let container = exif::Reader::new()
                .read_raw(out.tiff().to_vec())
                .expect("parse");
            let orientation = container.get_field(exif::Tag::Orientation, exif::In::PRIMARY);
            match orientation.map(|f| &f.value) {
                Some(exif::Value::Short(v)) => assert_eq!(v.first(), Some(&1)),
                other => panic!("unexpected orientation {other:?}"),
            }
        }
    }

    #[test]
    fn makernote_and_thumbnail_bytes_stay_verbatim() {
        let (fixture, makernote) = build_fixture(Endian::Little);
        let out = sanitize_exif_block(&fixture, false).expect("surgery");
        let blob = out.blob();
        assert!(
            blob.windows(makernote.len()).any(|w| w == makernote),
            "MakerNote bytes must be preserved"
        );
        assert!(
            blob.windows(5).any(|w| w == [0xAA, 0xBB, 0xCC, 0xDD, 0xEE]),
            "IFD1 thumbnail bytes must be preserved"
        );
    }

    #[test]
    fn keep_gps_retains_gps_ifd() {
        let (fixture, _) = build_fixture(Endian::Little);
        let out = sanitize_exif_block(&fixture, true).expect("surgery");
        assert_eq!(out.report.gps_stripped, 0);
        assert_eq!(out.report.serial_stripped, 1);
        let numbers = field_numbers(out.tiff());
        // GPSVersionID (0x0000, GPS context) is only reachable when the GPS
        // IFD pointer is kept; kamadak hides the pointer tag itself.
        assert!(numbers.contains(&0x0000), "GPS entry kept");
        assert!(!numbers.contains(&0xA431), "serial still removed");
    }

    #[test]
    fn wrapper_prefix_is_preserved() {
        let (fixture, _) = build_fixture(Endian::Little);
        let mut wrapped = b"Exif\0\0".to_vec();
        wrapped.extend_from_slice(&fixture);
        let out = sanitize_exif_block(&wrapped, false).expect("surgery");
        assert!(out.blob().starts_with(b"Exif\0\0"));
        assert_eq!(out.tiff(), &out.blob()[6..]);
        assert!(!out.tiff().is_empty());
    }

    #[test]
    fn malformed_inputs_error_without_panicking() {
        let (fixture, _) = build_fixture(Endian::Little);
        assert!(sanitize_exif_block(&[], false).is_err());
        assert!(sanitize_exif_block(b"XX", false).is_err());
        assert!(sanitize_exif_block(b"II*\0", false).is_err());
        // IFD0 pointer beyond the blob.
        let mut bad = fixture.clone();
        bad[4..8].copy_from_slice(&u32::MAX.to_le_bytes());
        assert!(sanitize_exif_block(&bad, false).is_err());
        // Absurd entry count.
        let mut bad = fixture.clone();
        bad[8..10].copy_from_slice(&u16::MAX.to_le_bytes());
        assert!(sanitize_exif_block(&bad, false).is_err());
        // Truncations of a valid blob at every length must not panic.
        for len in 0..fixture.len() {
            let _ = sanitize_exif_block(&fixture[..len], false);
        }
    }

    #[test]
    fn cyclic_next_ifd_hits_depth_limit() {
        let ifd0_off = 8u32;
        let mut tiff = Vec::new();
        tiff.extend(b"II");
        tiff.extend(42u16.to_le_bytes());
        tiff.extend(ifd0_off.to_le_bytes());
        tiff.extend(0u16.to_le_bytes()); // 0 entries
        tiff.extend(ifd0_off.to_le_bytes()); // next -> itself
        assert!(sanitize_exif_block(&tiff, false).is_err());
    }
}
