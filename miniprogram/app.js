App({
  globalData: {
    // 远程服务地址列表，按顺序作为主地址和备用地址使用。
    // 真机和上线环境需要把这些域名配置到小程序后台 request 合法域名中。
    // 本地联调示例：http://127.0.0.1:8787
    baseUrls: [
      "https://nas.yyyc52.site:5077",
      "https://www.yyyc1000.site",
    ],

    // 单个服务地址的请求超时时间，超过该时间未响应会尝试切换到下一个地址。
    requestTimeoutMs: 1500,

    // 当前正在使用的服务地址下标，请求失败自动切换成功后会更新该值。
    activeBaseUrlIndex: 0,

    // 当前解析作品的临时缓存，用于页面之间传递解析结果和详情数据。
    currentWork: null,
  },

  getServerState() {
    const baseUrls = Array.isArray(this.globalData.baseUrls)
      ? this.globalData.baseUrls.filter(Boolean)
      : [];
    const total = baseUrls.length;
    let activeIndex = Number(this.globalData.activeBaseUrlIndex) || 0;

    if (!total) {
      return {
        baseUrls: [],
        total: 0,
        activeIndex: 0,
        activeBaseUrl: "",
      };
    }

    if (activeIndex < 0 || activeIndex >= total) {
      activeIndex = 0;
      this.globalData.activeBaseUrlIndex = 0;
    }

    return {
      baseUrls,
      total,
      activeIndex,
      activeBaseUrl: baseUrls[activeIndex],
    };
  },

  switchServer() {
    const serverState = this.getServerState();
    if (!serverState.total) {
      return serverState;
    }

    const nextIndex = (serverState.activeIndex + 1) % serverState.total;
    this.globalData.activeBaseUrlIndex = nextIndex;

    return this.getServerState();
  },

  setActiveServer(index) {
    const serverState = this.getServerState();
    const nextIndex = Number(index);

    if (!serverState.total || Number.isNaN(nextIndex)) {
      return serverState;
    }

    if (nextIndex < 0 || nextIndex >= serverState.total) {
      return serverState;
    }

    this.globalData.activeBaseUrlIndex = nextIndex;
    return this.getServerState();
  },
});
