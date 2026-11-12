// Lecteur de ZIP minimal pour les tests (compatible avec l'archive produite par server/zip.ts : sans compression).
import { crc32 } from "node:zlib";

export interface ReadZipEntry { name: string; data: Buffer; crcOk: boolean }

export function readZip(zip: Buffer): ReadZipEntry[] {
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0) throw new Error("Pas une archive ZIP.");
  const count = zip.readUInt16LE(end + 10);
  let pos = zip.readUInt32LE(end + 16);
  const out: ReadZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (zip.readUInt32LE(pos) !== 0x02014b50) throw new Error("En-tête central invalide.");
    const crc = zip.readUInt32LE(pos + 16);
    const size = zip.readUInt32LE(pos + 24);
    const nameLen = zip.readUInt16LE(pos + 28);
    const local = zip.readUInt32LE(pos + 42);
    const name = zip.subarray(pos + 46, pos + 46 + nameLen).toString("utf8");
    const dataStart = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const data = zip.subarray(dataStart, dataStart + size);
    out.push({ name, data, crcOk: crc32(data) === crc });
    pos += 46 + nameLen + zip.readUInt16LE(pos + 30) + zip.readUInt16LE(pos + 32);
  }
  return out;
}
