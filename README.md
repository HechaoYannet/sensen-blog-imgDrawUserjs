# 签名墙 - 图片上传

油猴脚本，为[森森的博客签名墙](https://msensen.top/signature-wall/)添加图片上传功能。

## 功能

- 注入「上传图片」按钮（蓝底圆角，和原站风格一致）
- 图片等比缩放居中绘制到画布
- 桌面端 3 列布局，移动端自适应单列
- 走原站提交流程，无需额外配置

## 测试

- 直接打开森森的博客测试就好，森森是不会生气的😄
- 我贴心的为大家准备了测试图片，就在 `/TestImg/*` 下面哦~

<img src="https://github.com/HechaoYannet/sensen-blog-imgDrawUserjs/blob/master/TestImg/Castorice-luma.jpg?raw=true" width="210px">
<img src="https://github.com/HechaoYannet/sensen-blog-imgDrawUserjs/blob/master/TestImg/Phainon-lu.jpg?raw=true" width="210px">

## 安装

1. 安装 [Tampermonkey](https://www.tampermonkey.net/)或微软插件商店
2. 将 `signature-wall-upload.user.js`拖入浏览器或Tampermonkey脚本安装页，Tampermonkey 自动弹出安装
3. 访问 https://msensen.top/signature-wall/ 使用
