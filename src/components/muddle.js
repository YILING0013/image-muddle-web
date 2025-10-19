import { gilbert2d } from "./gilbert";

/**
 * @typedef {object} EncodeParams
 * @property {number} tile_h
 * @property {number} tile_w
 * @property {number} stride_y
 * @property {number} stride_x
 * @property {number} key
 * @property {"edge" | "constant"} pad_mode
 */

/**
 * @typedef {object} MetaV2
 * @property {2} version
 * @property {"gilbert_shift"} algo
 * @property {[number, number]} orig_size
 * @property {[number, number]} padded_size
 * @property {string} mode
 * @property {[number, number]} tile_size
 * @property {[number, number]} grid_size
 * @property {[number, number]} stride
 * @property {[number, number]} preview_grid_size
 * @property {"edge" | "constant"} pad_mode
 * @property {[number, number][]} preview_tiles
 * @property {{offset: number, M: number}} perm
 * @property {string} notes
 */


function phiOffset(M, key) {
  if (M <= 1) return 0;
  const phi = (Math.sqrt(5) - 1) / 2;
  const base = Math.round(phi * M);
  const rnd = (1103515245 * (key >>> 0) + 12345) & 0x7fffffff;
  let off = (base + rnd) % M;
  if (off === 0) off = 1;
  return off;
}

function padToMultiple(src, th, tw, mode) {
  const H = src.height, W = src.width;
  const ph = (th - (H % th)) % th;
  const pw = (tw - (W % tw)) % tw;
  const Hp = H + ph, Wp = W + pw;
  if (ph === 0 && pw === 0) return { Hp, Wp, arr: src.data };

  const out = new Uint8ClampedArray(Hp * Wp * 4);
  // copy original
  for (let y=0; y<H; y++) {
    const srcOff = y * W * 4;
    const dstOff = y * Wp * 4;
    out.set(src.data.slice(srcOff, srcOff + W*4), dstOff);
  }
  if (mode === "edge") {
    // right extension: copy last pixel horizontally
    for (let y=0; y<H; y++) {
      const base = y * Wp * 4 + (W - 1) * 4;
      const px = out.slice(base, base+4);
      for (let x=W; x<Wp; x++) out.set(px, y*Wp*4 + x*4);
    }
    // bottom rows: copy last row
    for (let y=H; y<Hp; y++) {
      const srcRow = (H - 1) * Wp * 4;
      out.set(out.slice(srcRow, srcRow + Wp*4), y*Wp*4);
    }
  }
  return { Hp, Wp, arr: out };
}

function copyRectSameStride(src, dst, Wp, sx, sy, dx, dy, w, h) {
  for (let r=0; r<h; r++) {
    const s = ((sy + r) * Wp + sx) * 4;
    const d = ((dy + r) * Wp + dx) * 4;
    dst.set(src.slice(s, s + w*4), d);
  }
}

/**
 * @param {ImageData} input
 * @param {EncodeParams} params
 * @returns {{output: ImageData, meta: MetaV2}}
 */
