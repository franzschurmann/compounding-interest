// ── Theme ──

function getCSSColor(varName) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  return value || "transparent";
}

const themeToggle = document.getElementById("themeToggle");

function applyTheme(scheme) {
  document.documentElement.style.colorScheme = scheme;
  themeToggle.textContent = scheme === "dark" ? "Light Mode" : "Dark Mode";
  localStorage.setItem("theme", scheme);
  // Recreate chart with new theme colors
  if (chart) {
    chart.destroy();
    chart = null;
  }
  calculate();
}

themeToggle.addEventListener("click", () => {
  const current = document.documentElement.style.colorScheme || "dark";
  applyTheme(current === "dark" ? "light" : "dark");
});

const inputs = {
  monthlyInvestment: document.getElementById("monthlyInvestment"),
  annualReturn: document.getElementById("annualReturn"),
  volatility: document.getElementById("volatility"),
  years: document.getElementById("years"),
  startingAge: document.getElementById("startingAge"),
};

const startingInvestmentToggle = document.getElementById("startingInvestmentToggle");
const startingAmountWrapper = document.getElementById("startingAmountWrapper");
const startingAmountInput = document.getElementById("startingAmount");

const stats = {
  totalInvested: document.getElementById("totalInvested"),
  simulatedValue: document.getElementById("simulatedValue"),
  totalGains: document.getElementById("totalGains"),
  totalGainsPct: document.getElementById("totalGainsPct"),
  annualizedReturn: document.getElementById("annualizedReturn"),
};

let currentSimulation = [];
let currentSimulationChartData = []; // balance values for chart (includes startingBalance at index 0)
let simulationHistory = []; // up to 9 past simulation traces
let currentTableView = "yearly";
let hasSimulated = false; // true once user clicks "Simulate"

function formatEUR(value) {
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(value);
}

// Box-Muller transform: generate normally distributed random number
function randomNormal(mean, stdDev) {
  let u1 = Math.random();
  let u2 = Math.random();
  // Avoid log(0)
  while (u1 === 0) u1 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mean + stdDev * z;
}

// Generate salary progression based on milestones
function generateSalarySchedule(startingNetMonthly, totalYears, milestones) {
  const schedule = [];
  let currentSalary = startingNetMonthly;

  for (let year = 0; year < totalYears; year++) {
    // Check for milestone
    if (milestones[year]) {
      currentSalary *= (1 + milestones[year]);
    }

    // Add 12 months of this year's salary
    for (let month = 0; month < 12; month++) {
      schedule.push(currentSalary);
    }
  }

  return schedule;
}

// Generate investment schedule from salary schedule
function generateInvestmentSchedule(salarySchedule, investmentRatePct) {
  return salarySchedule.map(salary => salary * (investmentRatePct / 100));
}

