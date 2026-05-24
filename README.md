# 签名墙 - 图片上传

油猴脚本，为[森森的博客签名墙](https://msensen.top/signature-wall/)添加图片上传与 GIF 动图功能。

## 功能

- 注入「上传图片」按钮，自动判断文件类型
- **静态图：** 等比缩放 → Canvas → 可继续手绘 → 点「贴到墙上」走原站流程
- **GIF 动图：** 纯 JS 解析 → APNG 编码 → 劫持「贴到墙上」提交 → 动图上墙
- 桌面端 3 列布局，移动端自适应单列
- 匹配原站 Astro 样式，不破坏视觉一致性

## 测试

- 直接打开森森的博客测试就好，森森是不会生气的😄
- 我贴心的为大家准备了测试图片哦~
- 静态图测试：`/TestImg/` 下有 Castorice 和 Phainon 的表情图
- 动图测试：`/TestGif/` 下有奶龙 GIF（52 帧）

<img src="https://github.com/HechaoYannet/sensen-blog-imgDrawUserjs/blob/master/TestImg/Castorice-luma.jpg?raw=true" width="210px">
<img src="https://github.com/HechaoYannet/sensen-blog-imgDrawUserjs/blob/master/TestImg/Phainon-lu.jpg?raw=true" width="210px">

## 安装

1. 安装 [Tampermonkey](https://www.tampermonkey.net/) 或微软插件商店
2. 将 `signature-wall-upload.user.js` 拖入浏览器，Tampermonkey 自动弹出安装/更新
3. 访问 https://msensen.top/signature-wall/ 使用

## 技术报告

- [v1.0 报告：手残党也能传图了](report.md)
- [v2.1 报告：奶龙攻占签名墙](reportv2.md)

## 依赖

脚本通过 Tampermonkey `@require` 加载以下 CDN 库（APNG 编码用）：
- [pako](https://github.com/nodeca/pako) — zlib 压缩
- [UPNG.js](https://github.com/photopea/UPNG.js) — APNG 编码

GIF 解析器完全内联，零外部依赖。
