// The typst.ts files loaded from jsdelivr at runtime (see typst.ts). Every
// URL is pinned to an exact version: an unversioned one serves whatever was
// published last, so a hijacked npm release would run on this site the
// moment it went out -- and the compiler and renderer could drift apart.
// jsdelivr serves versioned npm files as immutable, which is what makes the
// script's integrity hash below possible.
//
// To upgrade, bump TYPST_TS_VERSION (all three packages are released in
// lockstep) and recompute the hash:
//
//   curl -s <TYPST_SCRIPT_URL> | openssl dgst -sha384 -binary | openssl base64 -A

const TYPST_TS_VERSION = "0.7.0";
const CDN = "https://cdn.jsdelivr.net/npm/@myriaddreamin";

export const TYPST_SCRIPT_URL = `${CDN}/typst.ts@${TYPST_TS_VERSION}/dist/esm/contrib/all-in-one-lite.bundle.js`;
export const TYPST_SCRIPT_INTEGRITY = "sha384-EJFFdZPsds9hPomUuylsX218dPBLIlif5DzJW4aFW5ofF0hjMPPlFljqBDthNql+";
// The WASM is fetched by the script itself, which offers no integrity
// option; pinning the version is what keeps it matched to the script.
export const COMPILER_WASM_URL = `${CDN}/typst-ts-web-compiler@${TYPST_TS_VERSION}/pkg/typst_ts_web_compiler_bg.wasm`;
export const RENDERER_WASM_URL = `${CDN}/typst-ts-renderer@${TYPST_TS_VERSION}/pkg/typst_ts_renderer_bg.wasm`;