// Monte Carlo simulation using geometric Brownian motion (log-normal returns).
// The drift targets the geometric mean (CAGR), so the median outcome matches
// the user-supplied annual return. Volatility creates variance around this median.
//
// This simulation implements proper dollar-cost averaging (DCA) by tracking shares:
// 1. Share price changes based on market returns (pure random walk)
// 2. New investment buys shares at current price (more shares when price is low)
// 3. Portfolio value = totalShares × currentSharePrice
// This allows prolonged bear markets where DCA truly shines through share accumulation.
function simulateGrowth(monthlyAmountOrSchedule, annualReturnPct, annualVolPct, totalYears, startingBalance) {
  const annualVol = annualVolPct / 100;
  // Monthly volatility: annual volatility scaled by sqrt(1/12)
  const monthlyStdDev = annualVol / Math.sqrt(12);
  // Drift per month: targets geometric mean (CAGR)
  // Input return is the median compounded growth rate
  const annualDrift = Math.log(1 + annualReturnPct / 100);
  const baseDrift = annualDrift / 12;

  const totalMonths = totalYears * 12;
  const entries = [];

  // Share-based tracking for proper DCA modeling
  let sharePrice = 100;  // Arbitrary starting share price (100 EUR)
  let totalShares = startingBalance / sharePrice;  // Convert starting balance to shares
  let totalInvested = startingBalance;

  for (let m = 1; m <= totalMonths; m++) {
    // If schedule provided, use varying amounts; otherwise fixed
    const monthlyAmount = Array.isArray(monthlyAmountOrSchedule)
      ? monthlyAmountOrSchedule[m - 1]
      : monthlyAmountOrSchedule;

    let growthFactor;
    if (annualVolPct === 0) {
      // Deterministic growth (no volatility)
      growthFactor = Math.pow(1 + annualReturnPct / 100, 1 / 12);
    } else {
      // Stochastic growth (geometric Brownian motion)
      const logReturn = randomNormal(baseDrift, monthlyStdDev);
      growthFactor = Math.exp(logReturn);
    }

    // Apply growth to share price
    sharePrice = sharePrice * growthFactor;

    // Buy shares at current price with monthly investment
    const sharesBought = monthlyAmount / sharePrice;
    totalShares += sharesBought;

    // Calculate balance from total shares and current price
    const balance = totalShares * sharePrice;

    totalInvested += monthlyAmount;
    entries.push({
      month: m,
      monthlyReturn: growthFactor - 1,
      invested: monthlyAmount,
      totalInvested,
      balance,
      sharePrice,      // Current share price for verification
      sharesBought,    // Shares purchased this month
      totalShares,     // Cumulative shares owned
    });
  }

  return entries;
}

function getStartingBalance() {
  if (startingInvestmentToggle.checked) {
    return parseFloat(startingAmountInput.value) || 0;
  }
  return 0;
}

function updateSummaryStats(monthIndex) {
  const startingBalance = getStartingBalance();

  if (monthIndex < 0 || currentSimulation.length === 0) {
    stats.totalInvested.textContent = formatEUR(startingBalance);
    stats.simulatedValue.textContent = formatEUR(startingBalance);
    stats.totalGains.textContent = formatEUR(0);
    stats.totalGainsPct.textContent = "+0.0%";
    stats.totalGains.className = "stat-value gain";
    stats.totalGainsPct.className = "stat-pct gain";
    stats.annualizedReturn.textContent = "+0.00% p.a.";
    return;
  }

  const idx = Math.min(monthIndex, currentSimulation.length - 1);
  const entry = currentSimulation[idx];

  const totalInvested = entry.totalInvested;
  const finalSimulated = entry.balance;
  stats.totalInvested.textContent = formatEUR(totalInvested);
  stats.simulatedValue.textContent = formatEUR(finalSimulated);

  const totalGain = finalSimulated - totalInvested;
  stats.totalGains.textContent = formatEUR(totalGain);
  const gainPct = totalInvested > 0 ? (totalGain / totalInvested) * 100 : 0;
  stats.totalGainsPct.textContent = `${gainPct >= 0 ? "+" : ""}${gainPct.toFixed(1)}%`;
  const colorClass = totalGain >= 0 ? "gain" : "loss";
  stats.totalGains.className = `stat-value ${colorClass}`;
  stats.totalGainsPct.className = `stat-pct ${colorClass}`;

  const yearsElapsed = (idx + 1) / 12;
  const totalReturnDecimal = totalInvested > 0 ? (finalSimulated / totalInvested - 1) : 0;
  const annualizedReturn = yearsElapsed > 0
    ? (Math.pow(1 + totalReturnDecimal, 1 / yearsElapsed) - 1) * 100
    : 0;
  stats.annualizedReturn.textContent = `${annualizedReturn >= 0 ? "+" : ""}${annualizedReturn.toFixed(2)}% p.a.`;
}

