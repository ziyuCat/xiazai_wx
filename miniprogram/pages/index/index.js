const { parseShareText, fetchDetail } = require("../../utils/api");

const ERROR_MESSAGE_MAP = {
  EMPTY_TEXT: "请输入抖音分享文案",
  NO_URL_FOUND: "没找到可解析链接，请重新复制完整分享文案",
  UNSUPPORTED_PLATFORM: "当前仅支持抖音分享链接",
  CONTENT_UNAVAILABLE: "作品不存在、已删除或权限受限",
  DETAIL_FETCH_FAILED: "当前作品暂时无法解析，请稍后重试",
  ROUTER_DATA_NOT_FOUND: "当前作品暂时无法解析，请稍后重试",
};

const SHORTCUTS = [
  {
    id: "paste",
    title: "一键粘贴",
    desc: "自动读取剪贴板中的分享文案",
  },
  {
    id: "extract",
    title: "开始提取",
    desc: "解析链接并跳转到详情页",
  },
  {
    id: "guide",
    title: "使用教程",
    desc: "三步完成提取和保存",
  },
  {
    id: "faq",
    title: "常见问题",
    desc: "权限、失败和域名配置说明",
  },
];

function promisifyWx(method, options = {}) {
  return new Promise((resolve, reject) => {
    method({
      ...options,
      success: resolve,
      fail: reject,
    });
  });
}

Page({
  data: {
    shortcuts: SHORTCUTS,
    inputText: "",
    loading: false,
    loadingText: "",
    errorMessage: "",
  },

  onInputChange(e) {
    this.setData({
      inputText: e.detail.value,
      errorMessage: "",
    });
  },

  async onPasteTap() {
    try {
      const res = await promisifyWx(wx.getClipboardData);
      const text = res.data || "";
      this.setData({
        inputText: text,
        errorMessage: "",
      });
      if (text) {
        wx.showToast({
          title: "已粘贴剪贴板内容",
          icon: "none",
        });
      }
    } catch (error) {
      this.showError("读取剪贴板失败，请手动粘贴");
    }
  },

  async onExtractTap() {
    const inputText = (this.data.inputText || "").trim();
    if (!inputText) {
      this.showError("请输入抖音分享文案");
      return;
    }

    this.setLoading(true, "正在解析分享文案");
    this.setData({
      errorMessage: "",
    });

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

      wx.navigateTo({
        url: "/pages/result/index",
      });
    } catch (error) {
      this.showError(this.getFriendlyMessage(error));
    } finally {
      this.setLoading(false);
    }
  },

  async onShortcutTap(e) {
    const action = e.currentTarget.dataset.action;
    if (action === "paste") {
      await this.onPasteTap();
      return;
    }

    if (action === "extract") {
      await this.onExtractTap();
      return;
    }

    if (action === "guide") {
      wx.showModal({
        title: "使用教程",
        content: "1. 复制抖音分享文案\n2. 点击开始提取\n3. 在详情页选择资源并保存到相册",
        showCancel: false,
      });
      return;
    }

    wx.showModal({
      title: "常见问题",
      content: "如果保存失败，请检查相册权限。",
      showCancel: false,
    });
  },

  onResetTap() {
    this.setData({
      inputText: "",
      errorMessage: "",
    });
  },

  setLoading(loading, loadingText = "") {
    this.setData({
      loading,
      loadingText,
    });
  },

  showError(message) {
    this.setData({
      errorMessage: message,
    });
    wx.showToast({
      title: message,
      icon: "none",
      duration: 2500,
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