export function encodeGilbert(input, params) {
  const { tile_h, tile_w, stride_y, stride_x, key, pad_mode } = params;
  if (tile_h <= 0 || tile_w <= 0) throw new Error("tile size must be > 0");
  if (stride_y <= 0 || stride_x <= 0) throw new Error("stride must be > 0");

  const H = input.height, W = input.width;
  const { Hp, Wp, arr: srcPadded } = padToMultiple(input, tile_h, tile_w, pad_mode);
  const R = Math.floor(Hp / tile_h), C = Math.floor(Wp / tile_w);

  const previewTiles = [];
  for (let r=0; r<R; r+=stride_y) for (let c=0; c<C; c+=stride_x) previewTiles.push([r,c]);
  const Pr = Math.ceil(R / stride_y);
  const Pc = Math.ceil(C / stride_x);

  const out = new Uint8ClampedArray(Hp * Wp * 4);

  previewTiles.forEach(([tr, tc], idx) => {
    const pr = Math.floor(idx / Pc), pc = idx % Pc;
    copyRectSameStride(
      srcPadded, out, Wp,
      tc*tile_w, tr*tile_h, pc*tile_w, pr*tile_h,
      tile_w, tile_h
    );
  });

  const isPreview = new Set();
  previewTiles.forEach(([tr, tc]) => isPreview.add(tr*C + tc));
  const preH = Pr * tile_h, preW = Pc * tile_w;

  const path = gilbert2d(Wp, Hp);
  const source = [];
  const dest = [];
  for (const [x,y] of path) {
    const tr = Math.floor(y / tile_h), tc = Math.floor(x / tile_w);
    if (!isPreview.has(tr*C + tc)) source.push(y * Wp + x);
    if (!(y < preH && x < preW)) dest.push(y * Wp + x);
  }
  if (source.length !== dest.length) throw new Error("source/dest size mismatch");
  const M = source.length;
  const offset = phiOffset(M, key);

  for (let i=0; i<M; i++) {
    const j = (i + offset) % M;
    const si = source[i] * 4;
    const di = dest[j] * 4;
    out[di] = srcPadded[si];
    out[di+1] = srcPadded[si+1];
    out[di+2] = srcPadded[si+2];
    out[di+3] = srcPadded[si+3];
  }

  const output = new ImageData(out, Wp, Hp);
  const meta = {
    version: 2,
    algo: "gilbert_shift",
    orig_size: [H, W],
    padded_size: [Hp, Wp],
    mode: "RGBA",
    tile_size: [tile_h, tile_w],
    grid_size: [R, C],
    stride: [stride_y, stride_x],
    preview_grid_size: [Pr, Pc],
    pad_mode,
    preview_tiles: previewTiles,
    perm: { offset, M },
    notes: "source: 全图 Gilbert 排除原始预览 tile；dest: 排除左上预览矩形；对齐后做一次循环位移。"
  };

  return { output, meta };
}

/**
 * @param {ImageData} muddled
 * @param {MetaV2} meta
 * @returns {ImageData}
 */
export function decodeGilbert(muddled, meta) {
  if (meta.version !== 2 || meta.algo !== "gilbert_shift") throw new Error("Unsupported meta");

  const [Hp, Wp] = meta.padded_size;
  if (muddled.width !== Wp || muddled.height !== Hp) {
    throw new Error(`Input size ${muddled.height}x${muddled.width} != meta.padded_size ${Hp}x${Wp}`);
  }

  const out = new Uint8ClampedArray(Hp * Wp * 4);
  const R = meta.grid_size[0], C = meta.grid_size[1];
  const tile_h = meta.tile_size[0], tile_w = meta.tile_size[1];
  const Pr = meta.preview_grid_size[0], Pc = meta.preview_grid_size[1];
  const preH = Pr * tile_h, preW = Pc * tile_w;

  meta.preview_tiles.forEach(([tr, tc], idx) => {
    const pr = Math.floor(idx / Pc), pc = idx % Pc;
    copyRectSameStride(
      muddled.data, out, Wp,
      pc*tile_w, pr*tile_h, tc*tile_w, tr*tile_h,
      tile_w, tile_h
    );
  });

  const path = gilbert2d(Wp, Hp);
  const isPreview = new Set();
  meta.preview_tiles.forEach(([tr, tc]) => isPreview.add(tr*C + tc));

  const source = [];
  const dest = [];
  for (const [x,y] of path) {
    const tr = Math.floor(y / tile_h), tc = Math.floor(x / tile_w);
    if (!isPreview.has(tr*C + tc)) source.push(y * Wp + x);
    if (!(y < preH && x < preW)) dest.push(y * Wp + x);
  }
  const M = meta.perm.M;
  if (M !== source.length || M !== dest.length) throw new Error("Meta M mismatch");

  const offset = meta.perm.offset;
  for (let i=0; i<M; i++) {
    const j = (i + offset) % M;
    const si = source[i] * 4;
    const di = dest[j] * 4;
    out[si] = muddled.data[di];
    out[si+1] = muddled.data[di+1];
    out[si+2] = muddled.data[di+2];
    out[si+3] = muddled.data[di+3];
  }

  const [H, W] = meta.orig_size;
  if (H === Hp && W === Wp) return new ImageData(out, Wp, Hp);

  const cropped = new Uint8ClampedArray(W * H * 4);
  for (let y=0; y<H; y++) {
    const s = y * Wp * 4;
    const d = y * W * 4;
    cropped.set(out.slice(s, s + W*4), d);
  }
  return new ImageData(cropped, W, H);
}
