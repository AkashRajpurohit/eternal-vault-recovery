export interface ZipEntry {
  name: string;
  size: number;
  compressedSize: number;
  method: number;
  localHeaderOffset: number;
}

const SIG_EOCD = 0x06054b50;
const SIG_ZIP64_LOCATOR = 0x07064b50;
const SIG_ZIP64_EOCD = 0x06064b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;
const MAX_U32 = 0xffffffff;
const MAX_U16 = 0xffff;

export class ZipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ZipError';
  }
}

async function readRange(blob: Blob, start: number, end: number): Promise<DataView> {
  const buf = await blob.slice(start, end).arrayBuffer();
  return new DataView(buf);
}

function u64(view: DataView, offset: number): number {
  const value = view.getBigUint64(offset, true);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new ZipError('ZIP offset too large');
  }
  return Number(value);
}

export class ZipReader {
  private constructor(
    private readonly blob: Blob,
    readonly entries: Map<string, ZipEntry>,
  ) {}

  static async open(blob: Blob): Promise<ZipReader> {
    const size = blob.size;
    if (size < 22) throw new ZipError('File is too small to be a ZIP archive');

    const tailStart = Math.max(0, size - (22 + MAX_U16));
    const tail = await readRange(blob, tailStart, size);
    let eocd = -1;
    for (let i = tail.byteLength - 22; i >= 0; i--) {
      if (tail.getUint32(i, true) === SIG_EOCD) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new ZipError('Not a ZIP archive (end of central directory not found)');

    let entryCount = tail.getUint16(eocd + 10, true);
    let cdSize = tail.getUint32(eocd + 12, true);
    let cdOffset = tail.getUint32(eocd + 16, true);

    const needsZip64 = entryCount === MAX_U16 || cdSize === MAX_U32 || cdOffset === MAX_U32;
    const locatorPos = eocd - 20;
    if (locatorPos >= 0 && tail.getUint32(locatorPos, true) === SIG_ZIP64_LOCATOR) {
      const zip64EocdOffset = u64(tail, locatorPos + 8);
      const z = await readRange(blob, zip64EocdOffset, zip64EocdOffset + 56);
      if (z.getUint32(0, true) !== SIG_ZIP64_EOCD) {
        throw new ZipError('Corrupt Zip64 end of central directory');
      }
      entryCount = u64(z, 32);
      cdSize = u64(z, 40);
      cdOffset = u64(z, 48);
    } else if (needsZip64) {
      throw new ZipError('Zip64 locator missing');
    }

    const cd = await readRange(blob, cdOffset, cdOffset + cdSize);
    const decoder = new TextDecoder();
    const entries = new Map<string, ZipEntry>();
    let p = 0;
    for (let n = 0; n < entryCount; n++) {
      if (cd.getUint32(p, true) !== SIG_CENTRAL) {
        throw new ZipError('Corrupt central directory');
      }
      const method = cd.getUint16(p + 10, true);
      let compressedSize = cd.getUint32(p + 20, true);
      let uncompressedSize = cd.getUint32(p + 24, true);
      const nameLen = cd.getUint16(p + 28, true);
      const extraLen = cd.getUint16(p + 30, true);
      const commentLen = cd.getUint16(p + 32, true);
      let localHeaderOffset = cd.getUint32(p + 42, true);
      const name = decoder.decode(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nameLen));

      let e = p + 46 + nameLen;
      const extraEnd = e + extraLen;
      while (e + 4 <= extraEnd) {
        const id = cd.getUint16(e, true);
        const len = cd.getUint16(e + 2, true);
        if (id === 0x0001) {
          let q = e + 4;
          if (uncompressedSize === MAX_U32) {
            uncompressedSize = u64(cd, q);
            q += 8;
          }
          if (compressedSize === MAX_U32) {
            compressedSize = u64(cd, q);
            q += 8;
          }
          if (localHeaderOffset === MAX_U32) {
            localHeaderOffset = u64(cd, q);
          }
        }
        e += 4 + len;
      }

      entries.set(name, {
        name,
        size: uncompressedSize,
        compressedSize,
        method,
        localHeaderOffset,
      });
      p = extraEnd + commentLen;
    }
    return new ZipReader(blob, entries);
  }

  has(name: string): boolean {
    return this.entries.has(name);
  }

  async blobOf(name: string): Promise<Blob> {
    const entry = this.entries.get(name);
    if (!entry) throw new ZipError(`Missing file in bundle: ${name}`);
    if (entry.method !== 0) {
      throw new ZipError(`Unsupported compression for ${name} (only STORE is supported)`);
    }
    const header = await readRange(
      this.blob,
      entry.localHeaderOffset,
      entry.localHeaderOffset + 30,
    );
    if (header.getUint32(0, true) !== SIG_LOCAL) {
      throw new ZipError(`Corrupt local header for ${name}`);
    }
    const dataStart =
      entry.localHeaderOffset + 30 + header.getUint16(26, true) + header.getUint16(28, true);
    return this.blob.slice(dataStart, dataStart + entry.compressedSize);
  }

  async bytesOf(name: string): Promise<Uint8Array> {
    const blob = await this.blobOf(name);
    return new Uint8Array(await blob.arrayBuffer());
  }

  async textOf(name: string): Promise<string> {
    return new TextDecoder().decode(await this.bytesOf(name));
  }
}
