const { parseShareText, fetchDetail, prepareDownload } = require("../../utils/api");
const realtimeLog = require("../../utils/realtimeLog");

const ERROR_MESSAGE_MAP = {
  EMPTY_TEXT: "请输入抖音分享文案",
  NO_URL_FOUND: "没找到可解析链接，请重新复制完整分享文案",
  UNSUPPORTED_PLATFORM: "当前仅支持抖音分享链接",
  CONTENT_UNAVAILABLE: "作品不存在、已删除或权限受限",
  DETAIL_FETCH_FAILED: "当前作品暂时无法解析，请稍后重试",
  ROUTER_DATA_NOT_FOUND: "当前作品暂时无法解析，请稍后重试",
};

const SHORTCUTS = [
  { id: "paste",   title: "一键粘贴", desc: "自动读取剪贴板中的分享文案" },
  { id: "extract", title: "开始提取", desc: "解析链接并查看详情" },
  { id: "guide",   title: "使用教程", desc: "三步完成提取和保存" },
  { id: "faq",     title: "常见问题", desc: "权限、失败和域名配置说明" },
];

function promisifyWx(method, options = {}) {
  return new Promise((resolve, reject) => {
    method({ ...options, success: resolve, fail: reject });
  });
}

function isAlbumPermissionDenied(error) {
  const errMsg = error?.errMsg || "";
  return errMsg.includes("auth deny") || errMsg.includes("authorize no response");
}

