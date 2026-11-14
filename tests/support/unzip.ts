// Test-only zip reader (central directory + deflate/stored entries), used to inspect generated workbooks.
import { crc32, inflateRawSync } from "node:zlib";

export function unzip(buf: Buffer): Map<string, { data: Buffer; crcOk: boolean; dosDate: number }> {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error("not a zip: no end-of-central-directory record");
  const count = buf.readUInt16LE(eocd + 10);
  let at = buf.readUInt32LE(eocd + 16);
  const entries = new Map<string, { data: Buffer; crcOk: boolean; dosDate: number }>();
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(at) !== 0x02014b50) throw new Error(`bad central directory entry ${i}`);
    const method = buf.readUInt16LE(at + 10);
    const dosDate = buf.readUInt16LE(at + 14);
    const crc = buf.readUInt32LE(at + 16);
    const size = buf.readUInt32LE(at + 20);
    const nameLength = buf.readUInt16LE(at + 28);
    const extraLength = buf.readUInt16LE(at + 30);
    const commentLength = buf.readUInt16LE(at + 32);
    const local = buf.readUInt32LE(at + 42);
    const name = buf.subarray(at + 46, at + 46 + nameLength).toString("utf8");
    const dataStart = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(dataStart, dataStart + size);
    const data = method === 8 ? inflateRawSync(raw) : Buffer.from(raw);
    entries.set(name, { data, crcOk: crc32(data) === crc, dosDate });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}