function calculate({ isRefresh = false } = {}) {
  if (isRefresh) {
    hasSimulated = true;
    if (currentSimulationChartData.length > 0) {
      // Save current trace before overwriting
      simulationHistory.push(currentSimulationChartData);
      if (simulationHistory.length > 10) simulationHistory.shift();
    }
  } else {
    // Input changed — old traces are no longer comparable
    hasSimulated = false;
    simulationHistory = [];
  }
  const monthly = parseFloat(inputs.monthlyInvestment.value) || 0;
  const annualReturn = parseFloat(inputs.annualReturn.value) || 0;
  const vol = parseFloat(inputs.volatility.value) || 0;
  const years = parseInt(inputs.years.value) || 1;
  const startAge = isNaN(parseInt(inputs.startingAge.value)) ? 25 : parseInt(inputs.startingAge.value);
  const startingBalance = getStartingBalance();

  // Check if salary growth is enabled
  const salaryGrowthEnabled = document.getElementById("salaryGrowthToggle").checked;
  let investmentSchedule;
  let monthlyInvestmentForChart = monthly;

  if (salaryGrowthEnabled) {
    const netSalary = parseFloat(document.getElementById("netSalary").value) || 3000;
    const investmentRate = parseFloat(document.getElementById("investmentRate").value) || 10;

    // Collect enabled milestones
    const milestones = {};
    if (document.getElementById("milestone3yr").checked) milestones[3] = 0.20;
    if (document.getElementById("milestone6yr").checked) milestones[6] = 0.18;
    if (document.getElementById("milestone10yr").checked) milestones[10] = 0.22;
    if (document.getElementById("milestone15yr").checked) milestones[15] = 0.25;

    // Generate schedules
    const salarySchedule = generateSalarySchedule(netSalary, years, milestones);
    investmentSchedule = generateInvestmentSchedule(salarySchedule, investmentRate);

    // Show salary table
    document.getElementById("salaryTableSection").style.display = "block";
    updateSalaryTable(salarySchedule, investmentSchedule, startAge, milestones);

    // Use average investment for chart label purposes
    monthlyInvestmentForChart = investmentSchedule.reduce((a, b) => a + b, 0) / investmentSchedule.length;
  } else {
    // Fixed investment
    investmentSchedule = monthly;
    document.getElementById("salaryTableSection").style.display = "none";
  }

  // Deterministic benchmark (0% volatility — pure compound growth)
  const benchmarkSimulation = simulateGrowth(investmentSchedule, annualReturn, 0, years, startingBalance);

  // Randomized simulation (monthly granularity)
  currentSimulation = simulateGrowth(investmentSchedule, annualReturn, vol, years, startingBalance);

  // Create monthly labels and data for the chart (all months, not just yearly)
  const monthlyLabels = Array.from(
    { length: currentSimulation.length + 1 },
    (_, i) => i
  ); // [0, 1, 2, ..., totalMonths]

  // Extract monthly data points from simulation
  const simulated = [startingBalance];
  for (let m = 0; m < currentSimulation.length; m++) {
    simulated.push(currentSimulation[m].balance);
  }
  currentSimulationChartData = hasSimulated ? simulated : [];

  // Extract benchmark data points
  const benchmark = [startingBalance];
  for (let m = 0; m < benchmarkSimulation.length; m++) {
    benchmark.push(benchmarkSimulation[m].balance);
  }

  // Create monthly total investment line
  const totalInvestmentLine = [startingBalance];
  for (let m = 0; m < currentSimulation.length; m++) {
    totalInvestmentLine.push(currentSimulation[m].totalInvested);
  }

  // Pre-compute tooltip data for monthly granularity
  const simulatedTotalReturnPct = [];
  const simulatedTrailing12mPct = [];

  // Starting balance
  simulatedTotalReturnPct.push(0);
  simulatedTrailing12mPct.push(null);

  // Each month
  for (let m = 0; m < currentSimulation.length; m++) {
    const entry = currentSimulation[m];

    // Total return %
    simulatedTotalReturnPct.push(
      entry.totalInvested > 0
        ? ((entry.balance - entry.totalInvested) / entry.totalInvested) * 100
        : 0
    );

    // Trailing 12 month return
    if (m < 12) {
      simulatedTrailing12mPct.push(null);
    } else {
      const prevEntry = currentSimulation[m - 12];
      const investmentInLast12Months = entry.totalInvested - prevEntry.totalInvested;
      simulatedTrailing12mPct.push(
        prevEntry.balance > 0
          ? ((entry.balance - prevEntry.balance - investmentInLast12Months) / prevEntry.balance) * 100
          : 0
      );
    }
  }

  // Show/hide simulation-dependent UI
  const tableSection = document.querySelector(".table-section");
  const summaryStats = document.querySelector(".summary");
  tableSection.style.display = hasSimulated ? "" : "none";
  summaryStats.style.display = hasSimulated ? "" : "none";

  if (hasSimulated) {
    updateSummaryStats(currentSimulation.length - 1);
    updateTable();
  }

  updateChart(monthlyLabels, {
    totalInvestmentLine,
    simulated: hasSimulated ? simulated : null,
    benchmark,
    simulatedTotalReturnPct,
    simulatedTrailing12mPct,
  }, startAge);
}