function formatDuration(durationMs) {
  const parsed = Number(durationMs);
  if (!parsed || Number.isNaN(parsed)) return "";
  const normalizedMs = parsed < 1000 ? parsed * 1000 : parsed;
  const totalSeconds = Math.max(1, Math.floor(normalizedMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return [minutes, seconds].map((v) => String(v).padStart(2, "0")).join(":");
}

function formatCount(value) {
  const count = Number(value) || 0;
  if (count >= 10000) return `${(count / 10000).toFixed(count >= 100000 ? 0 : 1)}万`;
  return `${count}`;
}

function buildQualityText(source) {
  if (!source) return "";
  const width = Number(source.width) || 0;
  const height = Number(source.height) || 0;
  if (height >= 1920 || width >= 1920) return "超清";
  if (height >= 1080 || width >= 1080) return "1080P";
  if (height >= 720 || width >= 720) return "720P";
  if (width && height) return `${width} x ${height}`;
  return "默认源";
}

function formatSourceLabel(source) {
  if (!source) return "未知源";
  const raw = (source.label || "").toLowerCase();
  const wm  = source.watermark || "";

  const quality = buildQualityText(source);

  const isNoWm =
    wm === "without_watermark" ||
    wm === "unknown" ||
    raw.includes("no-watermark") ||
    raw.includes("no_watermark") ||
    raw.includes("nowm") ||
    raw.includes("guessed no-watermark") ||
    raw.includes("无水印");

  const isWm =
    wm === "with_watermark" ||
    (raw.includes("watermark") && !isNoWm);

  const wmText = isNoWm ? "无水印" : isWm ? "有水印" : "";
  const parts = [quality, wmText].filter(Boolean);
  if (parts.length) return parts.join(" · ");

  if (raw.includes("default"))  return "默认源";
  if (raw.includes("origin"))   return "原画";
  if (raw.includes("high"))     return "高清";
  if (raw.includes("normal") || raw.includes("standard")) return "标清";
  return source.label || "未知源";
}

function normalizeDetailResult(detailResult) {
  const rawSources = Array.isArray(detailResult?.sources) ? detailResult.sources : [];
  const sources = rawSources.map((s) => ({ ...s, displayLabel: formatSourceLabel(s) }));
  const images = Array.isArray(detailResult?.images) ? detailResult.images : [];
  const cover = detailResult?.cover || images[0]?.downloadUrl || images[0]?.url || "";
  const durationMs =
    detailResult?.durationMs ||
    rawSources[0]?.durationMs ||
    rawSources.find((item) => item?.durationMs)?.durationMs ||
    0;
  return { ...detailResult, cover, durationMs, author: detailResult?.author || {}, sources, images };
}

Page({
  data: {
    // 输入状态
    shortcuts: SHORTCUTS,
    inputText: "",
    loading: false,
    loadingText: "",
    errorMessage: "",

    // 结果状态（null 表示处于输入模式）
    detailResult: null,
    parseResult: null,
    resultTab: "video",
    durationText: "",
    statisticsText: "",
    selectedSourceId: "",
    selectedSourceMeta: null,
    selectedSourceQuality: "",
    selectedSourceIndexText: "",
    selectedImageId: "",
    selectedImagePreview: "",
    selectedImageIndexText: "",
    downloadProgressVisible: false,
    downloadProgress: 0,
    downloadProgressText: "",
  },

  // ── 输入区 ──────────────────────────────────────────────

  onInputChange(e) {
    this.setData({ inputText: e.detail.value, errorMessage: "" });
  },

  async onPasteTap() {
    try {
      const res = await promisifyWx(wx.getClipboardData);
      const text = res.data || "";
      this.setData({ inputText: text, errorMessage: "" });
      if (text) wx.showToast({ title: "已粘贴剪贴板内容", icon: "none" });
    } catch {
      this.showError("读取剪贴板失败，请手动粘贴");
    }
  },

  onResetTap() {
    this.setData({ inputText: "", errorMessage: "" });
  },

  async onExtractTap() {
    const inputText = (this.data.inputText || "").trim();
    if (!inputText) { this.showError("请输入抖音分享文案"); return; }

    this.setLoading(true, "正在解析分享文案");
    this.setData({ errorMessage: "" });

    try {
      const parseResult = await parseShareText(inputText);
      const resolved = parseResult?.resolved || {};
      if (parseResult?.status !== "resolved" || !resolved.awemeId) {
        throw { code: "NO_URL_FOUND", message: "没拿到作品 ID，请重新复制完整分享文案" };
      }

      this.setLoading(true, "正在获取作品详情");
      const detailResult = await fetchDetail(parseResult);
      this.applyWorkData({ inputText, parseResult, detailResult });
    } catch (error) {
      this.showError(this.getFriendlyMessage(error));
    } finally {
      this.setLoading(false);
    }
  },

  async onShortcutTap(e) {
    const action = e.currentTarget.dataset.action;
    if (action === "paste")   { await this.onPasteTap(); return; }
    if (action === "extract") { await this.onExtractTap(); return; }
    if (action === "guide") {
      wx.showModal({ title: "使用教程", content: "1. 复制抖音分享文案\n2. 点击开始提取\n3. 选择资源并保存到相册", showCancel: false });
      return;
    }
    wx.showModal({ title: "常见问题", content: "如果保存失败，请检查相册权限。", showCancel: false });
  },

  onBackToInput() {
    this.setData({
      detailResult: null,
      parseResult: null,
      errorMessage: "",
      downloadProgressVisible: false,
      downloadProgress: 0,
      downloadProgressText: "",
    });
  },

  // ── 结果区 ──────────────────────────────────────────────

  applyWorkData({ inputText, parseResult, detailResult }) {
    const normalized = normalizeDetailResult(detailResult);
    const selectedSourceMeta = this.getDefaultSource(normalized);
    const selectedImage = normalized.images[0] || null;

    this.setData({
      inputText: inputText || "",
      parseResult: parseResult || null,
      detailResult: normalized,
      resultTab: normalized.mediaType === "note" ? "image" : "video",
      durationText: formatDuration(normalized.durationMs),
      statisticsText: this.buildStatisticsText(normalized.statistics),
      selectedSourceId: selectedSourceMeta?.id || "",
      selectedSourceMeta,
      selectedSourceQuality: buildQualityText(selectedSourceMeta),
      selectedSourceIndexText: this.buildSourceIndexText(normalized, selectedSourceMeta?.id || ""),
      selectedImageId: selectedImage?.id || "",
      selectedImagePreview: selectedImage?.downloadUrl || selectedImage?.url || normalized.cover || "",
      selectedImageIndexText: this.buildImageIndexText(normalized, selectedImage?.id || ""),
      downloadProgressVisible: false,
      downloadProgress: 0,
      downloadProgressText: "",
    });
  },

  getDefaultSource(detailResult) {
    const sources = detailResult?.sources || [];
    if (!sources.length) return null;
    return (
      sources.find((item) => {
        const label = item?.label || "";
        const id = item?.id || "";
        return (
          label.includes("无水印") ||
          id.includes("nowm") ||
          item?.watermark === "without_watermark" ||
          item?.watermark === "unknown"
        );
      }) || sources[0]
    );
  },

  buildStatisticsText(statistics) {
    if (!statistics) return "";
    return `点赞 ${formatCount(statistics.diggCount)}  收藏 ${formatCount(statistics.collectCount)}  评论 ${formatCount(statistics.commentCount)}`;
  },

  buildSourceIndexText(detailResult, sourceId) {
    const sources = detailResult?.sources || [];
    if (!sources.length) return "";
    const index = sources.findIndex((item) => item.id === sourceId);
    return `源 ${index >= 0 ? index + 1 : 1}/${sources.length}`;
  },

  buildImageIndexText(detailResult, imageId) {
    const images = detailResult?.images || [];
    if (!images.length) return "";
    const index = images.findIndex((item) => item.id === imageId);
    return `第 ${index >= 0 ? index + 1 : 1}/${images.length} 张`;
  },

  onResultTabTap(e) {
    const tab = e.currentTarget.dataset.tab;
    const detailResult = this.data.detailResult;
    if (!detailResult) return;
    if (tab === "video" && !detailResult.sources.length) {
      wx.showToast({ title: "当前作品没有视频资源", icon: "none" }); return;
    }
    if (tab === "image" && !detailResult.images.length) {
      wx.showToast({ title: "当前作品没有图片资源", icon: "none" }); return;
    }
    this.setData({ resultTab: tab });
  },

  onSelectSource(e) {
    const sourceId = e.currentTarget.dataset.id;
    const selectedSourceMeta = (this.data.detailResult?.sources || []).find((item) => item.id === sourceId) || null;
    this.setData({
      resultTab: "video",
      selectedSourceId: sourceId,
      selectedSourceMeta,
      selectedSourceQuality: buildQualityText(selectedSourceMeta),
      selectedSourceIndexText: this.buildSourceIndexText(this.data.detailResult, sourceId),
    });
  },

  onSelectImage(e) {
    const { id, url } = e.currentTarget.dataset;
    this.setData({
      resultTab: "image",
      selectedImageId: id,
      selectedImagePreview: url,
      selectedImageIndexText: this.buildImageIndexText(this.data.detailResult, id),
    });
  },

  onPreviewPrimaryMedia() {
    if (this.data.resultTab === "image") {
      const current = this.data.selectedImagePreview;
      const images = (this.data.detailResult?.images || [])
        .map((item) => item.downloadUrl || item.url)
        .filter(Boolean);
      if (!current || !images.length) return;
      wx.previewImage({ current, urls: images });
      return;
    }
    const cover = this.data.detailResult?.cover;
    if (!cover) return;
    wx.previewImage({ current: cover, urls: [cover] });
  },

  async onReExtractTap() {
    const inputText = (this.data.inputText || "").trim();
    if (!inputText) { wx.showToast({ title: "请输入抖音分享文案", icon: "none" }); return; }

    this.setLoading(true, "正在重新提取");
    try {
      const parseResult = await parseShareText(inputText);
      const resolved = parseResult?.resolved || {};
      if (parseResult?.status !== "resolved" || !resolved.awemeId) {
        throw { code: "NO_URL_FOUND", message: "没拿到作品 ID" };
      }
      this.setLoading(true, "正在获取作品详情");
      const detailResult = await fetchDetail(parseResult);
      this.applyWorkData({ inputText, parseResult, detailResult });
      wx.showToast({ title: "提取成功", icon: "success" });
    } catch (error) {
      wx.showToast({ title: this.getFriendlyMessage(error), icon: "none" });
    } finally {
      this.setLoading(false);
    }
  },

  async onSaveTap() {
    const { detailResult, selectedSourceId, selectedImageId } = this.data;
    if (!detailResult) return;

    if (detailResult.mediaType === "video" && !selectedSourceId) {
      wx.showToast({ title: "请选择一个视频源", icon: "none" }); return;
    }
    if (detailResult.mediaType === "note" && !selectedImageId) {
      wx.showToast({ title: "请选择一张图片", icon: "none" }); return;
    }

    this.setLoading(true, "正在生成下载地址");
    this.resetDownloadProgress();

    try {
      const ticket = await prepareDownload(
        detailResult,
        detailResult.mediaType === "video" ? selectedSourceId : selectedImageId
      );
      this.setLoading(true, "正在检查相册权限");
      await this.ensureAlbumPermission();
      this.setLoading(true, "正在下载资源");
      const downloadRes = await this.downloadWithProgress(ticket.downloadUrl);
      this.setLoading(true, "正在保存到相册");
      await this.saveToAlbum(downloadRes.tempFilePath, detailResult.mediaType);
      this.setData({ downloadProgress: 100, downloadProgressText: "下载完成" });
      wx.showToast({
        title: detailResult.mediaType === "video" ? "视频已保存到相册" : "图片已保存到相册",
        icon: "success",
      });
    } catch (error) {
      wx.showToast({ title: error?.message || "保存失败，请稍后重试", icon: "none" });
    } finally {
      this.setLoading(false);
      setTimeout(() => this.resetDownloadProgress(), 800);
    }
  },

  downloadWithProgress(downloadUrl) {
    return new Promise((resolve, reject) => {
      this.setData({ downloadProgressVisible: true, downloadProgress: 0, downloadProgressText: "准备下载 0%" });
      const task = wx.downloadFile({
        url: downloadUrl,
        success: (res) => {
          if (res.statusCode === 200) { resolve(res); return; }
          reject({ message: "下载失败", statusCode: res.statusCode });
        },
        fail: (err) => reject({ message: err?.errMsg || "下载失败", raw: err }),
      });
      if (task?.onProgressUpdate) {
        task.onProgressUpdate((progress) => {
          this.setData({
            downloadProgressVisible: true,
            downloadProgress: progress.progress || 0,
            downloadProgressText: `下载进度 ${progress.progress || 0}%`,
          });
        });
      }
    });
  },

  async ensureAlbumPermission() {
    const settingRes = await promisifyWx(wx.getSetting);
    const permission = settingRes.authSetting["scope.writePhotosAlbum"];
    const permissionState = typeof permission === "undefined" ? "undefined" : String(permission);
    realtimeLog.info("get_setting", { permission: permissionState });
    if (permission === true) return;
    if (typeof permission === "undefined") {
      try {
        await promisifyWx(wx.authorize, { scope: "scope.writePhotosAlbum" });
      } catch (error) {
        if (isAlbumPermissionDenied(error)) { await this.handlePermissionDenied("authorize_denied"); return; }
        throw new Error(error?.errMsg || "相册权限申请失败，请稍后重试");
      }
      return;
    }
    await this.handlePermissionDenied("stored_false");
  },

  async handlePermissionDenied(reason = "unknown") {
    realtimeLog.warn("open_setting_prompt", { reason });
    const modalRes = await promisifyWx(wx.showModal, {
      title: "需要相册权限",
      content: "保存资源到相册需要相册权限，请在设置中开启。",
      confirmText: "去设置",
      cancelText: "取消",
    });
    if (!modalRes.confirm) throw new Error("未开启相册权限，无法保存到相册");
    const settingRes = await promisifyWx(wx.openSetting);
    if (!settingRes.authSetting["scope.writePhotosAlbum"]) throw new Error("未开启相册权限，无法保存到相册");
  },

  saveToAlbum(filePath, mediaType) {
    return new Promise((resolve, reject) => {
      const saveMethod = mediaType === "video" ? wx.saveVideoToPhotosAlbum : wx.saveImageToPhotosAlbum;
      saveMethod({ filePath, success: resolve, fail: reject });
    });
  },

  setLoading(loading, loadingText = "") {
    this.setData({ loading, loadingText });
  },

  resetDownloadProgress() {
    this.setData({ downloadProgressVisible: false, downloadProgress: 0, downloadProgressText: "" });
  },

  showError(message) {
    this.setData({ errorMessage: message });
    wx.showToast({ title: message, icon: "none", duration: 2500 });
  },

  getFriendlyMessage(error) {
    const code = error?.code || error?.raw?.code || error?.raw?.error?.code;
    if (code && ERROR_MESSAGE_MAP[code]) return ERROR_MESSAGE_MAP[code];
    return error?.message || "处理失败，请稍后重试";
  },
});
