//! WASM bindings for the FrameGeist engine (PRD G1/G2).
//!
//! All processing happens in the browser; no bytes ever leave the page.
//! Photos are passed in as `Uint8Array`, results come back as `Uint8Array`.

use js_sys::Uint8Array;
use wasm_bindgen::prelude::*;

use framegeist_core as core;

/// Engine instance holding registered fonts (loaded once, reused per render).
#[wasm_bindgen]
pub struct Engine {
    fonts: core::text::FontBook,
    model_map: Option<core::ModelMap>,
}

#[wasm_bindgen]
impl Engine {
    /// Create an engine and register fonts by (family, bytes) pairs.
    /// Family names follow the same normalization as the filesystem loader
    /// (`JetBrains Mono` -> `jetbrainsmono`).
    #[wasm_bindgen(constructor)]
    pub fn new(font_names: Vec<JsValue>, font_bytes: Vec<JsValue>) -> Result<Engine, JsError> {
        let mut entries = Vec::new();
        let names_iter = font_names.into_iter();
        let bytes_iter = font_bytes.into_iter();
        for (name, bytes) in names_iter.zip(bytes_iter) {
            let name = name
                .as_string()
                .ok_or_else(|| JsError::new("font name must be a string"))?;
            let bytes: Uint8Array = Uint8Array::from(bytes);
            entries.push((name, bytes.to_vec()));
        }
        let fonts = core::text::FontBook::from_bytes(entries)
            .map_err(|e| JsError::new(&e.to_string()))?;
        Ok(Engine {
            fonts,
            model_map: None,
        })
    }

    /// Validate a template JSON document. Returns field-level error text on
    /// rejection (PRD C2).
    pub fn validate_template(&self, json: &str) -> Result<(), JsError> {
        core::load_template_from_str(json)
            .map(|_| ())
            .map_err(|e| JsError::new(&e.to_string()))
    }

    /// Register an optional model-map override (PRD B5), JSON object of
    /// raw model code -> vendor-official name.
    pub fn load_model_map(&mut self, json: &[u8]) -> Result<(), JsError> {
        self.model_map = Some(
            core::ModelMap::from_json(json).map_err(|e| JsError::new(&e.to_string()))?,
        );
        Ok(())
    }

    /// Read EXIF from photo bytes and return it as a JSON string.
    pub fn probe_exif(&self, photo: &[u8]) -> Result<String, JsError> {
        let info = core::probe_exif(photo).map_err(|e| JsError::new(&e.to_string()))?;
        serde_json::to_string(&info).map_err(|e| JsError::new(&e.to_string()))
    }

    /// Render a photo against a template.
    /// `format`: "jpeg" | "png"; `preview`: true for fast low-quality sampling.
    pub fn render(
        &self,
        photo: &[u8],
        template_json: &str,
        format: &str,
        preview: bool,
    ) -> Result<Uint8Array, JsError> {
        self.render_impl(photo, None, 0, 0, template_json, format, preview, "")
    }

    /// Render with user overrides (T4.4): `overrides_json` of
    /// `{fontSizeScale, paddingScale, textColor}` (empty string = none).
    pub fn render_with_overrides(
        &self,
        photo: &[u8],
        template_json: &str,
        format: &str,
        preview: bool,
        overrides_json: &str,
    ) -> Result<Uint8Array, JsError> {
        self.render_impl(photo, None, 0, 0, template_json, format, preview, overrides_json)
    }

    /// Raw-RGBA fast preview: caller (browser) pre-decoded and downscaled the
    /// photo; `exif_bytes` may be empty (then no EXIF text/write-back).
    #[allow(clippy::too_many_arguments)]
    pub fn render_raw(
        &self,
        rgba: &[u8],
        width: u32,
        height: u32,
        exif_bytes: &[u8],
        template_json: &str,
        format: &str,
        overrides_json: &str,
    ) -> Result<Uint8Array, JsError> {
        self.render_impl(exif_bytes, Some(rgba), width, height, template_json, format, false, overrides_json)
    }

    #[allow(clippy::too_many_arguments)]
    fn render_impl(
        &self,
        photo: &[u8],
        rgba: Option<&[u8]>,
        width: u32,
        height: u32,
        template_json: &str,
        format: &str,
        preview: bool,
        overrides_json: &str,
    ) -> Result<Uint8Array, JsError> {
        let template = core::load_template_from_str(template_json)
            .map_err(|e| JsError::new(&e.to_string()))?;
        let fmt = match format {
            "jpeg" | "jpg" => core::OutputFormat::Jpeg,
            "png" => core::OutputFormat::Png,
            other => return Err(JsError::new(&format!("unsupported format {other:?}"))),
        };
        let overrides = if overrides_json.trim().is_empty() {
            None
        } else {
            Some(
                core::TemplateOverrides::from_json(overrides_json)
                    .map_err(|e| JsError::new(&e.to_string()))?,
            )
        };
        let opts = core::RenderOptions {
            format: fmt,
            sampling: if preview {
                core::Sampling::Preview
            } else {
                core::Sampling::Full
            },
            max_edge: if preview { Some(1600) } else { None },
            fonts: Some(self.fonts.clone()),
            model_map: self.model_map.clone(),
            overrides,
            ..core::RenderOptions::default()
        };
        let (out, _report) = match rgba {
            Some(buf) => core::render_from_rgba(
                if photo.is_empty() { None } else { Some(photo) },
                buf,
                width,
                height,
                &template,
                &opts,
            ),
            None => core::render_with_report(photo, &template, &opts),
        }
        .map_err(|e| JsError::new(&e.to_string()))?;
        Ok(Uint8Array::from(out.as_slice()))
    }

    /// Render a collage: `photos` is a JS Array of Uint8Array, filled into
    /// the layout's cells in order (PRD C5/G2).
    pub fn render_collage(
        &self,
        photos: js_sys::Array,
        layout_json: &str,
        format: &str,
        preview: bool,
    ) -> Result<Uint8Array, JsError> {
        let mut bytes: Vec<Vec<u8>> = Vec::new();
        for item in photos.iter() {
            let arr: Uint8Array = Uint8Array::from(item);
            bytes.push(arr.to_vec());
        }
        let refs: Vec<&[u8]> = bytes.iter().map(|v| v.as_slice()).collect();
        let layout = core::load_layout(layout_json.as_bytes())
            .map_err(|e| JsError::new(&e.to_string()))?;
        let fmt = match format {
            "jpeg" | "jpg" => core::OutputFormat::Jpeg,
            "png" => core::OutputFormat::Png,
            other => return Err(JsError::new(&format!("unsupported format {other:?}"))),
        };
        let opts = core::RenderOptions {
            format: fmt,
            sampling: if preview {
                core::Sampling::Preview
            } else {
                core::Sampling::Full
            },
            fonts: Some(self.fonts.clone()),
            model_map: self.model_map.clone(),
            ..core::RenderOptions::default()
        };
        let out = core::render_collage(&refs, &layout, &opts)
            .map_err(|e| JsError::new(&e.to_string()))?;
        Ok(Uint8Array::from(out.as_slice()))
    }
}
