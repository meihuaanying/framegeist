//! Camera/lens brand slug resolution (PRD B5-adjacent, v0.2.0 T-B).
//! Maps EXIF Make/Model and LensModel strings to Simple Icons slugs so
//! templates can reference `@builtin/brand/{exif.brand_slug}`.

/// Ordered (needle, slug) pairs; needle is matched case-insensitively as a
/// substring of Make first, then of Model.
const MAKE_MAP: &[(&str, &str)] = &[
    ("sony", "sony"),
    ("nikon", "nikon"),
    ("canon", "canon"),
    ("fuji", "fujifilm"),
    ("leica", "leica"),
    ("hasselblad", "hasselblad"),
    ("lumix", "panasonic"),
    ("panasonic", "panasonic"),
    ("ricoh", "ricoh"),
    ("sigma", "sigma"),
    ("zeiss", "zeiss"),
    ("dji", "dji"),
    ("xiaomi", "xiaomi"),
    ("apple", "apple"),
    ("olympus", "olympus"),
    ("om digital", "olympus"),
    ("om system", "olympus"),
    ("pentax", "pentax"),
    ("epson", "epson"),
    ("insta360", "insta360"),
    ("tamron", "tamron"),
];

/// Ordered (needle, slug) pairs matched case-insensitively as a prefix or
/// substring of the lens model.
const LENS_MAP: &[(&str, &str)] = &[
    ("fe ", "sony"),
    ("e pz", "sony"),
    (" gm", "sony"),
    ("g master", "sony"),
    ("nikkor", "nikon"),
    ("nikon", "nikon"),
    ("rf", "canon"),
    ("ef", "canon"),
    ("xf", "fujifilm"),
    ("xc", "fujifilm"),
    ("fujinon", "fujifilm"),
    ("dg dn", "sigma"),
    ("summilux", "leica"),
    ("summicron", "leica"),
    ("noctilux", "leica"),
    ("elmar", "leica"),
    ("lumix", "panasonic"),
    ("batis", "zeiss"),
    ("touit", "zeiss"),
    ("zeiss", "zeiss"),
    ("zuiko", "olympus"),
    ("tamron", "tamron"),
    ("hasselblad", "hasselblad"),
];

fn lookup(haystack: &str, table: &[(&str, &str)]) -> Option<String> {
    let lower = haystack.to_ascii_lowercase();
    table
        .iter()
        .find(|(needle, _)| lower.contains(needle))
        .map(|(_, slug)| (*slug).to_string())
}

/// Resolve the camera brand slug from Make (preferred) then Model.
pub fn brand_slug(make: Option<&str>, model: Option<&str>) -> Option<String> {
    make.and_then(|m| lookup(m, MAKE_MAP))
        .or_else(|| model.and_then(|m| lookup(m, MAKE_MAP)))
}

/// Resolve the lens brand slug from the lens model string.
pub fn lens_slug(lens: Option<&str>) -> Option<String> {
    lens.and_then(|l| lookup(l, LENS_MAP))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn brands_resolve() {
        assert_eq!(brand_slug(Some("SONY"), Some("ILCE-7CM2")).as_deref(), Some("sony"));
        assert_eq!(brand_slug(Some("NIKON CORPORATION"), None).as_deref(), Some("nikon"));
        assert_eq!(brand_slug(None, Some("Canon EOS R6")).as_deref(), Some("canon"));
        assert_eq!(brand_slug(Some("FUJIFILM"), None).as_deref(), Some("fujifilm"));
        assert_eq!(brand_slug(Some("LEICA CAMERA AG"), None).as_deref(), Some("leica"));
        assert_eq!(brand_slug(Some("Unknown"), Some("X100")).as_deref(), None);
    }

    #[test]
    fn lenses_resolve() {
        assert_eq!(lens_slug(Some("FE 35mm F1.4 GM")).as_deref(), Some("sony"));
        assert_eq!(lens_slug(Some("XF23mmF1.4 R LM WR")).as_deref(), Some("fujifilm"));
        assert_eq!(lens_slug(Some("RF24-70mm F2.8 L IS USM")).as_deref(), Some("canon"));
        assert_eq!(lens_slug(Some("NIKKOR Z 24-70mm f/2.8 S")).as_deref(), Some("nikon"));
        assert_eq!(lens_slug(Some("DG DN 35mm F1.4")).as_deref(), Some("sigma"));
        assert_eq!(lens_slug(Some("Noctilux-M 50mm")).as_deref(), Some("leica"));
    }
}
