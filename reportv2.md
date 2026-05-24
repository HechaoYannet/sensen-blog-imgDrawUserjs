## [渗透报告续] 奶龙攻占签名墙：GIF 也能动起来了

**漏洞编号：** CVE-2026-你画我猜·续  
**严重等级：** 🤡🤡 双倍低危（森森看完沉默，我笑得更灿烂了）  
**受影响版本：** 森の签名墙 v1.0（仍未被修复，令人感动）  
**前置阅读：** [上期报告](https://github.com/HechaoYannet/sensen-blog-imgDrawUserjs/blob/master/report.md)

---

### 缘起

那天晚上，我和森森在 QQ 上对着小草神的立绘指指点点——这张光影不行，那张表情不够涩。正当剑拔弩张之际，森森突然甩过来一张**奶龙教培专用 GIF**，然后问了一句改变历史的话：

> "能把这个传到签名墙上吗？要会动的那种。"

我沉默了三秒。

第一秒：Canvas 只能抓单帧，动图上去也是静态的。  
第二秒：但 API 收的是 base64，它不管帧数。  
第三秒：开干。

---

### 勘探：三条路线，两死一生

#### 路线 1：GIF 直传 💀

把 GIF 文件直接转 base64，MIME 标 `image/gif`，POST 给 API。

```python
# 满怀信心地发送
data_url = "data:image/gif;base64,R0lGODlh..."
```

服务器冷冰冰地回了句：**"签名图片格式不支持"**。

行吧，nginx 后面那个 Node.js 它不是傻子。

#### 路线 2：Animated WebP ✅

心想 WebP 不是你们自己选的首选格式么。拿 Pillow 把 GIF 52 帧全转成 animated WebP，240KB，`data:image/webp;base64,...` 发过去。

**HTTP 201 Created。** 52 帧一个没少。

打开返回的 URL——奶龙在墙上动起来了。

但有一个小问题：浏览器没有内置的 animated WebP 编码器。这玩意儿只能在服务端或用 Pillow/ffmpeg 转，**油猴脚本做不到纯浏览器端 GIF→WebP 转换**。

#### 路线 3：APNG（最终方案）✅

APNG 本质是 PNG 的扩展。MIME 标 `image/png`，服务器当普通 PNG 收，完全不设防。而浏览器 `<img>` 标签天然支持 APNG 动画——这是 2017 年就加入标准的东西。

于是整个流程变成了：

```
GIF 文件
  → 纯 JS GIF 解析器（~200 行，自写，0 依赖）
  → 逐帧提取 RGBA 像素
  → pako 压缩 + UPNG.js 编码 = APNG
  → data:image/png;base64,...
  → POST /api/signature-wall/signatures
  → 奶龙在墙上。会动。
```

52 帧奶龙，300×216 → 缩放到 200×144 → APNG 299KB → 上传成功。服务器存成 `.png`，Content-Type 老老实实写 `image/png`，浏览器 `<img>` 打开——动画完美。

---

### 踩坑记录

**Nginx 413 暗藏杀机。** 签名墙前面有个 nginx，默认 `client_max_body_size` 大约 1MB。第一次没缩放，APNG 膨胀到 1.4MB，直接被拦在门外。把 GIF 缩到 200px 宽才控制在 300KB 以内。

**Canvas 的肮脏秘密。** `canvas.toBlob()` 只支持 `image/png`、`image/jpeg`、`image/webp`——没有 `image/gif`。而且就算你画了一个 52 帧的 GIF 到 canvas 上，`toBlob()` 也只给你第一帧。所以"把 GIF 画到 canvas 上再提交"这条路永远不会通——必须绕过 canvas，直接 POST。

**Astro 的 CSS 作用域再次阴人。** `data-astro-cid-3pxndrdx` 这个属性我已经刻在 DNA 里了，这次没忘。

---

### 升级后的脚本 v2.1

相比 v1.0（只能传静态图），新版本的核心改进：

- **一个按钮搞定一切。** 「上传图片」按钮自动判断文件类型：静态图走 Canvas，GIF 走 APNG 转换
- **不跳过用户确认。** GIF 选择后显示首帧预览，**必须填昵称 + 点「贴到墙上」才会提交**，不会偷偷发出去
- **劫持提交而非绕过。** 在 form 父元素上挂 capturing 监听器，检测到待提交 GIF 时拦截原站处理器，走自己的上传逻辑。没有 GIF 时完全不影响原站行为
- **零外部 GIF 依赖。** GIF 解析器纯手写，所有帧提取、LZW 解码、隔行处理都在 200 行内完成。外部依赖只有 `pako`（zlib）和 `UPNG.js`（APNG 编码）

---

### 限制

- GIF 超过 200 帧会提示精简（再多也没有，谁家 GIF 200 帧）
- 最终 APNG 超过 900KB 会拒绝（nginx 不吃这套）
- 首帧作为预览显示在 canvas 上，但 GIF 本身走的是独立上传通道，canvas 上的修改不会影响最终动图

---

### 修复建议（更新版）

**方案 A（仍然推荐）：** 继续假装没看见。反正签名墙上现在已经有一只奶龙在动了，它很快乐。

**方案 B（升级版）：** 
- 后端校验 MIME 白名单并实际检查文件 magic bytes（现在我们传的 `.png` 其实是 APNG，magic bytes 和 PNG 一样，所以这招防不住）
- 限制 API 请求体到 1MB 以下（已经有 nginx 在做了，但 300KB 的 APNG 刚好滑过去了）
- 对上传图片做二次压缩/转码以剥离 APNG 动画帧（这需要服务端图像处理，工作量 ≈ 一篇小论文）

---

### 结语

以上所有操作均持续获得站点所有者口头授权（*"你能传上去算你厉害"*——森森，2026年某月某深夜，QQ 语音）。

本次实验证明了三条计算机科学基本原理：
1. 后端永远不要信任客户端的 MIME type
2. `.png` 不等于静止图片
3. 深夜不要随便问程序员"能不能"

脚本已更新至 [GitHub](https://github.com/HechaoYannet/sensen-blog-imgDrawUserjs)，Tampermonkey 用户拖入即可覆盖升级。

—— 一个深夜被奶龙 GIF 召唤的程序员 🐉
