"""Test APNG upload to signature wall API using pure Python."""
import json, urllib.request, base64, struct, zlib, os

GIF_PATH = "Nailong.gif"
API_URL = "https://msensen.top/api/signature-wall/signatures"

# ── Minimal GIF parser ──────────────────────────────────────────
def parse_gif(path):
    with open(path, 'rb') as f:
        data = f.read()

    pos = 6  # skip GIF89a header
    w = struct.unpack('<H', data[pos:pos+2])[0]; pos += 2
    h = struct.unpack('<H', data[pos:pos+2])[0]; pos += 2
    flags = data[pos]; pos += 1
    pos += 1 + 1  # bg color + aspect
    has_gct = flags & 0x80
    if has_gct:
        gct_size = 3 * (2 << (flags & 0x07))
        gct = data[pos:pos+gct_size]; pos += gct_size

    frames = []
    delays = []
    gct_data = gct if has_gct else None
    transparent_idx = -1
    disposal = 0

    while pos < len(data):
        block_type = data[pos]; pos += 1
        if block_type == 0x3B:  # trailer
            break
        elif block_type == 0x2C:  # image descriptor
            left = struct.unpack('<H', data[pos:pos+2])[0]; pos += 2
            top  = struct.unpack('<H', data[pos:pos+2])[0]; pos += 2
            iw   = struct.unpack('<H', data[pos:pos+2])[0]; pos += 2
            ih   = struct.unpack('<H', data[pos:pos+2])[0]; pos += 2
            flags2 = data[pos]; pos += 1
            has_lct = flags2 & 0x80
            lct = None
            if has_lct:
                lct_size = 3 * (2 << (flags2 & 0x07))
                lct = data[pos:pos+lct_size]; pos += lct_size
            interlace = bool(flags2 & 0x40)

            # Read LZW image data
            min_code_size = data[pos]; pos += 1
            lzw_data = bytearray()
            while True:
                block_len = data[pos]; pos += 1
                if block_len == 0: break
                lzw_data += data[pos:pos+block_len]; pos += block_len

            # Decode LZW
            palette = lct if lct else gct_data
            pixels = decode_gif_lzw(w, h, bytes(lzw_data), min_code_size, palette, transparent_idx, interlace)
            frames.append((iw, ih, left, top, pixels, disposal))
            if delays:
                delays.append(delays[-1])
        elif block_type == 0x21:  # extension
            ext_type = data[pos]; pos += 1
            if ext_type == 0xF9:  # graphic control
                _ = data[pos]; pos += 1  # block size (always 4)
                packed = data[pos]; pos += 1
                delay = struct.unpack('<H', data[pos:pos+2])[0]; pos += 2
                transparent_idx = data[pos] if (packed & 0x01) else -1; pos += 1
                disposal = (packed >> 2) & 0x07
                delays.append(delay)
                pos += 1  # block terminator
            elif ext_type == 0xFF:  # application
                while True:
                    block_len = data[pos]; pos += 1
                    if block_len == 0: break
                    pos += block_len
            elif ext_type == 0xFE:  # comment
                while True:
                    block_len = data[pos]; pos += 1
                    if block_len == 0: break
                    pos += block_len
            else:
                while True:
                    block_len = data[pos]; pos += 1
                    if block_len == 0: break
                    pos += block_len
        else:
            break

    return w, h, frames, delays

def decode_gif_lzw(w, h, data, min_code_size, palette, transparent, interlace):
    clear_code = 1 << min_code_size
    eoi_code = clear_code + 1
    code_size = min_code_size + 1
    max_code = (1 << code_size) - 1

    bits = []
    for byte in data:
        for i in range(8):
            bits.append((byte >> i) & 1)

    pos = 0
    pixels = bytearray(w * h * 4)
    color_table = []
    output = []

    def read_code():
        nonlocal pos, code_size, max_code
        code = 0
        for i in range(code_size):
            if pos >= len(bits): return -1
            code |= bits[pos] << i
            pos += 1
        return code

    # Initialize table
    table = {}
    next_code = eoi_code + 1
    for i in range(clear_code):
        table[i] = [i]

    prev = None
    frame_pixels = bytearray()

    while True:
        code = read_code()
        if code < 0 or code == eoi_code:
            break
        if code == clear_code:
            table = {i: [i] for i in range(clear_code)}
            next_code = eoi_code + 1
            code_size = min_code_size + 1
            max_code = (1 << code_size) - 1
            prev = None
            continue

        if code in table:
            entry = table[code]
        elif code == next_code and prev is not None:
            entry = prev + [prev[0]]
        else:
            break

        frame_pixels += bytes(entry)

        if prev is not None and next_code < 4096:
            table[next_code] = prev + [entry[0]]
            next_code += 1
            if next_code > max_code and code_size < 12:
                code_size += 1
                max_code = (1 << code_size) - 1

        prev = entry

    # Convert indexed pixels to RGBA
    for i, idx in enumerate(frame_pixels):
        if len(palette) > idx * 3 + 2:
            r, g, b = palette[idx*3], palette[idx*3+1], palette[idx*3+2]
            a = 0 if idx == transparent else 255
        else:
            r, g, b, a = 0, 0, 0, 255
        pi = i * 4
        if pi + 3 < len(pixels):
            pixels[pi] = r; pixels[pi+1] = g; pixels[pi+2] = b; pixels[pi+3] = a

    return bytes(pixels)


# ── APNG encoder ────────────────────────────────────────────────
def make_chunk(ctype, data):
    c = ctype + data
    return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c) & 0xFFFFFFFF)

