"""Convert GIF to animated WebP and test upload to signature wall API."""
import json, urllib.request, base64, sys, os
from PIL import Image, ImageSequence

GIF_PATH = "Nailong.gif"
OUT_PATH = "test_anim.webp"
API_URL = "https://msensen.top/api/signature-wall/signatures"

# ── Step 1: Convert GIF to animated WebP ────────────────────────
print(f"[1] Loading {GIF_PATH}...")
gif = Image.open(GIF_PATH)

# Extract frames
frames = []
durations = []
try:
    while True:
        frame = gif.copy().convert("RGBA")
        duration = gif.info.get("duration", 100)  # ms
        frames.append(frame)
        durations.append(duration)
        gif.seek(gif.tell() + 1)
except EOFError:
    pass

print(f"    {len(frames)} frames extracted")

# Resize if too large (target ~500KB total)
# Estimate: if image is large, scale down
orig_w, orig_h = frames[0].size
if orig_w * orig_h > 80000:  # > ~300x300
    scale = (80000 / (orig_w * orig_h)) ** 0.5
    new_w, new_h = int(orig_w * scale), int(orig_h * scale)
    frames = [f.resize((new_w, new_h), Image.LANCZOS) for f in frames]
    print(f"    Resized: {orig_w}x{orig_h} -> {new_w}x{new_h}")

# Save as animated WebP
frames[0].save(
    OUT_PATH,
    save_all=True,
    append_images=frames[1:],
    duration=durations,
    loop=0,
    format="WEBP",
    quality=60,  # lower quality to reduce size
    minimize_size=True,
)
webp_size = os.path.getsize(OUT_PATH)
print(f"    Saved: {OUT_PATH} ({webp_size} bytes)")

# ── Step 2: Encode to base64 data URL ───────────────────────────
with open(OUT_PATH, "rb") as f:
    b64 = base64.b64encode(f.read()).decode()
data_url = f"data:image/webp;base64,{b64}"
print(f"[2] Data URL length: {len(data_url)} chars")

# ── Step 3: POST to API ─────────────────────────────────────────
payload = json.dumps({
    "nickname": "WebP动图测试",
    "imageDataUrl": data_url,
    "website": "",
}).encode()

print(f"[3] POSTing to {API_URL}...")
req = urllib.request.Request(
    API_URL, data=payload,
    headers={"Content-Type": "application/json"},
    method="POST",
)

try:
    with urllib.request.urlopen(req, timeout=30) as resp:
        body = resp.read().decode()
        data = json.loads(body)
        print(f"    HTTP {resp.status} - SUCCESS!")
        print(f"    Response: {json.dumps(data, indent=2, ensure_ascii=False)}")
        if data.get("signature", {}).get("imageUrl"):
            img_url = data["signature"]["imageUrl"]
            print(f"\n[4] Image URL: {img_url}")
            print(f"    Open this in browser to check if animated!")
except urllib.error.HTTPError as e:
    body = e.read().decode()
    print(f"    HTTP {e.code} - FAILED")
    print(f"    Response: {body}")
except Exception as e:
    print(f"    Error: {e}")
