// Phones held flat over a page often save the photo sideways. Staff lines make
// the ink profile of an upright page spiky down its rows; a sideways page is
// spiky along its columns instead.

const SAMPLE = 800; // analysis size, long side

function inkMask(bitmap) {
  const scale = Math.min(1, SAMPLE / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const ctx = new OffscreenCanvas(w, h).getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0, w, h);
  const px = ctx.getImageData(0, 0, w, h).data;
  const lum = new Float32Array(w * h);
  let mean = 0;
  for (let i = 0; i < w * h; i++) {
    lum[i] = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];
    mean += lum[i];
  }
  mean /= w * h;
  const ink = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) ink[i] = lum[i] < mean * 0.6 ? 1 : 0;
  return { ink, w, h };
}

// Energy of the profile's sharp changes, per unit of ink: high when the
// profile is a comb of thin lines.
function spikiness(profile) {
  let e = 0;
  let total = 0;
  for (let i = 1; i < profile.length; i++) {
    e += (profile[i] - profile[i - 1]) ** 2;
    total += profile[i];
  }
  return total ? e / total : 0;
}

function profiles({ ink, w, h }) {
  const rows = new Float32Array(h);
  const cols = new Float32Array(w);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (ink[y * w + x]) {
        rows[y]++;
        cols[x]++;
      }
    }
  }
  return { rows, cols };
}

// True when the staff lines run top-to-bottom.
export function isSideways(bitmap) {
  const { rows, cols } = profiles(inkMask(bitmap));
  return spikiness(cols) > 1.5 * spikiness(rows);
}

// EXIF orientation tag (1-8) of a JPEG, or 1 if absent.
async function exifOrientation(blob) {
  const v = new DataView(await blob.slice(0, 128 * 1024).arrayBuffer());
  if (v.byteLength < 4 || v.getUint16(0) !== 0xffd8) return 1;
  let p = 2;
  while (p + 4 < v.byteLength) {
    const marker = v.getUint16(p);
    const len = v.getUint16(p + 2);
    if (marker === 0xffe1 && v.getUint32(p + 4) === 0x45786966) {
      const tiff = p + 10;
      const le = v.getUint16(tiff) === 0x4949;
      const ifd = tiff + v.getUint32(tiff + 4, le);
      const count = v.getUint16(ifd, le);
      for (let i = 0; i < count; i++) {
        const e = ifd + 2 + i * 12;
        if (e + 10 > v.byteLength) break;
        if (v.getUint16(e, le) === 0x0112) return v.getUint16(e + 8, le);
      }
      return 1;
    }
    if ((marker & 0xff00) !== 0xff00) break;
    p += 2 + len;
  }
  return 1;
}

const TAG_TURN = { 1: 0, 3: 180, 6: 90, 8: 270 }; // clockwise turn the tag applies

// Makes a phone photo upright. Cameras store the sensor's landscape pixels
// plus an EXIF tag saying how to turn them; held flat over a page, the phone
// can't tell which way is up and writes a landscape tag (1 or 3). The pixels
// are the same as for a portrait shot, which a rear camera turns 90°
// clockwise, so a sideways page gets that turn from its stored pixels.
// Returns the original blob if it's already upright.
export async function uprightPhoto(blob) {
  const shown = await createImageBitmap(blob, { imageOrientation: "from-image" });
  if (!isSideways(shown)) {
    shown.close();
    return blob;
  }
  // Turn needed from the displayed image = 90° minus what the tag already did.
  const turn = (360 + 90 - (TAG_TURN[await exifOrientation(blob)] ?? 0)) % 360;
  return bitmapToBlob(shown, turn === 90 || turn === 270 ? turn : 90);
}

export async function rotateBlob(blob, degrees) {
  return bitmapToBlob(await createImageBitmap(blob, { imageOrientation: "from-image" }), degrees);
}

async function bitmapToBlob(bmp, degrees, type = "image/jpeg") {
  const swap = degrees % 180 !== 0;
  const canvas = new OffscreenCanvas(swap ? bmp.height : bmp.width, swap ? bmp.width : bmp.height);
  const ctx = canvas.getContext("2d");
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((degrees * Math.PI) / 180);
  ctx.drawImage(bmp, -bmp.width / 2, -bmp.height / 2);
  bmp.close();
  return canvas.convertToBlob({ type, quality: 0.92 });
}
