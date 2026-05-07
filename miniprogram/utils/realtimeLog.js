const LOG_FILTER = "album_permission";

let filterInitialized = false;

function getRealtimeLogManager() {
  if (typeof wx === "undefined" || !wx.getRealtimeLogManager) {
    return null;
  }

  return wx.getRealtimeLogManager();
}

function getRuntimeMeta() {
  const meta = {
    envVersion: "unknown",
    appVersion: "",
    route: "",
  };

  try {
    if (wx.getAccountInfoSync) {
      const accountInfo = wx.getAccountInfoSync();
      meta.envVersion = accountInfo?.miniProgram?.envVersion || "unknown";
      meta.appVersion = accountInfo?.miniProgram?.version || "";
    }
  } catch (error) {}

  try {
    const pages = getCurrentPages();
    if (pages.length) {
      meta.route = pages[pages.length - 1].route || "";
    }
  } catch (error) {}

  return meta;
}

function initFilter(manager, event) {
  if (!manager?.addFilterMsg) {
    return;
  }

  if (!filterInitialized) {
    manager.addFilterMsg(LOG_FILTER);
    filterInitialized = true;
  }

  if (event) {
    manager.addFilterMsg(event);
  }
}

function write(level, event, payload = {}) {
  const manager = getRealtimeLogManager();
  const meta = getRuntimeMeta();
  const content = {
    event,
    ...meta,
    ...payload,
  };
  const consoleMethod = level === "info" ? "log" : level;

  console[consoleMethod](`[${LOG_FILTER}] ${event}`, content);

  if (!manager || typeof manager[level] !== "function") {
    return;
  }

  initFilter(manager, event);
  manager[level](`[${LOG_FILTER}] ${event}`, content);
}

module.exports = {
  info(event, payload) {
    write("info", event, payload);
  },
  warn(event, payload) {
    write("warn", event, payload);
  },
  error(event, payload) {
    write("error", event, payload);
  },
};
