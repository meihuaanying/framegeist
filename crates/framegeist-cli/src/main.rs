use std::path::{Path, PathBuf};
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
    /// Print EXIF metadata of a photo as JSON.
    Probe { photo: PathBuf },
    /// List built-in templates.
    Templates,
    /// Compute sha256 of an output file (golden regression helper).
    Hash { file: PathBuf },
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

fn run(args: &Args) -> Result<(), Error> {
    match &args.cmd {
        Cmd::Render {
            photo,
            template,
            output,
            format,
            preview,
        } => {
            let (tpl, _src) = resolve_template(template)?;
            let bytes = std::fs::read(photo)?;
            let opts = RenderOptions {
                format: parse_format(format)?,
                sampling: if *preview { Sampling::Preview } else { Sampling::Full },
                assets_dir: Some(args.assets_dir.clone()),
                ..RenderOptions::default()
            };
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
            Ok(())
        }
        Cmd::Batch {
            dir,
            template,
            output,
            format,
        } => {
            let (tpl, _src) = resolve_template(template)?;
            let opts = RenderOptions {
                format: parse_format(format)?,
                sampling: Sampling::Full,
                assets_dir: Some(args.assets_dir.clone()),
                ..RenderOptions::default()
            };
            std::fs::create_dir_all(output)?;
            let mut done = 0usize;
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
                done += 1;
            }
            println!("rendered {done} photo(s)");
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
            let opts = RenderOptions {
                format: parse_format(format)?,
                sampling: Sampling::Full,
                assets_dir: Some(args.assets_dir.clone()),
                ..RenderOptions::default()
            };
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
