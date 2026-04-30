function request({ url, method = "GET", data }) {
  return new Promise((resolve, reject) => {
    const app = getApp();
    wx.request({
      url: `${app.globalData.baseUrl}${url}`,
      method,
      data,
      success(res) {
        const body = res.data || {};
        if (res.statusCode >= 200 && res.statusCode < 300 && body.success) {
          resolve(body.data);
          return;
        }

        reject({
          code: body?.error?.code,
          message: body?.error?.message || body?.message || "请求失败",
          raw: body,
          statusCode: res.statusCode,
        });
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
