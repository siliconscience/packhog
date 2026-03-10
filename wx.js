async function geocode(query) {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1&addressdetails=1`;
  const res = await fetch(url, { headers: { 'User-Agent': 'wx.html mountain weather app' } });
  if (!res.ok) throw new Error('Geocoding request failed');
  const data = await res.json();
  if (!data || data.length === 0) {
    throw new Error(`No locations found for "${query}"`);
  }
  const r = data[0];
  const addr = r.address || {};
  return {
    name: addr.city || addr.town || addr.village || addr.hamlet || r.name,
    admin1: addr.state || addr.region,
    country: addr.country,
    latitude: parseFloat(r.lat),
    longitude: parseFloat(r.lon),
    elevation: null
  };
}

async function getNWSPoints(lat, lon) {
  const url = `https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'wx.html mountain weather app' } });
  if (!res.ok) {
    if (res.status === 404) {
      throw new Error('Location is outside NWS coverage (US only)');
    }
    throw new Error(`NWS points request failed (${res.status})`);
  }
  const data = await res.json();
  const props = data.properties;
  return {
    office: props.gridId,
    gridX: props.gridX,
    gridY: props.gridY,
    forecastHourly: props.forecastHourly
  };
}

async function getHourlyForecast(office, gridX, gridY) {
  const url = `https://api.weather.gov/gridpoints/${office}/${gridX},${gridY}/forecast/hourly`;
  const res = await fetch(url, { headers: { 'User-Agent': 'wx.html mountain weather app' } });
  if (!res.ok) throw new Error(`NWS forecast request failed (${res.status})`);
  const data = await res.json();
  return data.properties.periods;
}

function parseWindSpeed(windSpeedStr) {
  if (!windSpeedStr) return 0;
  const nums = windSpeedStr.match(/\d+/g);
  if (!nums) return 0;
  return Math.max(...nums.map(Number));
}

function buildTimeSeries(periods) {
  const TARGET_HOURS = new Set([1, 8, 12, 18]);
  const points = [];

  for (const p of periods) {
    const start = new Date(p.startTime);
    const h = start.getHours();
    if (!TARGET_HOURS.has(h)) continue;

    const day = start.toLocaleDateString('en-US', { weekday: 'short' });
    const timeStr = h === 1 ? '1am' : h === 8 ? '8am' : h === 12 ? 'noon' : '6pm';
    // Labels must be unique across all 28 points so use day+time
    const label = `${day} ${timeStr}`;

    points.push({
      label,
      temp: p.temperature,
      unit: p.temperatureUnit,
      pop: p.probabilityOfPrecipitation?.value ?? 0,
      wind: parseWindSpeed(p.windSpeed)
    });

    if (points.length >= 28) break;
  }

  return points;
}

function tempColor(temp, unit) {
  const f = unit === 'C' ? temp * 9 / 5 + 32 : temp;
  if (f <= 32) return '#5b8dd9';
  if (f <= 50) return '#7ab3e0';
  if (f <= 65) return '#50c878';
  if (f <= 80) return '#f4a62a';
  return '#e05c3a';
}

const CHART_CONFIG = { responsive: true, displayModeBar: false };

function buildNightShapes(xs) {
  const shapes = [];
  for (let i = 0; i < xs.length; i++) {
    if (xs[i].endsWith('6pm')) {
      const nextMorning = xs.findIndex((l, j) => j > i && l.endsWith('8am'));
      if (nextMorning !== -1) {
        shapes.push({
          type: 'rect',
          xref: 'x', yref: 'paper',
          x0: i,           // center of 6pm category
          x1: nextMorning, // center of 8am category
          y0: 0, y1: 1,
          fillcolor: 'rgba(100,100,140,0.10)',
          line: { width: 0 },
          layer: 'below'
        });
      }
    }
  }
  return shapes;
}

function baseLayout(title, yTitle, yRange) {
  return {
    title: { text: title, font: { size: 13, color: '#2c3e50' }, x: 0.5 },
    paper_bgcolor: '#ffffff',
    plot_bgcolor: '#f9fafb',
    margin: { l: 48, r: 15, t: 38, b: 70 },
    height: 210,
    xaxis: {
      tickfont: { size: 10 },
      fixedrange: true,
      tickangle: -45
    },
    yaxis: {
      title: yTitle,
      fixedrange: true,
      tickfont: { size: 11 },
      ...(yRange ? { range: yRange } : {})
    }
  };
}