// ── Chart ──

let chart = null;

function updateChart(labels, data, startAge) {
  const accentColor = "#58a6ff";
  const hintColor = "#6e7681";
  const mutedColor = "#8b949e";
  const gridColor = "rgba(48,54,61,0.5)";

  // Build historical trace datasets with exponential opacity decay.
  // Most recent past trace = 80% opacity, each older trace is 80% of the previous.
  const decayFactor = 0.8;
  const historyDatasets = simulationHistory.map((traceData, i) => {
    const distanceFromCurrent = simulationHistory.length - i; // oldest = largest
    const alpha = Math.pow(decayFactor, distanceFromCurrent);
    return {
      label: `Past run ${i + 1}`,
      data: traceData,
      borderColor: `rgba(88, 166, 255, ${alpha.toFixed(3)})`,
      backgroundColor: "transparent",
      fill: false,
      borderWidth: 1.5,
      pointRadius: 0,
      tension: 0.1,
      isHistoryTrace: true,
    };
  });

  const simulationDatasets = data.simulated ? [
    ...historyDatasets,
    {
      label: "Simulated Value",
      data: data.simulated,
      borderColor: accentColor,
      backgroundColor: "transparent",
      fill: false,
      borderWidth: 2.5,
      pointRadius: 0,
      tension: 0.1,
      simulatedTotalReturnPct: data.simulatedTotalReturnPct,
      simulatedTrailing12mPct: data.simulatedTrailing12mPct,
    },
  ] : [];

  const datasets = [
    ...simulationDatasets,
    {
      label: "Benchmark",
      data: data.benchmark,
      borderColor: "#e89b3e",
      backgroundColor: "transparent",
      fill: false,
      borderWidth: 2,
      borderDash: [4, 3],
      pointRadius: 0,
      tension: 0.1,
    },
    {
      label: "Total Invested",
      data: data.totalInvestmentLine,
      borderColor: hintColor,
      backgroundColor: "transparent",
      fill: false,
      borderWidth: 2,
      borderDash: [6, 4],
      pointRadius: 0,
      tension: 0,
    },
  ];

  if (chart) {
    chart.data.labels = labels;
    chart.data.datasets = datasets;
    chart.update();
    return;
  }

  chart = new Chart(document.getElementById("chart"), {
    type: "line",
    data: { labels, datasets },
    options: {
      animation: false,
      responsive: true,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: {
          labels: {
            color: mutedColor,
            usePointStyle: false,
            padding: 16,
            font: { size: 13, weight: "500" },
            filter: (item, data) => !data.datasets[item.datasetIndex].isHistoryTrace,
          },
        },
        tooltip: {
          backgroundColor: "rgba(15, 17, 23, 0.9)",
          borderColor: "#30363d",
          borderWidth: 1,
          titleColor: "#e1e4e8",
          bodyColor: "#e1e4e8",
          filter: (item) => !item.dataset.isHistoryTrace,
          callbacks: {
            title: (context) => {
              // Format month index as "X y Y m" (years and months)
              if (context.length === 0) return "";
              const monthIndex = context[0].label;
              const years = Math.floor(monthIndex / 12);
              const months = monthIndex % 12;
              if (monthIndex === 0) return "Start";
              return `${years} y ${months} m`;
            },
            label: (ctx) => {
              const ds = ctx.dataset;
              const base = `${ds.label}: ${formatEUR(ctx.parsed.y)}`;
              if (!ds.simulatedTotalReturnPct) return base;
              const idx = ctx.dataIndex;
              const totalPct = ds.simulatedTotalReturnPct[idx];
              const lines = [
                base,
                `  Total Return: ${totalPct >= 0 ? "+" : ""}${totalPct.toFixed(1)}%`,
              ];
              const trailing = ds.simulatedTrailing12mPct[idx];
              if (trailing !== null) {
                lines.push(`  Last 12m: ${trailing >= 0 ? "+" : ""}${trailing.toFixed(1)}%`);
              }
              return lines;
            },
          },
        },
      },
      scales: {
        x: {
          title: { display: true, text: "Age", color: mutedColor },
          ticks: {
            color: hintColor,
            callback: (value) => {
              if (value % 12 === 0) {
                const parsed = parseInt(inputs.startingAge.value);
                const startAge = isNaN(parsed) ? 25 : parsed;
                const age = startAge + value / 12;
                return age;
              }
              return null;
            },
          },
          grid: { color: gridColor },
        },
        y: {
          title: { display: true, text: "Portfolio Value (EUR)", color: mutedColor },
          ticks: {
            color: hintColor,
            callback: (v) => formatEUR(v),
          },
          grid: { color: gridColor },
        },
      },
    },
  });
}

