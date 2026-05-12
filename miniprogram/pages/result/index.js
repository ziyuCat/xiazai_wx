const {
  parseShareText,
  fetchDetail,
  prepareDownload,
} = require("../../utils/api");
const realtimeLog = require("../../utils/realtimeLog");

const PROMOTION_SHARE_PATH = "/pages/index/index";
const PROMOTION_SHARE_TITLE = "步步万能下载器，来试试一键提取无水印资源";

const ERROR_MESSAGE_MAP = {
  EMPTY_TEXT: "请输入抖音分享文案",
  NO_URL_FOUND: "没找到可解析链接，请重新复制完整分享文案",
  UNSUPPORTED_PLATFORM: "当前仅支持抖音分享链接",
  CONTENT_UNAVAILABLE: "作品不存在、已删除或权限受限",
  DETAIL_FETCH_FAILED: "当前作品暂时无法解析，请稍后重试",
  ROUTER_DATA_NOT_FOUND: "当前作品暂时无法解析，请稍后重试",
};

function promisifyWx(method, options = {}) {
  return new Promise((resolve, reject) => {
    method({
      ...options,
      success: resolve,
      fail: reject,
    });
  });
}

function isAlbumPermissionDenied(error) {
  const errMsg = error?.errMsg || "";
  return errMsg.includes("auth deny") || errMsg.includes("authorize no response");
}