function renderCharts(points) {
  const xs = points.map(p => p.label);
  const unit = points[0]?.unit || 'F';

  const nightShapes = buildNightShapes(xs);

  // Temperature
  const temps = points.map(p => p.temp);
  const tempMin = Math.min(...temps);
  const tempMax = Math.max(...temps);
  const freezingShape = {
    type: 'line', xref: 'paper', yref: 'y',
    x0: 0, x1: 1, y0: 32, y1: 32,
    line: { color: '#5b8dd9', width: 1, dash: 'dot' }
  };
  Plotly.newPlot('chart-temp', [{
    type: 'scatter',
    mode: 'lines+markers',
    x: xs,
    y: temps,
    line: { color: '#d4603a', width: 2 },
    marker: { color: points.map(p => tempColor(p.temp, p.unit)), size: 7, line: { color: '#fff', width: 1 } },
    hovertemplate: '%{x}<br>%{y}°' + unit + '<extra></extra>'
  }], {
    ...baseLayout('Temperature', `°${unit}`, [tempMin - 8, tempMax + 8]),
    shapes: [...nightShapes, ...(unit === 'F' ? [freezingShape] : [])]
  }, CHART_CONFIG);

  // PoP
  const pops = points.map(p => p.pop);
  Plotly.newPlot('chart-pop', [{
    type: 'scatter',
    mode: 'lines+markers',
    x: xs,
    y: pops,
    line: { color: '#4a90d9', width: 2 },
    marker: { color: '#4a90d9', size: 6, line: { color: '#fff', width: 1 } },
    fill: 'tozeroy',
    fillcolor: 'rgba(74,144,217,0.15)',
    hovertemplate: '%{x}<br>%{y}%<extra></extra>'
  }], {
    ...baseLayout('Chance of Precipitation', '%', [0, 105]),
    shapes: nightShapes
  }, CHART_CONFIG);

  // Wind
  const winds = points.map(p => p.wind);
  const windMax = Math.max(...winds, 5);
  Plotly.newPlot('chart-wind', [{
    type: 'scatter',
    mode: 'lines+markers',
    x: xs,
    y: winds,
    line: { color: '#5a9e4b', width: 2 },
    marker: { color: '#5a9e4b', size: 6, line: { color: '#fff', width: 1 } },
    fill: 'tozeroy',
    fillcolor: 'rgba(90,158,75,0.15)',
    hovertemplate: '%{x}<br>%{y} mph<extra></extra>'
  }], {
    ...baseLayout('Max Wind Speed', 'mph', [0, windMax * 1.25]),
    shapes: nightShapes
  }, CHART_CONFIG);
}

function conditionEmoji(shortForecast, pop) {
  const s = shortForecast.toLowerCase();
  const lowPop = (pop ?? 0) < 50;
  if (s.includes('thunder')) return lowPop ? '☁️' : '⛈️';
  if (s.includes('blizzard')) return lowPop ? '☁️' : '🌨️';
  if (s.includes('snow') || s.includes('flurr')) return lowPop ? '☁️' : '🌨️';
  if (s.includes('sleet') || s.includes('freezing rain') || s.includes('ice pellet')) return lowPop ? '☁️' : '🌨️';
  if (s.includes('rain') || s.includes('shower') || s.includes('drizzle')) return lowPop ? '☁️' : '🌧️';
  if (s.includes('fog') || s.includes('haze') || s.includes('mist')) return '🌫️';
  if (s.includes('mostly cloudy') || s.includes('overcast')) return '☁️';
  if (s.includes('partly cloudy') || s.includes('partly sunny') || s.includes('mostly sunny')) return '⛅';
  if (s.includes('sunny') || s.includes('clear')) return '☀️';
  if (s.includes('wind') || s.includes('breezy')) return '💨';
  return '🌡️';
}

function buildStripData(periods) {
  const TARGET_HOURS = [8, 12, 18];
  const days = {};
  const dayOrder = [];

  for (const p of periods) {
    const start = new Date(p.startTime);
    const hour = start.getHours();
    if (!TARGET_HOURS.includes(hour)) continue;
    const dateKey = start.toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric' });
    if (!days[dateKey]) { days[dateKey] = {}; dayOrder.push(dateKey); }
    const pop = p.probabilityOfPrecipitation?.value ?? 0;
    days[dateKey][hour] = {
      temp: p.temperature,
      unit: p.temperatureUnit,
      short: p.shortForecast,
      icon: conditionEmoji(p.shortForecast, pop)
    };
  }

  return dayOrder.slice(0, 7).map(date => ({
    date,
    slots: TARGET_HOURS.map(h => days[date]?.[h] || null)
  }));
}

function renderStripChart(stripDays) {
  const container = document.getElementById('strip');
  let html = '<table class="strip-chart"><thead><tr><th>Day</th><th>8 AM</th><th>Noon</th><th>6 PM</th></tr></thead><tbody>';

  for (const day of stripDays) {
    html += `<tr><td class="strip-day">${day.date}</td>`;
    for (const slot of day.slots) {
      if (slot) {
        html += `<td class="strip-cell"><span class="wx-icon">${slot.icon}</span><span class="wx-temp">${slot.temp}°${slot.unit}</span><span class="wx-label">${slot.short}</span></td>`;
      } else {
        html += `<td class="strip-cell strip-empty">—</td>`;
      }
    }
    html += '</tr>';
  }

  html += '</tbody></table>';
  container.innerHTML = html;
}

function setStatus(msg, isError) {
  const el = document.getElementById('status');
  el.textContent = msg;
  el.className = isError ? 'error' : '';
}

async function search(query) {
  query = query.trim();
  if (!query) return;

  setStatus('Geocoding location…');
  ['chart-temp', 'chart-pop', 'chart-wind', 'strip'].forEach(id => {
    document.getElementById(id).innerHTML = '';
  });

  try {
    const loc = await geocode(query);
    const displayName = loc.name + (loc.admin1 ? `, ${loc.admin1}` : '') + (loc.country ? `, ${loc.country}` : '');
    setStatus(`Found: ${displayName} (${loc.latitude.toFixed(3)}, ${loc.longitude.toFixed(3)}). Fetching forecast…`);

    const points = await getNWSPoints(loc.latitude, loc.longitude);
    setStatus('Loading hourly forecast…');

    const periods = await getHourlyForecast(points.office, points.gridX, points.gridY);
    const series = buildTimeSeries(periods);

    if (series.length === 0) {
      setStatus('No matching forecast hours found.', true);
      return;
    }

    setStatus(`7-day forecast for ${displayName}`);
    renderCharts(series);
    renderStripChart(buildStripData(periods));
  } catch (err) {
    setStatus(err.message, true);
  }
}

document.getElementById('search-form').addEventListener('submit', e => {
  e.preventDefault();
  search(document.getElementById('location-input').value);
});