// ── Table ──

function updateTable() {
  const tbody = document.querySelector("#portfolioTable tbody");
  const monthly = parseFloat(inputs.monthlyInvestment.value) || 0;
  const startAge = isNaN(parseInt(inputs.startingAge.value)) ? 25 : parseInt(inputs.startingAge.value);
  const startingBalance = getStartingBalance();

  let rows = [];

  if (currentTableView === "yearly") {
    for (let i = 11; i < currentSimulation.length; i += 12) {
      const entry = currentSimulation[i];
      const yearNum = Math.floor(i / 12) + 1;
      // Calculate actual investment for this year by summing 12 months from simulation
      const yearStartIdx = i - 11; // First month of this year (e.g., i=11 → yearStartIdx=0)
      let periodInvestment = 0;
      for (let k = yearStartIdx; k <= i; k++) {
        periodInvestment += currentSimulation[k].invested;
      }
      // For the first year, include starting balance in the investment amount
      const isFirstYear = i === 11;
      if (isFirstYear) {
        periodInvestment += startingBalance;
      }
      // For first year, opening balance before investments is 0; for other years, it's the previous year-end balance
      const prevBalance = isFirstYear ? 0 : currentSimulation[i - 12].balance;
      const periodReturn = entry.balance - prevBalance - periodInvestment;
      const periodReturnPct = prevBalance + periodInvestment > 0
        ? (periodReturn / (prevBalance + periodInvestment)) * 100
        : 0;
      const totalReturns = entry.balance - entry.totalInvested;
      const totalReturnPct = entry.totalInvested > 0
        ? (totalReturns / entry.totalInvested) * 100
        : 0;
      rows.push({
        period: `Age ${startAge + yearNum}`,
        investment: periodInvestment,
        totalInvested: entry.totalInvested,
        periodReturn,
        periodReturnPct,
        totalReturns,
        totalReturnPct,
        value: entry.balance,
      });
    }
  } else {
    for (let j = 0; j < currentSimulation.length; j++) {
      const entry = currentSimulation[j];
      // For first month, include starting balance in the investment amount
      const isFirstMonth = j === 0;
      let periodInvestment = entry.invested;
      if (isFirstMonth) {
        periodInvestment += startingBalance;
      }
      // For first month, opening balance before investments is 0; for other months, it's the previous month-end balance
      const prevBalance = isFirstMonth ? 0 : currentSimulation[j - 1].balance;
      const periodReturn = entry.balance - prevBalance - periodInvestment;
      const periodReturnPct = prevBalance + periodInvestment > 0
        ? (periodReturn / (prevBalance + periodInvestment)) * 100
        : 0;
      const totalReturns = entry.balance - entry.totalInvested;
      const totalReturnPct = entry.totalInvested > 0
        ? (totalReturns / entry.totalInvested) * 100
        : 0;
      rows.push({
        period: `Month ${entry.month}`,
        investment: periodInvestment,
        totalInvested: entry.totalInvested,
        periodReturn,
        periodReturnPct,
        totalReturns,
        totalReturnPct,
        value: entry.balance,
      });
    }
  }

  tbody.innerHTML = rows
    .map(
      (r) => `<tr>
        <td>${r.period}</td>
        <td>${formatEUR(r.investment)}</td>
        <td class="${r.periodReturn >= 0 ? "positive" : "negative"}">${formatEUR(r.periodReturn)}</td>
        <td class="${r.periodReturnPct >= 0 ? "positive" : "negative"}">${r.periodReturnPct >= 0 ? "+" : ""}${r.periodReturnPct.toFixed(1)}%</td>
        <td>${formatEUR(r.totalInvested)}</td>
        <td>${formatEUR(r.value)}</td>
        <td class="${r.totalReturns >= 0 ? "positive" : "negative"}">${formatEUR(r.totalReturns)}</td>
        <td class="${r.totalReturnPct >= 0 ? "positive" : "negative"}">${r.totalReturnPct >= 0 ? "+" : ""}${r.totalReturnPct.toFixed(1)}%</td>
      </tr>`
    )
    .join("");
}

