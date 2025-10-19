# Gilbert Image Muddle Tool

这是一个基于 Web 的图像混淆工具。它通过一种结合了低分辨率预览和基于 Gilbert 空间填充曲线的像素置换算法，对图像进行加扰。

该工具的核心思想是将图像的大部分像素打乱，但在图像的左上角保留一个低分辨率的“预览图”。所有用于解密（恢复原图）的必要参数（如瓦片大小、步长、密钥等）都会被序列化为 JSON，并直接嵌入到输出的 PNG 图像的元数据 (`iTXt` 块) 中。

这意味着任何拥有此工具的人都可以加载这张被混淆的 PNG 图像，工具会自动读取元数据，并允许用户将其完美地解码回原始状态。

体验地址：[https://gilbert.idlecloud.cc](https://gilbert.idlecloud.cc)

## 核心概念

当你使用此工具编码一张图片时，会发生以下情况：

1.  **生成预览：** 工具会从原图中按设定的`步长`（Stride）提取`瓦片`（Tile），并将它们拼接成一个低分辨率的预览图，放置在画布的左上角。
2.  **置换像素：**
    * 工具使用 Gilbert 空间填充曲线生成一个遍历整个图像的像素路径。
    * 它定义了两个像素集合：`source`（所有**不**属于原始预览瓦片的像素）和 `dest`（所有**不**在左上角预览区域内的像素）。
    * 它使用一个基于`密钥`（Key）的循环位移算法，将 `source` 集合中的像素加扰后，填充到 `dest` 集合的位置上。
3.  **嵌入元数据：** 所有参数（瓦片大小、步长、密钥、填充模式等）都被写入 PNG 文件的元数据中，以便后续解码。

最终，你得到的是一张左上角是低清预览、其余部分是加密数据的“混淆图”。

## 主要功能

* **图像混淆：** (`encodeGilbert`) 将清晰的源图像转换为“预览+加扰”的格式。
* **图像解混淆：** (`decodeGilbert`) 从混淆图像中恢复原始图像。
* **嵌入式元数据：** (`png-meta.js`) 使用 PNG `iTXt` 块来存储和读取解码所需的所有参数。
* **可调参数：**
    * **Tile Size:** 瓦片大小。该值越小，预览图越清晰（但计算量越大）。
    * **Stride:** 步长。该值越小，预览图占用的瓦片越多，预览图尺寸越大。
    * **Key:** 密钥。一个数字，用作加扰置换的种子。
    * **Pad 模式:** 图像尺寸不满足瓦片整除时的填充方式（`edge` 复制边缘或 `constant` 填充透明）。
* **智能水印：** (`applyTextWatermark` / `restoreWatermark`)
    * 允许用户在**混淆后**的图像上添加文本水印。
    * 该功能会将被水印覆盖的**原始加扰像素**保存到元数据中。
    * 在解码时，它会先使用保存的像素**移除水印**，然后再执行解混淆，确保水印不会干扰解码过程。
* **Web 界面：** (`page.js`)
    * 一个使用 React (Next.js) 和 MUI 构建的完整前端。
    * 支持拖放、粘贴和文件选择来加载图像。
    * 使用 Canvas API 进行所有图像处理。
    * 提供参数滑块、按钮和状态显示。

## 项目部署教程

### 1\. 本地环境设置与构建

在部署之前，您需要先在本地正确设置项目并运行构建。

**A. 项目初始化**

1.  克隆该项目：

    ```bash
    git clone https://github.com/YILING0013/image-muddle-web.git
    ```

2.  进入项目目录：

    ```bash
    cd image-muddle-web
    ```

**B. 安装依赖**

该项目依赖 MUI。您需要安装 MUI 及其对等依赖项：

```bash
npm install @mui/material @emotion/react @emotion/styled @mui/icons-material
```

**C. 构建项目**

完成以上步骤后，运行生产构建命令：

```bash
npm run build
```

这会生成一个 `.out` 文件夹，其中包含所有用于部署的优化过的静态资源。如果要进行自动化部署，在进行下面步骤前，你需要自行修改`next.config.mjs`文件。

### 2\. 部署方案

#### 方案一：Vercel (推荐)

Vercel 是 Next.js 的创建者，提供了最简单、最优化的部署体验。

1.  将您的项目代码推送到一个 Git 仓库 (如 GitHub, GitLab)。
2.  登录 Vercel，选择 "Import Project"。
3.  选择您刚刚推送的 Git 仓库。
4.  Vercel 会自动识别这是一个 Next.js 项目。
5.  点击 "Deploy"。Vercel 将自动拉取代码、执行 `npm run build` 并将其部署到全球 CDN。

#### 方案二：宝塔面板 (Baota) / 传统 VPS

此方案将 Next.js 作为一个独立的 Node.js 服务运行，并使用宝塔作为反向代理。

1.  **上传文件：**
      * 修改修改`next.config.mjs`文件，移除有关打包为静态文件的相关参数，之后运行`npm run build`生成`.next`文件。
      * 将您本地的整个项目文件夹（包括 `node_modules`、`.next` 和 `package.json` 等）上传到服务器的指定目录（例如 `/www/wwwroot/gilbert-tool`）。
      * *（或者，您可以在服务器上拉取代码并运行 `npm install` 和 `npm run build`，这是更好的做法）。*

2.  **启动服务：**
    Next.js 的生产服务通过 `next start` 启动。

    ```bash
    npm run start
    ```

    *默认情况下，这会启动一个监听 `localhost:3000` 的 Node.js 服务器。*

3.  **使用 PM2 进行进程守护 (推荐)：**
    为了确保服务在崩溃或服务器重启后能自动运行，请使用 `pm2`。

    ```bash
    # 全局安装 pm2
    npm install pm2 -g

    # 进入项目目录
    cd /www/wwwroot/gilbert-tool

    # 使用 pm2 启动服务
    pm2 start npm --name "gilbert-tool" -- run start
    ```

4.  **设置宝塔反向代理：**
    a.  登录宝塔面板，点击“网站” -\> “添加站点”。
    b.  输入您的域名（例如 `gilbert.yourdomain.com`）。**PHP 版本选择“纯静态”**，数据库不需要创建。
    c.  提交后，打开该站点的“设置”。
    d.  选择“反向代理” -\> “添加反向代理”。
    e.  **目标 URL** 填写 `http://localhost:3000`。
    f.  点击“提交”。

完成以上步骤后，宝塔面板会将所有访问您域名的公开请求（80/443 端口）转发到 `pm2` 守护的、运行在 3000 端口的 Next.js 服务上。

## 技术工作流

### 编码 (handleEncode)

1.  **加载：** 用户加载一张原始图片 (`originalImageData`)。
2.  **混淆：** 调用 `encodeGilbert(originalImageData, params)`：
    * 根据 `tile_size` 填充图像 (`padToMultiple`)。
    * 根据 `stride` 复制瓦片到左上角，生成预览。
    * 生成 `gilbert2d` 路径。
    * 确定 `source`（非预览瓦片）和 `dest`（非预览区域）像素索引。
    * 计算 `phiOffset` 循环位移量。
    * 将 `source` 像素按位移量写入 `dest` 位置，生成混淆的 `ImageData` 和 `meta` 对象。
3.  **(可选) 水印：** 如果用户输入了水印文本，调用 `applyTextWatermark`：
    * 在混淆图像上绘制文本。
    * 将被覆盖的像素保存到 `watermarkMeta` 中。
    * 将 `watermarkMeta` 添加到主 `meta` 对象中。
4.  **写入画布：** 将最终的 `ImageData` (带或不带水印) 绘制到 `<canvas>`。
5.  **嵌入元数据：**
    * 将 `meta` 对象 `JSON.stringify`。
    * 调用 `embedMetaITXt(pngBlob, PNG_META_KEY, json)` 将元数据字符串注入 PNG blob。
6.  **完成：** `currentBlob` 更新为带有元数据的混淆 PNG。

### 解码 (handleDecode)

1.  **加载：** 用户加载一张**混淆过**的 PNG 图片。
2.  **提取元数据：** `handleFile` 自动调用 `extractMeta(file, PNG_META_KEY)`。
    * 如果成功，解析 JSON 并将其存储在 `meta` 状态中。
    * 画布显示这张混淆的图片。
3.  **(可选) 恢复水印：** 用户点击“解混淆”按钮。
    * 检查 `meta?.watermark`是否存在。
    * 如果存在，调用 `restoreWatermark(muddledData, meta.watermark)`，使用元数据中存储的像素覆盖掉水印区域，得到一张“干净”的混淆图。
4.  **解混淆：** 调用 `decodeGilbert(cleanMuddledData, meta)`：
    * 根据 `meta.preview_tiles` 将左上角的预览瓦片复制回其原始位置。
    * 重新生成 `gilbert2d` 路径、`source` 和 `dest` 索引。
    * 应用**反向**循环位移，将 `dest` 像素写回 `source` 位置。
    * 根据 `meta.orig_size` 裁剪掉填充部分。
5.  **完成：** 将恢复的 `ImageData` 写入画布，`meta` 状态被清除。

## 项目文件结构

* `page.js`:
    * 主要的 React/MUI 前端组件。
    * 处理 UI 状态、事件（点击、拖放、粘贴）和业务流程编排。
* `muddle.js`:
    * 核心混淆/解混淆算法 (`encodeGilbert`, `decodeGilbert`)。
    * 实现了预览生成、像素置换和填充逻辑。
* `gilbert.js`:
    * `gilbert2d` 函数的实现，用于生成 Gilbert 空间填充曲线的坐标。
* `png-meta.js`:
    * 用于操作 PNG 文件块的底层工具。
    * `embedMetaITXt` 和 `extractMeta` 负责将 JSON 元数据写入和读出 `iTXt` 块。

## 如何使用

1.  **加载图像：** 打开网页。将本地图像文件（PNG, JPG 等）拖放到虚线框内，或点击按钮选择文件，或直接从剪贴板粘贴图像。
2.  **配置参数（编码时）：**
    * **Tile Size:** 预览瓦片的大小（像素）。
    * **Stride:** 采样瓦片的步长（格子数）。
    * **Key:** 用于加扰的数字密钥。
    * **(可选) 文本水印：** 输入要在混淆图上显示的文本。
3.  **执行操作：**
    * **混淆：** 如果当前是原图（`meta` 为 `null`），点击“混淆”按钮。
    * **解混淆：** 如果当前是混淆图（已成功加载 `meta`），点击“解混淆”按钮。
4.  **下载：** 点击“下载图片”按钮，保存画布上当前的图像。
    * 如果下载的是混淆图，它将包含元数据。
    * 如果下载的是解混淆后的图，它将是普通的、不含元数据的 PNG。
5.  **清空：** 点击“清空”按钮以重置所有状态和画布。