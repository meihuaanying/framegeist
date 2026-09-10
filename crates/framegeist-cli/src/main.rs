use std::path::{Path, PathBuf};
use std::io::Write as _;
use std::process::ExitCode;

use clap::Parser;
use framegeist_core::{
    load_template, probe_exif, render, Error, OutputFormat, RenderOptions, Sampling, Template,
};
use sha2::{Digest, Sha256};

#[derive(Parser, Debug)]
#[command(name = "framegeist", version, about = "FrameGeist photo frame engine")]
struct Args {
    #[command(subcommand)]
    cmd: Cmd,
    #[arg(long, global = true, default_value = "templates/assets")]
    assets_dir: PathBuf,
    /// Keep GPS coordinates in exported EXIF (PRD B3: off by default).
    #[arg(long = "keep-gps", global = true)]
    keep_gps: bool,
}

#[derive(clap::Subcommand, Debug)]
enum Cmd {
    /// Render a single photo with a template.
    Render {
        photo: PathBuf,
        #[arg(long = "template")]
        template: String,
        #[arg(short, long)]
        output: PathBuf,
        #[arg(long = "format", default_value = "jpeg")]
        format: String,
        #[arg(long)]
        preview: bool,
        #[arg(long = "max-edge")]
        max_edge: Option<u32>,
        #[arg(long)]
        aspect: Option<String>,
        #[arg(long)]
        background: Option<String>,
        #[arg(long = "bg-color")]
        bg_color: Option<String>,
        #[arg(long = "flip-h")]
        flip_h: bool,
        #[arg(long = "flip-v")]
        flip_v: bool,
        #[arg(long = "no-logo")]
        no_logo: bool,
        #[arg(long)]
        font: Option<String>,
    },
    /// Render a directory of photos; existing outputs are never overwritten.
    Batch {
        dir: PathBuf,
        #[arg(long = "template")]
        template: String,
        #[arg(short, long)]
        output: PathBuf,
        #[arg(long = "format", default_value = "jpeg")]
        format: String,
    },
    /// Render a collage from multiple photos using a grid layout (PRD C5).
    Collage {
        photos: Vec<PathBuf>,
        #[arg(long = "layout")]
        layout: String,
        #[arg(short, long)]
        output: PathBuf,
        #[arg(long = "format", default_value = "jpeg")]
        format: String,
    },
    /// Export a template as a portable .fgt package (PRD E1).
    TemplateExport {
        #[arg(long = "template")]
        template: String,
        #[arg(short, long)]
        output: PathBuf,
    },
    /// Import a .fgt package; rejects anything failing sandbox validation (PRD E2).
    TemplateImport {
        file: PathBuf,
        #[arg(long = "dir", default_value = "templates")]
        dir: PathBuf,
        #[arg(long)]
        force: bool,
    },
    /// Print EXIF metadata of a photo as JSON.
    Probe { photo: PathBuf },
    /// List built-in templates.
    Templates,
    /// Compute sha256 of an output file (golden regression helper).
    Hash { file: PathBuf },
    /// Decode an image and hash its RGBA pixels (cross-end pixel gate, PRD N2).
    PixelHash { file: PathBuf },
    /// Decode two images and report the ratio of differing RGBA pixels
    /// (PRD N2 gate: ratio <= 0.1% passes).
    PixelDiff { a: PathBuf, b: PathBuf },
}

fn find_template_dir() -> PathBuf {
    PathBuf::from("templates")
}

fn resolve_template(spec: &str) -> Result<(Template, String), Error> {
    let path = Path::new(spec);
    if path.exists() {
        let bytes = std::fs::read(path)?;
        return Ok((load_template(&bytes)?, spec.to_string()));
    }
    let dir = find_template_dir();
    let mut matches = Vec::new();
    for entry in walkdir::WalkDir::new(&dir) {
        let entry = entry.map_err(|e| Error::Io(std::io::Error::other(e.to_string())))?;
        if !entry.file_type().is_file() {
            continue;
        }
        if entry.path().extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let bytes = std::fs::read(entry.path())?;
        if let Ok(t) = load_template(&bytes) {
            if t.meta.id == spec {
                matches.push((t, entry.path().display().to_string()));
            }
        }
    }
    match matches.len() {
        0 => Err(Error::TemplateJson(format!(
            "template id {spec:?} not found under {}",
            dir.display()
        ))),
        1 => Ok(matches.remove(0)),
        _ => Err(Error::TemplateJson(format!(
            "template id {spec:?} is ambiguous: {} matches",
            matches.len()
        ))),
    }
}

