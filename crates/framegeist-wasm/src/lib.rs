//! WASM bindings for the FrameGeist engine (PRD G / v0.2.0).
//!
//! All processing happens in the browser; no bytes ever leave the page.
//! Errors are thrown as JSON strings: `{"code":"...","message":"..."}` so the
//! UI can localize by stable code.

use js_sys::Uint8Array;
use wasm_bindgen::prelude::*;

use framegeist_core as core;

fn js_err(e: core::Error) -> JsError {
    let message = serde_json::to_string(&e.to_string()).unwrap_or_else(|_| "\"error\"".into());
    JsError::new(&format!(r#"{{"code":"{}","message":{}}}"#, e.code(), message))
}

/// Engine instance holding registered fonts + assets (loaded once, reused).
#[wasm_bindgen]
pub struct Engine {
    fonts: core::text::FontBook,
    model_map: Option<core::ModelMap>,
    assets: std::collections::HashMap<String, Vec<u8>>,
}

#[wasm_bindgen]
impl Engine {
    /// Create an engine and register the boot fonts by (family, bytes) pairs.
    #[wasm_bindgen(constructor)]
    pub fn new(font_names: Vec<JsValue>, font_bytes: Vec<JsValue>) -> Result<Engine, JsError> {
        let mut entries = Vec::new();
        for (name, bytes) in font_names.into_iter().zip(font_bytes) {
            let name = name
                .as_string()
                .ok_or_else(|| JsError::new("font name must be a string"))?;
            let bytes: Uint8Array = Uint8Array::from(bytes);
            entries.push((name, bytes.to_vec()));
        }
        let fonts = core::text::FontBook::from_bytes(entries).map_err(js_err)?;
        Ok(Engine {
            fonts,
            model_map: None,
            assets: std::collections::HashMap::new(),
        })
    }

    /// Lazily register one font (selected family / uploaded font, v0.2.0).
    pub fn add_font(&mut self, family: &str, bytes: &[u8]) -> Result<(), JsError> {
        self.fonts.insert(family, bytes.to_vec()).map_err(js_err)
    }

    /// Registered font family names (normalized, lowercase).
    pub fn font_families(&self) -> Vec<String> {
        self.fonts.families()
    }

    /// Register an image asset: "@user/logo", "@user/background",
    /// "@builtin/brand/<slug>" (test/preview), etc.
    pub fn register_asset(&mut self, name: &str, bytes: &[u8]) {
        self.assets.insert(name.to_string(), bytes.to_vec());
    }

    pub fn clear_assets(&mut self) {
        self.assets.clear();
    }

    /// Validate a template JSON document (PRD C2). Field-level error text on
    /// rejection, as the JSON error object.
    pub fn validate_template(&self, json: &str) -> Result<(), JsError> {
        core::load_template_from_str(json).map(|_| ()).map_err(js_err)
    }

    /// Register an optional model-map override (PRD B5).
    pub fn load_model_map(&mut self, json: &[u8]) -> Result<(), JsError> {
        self.model_map = Some(core::ModelMap::from_json(json).map_err(js_err)?);
        Ok(())
    }

    /// Read EXIF from photo bytes and return it as a JSON string.
    pub fn probe_exif(&self, photo: &[u8]) -> Result<String, JsError> {
        let info = core::probe_exif(photo).map_err(js_err)?;
        serde_json::to_string(&info).map_err(|e| JsError::new(&e.to_string()))
    }

    /// Render a photo against a template (legacy signature).
    pub fn render(
        &self,
        photo: &[u8],
        template_json: &str,
        format: &str,
        preview: bool,
    ) -> Result<Uint8Array, JsError> {
        self.render_impl(photo, None, 0, 0, template_json, format, preview, "", 0)
    }

    /// Render with user overrides JSON (camelCase; empty = none).
    /// `max_edge`: 0 = full resolution, >0 = longest-edge cap (export presets).
    pub fn render_with_overrides(
        &self,
        photo: &[u8],
        template_json: &str,
        format: &str,
        preview: bool,
        overrides_json: &str,
        max_edge: u32,
    ) -> Result<Uint8Array, JsError> {
        self.render_impl(photo, None, 0, 0, template_json, format, preview, overrides_json, max_edge)
    }

    /// Raw-RGBA fast preview: caller pre-decoded/downscaled the photo;
    /// `exif_bytes` may be empty (then no EXIF text/write-back).
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
        self.render_impl(exif_bytes, Some(rgba), width, height, template_json, format, false, overrides_json, 0)
    }

    /// Render a collage (PRD C5).
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
        let layout = core::load_layout(layout_json.as_bytes()).map_err(js_err)?;
        let fmt = parse_format(format)?;
        let opts = core::RenderOptions {
            format: fmt,
            sampling: if preview { core::Sampling::Preview } else { core::Sampling::Full },
            fonts: Some(self.fonts.clone()),
            model_map: self.model_map.clone(),
            ..core::RenderOptions::default()
        };
        let out = core::render_collage(&refs, &layout, &opts).map_err(js_err)?;
        Ok(Uint8Array::from(out.as_slice()))
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
        max_edge: u32,
    ) -> Result<Uint8Array, JsError> {
        let template = core::load_template_from_str(template_json).map_err(js_err)?;
        let fmt = parse_format(format)?;
        let overrides = if overrides_json.trim().is_empty() {
            None
        } else {
            Some(core::TemplateOverrides::from_json(overrides_json).map_err(js_err)?)
        };
        let opts = core::RenderOptions {
            format: fmt,
            sampling: if preview { core::Sampling::Preview } else { core::Sampling::Full },
            max_edge: if max_edge > 0 { Some(max_edge) } else if preview { Some(1600) } else { None },
            fonts: Some(self.fonts.clone()),
            model_map: self.model_map.clone(),
            assets: Some(self.assets.clone()),
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
        .map_err(js_err)?;
        Ok(Uint8Array::from(out.as_slice()))
    }
}

fn parse_format(format: &str) -> Result<core::OutputFormat, JsError> {
    match format {
        "jpeg" | "jpg" => Ok(core::OutputFormat::Jpeg),
        "png" => Ok(core::OutputFormat::Png),
        other => Err(JsError::new(&format!(
            r#"{{"code":"encode","message":"unsupported format {other:?}"}}"#
        ))),
    }
}
