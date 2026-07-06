export function calculateAIInsight(data) {

    const last = data[data.length - 1];
    const prev = data[data.length - 2];

    let bias = "NEUTRAL";
    let risk = "LOW";
    let regime = "SIDEWAYS";

    let confidence = 50;
    let headline = "";
    let detail = "";

    // --- Trend direction
    if (last.trendUp) {
        bias = "BULLISH";
        confidence += 20;
    } else {
        bias = "BEARISH";
        confidence += 20;
    }

    // --- Momentum check
    const momentum = last.close - prev.close;

    if (Math.abs(momentum) > last.atr * 0.5) {
        confidence += 15;
        regime = "TRENDING";
    } else {
        risk = "MEDIUM";
    }

    // --- Volatility filter
    if (last.atr > last.close * 0.01) {
        risk = "HIGH";
        confidence -= 10;
    }

    // --- Clamp
    confidence = Math.max(0, Math.min(100, confidence));

    // --- Generate explanation
    if (bias === "BULLISH") {
        headline = "Trend saat ini bullish dengan momentum positif.";
        detail = "Potensi kelanjutan trend naik.";
    } else {
        headline = "Trend saat ini bearish dengan tekanan turun dominan.";
        detail = "Waspadai potensi kelanjutan trend turun.";
    }

    // --- Captions
    const biasCaption = bias === "BULLISH" ? "Outlook Positif" : "Outlook Negatif";
    const riskCaption = risk === "HIGH" ? "Volatilitas Tinggi" : (risk === "MEDIUM" ? "Sinyal Kurang Jelas" : "Volatilitas Terkendali");
    const regimeCaption = regime === "TRENDING" ? "Momentum Searah" : "Pasar Konsolidasi";

    // --- Summary
    const summary = bias === "BULLISH"
        ? "Trend jangka pendek masih didukung oleh momentum harga yang bullish. Waspadai noise pasar dan konfirmasi break struktur untuk validasi arah trend."
        : "Trend jangka pendek masih tertekan oleh momentum harga yang bearish. Waspadai noise pasar dan konfirmasi break struktur sebelum mengambil posisi.";

    return {
        bias,
        risk,
        regime,
        confidence,
        headline,
        detail,
        biasCaption,
        riskCaption,
        regimeCaption,
        summary
    };
}

export function updateAIUI(ai) {

    document.getElementById("aiConfidence").innerText = ai.confidence + "%";
    document.getElementById("aiConfidenceFill").style.width = ai.confidence + "%";

    document.getElementById("aiInsightHeadline").innerText = ai.headline;
    document.getElementById("aiInsightText").innerText = ai.detail;

    document.getElementById("aiBias").innerText = ai.bias;
    document.getElementById("aiRisk").innerText = ai.risk;
    document.getElementById("aiRegime").innerText = ai.regime;

    document.getElementById("aiBiasCaptionText").innerText = ai.biasCaption;
    document.getElementById("aiRiskCaptionText").innerText = ai.riskCaption;
    document.getElementById("aiRegimeCaptionText").innerText = ai.regimeCaption;

    document.getElementById("aiSummaryText").innerText = ai.summary;

    // trend icon direction
    const trendIcon = document.getElementById("aiTrendIcon");
    trendIcon.classList.remove("down", "flat");
    if (ai.bias === "BEARISH") trendIcon.classList.add("down");

    // bias card color state
    const biasCard = document.getElementById("aiBiasCard");
    biasCard.classList.toggle("bearish", ai.bias === "BEARISH");

    // risk card color state (low risk = teal, high/noise = amber)
    const riskCard = document.getElementById("aiRiskCard");
    riskCard.classList.toggle("low", ai.risk === "LOW");
}
