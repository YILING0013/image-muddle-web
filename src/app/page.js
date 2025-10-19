"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Box,
  Container,
  Paper,
  Typography,
  Slider,
  TextField,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Button,
  Card,
  CardContent,
  IconButton,
  Chip,
  Stack,
  useTheme,
  useMediaQuery,
  LinearProgress,
  Alert,
  Divider,
  Tooltip
} from "@mui/material";
import {
  Upload as UploadIcon,
  Download as DownloadIcon,
  Clear as ClearIcon,
  Shuffle as ShuffleIcon,
  Restore as RestoreIcon,
  Info as InfoIcon
} from "@mui/icons-material";

import { encodeGilbert, decodeGilbert } from "@/components/muddle";
import { embedMetaITXt, extractMeta } from "@/components/png-meta";

const PNG_META_KEY = "muddle_meta";

function applyTextWatermark(imgData, {
  text = "DEMO",
  font = "bold 28px system-ui",
  x = 24, y = 24,
  color = [255,255,255,255], // RGBA
  align = "left" // or "center","right"
}) {
  const { width: W, height: H, data: src } = imgData;
  // 用一个离屏 canvas 绘制文本掩码
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const ctx = c.getContext("2d");
  ctx.clearRect(0,0,W,H);
  ctx.font = font;
  ctx.textBaseline = "top";
  ctx.textAlign = align;
  ctx.fillStyle = "rgba(255,255,255,1)";
  ctx.fillText(text, x, y);
  const mask = ctx.getImageData(0,0,W,H).data;

  const out = new Uint8ClampedArray(src); // 拷贝一份用于覆盖
  const idxs = [];               // 线性像素索引（y*W + x）
  const orig = [];               // 原始 RGBA 按顺序平铺

  const [wr,wg,wb,wa] = color;   // 文本颜色
  for (let i=0;i<W*H;i++) {
    const aMask = mask[i*4 + 3]; // 文本掩码 alpha
    if (aMask === 0) continue;

    const oi = i*4;
    // 记录原像素
    orig.push(out[oi], out[oi+1], out[oi+2], out[oi+3]);
    idxs.push(i);

    // 进行 alpha 叠加（把文本颜色叠到原像素上）
    const alpha = (aMask/255) * (wa/255);
    out[oi]   = Math.round(wr*alpha + out[oi]  *(1-alpha));
    out[oi+1] = Math.round(wg*alpha + out[oi+1]*(1-alpha));
    out[oi+2] = Math.round(wb*alpha + out[oi+2]*(1-alpha));
    out[oi+3] = 255;
  }

  // 打包（base64，避免 JSON 膨胀的数字数组）
  const b64 = (u8)=> btoa(String.fromCharCode(...u8));
  const packU32 = (arr)=> {
    const u32 = new Uint32Array(arr);
    return b64(new Uint8Array(u32.buffer));
  };
  const packU8 = (arr)=> b64(Uint8Array.from(arr));

  const watermarkMeta = {
    v: 1,
    kind: "text_overlay",
    size: [W,H],
    text, font, x, y, align, color,
    idxs_b64: packU32(idxs),
    rgba_b64: packU8(orig)
  };

  return { output: new ImageData(out, W, H), watermarkMeta };
}

function restoreWatermark(imgData, wm) {
  const { width: W, height: H, data } = imgData;
  if (!wm || wm.v !== 1 || !wm.idxs_b64 || !wm.rgba_b64) return imgData;

  // 解包
  const fromB64 = (s)=> Uint8Array.from(atob(s), c=>c.charCodeAt(0));
  const idxBytes = fromB64(wm.idxs_b64);
  const rgba = fromB64(wm.rgba_b64);

  const u32 = new Uint32Array(idxBytes.buffer);
  const out = new Uint8ClampedArray(data); // 拷贝一份

  for (let k=0;k<u32.length;k++) {
    const i = u32[k] * 4;
    const o = k*4;
    out[i]   = rgba[o];
    out[i+1] = rgba[o+1];
    out[i+2] = rgba[o+2];
    out[i+3] = rgba[o+3];
  }
  return new ImageData(out, W, H);
}