def encode_apng(frames_data, w, h, delays):
    """frames_data: list of (rgba_bytes, w, h)"""
    buf = bytearray()

    # PNG signature
    buf += b'\x89PNG\r\n\x1a\n'

    # IHDR
    ihdr = struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)  # 8bit RGBA
    buf += make_chunk(b'IHDR', ihdr)

    # acTL
    actl = struct.pack('>II', len(frames_data), 0)
    buf += make_chunk(b'acTL', actl)

    for i, (rgba, fw, fh, left, top, disposal) in enumerate(frames_data):
        seq_extra = 0
        if i == 0:
            seq_extra = 0  # first frame: IDAT (implied fcTL with sequence 0)

        # fcTL: seq, w, h, x, y, delay_num, delay_den, dispose_op, blend_op
        delay_cs = delays[i] if i < len(delays) else 10
        delay_cs = max(1, min(65535, delay_cs or 10))
        if i == 0:
            fctl = struct.pack('>IIIIIHHBB', 0, fw, fh, 0, 0, delay_cs, 100, 0, 0)
        else:
            fctl = struct.pack('>IIIIIHHBB', i, fw, fh, left, top, delay_cs, 100, 0, 0)
        buf += make_chunk(b'fcTL', fctl)

        # Image data for this frame
        raw = bytearray()
        for y in range(fh):
            raw.append(0)  # filter none
            row_start = y * fw * 4
            raw += rgba[row_start:row_start + fw * 4]

        compressed = zlib.compress(bytes(raw))
        if i == 0:
            buf += make_chunk(b'IDAT', compressed)
        else:
            buf += make_chunk(b'fdAT', struct.pack('>I', i) + compressed)

    # IEND
    buf += make_chunk(b'IEND', b'')
    return bytes(buf)


# ── Resize ──────────────────────────────────────────────────────
def resize_rgba(src, sw, sh, dw, dh):
    dst = bytearray(dw * dh * 4)
    xr, yr = sw / dw, sh / dh
    for dy in range(dh):
        for dx in range(dw):
            sx, sy = int(dx * xr), int(dy * yr)
            si = (sy * sw + sx) * 4
            di = (dy * dw + dx) * 4
            dst[di:di+4] = src[si:si+4]
    return bytes(dst)


# ── Main ────────────────────────────────────────────────────────
print("[1] Parsing GIF...")
gif_w, gif_h, frames, delays = parse_gif(GIF_PATH)
print(f"    {gif_w}x{gif_h}, {len(frames)} frames")

# Build composite frames (handle disposal/frame positioning)
MAX_PX = 200
scale = min(1.0, MAX_PX / max(gif_w, gif_h))
ow, oh = max(1, round(gif_w * scale)), max(1, round(gif_h * scale))

canvas = bytearray(ow * oh * 4)
apng_frames = []

for i, (fw, fh, left, top, rgba, disposal) in enumerate(frames):
    if i == 0:
        canvas[:] = bytearray(ow * oh * 4)

    # Scale frame position and size
    sl = round(left * scale)
    st = round(top * scale)
    sfw = round(fw * scale)
    sfh = round(fh * scale)
    srgba = resize_rgba(rgba, fw, fh, sfw, sfh) if (fw != sfw or fh != sfh) else rgba

    # Composite onto canvas
    for y in range(sfh):
        if st + y >= oh: break
        for x in range(sfw):
            if sl + x >= ow: break
            si = (y * sfw + x) * 4
            di = ((st + y) * ow + (sl + x)) * 4
            if si + 3 < len(srgba) and di + 3 < len(canvas):
                a = srgba[si + 3]
                if a > 128:
                    canvas[di:di+4] = srgba[si:si+4]

    apng_frames.append((bytes(canvas), ow, oh, 0, 0, disposal))

    if disposal == 2:  # restore to background
        for y in range(sfh):
            if st + y >= oh: break
            for x in range(sfw):
                if sl + x >= ow: break
                di = ((st + y) * ow + (sl + x)) * 4
                if di + 3 < len(canvas):
                    canvas[di:di+4] = b'\x00\x00\x00\x00'

print(f"    Scaled to {ow}x{oh}")

print("[2] Encoding APNG...")
apng = encode_apng(apng_frames, ow, oh, delays)
print(f"    APNG size: {len(apng)} bytes ({len(apng)/1024:.0f}KB)")

if len(apng) > 5 * 1024 * 1024:
    print("    TOO LARGE, aborting")
    exit(1)

with open('test_anim.apng', 'wb') as f:
    f.write(apng)

print("[3] Uploading to API...")
b64 = base64.b64encode(apng).decode()
data_url = f"data:image/png;base64,{b64}"

payload = json.dumps({
    "nickname": "APNG动图测试",
    "imageDataUrl": data_url,
    "website": "",
}).encode()

req = urllib.request.Request(
    API_URL, data=payload,
    headers={"Content-Type": "application/json"},
    method="POST",
)

try:
    with urllib.request.urlopen(req, timeout=60) as resp:
        body = resp.read().decode()
        data = json.loads(body)
        print(f"    HTTP {resp.status} - SUCCESS!")
        sig = data.get('signature', {})
        print(f"    Image URL: {sig.get('imageUrl', 'N/A')}")
        print(f"    Frames: {len(apng_frames)}, Size: {sig.get('size', 'N/A')} bytes")
        print(f"    Check URL: https://msensen.top{sig.get('imageUrl', '')}")
except urllib.error.HTTPError as e:
    print(f"    HTTP {e.code} - FAILED")
    print(f"    Response: {e.read().decode()}")