fn parse_format(s: &str) -> Result<OutputFormat, Error> {
    match s {
        "jpeg" | "jpg" => Ok(OutputFormat::Jpeg),
        "png" => Ok(OutputFormat::Png),
        other => Err(Error::Encode(format!("unsupported output format {other:?}"))),
    }
}

fn photo_files(dir: &Path) -> Result<Vec<PathBuf>, Error> {
    let mut files = Vec::new();
    for entry in walkdir::WalkDir::new(dir).max_depth(1) {
        let entry = entry.map_err(|e| Error::Io(std::io::Error::other(e.to_string())))?;
        if !entry.file_type().is_file() {
            continue;
        }
        let ext = entry
            .path()
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_ascii_lowercase());
        if matches!(
            ext.as_deref(),
            Some("jpg") | Some("jpeg") | Some("png") | Some("webp") | Some("tif") | Some("tiff")
        ) {
            files.push(entry.path().to_path_buf());
        }
    }
    files.sort();
    Ok(files)
}

fn resolve_layout(spec: &str) -> Result<framegeist_core::Layout, Error> {
    let path = Path::new(spec);
    if path.exists() {
        let bytes = std::fs::read(path)?;
        return framegeist_core::load_layout(&bytes);
    }
    let dir = PathBuf::from("templates/layouts");
    let mut found = None;
    for entry in walkdir::WalkDir::new(&dir) {
        let entry = entry.map_err(|e| Error::Io(std::io::Error::other(e.to_string())))?;
        if entry.path().extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let bytes = std::fs::read(entry.path())?;
        if let Ok(l) = framegeist_core::load_layout(&bytes) {
            if l.meta.id == spec {
                found = Some(l);
                break;
            }
        }
    }
    found.ok_or_else(|| {
        Error::TemplateJson(format!(
            "layout id {spec:?} not found under {}",
            dir.display()
        ))
    })
}

fn build_opts(args: &Args, format: OutputFormat, preview: bool) -> Result<RenderOptions, Error> {
    let assets_dir = args.assets_dir.clone();
    Ok(RenderOptions {
        format,
        sampling: if preview { Sampling::Preview } else { Sampling::Full },
        max_edge: if preview { Some(1600) } else { None },
        keep_gps: args.keep_gps,
        assets_dir: Some(assets_dir.clone()),
        model_map: framegeist_core::load_model_map(&assets_dir)?,
        ..RenderOptions::default()
    })
}

