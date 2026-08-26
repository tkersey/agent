export const EXPECTED_ZIG_VERSION = "0.16.0";

// Official binary digests were extracted only after matching the Zig download
// index archive SHA-256 values: Darwin arm64
// b23d70deaa879b5c2d486ed3316f7eaa53e84acf6fc9cc747de152450d401489,
// Darwin x64 0387557ed1877bc6a2e1802c8391953baddba76081876301c522f52977b52ba7,
// Linux arm64 ea4b09bfb22ec6f6c6ceac57ab63efb6b46e17ab08d21f69f3a48b38e1534f17,
// and Linux x64 70e49664a74374b48b51e6f3fdfbf437f6395d42509050588bd49abe52ba3d00.
// The additional Darwin arm64 digest is the exact Homebrew 0.16.0_1 binary
// used by the release lane.
const ADMITTED_ZIG_BINARY_SHA256 = Object.freeze({
  "darwin-arm64": Object.freeze([
    "71cc3995a7586753ebf82c66dfb8bef43df446517550678781834586a960f8c9",
    "e6cd688d25664983833aae272f501d4bceeae304875b8f1741209d15fd13a4ec"
  ]),
  "darwin-x64": Object.freeze([
    "5597fba0eb9d8f1f5331e3e5822e7e96e4a12eeb6f4939781bd8e2c13b15e8b5"
  ]),
  "linux-arm64": Object.freeze([
    "6e2989a7efbd4e81acbacb6c6378e34340d8e88bb023b10c4a941021be55cdcb"
  ]),
  "linux-x64": Object.freeze([
    "2317bbb91798556d9d0f38aabdac23db83f0979b25f767259ae474546724087c"
  ])
});

export function admitZigBinarySha256(actual, platform = process.platform, architecture = process.arch) {
  const host = `${platform}-${architecture}`;
  const admitted = ADMITTED_ZIG_BINARY_SHA256[host];
  if (admitted === undefined) {
    throw new Error(`Zig ${EXPECTED_ZIG_VERSION} binary is not admitted on ${host}`);
  }
  if (!admitted.includes(actual)) {
    throw new Error(`Zig ${EXPECTED_ZIG_VERSION} binary digest mismatch on ${host}: ${actual}`);
  }
  return actual;
}
