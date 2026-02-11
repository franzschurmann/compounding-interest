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
};

let currentSimulation = [];
let currentTableView = "yearly";

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

// Monte Carlo simulation using log-normal returns (geometric Brownian motion).
// The drift term includes the Ito correction (-0.5 * sigma^2) so that the
// *expected* compounded return matches the user-supplied annual return.
function simulateGrowth(monthlyAmount, annualReturnPct, annualVolPct, totalYears, startingBalance) {
  const annualVol = annualVolPct / 100;
  const monthlyStdDev = annualVol / Math.sqrt(12);
  // Drift per month: continuous-rate equivalent of the desired annual return,
  // minus the variance drag so E[exp(logReturn)] = (1+r)^(1/12)
  const drift = (Math.log(1 + annualReturnPct / 100) - 0.5 * annualVol * annualVol) / 12;
  const totalMonths = totalYears * 12;
  const entries = [];
  let balance = startingBalance;
  let totalInvested = startingBalance;

  for (let m = 1; m <= totalMonths; m++) {
    let growthFactor;
    if (annualVolPct === 0) {
      growthFactor = Math.pow(1 + annualReturnPct / 100, 1 / 12);
    } else {
      const logReturn = randomNormal(drift, monthlyStdDev);
      growthFactor = Math.exp(logReturn);
    }
    balance = balance * growthFactor + monthlyAmount;
    totalInvested += monthlyAmount;
    entries.push({
      month: m,
      monthlyReturn: growthFactor - 1,
      invested: monthlyAmount,
      totalInvested,
      balance,
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

function calculate() {
  const monthly = parseFloat(inputs.monthlyInvestment.value) || 0;
  const annualReturn = parseFloat(inputs.annualReturn.value) || 0;
  const vol = parseFloat(inputs.volatility.value) || 0;
  const years = parseInt(inputs.years.value) || 1;
  const startAge = parseInt(inputs.startingAge.value) || 25;
  const startingBalance = getStartingBalance();

  const labels = Array.from({ length: years + 1 }, (_, i) => startAge + i);

  // Total investment line (yearly)
  const totalInvestmentLine = labels.map((_, i) => startingBalance + monthly * 12 * i);

  // Randomized simulation (monthly granularity)
  currentSimulation = simulateGrowth(monthly, annualReturn, vol, years, startingBalance);

  // Extract yearly data points from simulation for the chart (every 12th month)
  const simulated = [startingBalance];
  for (let i = 11; i < currentSimulation.length; i += 12) {
    simulated.push(currentSimulation[i].balance);
  }

  // Pre-compute tooltip data for the simulated line
  const simulatedTotalReturnPct = [];
  const simulatedTrailing12mPct = [];
  for (let y = 0; y <= years; y++) {
    const totalInvestedAtYear = startingBalance + monthly * 12 * y;
    const balanceAtYear = simulated[y];
    simulatedTotalReturnPct.push(
      totalInvestedAtYear > 0
        ? ((balanceAtYear - totalInvestedAtYear) / totalInvestedAtYear) * 100
        : 0
    );
    if (y === 0) {
      simulatedTrailing12mPct.push(null);
    } else {
      const prevBalance = simulated[y - 1];
      const yearContributions = monthly * 12;
      simulatedTrailing12mPct.push(
        prevBalance > 0
          ? ((balanceAtYear - prevBalance - yearContributions) / prevBalance) * 100
          : 0
      );
    }
  }

  // Update summary stats from simulation
  const totalInvested = startingBalance + monthly * 12 * years;
  const finalSimulated = currentSimulation.length > 0
    ? currentSimulation[currentSimulation.length - 1].balance
    : startingBalance;
  stats.totalInvested.textContent = formatEUR(totalInvested);
  stats.simulatedValue.textContent = formatEUR(finalSimulated);
  const totalGain = finalSimulated - totalInvested;
  stats.totalGains.textContent = formatEUR(totalGain);
  const gainPct = totalInvested > 0 ? (totalGain / totalInvested) * 100 : 0;
  stats.totalGainsPct.textContent = `${gainPct >= 0 ? "+" : ""}${gainPct.toFixed(1)}%`;
  const colorClass = totalGain >= 0 ? "gain" : "loss";
  stats.totalGains.className = `stat-value ${colorClass}`;
  stats.totalGainsPct.className = `stat-pct ${colorClass}`;

  updateChart(labels, {
    totalInvestmentLine,
    simulated,
    simulatedTotalReturnPct,
    simulatedTrailing12mPct,
  });
  updateTable();
}

// ── Chart ──

let chart = null;

function updateChart(labels, data) {
  const datasets = [
    {
      label: "Simulated Value",
      data: data.simulated,
      borderColor: "#58a6ff",
      backgroundColor: "transparent",
      fill: false,
      borderWidth: 2.5,
      pointRadius: 0,
      tension: 0.1,
      simulatedTotalReturnPct: data.simulatedTotalReturnPct,
      simulatedTrailing12mPct: data.simulatedTrailing12mPct,
    },
    {
      label: "Total Investment",
      data: data.totalInvestmentLine,
      borderColor: "#6e7681",
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
      responsive: true,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: {
          labels: {
            color: "#8b949e",
            usePointStyle: true,
            padding: 16,
            font: { size: 13, weight: "500" },
          },
        },
        tooltip: {
          callbacks: {
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
          title: { display: true, text: "Age", color: "#8b949e" },
          ticks: { color: "#6e7681" },
          grid: { color: "rgba(48,54,61,0.5)" },
        },
        y: {
          title: { display: true, text: "Portfolio Value (EUR)", color: "#8b949e" },
          ticks: {
            color: "#6e7681",
            callback: (v) => formatEUR(v),
          },
          grid: { color: "rgba(48,54,61,0.5)" },
        },
      },
    },
  });
}

// ── Table ──

function updateTable() {
  const tbody = document.querySelector("#portfolioTable tbody");
  const monthly = parseFloat(inputs.monthlyInvestment.value) || 0;
  const startAge = parseInt(inputs.startingAge.value) || 25;
  const startingBalance = getStartingBalance();

  let rows = [];

  if (currentTableView === "yearly") {
    for (let i = 11; i < currentSimulation.length; i += 12) {
      const entry = currentSimulation[i];
      const yearNum = Math.floor(i / 12) + 1;
      const prevBalance = i >= 12 ? currentSimulation[i - 12].balance : startingBalance;
      const periodInvestment = monthly * 12;
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
      const prevBalance = j > 0 ? currentSimulation[j - 1].balance : startingBalance;
      const periodReturn = entry.balance - prevBalance - entry.invested;
      const periodReturnPct = prevBalance + entry.invested > 0
        ? (periodReturn / (prevBalance + entry.invested)) * 100
        : 0;
      const totalReturns = entry.balance - entry.totalInvested;
      const totalReturnPct = entry.totalInvested > 0
        ? (totalReturns / entry.totalInvested) * 100
        : 0;
      rows.push({
        period: `Month ${entry.month}`,
        investment: entry.invested,
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
        <td>${formatEUR(r.totalInvested)}</td>
        <td class="${r.periodReturn >= 0 ? "positive" : "negative"}">${formatEUR(r.periodReturn)}</td>
        <td class="${r.periodReturnPct >= 0 ? "positive" : "negative"}">${r.periodReturnPct >= 0 ? "+" : ""}${r.periodReturnPct.toFixed(1)}%</td>
        <td class="${r.totalReturns >= 0 ? "positive" : "negative"}">${formatEUR(r.totalReturns)}</td>
        <td class="${r.totalReturnPct >= 0 ? "positive" : "negative"}">${r.totalReturnPct >= 0 ? "+" : ""}${r.totalReturnPct.toFixed(1)}%</td>
        <td>${formatEUR(r.value)}</td>
      </tr>`
    )
    .join("");
}

// ── Event Listeners ──

Object.values(inputs).forEach((el) => el.addEventListener("input", calculate));

document.getElementById("rerollBtn").addEventListener("click", calculate);

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

calculate();