fn run(args: &Args) -> Result<(), Error> {
    match &args.cmd {
        Cmd::Render {
            photo,
            template,
            output,
            format,
            preview,
            max_edge,
            aspect,
            background,
            bg_color,
            flip_h,
            flip_v,
            no_logo,
            font,
        } => {
            let (tpl, _src) = resolve_template(template)?;
            let bytes = std::fs::read(photo)?;
            let mut opts = build_opts(args, parse_format(format)?, *preview)?;
            if let Some(edge) = max_edge { opts.max_edge = Some(*edge); }
            let mut over = framegeist_core::TemplateOverrides {
                aspect: aspect.clone(),
                background: background.clone(),
                background_color: bg_color.clone(),
                flip_horizontal: flip_h.then_some(true),
                flip_vertical: flip_v.then_some(true),
                font_family: font.clone(),
                ..framegeist_core::TemplateOverrides::default()
            };
            if *no_logo {
                over.show_logo = Some(false);
            }
            let has_over = over.aspect.is_some()
                || over.background.is_some()
                || over.background_color.is_some()
                || over.flip_horizontal.is_some()
                || over.flip_vertical.is_some()
                || over.font_family.is_some()
                || over.show_logo.is_some();
            if has_over {
                over.validate()?;
                opts.overrides = Some(over);
            }
            let out = render(&bytes, &tpl, &opts)?;
            if output.exists() {
                return Err(Error::Io(std::io::Error::other(format!(
                    "refusing to overwrite existing file: {}",
                    output.display()
                ))));
            }
            if let Some(parent) = output.parent() {
                std::fs::create_dir_all(parent)?;
            }
            std::fs::write(output, out)?;
            if let Some(r) = framegeist_core::metadata_report(&bytes, opts.keep_gps)? {
                eprintln!(
                    "metadata report: kept {} field(s); GPS {} (keep_gps={}); serials removed: {}",
                    r.kept,
                    if r.gps_stripped > 0 { format!("stripped {} entr(ies)", r.gps_stripped) } else { "none".into() },
                    r.keep_gps,
                    r.serial_stripped
                );
            }
            Ok(())
        }
        Cmd::Batch {
            dir,
            template,
            output,
            format,
        } => {
            let (tpl, _src) = resolve_template(template)?;
            let opts = build_opts(args, parse_format(format)?, false)?;
            std::fs::create_dir_all(output)?;
            let mut done = 0usize;
            let mut gps_stripped = 0usize;
            let mut serials_stripped = 0usize;
            for photo in photo_files(dir)? {
                let name = photo
                    .file_name()
                    .and_then(|n| n.to_str())
                    .ok_or_else(|| Error::UnsupportedFormat("bad file name".into()))?
                    .to_string();
                let mut out_name = name;
                if opts.format == OutputFormat::Jpeg {
                    let stem = out_name
                        .split_once('.')
                        .map(|(s, _)| s.to_string())
                        .unwrap_or(out_name.clone());
                    out_name = format!("{stem}.jpg");
                }
                let out_path = output.join(&out_name);
                if out_path.exists() {
                    eprintln!("skip existing {}", out_path.display());
                    continue;
                }
                let bytes = std::fs::read(&photo)?;
                let out = render(&bytes, &tpl, &opts)?;
                std::fs::write(&out_path, out)?;
                if let Some(r) = framegeist_core::metadata_report(&bytes, opts.keep_gps)? {
                    gps_stripped += r.gps_stripped;
                    serials_stripped += r.serial_stripped;
                }
                done += 1;
            }
            println!("rendered {done} photo(s)");
            if gps_stripped > 0 || serials_stripped > 0 {
                println!("metadata report: GPS stripped {gps_stripped} entr(ies), serials stripped {serials_stripped} (keep_gps={})", opts.keep_gps);
            }
            Ok(())
        }
        Cmd::Collage {
            photos,
            layout,
            output,
            format,
        } => {
            if photos.is_empty() {
                return Err(Error::Image("collage needs photo arguments".into()));
            }
            let lay = resolve_layout(layout)?;
            let opts = build_opts(args, parse_format(format)?, false)?;
            let mut loaded = Vec::new();
            for p in photos {
                loaded.push(std::fs::read(p)?);
            }
            let refs: Vec<&[u8]> = loaded.iter().map(|v| v.as_slice()).collect();
            let out = framegeist_core::render_collage(&refs, &lay, &opts)?;
            if output.exists() {
                return Err(Error::Io(std::io::Error::other(format!(
                    "refusing to overwrite existing file: {}",
                    output.display()
                ))));
            }
            if let Some(parent) = output.parent() {
                std::fs::create_dir_all(parent)?;
            }
            std::fs::write(output, out)?;
            if let Some(r) = framegeist_core::metadata_report(loaded.first().map(|v| v.as_slice()).unwrap_or(&[]), opts.keep_gps)? {
                eprintln!(
                    "metadata report (first photo): kept {} field(s); GPS stripped {}; serials stripped {}",
                    r.kept, r.gps_stripped, r.serial_stripped
                );
            }
            Ok(())
        }
        Cmd::TemplateExport { template, output } => {
            let (tpl, src) = resolve_template(template)?;
            if output.exists() {
                return Err(Error::Io(std::io::Error::other(format!(
                    "refusing to overwrite existing file: {}",
                    output.display()
                ))));
            }
            if let Some(parent) = output.parent() {
                std::fs::create_dir_all(parent)?;
            }
            let file = std::fs::File::create(output)?;
            let mut zip = zip::ZipWriter::new(file);
            let opts: zip::write::FileOptions<'_, ()> =
                zip::write::FileOptions::default().compression_method(zip::CompressionMethod::Deflated);
            zip.start_file("manifest.json", opts).map_err(|e| Error::Encode(e.to_string()))?;
            zip.write_all(
                serde_json::to_string_pretty(&serde_json::json!({
                    "formatVersion": 1,
                    "kind": "framegeist-template",
                    "templateId": tpl.meta.id,
                }))
                .map_err(|e| Error::TemplateJson(e.to_string()))?
                .as_bytes(),
            )?;
            zip.start_file("template.json", opts).map_err(|e| Error::Encode(e.to_string()))?;
            let raw = std::fs::read(&src)?;
            zip.write_all(&raw)?;
            zip.finish().map_err(|e| Error::Encode(e.to_string()))?;
            Ok(())
        }
        Cmd::TemplateImport { file, dir, force } => {
            let f = std::fs::File::open(file)?;
            let mut zip = zip::ZipArchive::new(f)
                .map_err(|e| Error::TemplateJson(format!("not a valid .fgt zip: {e}")))?;
            let raw = {
                let mut entry = zip
                    .by_name("template.json")
                    .map_err(|e| Error::TemplateJson(format!(".fgt missing template.json: {e}")))?;
                let mut buf = Vec::new();
                std::io::Read::read_to_end(&mut entry, &mut buf)?;
                buf
            };
            // Mandatory C2 sandbox + schema validation BEFORE anything is
            // written to disk (PRD E2); errors are field-level.
            let tpl = load_template(&raw)?;
            let target = dir.join(format!("{}.json", tpl.meta.id));
            if target.exists() && !force {
                return Err(Error::TemplateJson(format!(
                    "template id {:?} already exists at {} (use --force to replace)",
                    tpl.meta.id,
                    target.display()
                )));
            }
            std::fs::create_dir_all(dir)?;
            std::fs::write(&target, &raw)?;
            println!("imported {} -> {}", tpl.meta.id, target.display());
            Ok(())
        }
        Cmd::Probe { photo } => {
            let bytes = std::fs::read(photo)?;
            let info = probe_exif(&bytes)?;
            println!("{}", serde_json::to_string_pretty(&info).map_err(|e| Error::Exif(e.to_string()))?);
            Ok(())
        }
        Cmd::Templates => {
            for entry in walkdir::WalkDir::new(find_template_dir()) {
                let entry = entry.map_err(|e| Error::Io(std::io::Error::other(e.to_string())))?;
                if entry.path().extension().and_then(|e| e.to_str()) != Some("json") {
                    continue;
                }
                let bytes = std::fs::read(entry.path())?;
                if let Ok(t) = load_template(&bytes) {
                    println!("{}\t{}\t{}", t.meta.id, t.meta.category, t.meta.name);
                }
            }
            Ok(())
        }
        Cmd::Hash { file } => {
            let bytes = std::fs::read(file)?;
            let digest = Sha256::digest(&bytes);
            println!("{}", hex::encode(digest));
            Ok(())
        }
        Cmd::PixelHash { file } => {
            let bytes = std::fs::read(file)?;
            let img = image::load_from_memory(&bytes)
                .map_err(|e| Error::Image(e.to_string()))?
                .to_rgba8();
            let digest = Sha256::digest(img.as_raw());
            println!("{}", hex::encode(digest));
            Ok(())
        }
        Cmd::PixelDiff { a, b } => {
            let ia = image::load_from_memory(&std::fs::read(a)?)
                .map_err(|e| Error::Image(e.to_string()))?
                .to_rgba8();
            let ib = image::load_from_memory(&std::fs::read(b)?)
                .map_err(|e| Error::Image(e.to_string()))?
                .to_rgba8();
            if ia.dimensions() != ib.dimensions() {
                let (aw, ah) = ia.dimensions();
                let (bw, bh) = ib.dimensions();
                println!("mismatched-dimensions {aw}x{ah} vs {bw}x{bh}");
                return Ok(());
            }
            let total = ia.as_raw().len() / 4;
            let mut diff = 0usize;
            for (pa, pb) in ia.as_raw().as_chunks::<4>().0.iter().zip(ib.as_raw().as_chunks::<4>().0.iter()) {
                if pa[..3] != pb[..3] {
                    diff += 1;
                }
            }
            println!("diff={diff} total={total} ratio={:.6}", diff as f64 / total.max(1) as f64);
            Ok(())
        }
    }
}

fn main() -> ExitCode {
    let args = Args::parse();
    match run(&args) {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("error: {e}");
            ExitCode::FAILURE
        }
    }
}