function hexToRgba(hex) {
  let c;
  if (/^#([A-Fa-f0-9]{3}){1,2}$/.test(hex)) {
    c = hex.substring(1).split('');
    if (c.length === 3) {
      c = [c[0], c[0], c[1], c[1], c[2], c[2]];
    }
    c = '0x' + c.join('');
    return [(c >> 16) & 255, (c >> 8) & 255, c & 255, 255];
  }
  // Default to white if invalid format
  return [255, 255, 255, 255];
}


export default function Page() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));
  
  const [tile, setTile] = useState(8);
  const [stride, setStride] = useState(8);
  const [key, setKey] = useState(2776359982);
  const [padMode, setPadMode] = useState("edge");
  
  // Watermark states
  const [watermarkText, setWatermarkText] = useState("");
  const [watermarkColor, setWatermarkColor] = useState("#FFFFFF");
  const [watermarkX, setWatermarkX] = useState(24);
  const [watermarkY, setWatermarkY] = useState(24);
  const [watermarkAlign, setWatermarkAlign] = useState("left");

  const canvasRef = useRef(null);
  const fileInputRef = useRef(null);
  const [originalImageData, setOriginalImageData] = useState(null);
  const [currentBlob, setCurrentBlob] = useState(null);
  const [meta, setMeta] = useState(null);
  const [status, setStatus] = useState({ type: "info", message: "请载入图片开始使用" });
  const [isProcessing, setIsProcessing] = useState(false);
  const [imageDimensions, setImageDimensions] = useState(null);

  const drawToCanvas = useCallback(async (fileOrBlob, extractedMeta = null) => {
    try {
      setStatus({ type: "info", message: "正在载入图片..." });
      const url = URL.createObjectURL(fileOrBlob);
      const img = new Image();
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = () => reject(new Error("图片载入失败"));
        img.src = url;
      });
      
      const c = canvasRef.current;
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext("2d", { willReadFrequently: true });
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      
      const imageData = ctx.getImageData(0, 0, c.width, c.height);
      setImageDimensions({ width: c.width, height: c.height });
      
      if (!extractedMeta) {
        setOriginalImageData(imageData);
        setMeta(null);
        setStatus({ type: "success", message: `图片已载入: ${c.width}×${c.height}` });
      } else {
        setOriginalImageData(null);
        setMeta(extractedMeta);
        setStatus({ type: "success", message: "已载入混淆图片，并成功解析元数据" });
      }
      
      setCurrentBlob(fileOrBlob);
    } catch (e) {
      setStatus({ type: "error", message: `错误: ${e.message}` });
      console.error(e);
    }
  }, []);

  const handleFile = async (file) => {
    if (!file) return;
    try {
      const metaText = await extractMeta(file, PNG_META_KEY);
      if (metaText) {
        const parsedMeta = JSON.parse(metaText);
        setMeta(parsedMeta);
        await drawToCanvas(file, parsedMeta);
      } else {
        await drawToCanvas(file);
        setMeta(null);
      }
    } catch (e) {
      await drawToCanvas(file);
      setMeta(null);
      console.error("Meta extraction failed:", e);
    }
  };

  const onDrop = useCallback((e) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f) handleFile(f);
  }, []);

  useEffect(() => {
    const onPaste = (e) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const it of items) {
        if (it.type.startsWith("image/")) {
          const b = it.getAsFile();
          if (b) {
            handleFile(b);
            e.preventDefault();
            break;
          }
        }
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);

  const readCanvasImageData = () => {
    const c = canvasRef.current;
    if (!c || c.width === 0 || c.height === 0) return null;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    return ctx.getImageData(0, 0, c.width, c.height);
  };

  const writeCanvas = (imgData) => {
    const c = canvasRef.current;
    c.width = imgData.width;
    c.height = imgData.height;
    const ctx = c.getContext("2d");
    ctx.putImageData(imgData, 0, 0);
    return new Promise(resolve => c.toBlob(resolve, "image/png"));
  };

  const handleEncode = async () => {
    if (!originalImageData) {
      setStatus({ type: "warning", message: "请先载入一张原始图片进行混淆" });
      return;
    }
    setIsProcessing(true);
    setStatus({ type: "info", message: "正在混淆..." });
    try {
      const params = {
        tile_h: tile,
        tile_w: tile,
        stride_y: stride,
        stride_x: stride,
        key,
        pad_mode: padMode
      };
      const { output, meta: newMeta } = encodeGilbert(originalImageData, params);
      
      let out2 = output;
      let meta2 = newMeta;
      
      // 如果用户填了水印文本，就叠加文本并写入元数据
      if (watermarkText?.trim()) {
        const { output: wmOut, watermarkMeta } = applyTextWatermark(output, {
          text: watermarkText,
          x: watermarkX,
          y: watermarkY,
          align: watermarkAlign,
          color: hexToRgba(watermarkColor),
        });
        out2 = wmOut;
        meta2 = { ...newMeta, watermark: watermarkMeta };
      }
      
      const newBlob = await writeCanvas(out2);
      const blobWithMeta = await embedMetaITXt(newBlob, PNG_META_KEY, JSON.stringify(meta2));
      
      setCurrentBlob(blobWithMeta);
      setMeta(meta2);
      setImageDimensions({ width: out2.width, height: out2.height });
      setStatus({ type: "success", message: `混淆完成: ${out2.width}×${out2.height}` });
    } catch (e) {
      console.error(e);
      setStatus({ type: "error", message: `混淆失败: ${e.message || e}` });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDecode = async () => {
    if (!meta) {
      setStatus({ type: "warning", message: "无法解混淆：当前图片没有元数据。请载入一张已混淆的图片" });
      return;
    }
    let muddledData = readCanvasImageData();
    if (!muddledData) {
      setStatus({ type: "error", message: "画布为空，无法解混淆" });
      return;
    }
    setIsProcessing(true);
    setStatus({ type: "info", message: "正在解混淆..." });
    try {
      // 解码前，如果元数据中有水印信息，则先恢复被覆盖的像素
      if (meta?.watermark) {
        muddledData = restoreWatermark(muddledData, meta.watermark);
      }
      
      const restored = decodeGilbert(muddledData, meta);
      const newBlob = await writeCanvas(restored);
      
      setOriginalImageData(restored);
      setCurrentBlob(newBlob);
      setMeta(null);
      setImageDimensions({ width: restored.width, height: restored.height });
      setStatus({ type: "success", message: `解混淆完成: ${restored.width}×${restored.height}` });
    } catch (e) {
      console.error(e);
      setStatus({ type: "error", message: `解混淆失败: ${e.message || e}` });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDownload = () => {
    if (!currentBlob) {
      setStatus({ type: "warning", message: "没有可下载的图片" });
      return;
    }
    const a = document.createElement("a");
    const url = URL.createObjectURL(currentBlob);
    a.href = url;
    a.download = meta ? "muddled.png" : "unmuddled.png";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleClear = () => {
    const c = canvasRef.current;
    if (c) {
      const ctx = c.getContext("2d");
      ctx.clearRect(0, 0, c.width, c.height);
      c.width = 0;
      c.height = 0;
    }
    setOriginalImageData(null);
    setCurrentBlob(null);
    setMeta(null);
    setImageDimensions(null);
    setWatermarkText("");
    setWatermarkColor("#FFFFFF");
    setWatermarkX(24);
    setWatermarkY(24);
    setWatermarkAlign("left");
    setStatus({ type: "info", message: "请载入图片开始使用" });
    setIsProcessing(false);
  };

  const hasImage = !!(canvasRef.current && canvasRef.current.width > 0);

  return (
    <Box
      sx={{
        minHeight: "100vh",
        background: "linear-gradient(135deg, #676767ff 0%, #ffffffff 100%)",
        py: { xs: 2, md: 4 }
      }}
    >
      <Container maxWidth="lg">
        {/* Header */}
        <Paper
          elevation={3}
          sx={{
            p: { xs: 2, md: 3 },
            mb: 3,
            background: "rgba(255, 255, 255, 0.95)",
            backdropFilter: "blur(10px)",
            borderRadius: 2
          }}
        >
          <Stack direction="row" alignItems="center" spacing={2}>
            <Box flex={1}>
              <Typography variant="h4" fontWeight="bold" gutterBottom>
                Gilbert
              </Typography>
              <Typography variant="body2" color="text.secondary">
                结合图像左上角预览与 Gilbert 曲线位移的图片混淆工具。将图片拖入下方区域开始使用。
              </Typography>
            </Box>
          </Stack>
        </Paper>

        <Stack direction={{ xs: "column", md: "row" }} spacing={3}>
          {/* Controls Panel */}
          <Card
            sx={{
              width: { xs: "100%", md: 320 },
              background: "rgba(255, 255, 255, 0.95)",
              backdropFilter: "blur(10px)"
            }}
          >
            <CardContent>
              <Typography variant="h6" fontWeight="bold" gutterBottom>
                参数设置
              </Typography>
              <Divider sx={{ mb: 2 }} />

              <Stack spacing={3}>
                {/* Tile Size */}
                <Box>
                  <Typography variant="body2" color="text.secondary" gutterBottom>
                    Tile Size: {tile}px
                  </Typography>
                  <Typography variant="body2" color="text.secondary" gutterBottom>
                    Stride不变，该值越小预览图越清晰
                  </Typography>
                  <Slider
                    value={tile}
                    onChange={(e, v) => setTile(v)}
                    min={2}
                    max={16}
                    step={2}
                    marks
                    disabled={isProcessing}
                    valueLabelDisplay="auto"
                  />
                </Box>

                {/* Stride */}
                <Box>
                  <Typography variant="body2" color="text.secondary" gutterBottom>
                    Stride: {stride}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" gutterBottom>
                    Tile Size不变，该值越小预览图越大
                  </Typography>
                  <Slider
                    value={stride}
                    onChange={(e, v) => setStride(v)}
                    min={2}
                    max={16}
                    step={2}
                    marks
                    disabled={isProcessing}
                    valueLabelDisplay="auto"
                  />
                </Box>

                {/* Key */}
                <TextField
                  label="Key"
                  type="number"
                  value={key}
                  onChange={(e) => setKey(parseInt(e.target.value || "0", 10) || 0)}
                  disabled={isProcessing}
                  fullWidth
                  variant="outlined"
                  size="small"
                />

                {/* Pad Mode */}
                <FormControl fullWidth size="small">
                  <InputLabel>Pad 模式</InputLabel>
                  <Select
                    value={padMode}
                    label="Pad 模式"
                    onChange={(e) => setPadMode(e.target.value)}
                    disabled={isProcessing}
                  >
                    <MenuItem value="edge">edge (复制边缘)</MenuItem>
                    <MenuItem value="constant">constant (透明黑)</MenuItem>
                  </Select>
                </FormControl>

                {/* Watermark Section */}
                <Box>
                  <TextField
                    label="文本水印 (可选)"
                    value={watermarkText}
                    onChange={(e) => setWatermarkText(e.target.value)}
                    disabled={isProcessing}
                    fullWidth
                    variant="outlined"
                    size="small"
                    placeholder="在混淆图上添加文本"
                  />
                  {watermarkText?.trim() && (
                    <Stack spacing={2} sx={{ mt: 2 }}>
                      <Stack direction="row" spacing={2}>
                        <TextField
                          label="颜色 (Hex)"
                          value={watermarkColor}
                          onChange={(e) => setWatermarkColor(e.target.value)}
                          disabled={isProcessing}
                          variant="outlined"
                          size="small"
                          sx={{ flex: 1 }}
                        />
                        <FormControl fullWidth size="small" sx={{ flex: 1 }}>
                          <InputLabel>对齐</InputLabel>
                          <Select
                            value={watermarkAlign}
                            label="对齐"
                            onChange={(e) => setWatermarkAlign(e.target.value)}
                            disabled={isProcessing}
                          >
                            <MenuItem value="left">左</MenuItem>
                            <MenuItem value="center">中</MenuItem>
                            <MenuItem value="right">右</MenuItem>
                          </Select>
                        </FormControl>
                      </Stack>
                      <Stack direction="row" spacing={2}>
                        <TextField
                          label="X 坐标"
                          type="number"
                          value={watermarkX}
                          onChange={(e) => setWatermarkX(parseInt(e.target.value || '0', 10))}
                          disabled={isProcessing}
                          variant="outlined"
                          size="small"
                          fullWidth
                        />
                        <TextField
                          label="Y 坐标"
                          type="number"
                          value={watermarkY}
                          onChange={(e) => setWatermarkY(parseInt(e.target.value || '0', 10))}
                          disabled={isProcessing}
                          variant="outlined"
                          size="small"
                          fullWidth
                        />
                      </Stack>
                    </Stack>
                  )}
                </Box>
              </Stack>

              <Divider sx={{ my: 3 }} />

              {/* Info */}
              <Stack spacing={1}>
                {imageDimensions && (
                  <Chip
                    icon={<InfoIcon />}
                    label={`尺寸: ${imageDimensions.width}×${imageDimensions.height}`}
                    size="small"
                    color="primary"
                    variant="outlined"
                  />
                )}
                {meta && (
                  <Chip
                    label="包含元数据"
                    size="small"
                    color="success"
                    variant="outlined"
                  />
                )}
                {meta?.watermark && (
                  <Chip
                    label={`水印: "${meta.watermark.text}"`}
                    size="small"
                    color="info"
                    variant="outlined"
                  />
                )}
              </Stack>
            </CardContent>
          </Card>

          {/* Main Panel */}
          <Box flex={1}>
            <Card
              sx={{
                background: "rgba(255, 255, 255, 0.95)",
                backdropFilter: "blur(10px)"
              }}
            >
              <CardContent>
                {/* Drop Zone */}
                <Paper
                  onDrop={onDrop}
                  onDragOver={(e) => e.preventDefault()}
                  sx={{
                    position: "relative",
                    minHeight: { xs: 300, md: 400 },
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    border: "2px dashed",
                    borderColor: hasImage ? "transparent" : "primary.main",
                    borderRadius: 2,
                    overflow: "hidden",
                    backgroundColor: hasImage ? "grey.100" : "grey.50",
                    transition: "all 0.3s ease"
                  }}
                >
                  {!hasImage && (
                    <Stack alignItems="center" spacing={2} sx={{ p: 3, textAlign: "center" }}>
                      <UploadIcon sx={{ fontSize: 60, color: "primary.main" }} />
                      <Typography variant="h6" color="text.secondary">
                        将图片拖入或粘贴到此处
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        或
                      </Typography>
                      <Button
                        variant="contained"
                        startIcon={<UploadIcon />}
                        onClick={() => fileInputRef.current?.click()}
                      >
                        选择图片文件
                      </Button>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        style={{ display: "none" }}
                        onChange={(e) => handleFile(e.target.files[0])}
                      />
                    </Stack>
                  )}
                  <canvas
                    ref={canvasRef}
                    style={{
                      maxWidth: "100%",
                      maxHeight: "100%",
                      display: hasImage ? "block" : "none"
                    }}
                  />
                </Paper>

                {/* Progress Bar */}
                {isProcessing && <LinearProgress sx={{ mt: 2 }} />}

                {/* Status */}
                {status && (
                  <Alert severity={status.type} sx={{ mt: 2 }}>
                    {status.message}
                  </Alert>
                )}

                {/* Actions */}
                <Stack spacing={2} sx={{ mt: 3 }}>
                  <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                    <Button
                      variant="contained"
                      size="large"
                      startIcon={<ShuffleIcon />}
                      onClick={handleEncode}
                      disabled={!originalImageData || isProcessing}
                      fullWidth
                      sx={{ flex: 1 }}
                    >
                      混淆
                    </Button>
                    <Button
                      variant="contained"
                      size="large"
                      color="secondary"
                      startIcon={<RestoreIcon />}
                      onClick={handleDecode}
                      disabled={!meta || isProcessing}
                      fullWidth
                      sx={{ flex: 1 }}
                    >
                      解混淆
                    </Button>
                  </Stack>

                  <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                    <Button
                      variant="outlined"
                      startIcon={<DownloadIcon />}
                      onClick={handleDownload}
                      disabled={!hasImage || isProcessing}
                      fullWidth
                      sx={{ flex: 1 }}
                    >
                      下载图片
                    </Button>
                    <Button
                      variant="outlined"
                      color="error"
                      startIcon={<ClearIcon />}
                      onClick={handleClear}
                      disabled={isProcessing}
                      fullWidth
                      sx={{ flex: 1 }}
                    >
                      清空
                    </Button>
                  </Stack>
                </Stack>
              </CardContent>
            </Card>

            {/* Footer */}
            <Paper
              sx={{
                mt: 2,
                p: 2,
                background: "rgba(255, 255, 255, 0.9)",
                backdropFilter: "blur(10px)"
              }}
            >
              <Typography variant="caption" color="text.secondary" display="block">
                如果上传区域为空白，点击清空按钮即可。
              </Typography>
            </Paper>
          </Box>
        </Stack>
      </Container>
    </Box>
  );
}

