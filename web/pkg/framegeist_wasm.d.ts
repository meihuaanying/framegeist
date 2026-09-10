/* tslint:disable */
/* eslint-disable */

/**
 * Engine instance holding registered fonts + assets (loaded once, reused).
 */
export class Engine {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Lazily register one font (selected family / uploaded font, v0.2.0).
     */
    add_font(family: string, bytes: Uint8Array): void;
    clear_assets(): void;
    /**
     * Registered font family names (normalized, lowercase).
     */
    font_families(): string[];
    /**
     * Register an optional model-map override (PRD B5).
     */
    load_model_map(json: Uint8Array): void;
    /**
     * Create an engine and register the boot fonts by (family, bytes) pairs.
     */
    constructor(font_names: any[], font_bytes: any[]);
    /**
     * Read EXIF from photo bytes and return it as a JSON string.
     */
    probe_exif(photo: Uint8Array): string;
    /**
     * Register an image asset: "@user/logo", "@user/background",
     * "@builtin/brand/<slug>" (test/preview), etc.
     */
    register_asset(name: string, bytes: Uint8Array): void;
    /**
     * Render a photo against a template (legacy signature).
     */
    render(photo: Uint8Array, template_json: string, format: string, preview: boolean): Uint8Array;
    /**
     * Render a collage (PRD C5).
     */
    render_collage(photos: Array<any>, layout_json: string, format: string, preview: boolean): Uint8Array;
    /**
     * Raw-RGBA fast preview: caller pre-decoded/downscaled the photo;
     * `exif_bytes` may be empty (then no EXIF text/write-back).
     */
    render_raw(rgba: Uint8Array, width: number, height: number, exif_bytes: Uint8Array, template_json: string, format: string, overrides_json: string): Uint8Array;
    /**
     * Render with user overrides JSON (camelCase; empty = none).
     * `max_edge`: 0 = full resolution, >0 = longest-edge cap (export presets).
     */
    render_with_overrides(photo: Uint8Array, template_json: string, format: string, preview: boolean, overrides_json: string, max_edge: number): Uint8Array;
    /**
     * Validate a template JSON document (PRD C2). Field-level error text on
     * rejection, as the JSON error object.
     */
    validate_template(json: string): void;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_engine_free: (a: number, b: number) => void;
    readonly engine_add_font: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly engine_clear_assets: (a: number) => void;
    readonly engine_font_families: (a: number) => [number, number];
    readonly engine_load_model_map: (a: number, b: number, c: number) => [number, number];
    readonly engine_new: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly engine_probe_exif: (a: number, b: number, c: number) => [number, number, number, number];
    readonly engine_register_asset: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly engine_render: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number, number];
    readonly engine_render_collage: (a: number, b: any, c: number, d: number, e: number, f: number, g: number) => [number, number, number];
    readonly engine_render_raw: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number) => [number, number, number];
    readonly engine_render_with_overrides: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number) => [number, number, number];
    readonly engine_validate_template: (a: number, b: number, c: number) => [number, number];
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __externref_drop_slice: (a: number, b: number) => void;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
