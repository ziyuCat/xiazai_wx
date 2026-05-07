function getBaseUrls(app) {
  const configuredUrls = Array.isArray(app.globalData.baseUrls)
    ? app.globalData.baseUrls
    : [];
  const urls = configuredUrls.filter(Boolean);

  return [...new Set(urls)];
}

function getRequestTimeoutMs(app) {
  const timeout = Number(app.globalData.requestTimeoutMs);
  if (!timeout || timeout <= 0) {
    return 8000;
  }

  return timeout;
}

function shouldSwitchBaseUrl(error) {
  if (!error.statusCode) {
    return true;
  }

  return error.statusCode === 404 || error.statusCode >= 500;
}

function buildRequestError(res) {
  const body = res.data || {};
  return {
    code: body?.error?.code,
    message: body?.error?.message || body?.message || "请求失败",
    raw: body,
    statusCode: res.statusCode,
  };
}

function joinRequestUrl(baseUrl, path) {
  const normalizedBaseUrl = String(baseUrl).replace(/\/+$/, "");
  const normalizedPath = String(path || "").startsWith("/") ? path : `/${path}`;
  return `${normalizedBaseUrl}${normalizedPath}`;
}

function requestOnce({ baseUrl, url, method, data, timeout }) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: joinRequestUrl(baseUrl, url),
      method,
      data,
      timeout,
      success(res) {
        const body = res.data || {};
        if (res.statusCode >= 200 && res.statusCode < 300 && body.success) {
          resolve(body.data);
          return;
        }

        reject(buildRequestError(res));
      },
      fail(err) {
        reject({
          message: err?.errMsg || "网络请求失败",
          raw: err,
        });
      },
    });
  });
}

async function request({ url, method = "GET", data }) {
  const app = getApp();
  const baseUrls = getBaseUrls(app);
  const timeout = getRequestTimeoutMs(app);
  let activeIndex = Number(app.globalData.activeBaseUrlIndex) || 0;

  if (!baseUrls.length) {
    throw { message: "未配置服务地址" };
  }

  if (activeIndex < 0 || activeIndex >= baseUrls.length) {
    activeIndex = 0;
  }

  for (let attempt = 0; attempt < baseUrls.length; attempt += 1) {
    const currentIndex = (activeIndex + attempt) % baseUrls.length;
    const baseUrl = baseUrls[currentIndex];

    try {
      const result = await requestOnce({ baseUrl, url, method, data, timeout });
      app.globalData.activeBaseUrlIndex = currentIndex;
      return result;
    } catch (error) {
      const hasBackup = attempt < baseUrls.length - 1;
      if (!hasBackup || !shouldSwitchBaseUrl(error)) {
        throw error;
      }
    }
  }

  throw { message: "网络请求失败" };
}

function parseShareText(text) {
  return request({
    url: "/api/parse",
    method: "POST",
    data: {
      text,
      resolveRedirect: true,
      includeDebug: false,
      fetchMetadata: false,
    },
  });
}

function fetchDetail(parseResult) {
  return request({
    url: "/api/detail",
    method: "POST",
    data: {
      awemeId: parseResult.resolved.awemeId,
      resolvedUrl: parseResult.resolved.finalUrl,
      typeHint: parseResult.resolved.resourceTypeHint,
      includeDebug: false,
    },
  });
}

function prepareDownload(detailResult, selectedId) {
  const data =
    detailResult.mediaType === "video"
      ? {
          awemeId: detailResult.awemeId,
          typeHint: "video",
          sourceId: selectedId,
        }
      : {
          awemeId: detailResult.awemeId,
          typeHint: "note",
          imageId: selectedId,
        };

  return request({
    url: "/api/download/prepare",
    method: "POST",
    data,
  });
}

function downloadDirectFile(downloadUrl) {
  return new Promise((resolve, reject) => {
    wx.downloadFile({
      url: downloadUrl,
      success(res) {
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
      fail(err) {
        reject({
          message: err?.errMsg || "下载失败",
          raw: err,
        });
      },
    });
  });
}

module.exports = {
  parseShareText,
  fetchDetail,
  prepareDownload,
  downloadDirectFile,
};
