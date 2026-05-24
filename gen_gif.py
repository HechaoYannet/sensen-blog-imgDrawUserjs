import base64, struct, sys

def build_frame(w, h, color_idx, delay_cs):
    """Build a single frame for animated GIF."""
    data = bytearray()

    # Graphic Control Extension
    data += b'\x21\xF9\x04\x04'
    data += struct.pack('<H', delay_cs)
    data += b'\x00\x00'

    # Image Descriptor
    data += b'\x2C'  # image descriptor marker
    data += struct.pack('<HHHH', 0, 0, w, h)
    data += b'\x81'  # local color table (size=2 -> 4 entries, bit 7=1)

    # Local color table: index 0 = black, index 1 = color
    colors = {
        0: (255, 80, 80),   # red
        1: (80, 80, 255),   # blue
        2: (80, 255, 80),   # green
    }
    r, g, b = colors.get(color_idx, colors[0])
    data += bytes([0, 0, 0, r, g, b, 0, 0, 0, 0, 0, 0])

    # Image data (LZW encoded)
    min_code = 2
    raw = bytes([1]) * w * h  # all pixels use color index 1

    # LZW encode for a single-color image
    clear_code = 4
    eoi_code = 5
    bits = []
    code_size = 3  # min_code_size + 1

    def out(code):
        nonlocal code_size, bits
        for i in range(code_size):
            bits.append((code >> i) & 1)
        if code >= (1 << code_size) - 1 and code_size < 12:
            code_size += 1

    out(clear_code)
    out(1)  # color index 1
    out(eoi_code)

    # Pack bits to bytes
    lzw = bytearray()
    for i in range(0, len(bits), 8):
        b = 0
        for j in range(8):
            if i + j < len(bits):
                b |= bits[i + j] << j
        lzw.append(b)

    data += bytes([min_code])
    # Sub-blocks (max 255)
    lzw_bytes = bytes(lzw)
    for i in range(0, len(lzw_bytes), 255):
        block = lzw_bytes[i:i+255]
        data += bytes([len(block)])
        data += block
    data += b'\x00'

    return bytes(data)

def build_animated_gif(frames_info, w=10, h=10):
    """frames_info: list of (color_idx, delay_cs)"""
    buf = bytearray()

    # GIF header
    buf += b'GIF89a'

    # Logical Screen Descriptor
    buf += struct.pack('<HH', w, h)
    buf += b'\x00\x00\x00'

    # Netscape looping extension
    buf += b'\x21\xFF\x0bNETSCAPE2.0\x03\x01\x00\x00\x00\x00'

    for color_idx, delay in frames_info:
        buf += build_frame(w, h, color_idx, delay)

    # Trailer
    buf += b'\x3B'
    return bytes(buf)

# Generate test GIF: 10x10, red->blue->green, 50cs each
gif = build_animated_gif([(0, 50), (1, 50), (2, 50)], 10, 10)

b64 = base64.b64encode(gif).decode()
print(f'GIF bytes: {len(gif)}')
print(f'DATA_URL: data:image/gif;base64,{b64[:60]}...')

with open('TestImg/test_anim.gif', 'wb') as f:
    f.write(gif)
print('Written to TestImg/test_anim.gif')
print('DONE')