function formatDuration(durationMs) {
  const parsed = Number(durationMs);
  if (!parsed || Number.isNaN(parsed)) {
    return "";
  }

  const normalizedMs = parsed < 1000 ? parsed * 1000 : parsed;
  const totalSeconds = Math.max(1, Math.floor(normalizedMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return [minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
}

function formatCount(value) {
  const count = Number(value) || 0;
  if (count >= 10000) {
    return `${(count / 10000).toFixed(count >= 100000 ? 0 : 1)}万`;
  }
  return `${count}`;
}

function buildQualityText(source) {
  if (!source) {
    return "";
  }

  const width = Number(source.width) || 0;
  const height = Number(source.height) || 0;
  if (height >= 1920 || width >= 1920) {
    return "超清";
  }
  if (height >= 1080 || width >= 1080) {
    return "1080P";
  }
  if (height >= 720 || width >= 720) {
    return "720P";
  }
  if (width && height) {
    return `${width} x ${height}`;
  }
  return "默认源";
}

function isDouyinWork(parseResult, detailResult) {
  const platform = (parseResult?.platform || "").toLowerCase();
  if (platform) {
    return platform === "douyin";
  }

  const urls = [
    parseResult?.resolved?.finalUrl,
    detailResult?.sharePage?.sourceUrl,
    detailResult?.sharePage?.pageUrl,
  ].filter(Boolean);

  return urls.some((url) => /douyin\.com|iesdouyin\.com/.test(url));
}

function isLikelyNoWatermarkSource(source) {
  const label = `${source?.label || ""}`.toLowerCase();
  const id = `${source?.id || ""}`.toLowerCase();
  const watermark = `${source?.watermark || ""}`.toLowerCase();

  return (
    label.includes("no-watermark") ||
    label.includes("nowm") ||
    label.includes("无水印") ||
    id.includes("no_watermark") ||
    id.includes("nowm") ||
    watermark === "without_watermark" ||
    watermark === "unknown"
  );
}

function buildSourceDisplayLabel(source, parseResult, detailResult) {
  if (!source) {
    return "";
  }

  if (!isDouyinWork(parseResult, detailResult)) {
    return source.label || "";
  }

  if (isLikelyNoWatermarkSource(source)) {
    return source?.watermark === "without_watermark" ? "去水印源" : "去水印源（推测）";
  }

  if (`${source?.watermark || ""}`.toLowerCase() === "with_watermark") {
    return "默认源（有水印）";
  }

  return "默认源";
}

function getPreferredImageUrl(image) {
  if (!image) {
    return "";
  }

  return image.url || image.downloadUrl || "";
}

function normalizeDetailResult(detailResult, parseResult) {
  const sources = Array.isArray(detailResult?.sources)
    ? detailResult.sources.map((source) => ({
        ...source,
        displayLabel: buildSourceDisplayLabel(source, parseResult, detailResult),
      }))
    : [];
  const images = Array.isArray(detailResult?.images) ? detailResult.images : [];
  const cover = detailResult?.cover || getPreferredImageUrl(images[0]) || "";
  const durationMs =
    detailResult?.durationMs ||
    sources[0]?.durationMs ||
    sources.find((item) => item?.durationMs)?.durationMs ||
    0;

  return {
    ...detailResult,
    cover,
    durationMs,
    author: detailResult?.author || {},
    sources,
    images,
  };
}

Page({
  data: {
    inputText: "",
    parseResult: null,
    detailResult: null,
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
    selectedImageCurrent: 0,
    sourcePanelExpanded: false,
    loading: false,
    loadingText: "",
    activeSaveAction: "",
    downloadTicket: null,
    downloadProgressVisible: false,
    downloadProgress: 0,
    downloadProgressText: "",
  },

  onLoad() {
    this.showNativeShareMenu();

    const app = getApp();
    const currentWork = app.globalData.currentWork;

    if (currentWork?.detailResult) {
      this.applyWorkData({
        inputText: currentWork.inputText || "",
        parseResult: currentWork.parseResult || null,
        detailResult: currentWork.detailResult,
      });
      return;
    }

    wx.showToast({
      title: "请先返回首页提取内容",
      icon: "none",
    });
    setTimeout(() => {
      wx.reLaunch({
        url: "/pages/index/index",
      });
    }, 300);
  },

  showNativeShareMenu() {
    if (!wx.showShareMenu) {
      return;
    }

    wx.showShareMenu({
      menus: ["shareAppMessage", "shareTimeline"],
    });
  },

  applyWorkData({ inputText, parseResult, detailResult }) {
    const normalizedDetail = normalizeDetailResult(detailResult, parseResult);
    const selectedSourceMeta = this.getDefaultSource(normalizedDetail);
    const selectedImage = normalizedDetail.images[0] || null;

    this.setData({
      inputText: inputText || "",
      parseResult: parseResult || null,
      detailResult: normalizedDetail,
      resultTab: normalizedDetail.mediaType === "note" ? "image" : "video",
      durationText: formatDuration(normalizedDetail.durationMs),
      statisticsText: this.buildStatisticsText(normalizedDetail.statistics),
      selectedSourceId: selectedSourceMeta?.id || "",
      selectedSourceMeta,
      selectedSourceQuality: buildQualityText(selectedSourceMeta),
      selectedSourceIndexText: this.buildSourceIndexText(
        normalizedDetail,
        selectedSourceMeta?.id || ""
      ),
      selectedImageId: selectedImage?.id || "",
      selectedImagePreview: getPreferredImageUrl(selectedImage) || normalizedDetail.cover || "",
      selectedImageIndexText: this.buildImageIndexText(normalizedDetail, selectedImage?.id || ""),
      selectedImageCurrent: this.getImageIndexById(normalizedDetail, selectedImage?.id || ""),
      sourcePanelExpanded: false,
      loading: false,
      loadingText: "",
      activeSaveAction: "",
      downloadTicket: null,
      downloadProgressVisible: false,
      downloadProgress: 0,
      downloadProgressText: "",
    });
  },

  getDefaultSource(detailResult) {
    const sources = detailResult?.sources || [];
    if (!sources.length) {
      return null;
    }

    return sources.find((item) => isLikelyNoWatermarkSource(item)) || sources[0];
  },

  getImageIndexById(detailResult, imageId) {
    const images = detailResult?.images || [];
    if (!images.length) {
      return 0;
    }

    const index = images.findIndex((item) => item.id === imageId);
    return index >= 0 ? index : 0;
  },

  buildStatisticsText(statistics) {
    if (!statistics) {
      return "";
    }

    return `点赞 ${formatCount(statistics.diggCount)}  收藏 ${formatCount(
      statistics.collectCount
    )}  评论 ${formatCount(statistics.commentCount)}`;
  },

  buildSourceIndexText(detailResult, sourceId) {
    const sources = detailResult?.sources || [];
    if (!sources.length) {
      return "";
    }

    const index = sources.findIndex((item) => item.id === sourceId);
    return `源 ${index >= 0 ? index + 1 : 1}/${sources.length}`;
  },

  buildImageIndexText(detailResult, imageId) {
    const images = detailResult?.images || [];
    if (!images.length) {
      return "";
    }

    const index = images.findIndex((item) => item.id === imageId);
    return `第 ${index >= 0 ? index + 1 : 1}/${images.length} 张`;
  },

  buildShareOptions() {
    const { detailResult } = this.data;
    const imageUrl = detailResult?.cover || getPreferredImageUrl(detailResult?.images?.[0]) || "";

    return {
      title: PROMOTION_SHARE_TITLE,
      imageUrl,
    };
  },

  onShareAppMessage() {
    const { title, imageUrl } = this.buildShareOptions();

    return {
      title,
      path: PROMOTION_SHARE_PATH,
      imageUrl,
    };
  },

  onShareTimeline() {
    const { title, imageUrl } = this.buildShareOptions();

    return {
      title,
      query: "",
      imageUrl,
    };
  },

  onShareInputChange(e) {
    this.setData({
      inputText: e.detail.value,
    });
  },

  onClearInputTap() {
    this.setData({
      inputText: "",
    });
  },

  async onPasteTap() {
    try {
      const res = await promisifyWx(wx.getClipboardData);
      const text = res.data || "";
      this.setData({
        inputText: text,
      });
      if (text) {
        wx.showToast({
          title: "已粘贴剪贴板内容",
          icon: "none",
        });
      }
    } catch (error) {
      wx.showToast({
        title: "读取剪贴板失败",
        icon: "none",
      });
    }
  },

  async onReExtractTap() {
    const inputText = (this.data.inputText || "").trim();
    if (!inputText) {
      wx.showToast({
        title: "请输入抖音分享文案",
        icon: "none",
      });
      return;
    }

    this.setLoading(true, "正在重新提取");

    try {
      const parseResult = await parseShareText(inputText);
      const resolved = parseResult?.resolved || {};
      if (parseResult?.status !== "resolved" || !resolved.awemeId) {
        throw {
          code: "NO_URL_FOUND",
          message: "没拿到作品 ID，请重新复制完整分享文案",
        };
      }

      this.setLoading(true, "正在获取作品详情");
      const detailResult = await fetchDetail(parseResult);

      const app = getApp();
      app.globalData.currentWork = {
        inputText,
        parseResult,
        detailResult,
      };

      this.applyWorkData({
        inputText,
        parseResult,
        detailResult,
      });

      wx.showToast({
        title: "提取成功",
        icon: "success",
      });
    } catch (error) {
      wx.showToast({
        title: this.getFriendlyMessage(error),
        icon: "none",
      });
    } finally {
      this.setLoading(false);
    }
  },

  onToggleSourcePanel() {
    this.setData({
      sourcePanelExpanded: !this.data.sourcePanelExpanded,
    });
  },

  onResultTabTap(e) {
    const tab = e.currentTarget.dataset.tab;
    const detailResult = this.data.detailResult;
    if (!detailResult) {
      return;
    }

    if (tab === "video" && !detailResult.sources.length) {
      wx.showToast({
        title: "当前作品没有视频资源",
        icon: "none",
      });
      return;
    }

    if (tab === "image" && !detailResult.images.length) {
      wx.showToast({
        title: "当前作品没有图片资源",
        icon: "none",
      });
      return;
    }

    this.setData({
      resultTab: tab,
    });
  },

  onSelectSource(e) {
    const sourceId = e.currentTarget.dataset.id;
    const selectedSourceMeta =
      (this.data.detailResult?.sources || []).find((item) => item.id === sourceId) || null;

    this.setData({
      resultTab: "video",
      selectedSourceId: sourceId,
      selectedSourceMeta,
      selectedSourceQuality: buildQualityText(selectedSourceMeta),
      selectedSourceIndexText: this.buildSourceIndexText(this.data.detailResult, sourceId),
      sourcePanelExpanded: false,
    });
  },

  onSelectImage(e) {
    const { id, url } = e.currentTarget.dataset;
    this.setData({
      resultTab: "image",
      selectedImageId: id,
      selectedImagePreview: url,
      selectedImageIndexText: this.buildImageIndexText(this.data.detailResult, id),
      selectedImageCurrent: this.getImageIndexById(this.data.detailResult, id),
    });
  },

  onImageSwiperChange(e) {
    const current = Number(e.detail.current) || 0;
    const images = this.data.detailResult?.images || [];
    const selectedImage = images[current] || null;
    if (!selectedImage) {
      return;
    }

    this.setData({
      selectedImageId: selectedImage.id || "",
      selectedImagePreview: getPreferredImageUrl(selectedImage),
      selectedImageIndexText: this.buildImageIndexText(this.data.detailResult, selectedImage.id || ""),
      selectedImageCurrent: current,
    });
  },

  onPreviewPrimaryMedia() {
    if (this.data.resultTab === "image") {
      const current = this.data.selectedImagePreview;
      const images = (this.data.detailResult?.images || []).map(getPreferredImageUrl).filter(Boolean);

      if (!current || !images.length) {
        return;
      }

      wx.previewImage({
        current,
        urls: images,
      });
      return;
    }

    const cover = this.data.detailResult?.cover;
    if (!cover) {
      return;
    }

    wx.previewImage({
      current: cover,
      urls: [cover],
    });
  },

  async downloadAndSaveImage(detailResult, imageId) {
    let ticket = null;
    let downloadUrl = "";
    const selectedImage = (detailResult.images || []).find((item) => item.id === imageId) || null;
    downloadUrl = getPreferredImageUrl(selectedImage);

    if (!downloadUrl) {
      ticket = await prepareDownload(detailResult, imageId);
      downloadUrl = ticket.downloadUrl;
    }

    this.setData({
      downloadTicket: ticket,
    });

    try {
      return await this.downloadWithProgress(downloadUrl);
    } catch (error) {
      const canFallbackToTicket = downloadUrl && !ticket;
      if (!canFallbackToTicket) {
        throw error;
      }

      ticket = await prepareDownload(detailResult, imageId);
      this.setData({
        downloadTicket: ticket,
      });
      return this.downloadWithProgress(ticket.downloadUrl);
    }
  },

  async onSaveTap() {
    const { detailResult, selectedSourceId } = this.data;
    if (!detailResult) {
      return;
    }

    if (detailResult.mediaType === "video" && !selectedSourceId) {
      wx.showToast({
        title: "请选择一个视频源",
        icon: "none",
      });
      return;
    }

    this.setData({
      activeSaveAction: "video",
    });
    this.setLoading(true, "正在生成下载地址");
    this.resetDownloadProgress();

    try {
      const ticket = await prepareDownload(detailResult, selectedSourceId);

      this.setData({
        downloadTicket: ticket,
      });

      this.setLoading(true, "正在检查相册权限");
      await this.ensureAlbumPermission();

      this.setLoading(true, "正在下载资源");
      const downloadRes = await this.downloadWithProgress(ticket.downloadUrl);

      this.setLoading(true, "正在保存到相册");
      await this.saveToAlbum(downloadRes.tempFilePath, detailResult.mediaType);

      this.setData({
        downloadProgress: 100,
        downloadProgressText: "下载完成",
      });

      wx.showToast({
        title: "视频已保存到相册",
        icon: "success",
      });
    } catch (error) {
      wx.showToast({
        title: error?.message || "保存失败，请稍后重试",
        icon: "none",
      });
    } finally {
      this.setLoading(false);
      this.setData({
        activeSaveAction: "",
      });
      setTimeout(() => {
        this.resetDownloadProgress();
      }, 800);
    }
  },

  async onSaveCurrentImageTap() {
    const { detailResult, selectedImageId } = this.data;
    if (!detailResult) {
      return;
    }

    if (!selectedImageId) {
      wx.showToast({
        title: "请选择一张图片",
        icon: "none",
      });
      return;
    }

    this.setData({
      activeSaveAction: "current",
    });
    this.resetDownloadProgress();

    try {
      this.setLoading(true, "正在检查相册权限");
      await this.ensureAlbumPermission();

      this.setLoading(true, "正在下载当前图片");
      const downloadRes = await this.downloadAndSaveImage(detailResult, selectedImageId);

      this.setLoading(true, "正在保存到相册");
      await this.saveToAlbum(downloadRes.tempFilePath, "note");

      this.setData({
        downloadProgress: 100,
        downloadProgressText: "当前图片下载完成",
      });

      wx.showToast({
        title: "当前图片已保存到相册",
        icon: "success",
      });
    } catch (error) {
      wx.showToast({
        title: error?.message || "保存失败，请稍后重试",
        icon: "none",
      });
    } finally {
      this.setLoading(false);
      this.setData({
        activeSaveAction: "",
      });
      setTimeout(() => {
        this.resetDownloadProgress();
      }, 800);
    }
  },

  async onSaveAllImagesTap() {
    const { detailResult } = this.data;
    const images = detailResult?.images || [];
    if (!detailResult || !images.length) {
      wx.showToast({
        title: "当前作品没有图片资源",
        icon: "none",
      });
      return;
    }

    this.setData({
      activeSaveAction: "all",
    });
    this.resetDownloadProgress();

    try {
      this.setLoading(true, "正在检查相册权限");
      await this.ensureAlbumPermission();

      for (let index = 0; index < images.length; index += 1) {
        const image = images[index];
        const current = index + 1;

        this.setData({
          downloadProgressVisible: true,
          downloadProgress: Math.floor((index / images.length) * 100),
          downloadProgressText: `正在处理第 ${current}/${images.length} 张`,
        });

        this.setLoading(true, `正在下载第 ${current} 张图片`);
        const downloadRes = await this.downloadAndSaveImage(detailResult, image.id);

        this.setLoading(true, `正在保存第 ${current} 张图片`);
        await this.saveToAlbum(downloadRes.tempFilePath, "note");
      }

      this.setData({
        downloadProgressVisible: true,
        downloadProgress: 100,
        downloadProgressText: `已完成 ${images.length} 张图片下载与保存`,
      });

      wx.showToast({
        title: `已保存 ${images.length} 张图片`,
        icon: "success",
      });
    } catch (error) {
      wx.showToast({
        title: error?.message || "批量保存失败，请稍后重试",
        icon: "none",
      });
    } finally {
      this.setLoading(false);
      this.setData({
        activeSaveAction: "",
      });
      setTimeout(() => {
        this.resetDownloadProgress();
      }, 800);
    }
  },

  downloadWithProgress(downloadUrl) {
    return new Promise((resolve, reject) => {
      this.setData({
        downloadProgressVisible: true,
        downloadProgress: 0,
        downloadProgressText: "准备下载 0%",
      });

      const task = wx.downloadFile({
        url: downloadUrl,
        success: (res) => {
          if (res.statusCode === 200) {
            resolve(res);
            return;
          }

          reject({
            message: "下载失败",
            statusCode: res.statusCode,
            raw: res,
          });
        },
        fail: (err) => {
          reject({
            message: err?.errMsg || "下载失败",
            raw: err,
          });
        },
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

    realtimeLog.info("get_setting", {
      permission: permissionState,
    });

    if (permission === true) {
      realtimeLog.info("permission_already_granted", {
        permission: permissionState,
      });
      return;
    }

    if (typeof permission === "undefined") {
      try {
        realtimeLog.info("authorize_start", {
          scope: "scope.writePhotosAlbum",
        });
        await promisifyWx(wx.authorize, {
          scope: "scope.writePhotosAlbum",
        });
        realtimeLog.info("authorize_success", {
          scope: "scope.writePhotosAlbum",
        });
      } catch (error) {
        realtimeLog.warn("authorize_failed", {
          scope: "scope.writePhotosAlbum",
          errMsg: error?.errMsg || "",
          permission: permissionState,
        });
        if (isAlbumPermissionDenied(error)) {
          await this.handlePermissionDenied("authorize_denied");
          return;
        }
        realtimeLog.error("authorize_unexpected_error", {
          scope: "scope.writePhotosAlbum",
          errMsg: error?.errMsg || "",
          permission: permissionState,
        });
        throw new Error(error?.errMsg || "相册权限申请失败，请稍后重试");
      }
      return;
    }

    await this.handlePermissionDenied("stored_false");
  },

  async handlePermissionDenied(reason = "unknown") {
    realtimeLog.warn("open_setting_prompt", {
      reason,
    });

    const modalRes = await promisifyWx(wx.showModal, {
      title: "需要相册权限",
      content: "保存资源到相册需要相册权限，请在设置中开启。",
      confirmText: "去设置",
      cancelText: "取消",
    });

    realtimeLog.info("open_setting_prompt_result", {
      reason,
      confirmed: !!modalRes.confirm,
    });

    if (!modalRes.confirm) {
      realtimeLog.warn("open_setting_prompt_cancelled", {
        reason,
      });
      throw new Error("未开启相册权限，无法保存到相册");
    }

    const settingRes = await promisifyWx(wx.openSetting);
    const permissionAfterSetting = settingRes.authSetting["scope.writePhotosAlbum"];

    realtimeLog.info("open_setting_result", {
      reason,
      permission:
        typeof permissionAfterSetting === "undefined"
          ? "undefined"
          : String(permissionAfterSetting),
    });

    if (!permissionAfterSetting) {
      realtimeLog.warn("open_setting_not_granted", {
        reason,
        permission:
          typeof permissionAfterSetting === "undefined"
            ? "undefined"
            : String(permissionAfterSetting),
      });
      throw new Error("未开启相册权限，无法保存到相册");
    }
  },

  saveToAlbum(filePath, mediaType) {
    return new Promise((resolve, reject) => {
      const saveMethod =
        mediaType === "video" ? wx.saveVideoToPhotosAlbum : wx.saveImageToPhotosAlbum;

      saveMethod({
        filePath,
        success: resolve,
        fail: reject,
      });
    });
  },

  setLoading(loading, loadingText = "") {
    this.setData({
      loading,
      loadingText,
    });
  },

  resetDownloadProgress() {
    this.setData({
      downloadProgressVisible: false,
      downloadProgress: 0,
      downloadProgressText: "",
    });
  },

  getFriendlyMessage(error) {
    const code = error?.code || error?.raw?.code || error?.raw?.error?.code;
    if (code && ERROR_MESSAGE_MAP[code]) {
      return ERROR_MESSAGE_MAP[code];
    }

    return error?.message || "处理失败，请稍后重试";
  },
});
