# Project Guidelines

## Overview
A simple web-based visualization tool that demonstrates the compounding effect of consistent stock investing. The user can see how their wealth grows over time by investing and reinvesting regularly.

### Core Features
- Interactive chart showing projected portfolio growth over time
- User-adjustable inputs with sensible defaults:
  - **Monthly investment amount** — default: 400 EUR
  - **Expected annual return** — default: ~8% (benchmarked to the DAX historical average)
  - **Volatility (standard deviation)** — default: ~20% (based on DAX historical volatility)
  - **Investment horizon** — default: 40 years
- Show the effect of compounding vs. just saving (no returns) as a comparison line
- Display key summary stats (total invested, projected value, total gains)

### Defaults Reference
- DAX long-term average annual return: ~8%
- DAX historical annualized volatility: ~20%
- Currency: EUR

## Tech Stack
- Vanilla HTML/CSS/JS (no build step, no framework)
- Chart.js via CDN for charting

## Project Structure
```
index.html    — main page with inputs, chart, and summary stats
style.css     — styling
app.js        — calculation logic and chart rendering
```

## Development
- No build step required — open `index.html` in a browser to run
- To serve locally: `python3 -m http.server 8000` from the project directory

## Conventions
- Keep the project simple — minimal dependencies
- All monetary values in EUR
- Use clear, beginner-friendly labels and explanations in the UI
- Chart should update in real-time as the user adjusts inputs
