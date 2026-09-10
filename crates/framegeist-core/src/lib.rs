//! FrameGeist rendering engine.
//!
//! Public API (PRD A2): `load_template`, `probe_exif`, `render`.
//! GUI clients must not implement any drawing logic themselves.

pub mod collage;
pub mod encode;
pub mod exif;
pub mod layout;
pub mod model_map;
pub mod render;
pub mod sandbox;
pub mod template;
pub mod text;

pub use encode::{encode_jpeg_quality100, encode_png, splice_exif_app1, splice_png_exif};
pub use exif::{cleaned_exif_tiff, metadata_report, probe_exif, ExifInfo, MetadataReport};
pub use layout::{load_layout, Layout};
pub use model_map::ModelMap;
pub use render::{
    load_model_map, render, render_from_rgba, render_rgba, render_rgba_with_image,
    render_with_report, OutputFormat, RenderOptions, Sampling,
};
pub use template::{
    load_template, load_template_from_str, Category, License, Template, TemplateOverrides,
};

pub fn render_collage(
    photos: &[&[u8]],
    layout: &Layout,
    opts: &RenderOptions,
) -> Result<Vec<u8>> {
    collage::render_collage(photos, layout, opts)
}

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("invalid template JSON: {0}")]
    TemplateJson(String),
    #[error("template schema violation: {0}")]
    SchemaViolation(String),
    #[error("template sandbox violation: {0}")]
    SandboxViolation(String),
    #[error("template JSON too large: {size} bytes (max {max})")]
    TemplateTooLarge { size: usize, max: usize },
    #[error("image error: {0}")]
    Image(String),
    #[error("unsupported image format: {0}")]
    UnsupportedFormat(String),
    #[error("exif error: {0}")]
    Exif(String),
    #[error("font error: {0}")]
    Font(String),
    #[error("encode error: {0}")]
    Encode(String),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
}

impl From<image::ImageError> for Error {
    fn from(e: image::ImageError) -> Self {
        match e {
            image::ImageError::Unsupported(_) => Error::UnsupportedFormat(e.to_string()),
            other => Error::Image(other.to_string()),
        }
    }
}

impl From<serde_json::Error> for Error {
    fn from(e: serde_json::Error) -> Self {
        Error::TemplateJson(e.to_string())
    }
}
