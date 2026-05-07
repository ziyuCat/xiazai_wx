function extractQualityFromLabel(label) {
  const rawLabel = String(label || "").trim();
  if (!rawLabel) return "";

  const normalizedLabel = rawLabel.replace(/\s+/g, " ");
  if (
    /(\d{3,4}P(?:60)?|[248]K|HDR|杜比|蓝光|原画|超清|高清|标清|流畅)/i.test(
      normalizedLabel
    ) &&
    !/watermark|无水印|有水印/i.test(normalizedLabel)
  ) {
    return normalizedLabel;
  }

  return "";
}

function mapQualityCode(source) {
  const quality = Number(source?.quality);
  if (!quality) return "";

  const qualityMap = {
    6: "240P",
    16: "360P",
    32: "480P",
    64: "720P",
    74: "720P60",
    80: "1080P",
    112: "1080P+",
    116: "1080P60",
    120: "4K",
    125: "HDR",
    126: "杜比视界",
    127: "8K",
  };

  return qualityMap[quality] || "";
}

function buildQualityText(source) {
  if (!source) return "";

  const labelQuality = extractQualityFromLabel(source.label);
  if (labelQuality) return labelQuality;

  const mappedQuality = mapQualityCode(source);
  if (mappedQuality) return mappedQuality;

  const width = Number(source.width) || 0;
  const height = Number(source.height) || 0;
  if (height >= 1920 || width >= 1920) return "超清";
  if (height >= 1080 || width >= 1080) return "1080P";
  if (height >= 720 || width >= 720) return "720P";
  if (width && height) return `${width} x ${height}`;

  return "默认源";
}

function buildWatermarkText(source) {
  if (!source) return "";

  const raw = String(source.label || "").toLowerCase();
  const watermark = source.watermark || "";

  const isNoWatermark =
    watermark === "without_watermark" ||
    raw.includes("no-watermark") ||
    raw.includes("no_watermark") ||
    raw.includes("nowm") ||
    raw.includes("guessed no-watermark") ||
    raw.includes("无水印");

  if (isNoWatermark) return "无水印";

  const isWithWatermark =
    watermark === "with_watermark" ||
    (raw.includes("watermark") && !isNoWatermark) ||
    raw.includes("有水印");

  if (isWithWatermark) return "有水印";

  return "";
}

function formatSourceLabel(source) {
  if (!source) return "未知源";

  const quality = buildQualityText(source);
  const watermark = buildWatermarkText(source);
  const parts = [quality, watermark].filter(Boolean);
  if (parts.length) return parts.join(" · ");

  return source.label || "未知源";
}

function isPreferredDefaultSource(source) {
  if (!source) return false;

  const raw = String(source.label || "").toLowerCase();
  const id = String(source.id || "").toLowerCase();
  return (
    source.watermark === "without_watermark" ||
    raw.includes("无水印") ||
    raw.includes("no-watermark") ||
    raw.includes("no_watermark") ||
    id.includes("nowm")
  );
}

function normalizeDetailResult(detailResult) {
  const rawSources = Array.isArray(detailResult?.sources) ? detailResult.sources : [];
  const sources = rawSources.map((source) => ({
    ...source,
    displayLabel: formatSourceLabel(source),
  }));
  const images = Array.isArray(detailResult?.images) ? detailResult.images : [];
  const cover = detailResult?.cover || images[0]?.downloadUrl || images[0]?.url || "";
  const durationMs =
    detailResult?.durationMs ||
    rawSources[0]?.durationMs ||
    rawSources.find((item) => item?.durationMs)?.durationMs ||
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

module.exports = {
  buildQualityText,
  formatSourceLabel,
  normalizeDetailResult,
  isPreferredDefaultSource,
};