function updateSalaryTable(salarySchedule, investmentSchedule, startAge, milestones) {
  const tbody = document.querySelector("#salaryTable tbody");
  const years = salarySchedule.length / 12;
  const rows = [];

  for (let year = 0; year < years; year++) {
    const monthIndex = year * 12;
    const monthlySalary = salarySchedule[monthIndex];
    const monthlyInvestment = investmentSchedule[monthIndex];
    const annualInvestment = monthlyInvestment * 12;
    const age = startAge + year;

    // Check for milestone
    let milestone = "—";
    if (milestones[year]) {
      const pct = (milestones[year] * 100).toFixed(0);
      milestone = `+${pct}% raise`;
    }

    rows.push(`<tr>
      <td>Year ${year + 1}</td>
      <td>${age}</td>
      <td>${formatEUR(monthlySalary)}</td>
      <td>${formatEUR(monthlyInvestment)}</td>
      <td>${formatEUR(annualInvestment)}</td>
      <td>${milestone}</td>
    </tr>`);
  }

  tbody.innerHTML = rows.join("");
}

// ── Event Listeners ──

Object.values(inputs).forEach((el) => el.addEventListener("input", calculate));

document.getElementById("rerollBtn").addEventListener("click", () => calculate({ isRefresh: true }));

const resetZoomBtn = document.getElementById("resetZoom");
resetZoomBtn.disabled = true;

resetZoomBtn.addEventListener("click", () => {
  if (chart) {
    chart.options.scales.x.min = undefined;
    chart.options.scales.x.max = undefined;
    chart.update();
    resetZoomBtn.disabled = true;
    updateSummaryStats(currentSimulation.length - 1);
  }
});

// ── Zoom functionality ──

const chartCanvas = document.getElementById("chart");
let isZooming = false;
let zoomStartX = 0;
let zoomStartDataValue = 0;

function getDataValueFromPixel(pixelX) {
  if (!chart || !chart.scales || !chart.scales.x) return null;
  const xScale = chart.scales.x;

  // getValueForPixel expects canvas pixel coordinates directly
  return xScale.getValueForPixel(pixelX);
}

function drawZoomPreview(startX, endX) {
  if (!chart || !chart.chartArea) return;

  // Redraw the chart without animation
  chart.update('none');

  // Get canvas context
  const ctx = chartCanvas.getContext("2d");
  const chartArea = chart.chartArea;
  const canvasTop = chartArea.top;
  const canvasBottom = chartArea.bottom;

  // Clamp positions to chart area
  const left = Math.max(Math.min(startX, endX), chartArea.left);
  const right = Math.min(Math.max(startX, endX), chartArea.right);
  const width = right - left;

  // Draw semi-transparent overlay
  ctx.fillStyle = "rgba(88, 166, 255, 0.15)";
  ctx.fillRect(left, canvasTop, width, canvasBottom - canvasTop);

  // Draw border
  ctx.strokeStyle = "rgba(88, 166, 255, 0.8)";
  ctx.lineWidth = 2;
  ctx.strokeRect(left, canvasTop, width, canvasBottom - canvasTop);
}

