const PNG_SIG = new Uint8Array([137,80,78,71,13,10,26,10]);
const TYPE_IHDR = 0x49484452; // "IHDR"
const TYPE_IDAT = 0x49444154; // "IDAT"
const TYPE_IEND = 0x49454E44; // "IEND"
const TYPE_tEXt = 0x74455874; // "tEXt"
const TYPE_iTXt = 0x69545874; // "iTXt"

function readU32(b, o) { return b.getUint32(o); }
function writeU32(b, o, v) { b.setUint32(o, v); }

function crcTable() {
  const table = new Uint32Array(256);
  for (let n=0; n<256; n++) {
    let c = n;
    for (let k=0; k<8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
}
const CRC_TABLE = crcTable();
function crc32(type, data) {
  let c = 0xFFFFFFFF;
  for (let i=0;i<type.length;i++) c = CRC_TABLE[(c ^ type[i]) & 0xFF] ^ (c >>> 8);
  for (let i=0;i<data.length;i++) c = CRC_TABLE[(c ^ data[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function decodeChunks(buf) {
  const u = new Uint8Array(buf);
  if (u.length < 8 || !PNG_SIG.every((v,i)=>u[i]===v)) throw new Error("Not a PNG");
  let off = 8;
  const dv = new DataView(buf);
  const chunks = [];
  while (off + 12 <= u.length) {
    const len = readU32(dv, off); off += 4;
    const type = readU32(dv, off); off += 4;
    if (off + len + 4 > u.length) throw new Error("PNG corrupted");
    const data = u.slice(off, off+len); off += len;
    off += 4; // skip crc (we don't validate)
    chunks.push({ type, data });
    if (type === TYPE_IEND) break;
  }
  return chunks;
}

function encodeChunks(chunks) {
  // compute length
  let size = 8;
  for (const ch of chunks) size += 12 + ch.data.length;
  const buf = new ArrayBuffer(size);
  const u = new Uint8Array(buf);
  u.set(PNG_SIG, 0);
  let off = 8;
  const dv = new DataView(buf);
  for (const ch of chunks) {
    writeU32(dv, off, ch.data.length); off += 4;
    const typeBytes = new Uint8Array(4);
    typeBytes[0] = (ch.type >>> 24) & 0xFF;
    typeBytes[1] = (ch.type >>> 16) & 0xFF;
    typeBytes[2] = (ch.type >>> 8) & 0xFF;
    typeBytes[3] = (ch.type >>> 0) & 0xFF;
    u.set(typeBytes, off); off += 4;
    u.set(ch.data, off); off += ch.data.length;
    const crc = crc32(typeBytes, ch.data);
    writeU32(dv, off, crc); off += 4;
  }
  return buf;
}

function ascii(str) {
  const u = new Uint8Array(str.length);
  for (let i=0;i<str.length;i++) u[i] = str.charCodeAt(i) & 0x7F;
  return u;
}

function utf8(str) {
  return new TextEncoder().encode(str);
}

export async function embedMetaITXt(pngBlob, keyword, json) {
  const buf = await pngBlob.arrayBuffer();
  const chunks = decodeChunks(buf);

  // create iTXt data: keyword\0 compressionFlag=0 \0 languageTag\0 translatedKeyword\0 text(utf-8)
  const k = ascii(keyword);
  const text = utf8(json);
  const parts = [
    k, new Uint8Array([0x00]), // keyword + null
    new Uint8Array([0x00]),    // compression flag (0 = uncompressed)
    new Uint8Array([0x00]),    // compression method
    new Uint8Array([0x00]),    // language tag (empty + null)
    new Uint8Array([0x00]),    // translated keyword (empty + null)
    text                        // utf8 text
  ];
  let len = 0; parts.forEach(p=>len+=p.length);
  const data = new Uint8Array(len);
  let off = 0;
  for (const p of parts) { data.set(p, off); off += p.length; }

  // insert after IHDR
  const out = [];
  let inserted = false;
  for (const ch of chunks) {
    out.push(ch);
    if (!inserted && ch.type === TYPE_IHDR) {
      out.push({ type: TYPE_iTXt, data });
      inserted = true;
    }
  }
  if (!inserted) out.splice(1,0,{ type: TYPE_iTXt, data });

  const outBuf = encodeChunks(out);
  return new Blob([outBuf], { type: "image/png" });
}

export async function extractMeta(pngBlob, keyword) {
  const buf = await pngBlob.arrayBuffer();
  const chunks = decodeChunks(buf);

  for (const ch of chunks) {
    if (ch.type === TYPE_iTXt) {
      // parse iTXt
      const u = ch.data;
      let i = 0;
      while (i < u.length && u[i] !== 0) i++;
      const key = new TextDecoder("ascii").decode(u.slice(0,i));
      i++; // null
      if (key === keyword) {
        // compressionFlag, compressionMethod
        const compFlag = u[i]; i++;
        i++; // method
        // languageTag (null-terminated)
        while (i < u.length && u[i] !== 0) i++; i++;
        // translated keyword (null-terminated, UTF-8)
        while (i < u.length && u[i] !== 0) i++; i++;
        const textBytes = u.slice(i);
        if (compFlag !== 0) throw new Error("Compressed iTXt not supported");
        return new TextDecoder().decode(textBytes);
      }
    } else if (ch.type === TYPE_tEXt) {
      // parse tEXt (Latin-1) for compatibility
      const u = ch.data;
      let i = 0; while (i < u.length && u[i] !== 0) i++;
      const key = new TextDecoder("latin1").decode(u.slice(0,i));
      if (key === keyword) {
        const text = new TextDecoder("latin1").decode(u.slice(i+1));
        return text;
      }
    }
  }
  return null;
}
