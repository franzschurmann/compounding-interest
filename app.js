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

// Monte Carlo simulation using log-normal returns (geometric Brownian motion).
// The drift term includes the Ito correction (-0.5 * sigma^2) so that the
// *expected* compounded return matches the user-supplied annual return.
// Includes mean reversion (AR(1) model) to increase probability of recovery
// after drawdowns, matching historical market behavior (e.g., DAX -40% in 2008
// followed by +24% in 2009).
// Note: 23% annual volatility produces ±5-10% monthly swings, matching DAX
// historical volatility. Mean reversion strength (φ = -0.35) provides moderate
// reversion without overcorrecting.
function simulateGrowth(monthlyAmountOrSchedule, annualReturnPct, annualVolPct, totalYears, startingBalance) {
  const annualVol = annualVolPct / 100;
  // Monthly volatility: annual volatility scaled by sqrt(1/12)
  const monthlyStdDev = annualVol / Math.sqrt(12);
  // Drift per month: annualized return spread over 12 months,
  // adjusted for volatility drag (Ito correction)
  const annualDrift = Math.log(1 + annualReturnPct / 100) - 0.5 * annualVol * annualVol;
  const baseDrift = annualDrift / 12;

  // Mean reversion coefficient (negative value pulls returns back to mean)
  // φ = -0.35 provides moderate mean reversion: after a -30% year, drift
  // increases by ~10.5%, making recovery more likely
  const meanReversionStrength = -0.35;

  const totalMonths = totalYears * 12;
  const entries = [];
  let balance = startingBalance;
  let totalInvested = startingBalance;

  for (let m = 1; m <= totalMonths; m++) {
    // If schedule provided, use varying amounts; otherwise fixed
    const monthlyAmount = Array.isArray(monthlyAmountOrSchedule)
      ? monthlyAmountOrSchedule[m - 1]
      : monthlyAmountOrSchedule;

    let drift = baseDrift;

    // Apply mean reversion at year boundaries (every 12 months)
    // Check at the start of each new year (months 13, 25, 37, etc.)
    if (m > 12 && m % 12 === 1) {
      // Get the balance from end of previous year (one month ago) and 12 months ago
      const currentYearEndIdx = entries.length - 1;  // This is month m-1 (end of previous year)
      const prevYearEndIdx = entries.length - 13;     // This is month m-13 (12 months back)

      if (prevYearEndIdx >= 0 && currentYearEndIdx >= 0) {
        const currentYearEnd = entries[currentYearEndIdx];
        const prevYearEnd = entries[prevYearEndIdx];

        // Calculate actual return over the previous year
        const yearInvestment = currentYearEnd.totalInvested - prevYearEnd.totalInvested;
        const yearGain = currentYearEnd.balance - prevYearEnd.balance - yearInvestment;
        const yearReturn = prevYearEnd.balance > 0 ? yearGain / prevYearEnd.balance : 0;

        // Expected annual return (geometric mean from drift)
        const expectedAnnualReturn = Math.exp(annualDrift) - 1;

        // Deviation from expected return
        const deviation = yearReturn - expectedAnnualReturn;

        // Mean reversion adjustment: negative year (large negative deviation)
        // leads to positive drift adjustment, increasing recovery probability
        const meanReversionAdjustment = meanReversionStrength * deviation;

        // Spread the annual adjustment over the next 12 months
        drift = baseDrift - (meanReversionAdjustment / 12);
      }
    }

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

  const labels = Array.from({ length: years + 1 }, (_, i) => startAge + i);

  // Total investment line (yearly) - needs to calculate based on schedule if available
  let totalInvestmentLine;
  if (Array.isArray(investmentSchedule)) {
    totalInvestmentLine = [startingBalance];
    let cumulativeInvestment = startingBalance;
    for (let y = 0; y < years; y++) {
      const yearInvestment = investmentSchedule.slice(y * 12, (y + 1) * 12).reduce((a, b) => a + b, 0);
      cumulativeInvestment += yearInvestment;
      totalInvestmentLine.push(cumulativeInvestment);
    }
  } else {
    totalInvestmentLine = labels.map((_, i) => startingBalance + monthly * 12 * i);
  }

  // Randomized simulation (monthly granularity)
  currentSimulation = simulateGrowth(investmentSchedule, annualReturn, vol, years, startingBalance);

  // Extract yearly data points from simulation for the chart (every 12th month)
  const simulated = [startingBalance];
  for (let i = 11; i < currentSimulation.length; i += 12) {
    simulated.push(currentSimulation[i].balance);
  }

  // Pre-compute tooltip data for the simulated line
  const simulatedTotalReturnPct = [];
  const simulatedTrailing12mPct = [];
  for (let y = 0; y <= years; y++) {
    const balanceAtYear = simulated[y];
    const totalInvestedAtYear = totalInvestmentLine[y];
    simulatedTotalReturnPct.push(
      totalInvestedAtYear > 0
        ? ((balanceAtYear - totalInvestedAtYear) / totalInvestedAtYear) * 100
        : 0
    );
    if (y === 0) {
      simulatedTrailing12mPct.push(null);
    } else {
      const prevBalance = simulated[y - 1];
      const yearContributions = totalInvestmentLine[y] - totalInvestmentLine[y - 1];
      simulatedTrailing12mPct.push(
        prevBalance > 0
          ? ((balanceAtYear - prevBalance - yearContributions) / prevBalance) * 100
          : 0
      );
    }
  }

  // Update summary stats from simulation
  const totalInvested = totalInvestmentLine[years];
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
  const accentColor = "#58a6ff";
  const hintColor = "#6e7681";
  const mutedColor = "#8b949e";
  const gridColor = "rgba(48,54,61,0.5)";

  const datasets = [
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
      responsive: true,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: {
          labels: {
            color: mutedColor,
            usePointStyle: false,
            padding: 16,
            font: { size: 13, weight: "500" },
          },
        },
        tooltip: {
          backgroundColor: "rgba(15, 17, 23, 0.9)",
          borderColor: "#30363d",
          borderWidth: 1,
          titleColor: "#e1e4e8",
          bodyColor: "#e1e4e8",
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
          title: { display: true, text: "Age", color: mutedColor },
          ticks: { color: hintColor },
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