chartCanvas.addEventListener("mousedown", (e) => {
  if (!chart) return;
  isZooming = true;
  const rect = chartCanvas.getBoundingClientRect();
  zoomStartX = e.clientX - rect.left;
  zoomStartDataValue = getDataValueFromPixel(zoomStartX);
});

chartCanvas.addEventListener("mousemove", (e) => {
  if (!isZooming || !chart) return;

  const rect = chartCanvas.getBoundingClientRect();
  const currentX = e.clientX - rect.left;

  // Visual feedback: change cursor when dragging
  if (Math.abs(currentX - zoomStartX) > 5) {
    chartCanvas.style.cursor = "col-resize";
    // Draw the preview rectangle
    drawZoomPreview(zoomStartX, currentX);
  }
});

chartCanvas.addEventListener("mouseup", (e) => {
  if (!isZooming || !chart) {
    isZooming = false;
    chartCanvas.style.cursor = "col-resize";
    chart.update();
    return;
  }

  isZooming = false;
  chartCanvas.style.cursor = "col-resize";

  const rect = chartCanvas.getBoundingClientRect();
  const currentX = e.clientX - rect.left;
  const zoomEndDataValue = getDataValueFromPixel(currentX);

  // Only zoom if drag distance is significant
  if (Math.abs(currentX - zoomStartX) > 10 && zoomEndDataValue !== null && zoomStartDataValue !== null) {
    const minValue = Math.min(zoomStartDataValue, zoomEndDataValue);
    const maxValue = Math.max(zoomStartDataValue, zoomEndDataValue);

    // Apply zoom by setting scale min/max
    chart.options.scales.x.min = minValue;
    chart.options.scales.x.max = maxValue;
    resetZoomBtn.disabled = false;
    chart.update();
    updateSummaryStats(Math.round(maxValue) - 1);
  } else {
    chart.update();
  }
});

chartCanvas.addEventListener("mouseleave", () => {
  if (isZooming) {
    isZooming = false;
    chartCanvas.style.cursor = "col-resize";
    chart.update();
  }
});

startingInvestmentToggle.addEventListener("change", () => {
  startingAmountWrapper.classList.toggle("visible", startingInvestmentToggle.checked);
  calculate();
});

startingAmountInput.addEventListener("input", calculate);

document.querySelectorAll(".toggle-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".toggle-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    currentTableView = btn.dataset.view;
    updateTable();
  });
});

// Salary growth toggle
document.getElementById("salaryGrowthToggle").addEventListener("change", (e) => {
  const visible = e.target.checked;
  document.getElementById("salaryInputs").style.display = visible ? "grid" : "none";

  // Update monthly investment field state
  inputs.monthlyInvestment.disabled = visible;
  if (visible) {
    inputs.monthlyInvestment.parentElement.style.opacity = "0.5";
  } else {
    inputs.monthlyInvestment.parentElement.style.opacity = "1";
  }

  calculate();
});

// Recalculate on salary input changes
document.getElementById("netSalary").addEventListener("input", calculate);
document.getElementById("investmentRate").addEventListener("input", calculate);
document.getElementById("milestone3yr").addEventListener("change", calculate);
document.getElementById("milestone6yr").addEventListener("change", calculate);
document.getElementById("milestone10yr").addEventListener("change", calculate);
document.getElementById("milestone15yr").addEventListener("change", calculate);

// ── Init ──

const savedTheme = localStorage.getItem("theme") || "dark";
document.documentElement.style.colorScheme = savedTheme;
themeToggle.textContent = savedTheme === "dark" ? "Light Mode" : "Dark Mode";
calculate();
