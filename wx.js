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

async function getGridpointData(office, gridX, gridY) {
  const url = `https://api.weather.gov/gridpoints/${office}/${gridX},${gridY}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'wx.html mountain weather app' } });
  if (!res.ok) return null;
  const data = await res.json();
  return data.properties;
}

function buildHourlyMap(values, transform = v => v) {
  const map = {};
  for (const { validTime, value } of values) {
    const [startStr, durationStr] = validTime.split('/');
    const hours = parseInt((durationStr.match(/PT(\d+)H/) || [, '1'])[1]);
    const start = new Date(startStr);
    for (let i = 0; i < hours; i++) {
      const key = new Date(start.getTime() + i * 3600000).toISOString().slice(0, 13);
      map[key] = value !== null ? transform(value) : null;
    }
  }
  return map;
}

function parseWindSpeed(windSpeedStr) {
  if (!windSpeedStr) return 0;
  const nums = windSpeedStr.match(/\d+/g);
  if (!nums) return 0;
  return Math.max(...nums.map(Number));
}

function buildTimeSeries(periods, skyCoverMap, gustMap) {
  const TARGET_HOURS = new Set([8, 10, 12, 14, 16, 18, 20, 1]);
  const LABEL_HOURS = new Set([8, 12, 18]);
  const TIME_STRS = { 1: '1am', 8: '8am', 10: '10am', 12: 'noon', 14: '2pm', 16: '4pm', 18: '6pm', 20: '8pm' };
  const points = [];

  for (const p of periods) {
    const start = new Date(p.startTime);
    const h = start.getHours();
    if (!TARGET_HOURS.has(h)) continue;

    const day = start.toLocaleDateString('en-US', { weekday: 'short' });
    const label = `${day} ${TIME_STRS[h]}`;

    const utcKey = start.toISOString().slice(0, 13);
    points.push({
      x: points.length,
      label,
      hour: h,
      showLabel: LABEL_HOURS.has(h),
      temp: p.temperature,
      unit: p.temperatureUnit,
      pop: p.probabilityOfPrecipitation?.value ?? 0,
      wind: parseWindSpeed(p.windSpeed),
      gust: gustMap ? (gustMap[utcKey] ?? 0) : 0,
      windDir: p.windDirection || '',
      skyCover: skyCoverMap ? (skyCoverMap[utcKey] ?? null) : null,
      shortForecast: p.shortForecast || ''
    });

    if (points.length >= 56) break; // 7 days × 8 points
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

const CHART_CONFIG = { responsive: true, displayModeBar: false};

function windDirArrow(dir) {
  switch ((dir || '').toUpperCase()) {
    case 'N':                       return '↓';
    case 'NNE': case 'NE': case 'ENE': return '↙';
    case 'E':                       return '←';
    case 'ESE': case 'SE': case 'SSE': return '↖';
    case 'S':                       return '↑';
    case 'SSW': case 'SW': case 'WSW': return '↗';
    case 'W':                       return '→';
    case 'WNW': case 'NW': case 'NNW': return '↘';
    default:                        return '';
  }
}

function buildNightShapes(points) {
  const shapes = [];
  for (let i = 0; i < points.length; i++) {
    if (points[i].hour === 18) { // 6pm
      const nextMorning = points.findIndex((p, j) => j > i && p.hour === 8);
      if (nextMorning !== -1) {
        shapes.push({
          type: 'rect',
          xref: 'x', yref: 'paper',
          x0: points[i].x,
          x1: points[nextMorning].x,
          y0: 0, y1: 1,
          fillcolor: 'rgba(100,100,140,0.22)',
          line: { width: 0 },
          layer: 'below'
        });
      }
    }
  }
  return shapes;
}

function baseLayout(title, yTitle, yRange, xaxisExtra) {
  return {
    title: { text: title, font: { size: 13, color: '#2c3e50' }, x: 0.5 },
    paper_bgcolor: '#ffffff',
    plot_bgcolor: '#f9fafb',
    margin: { l: 55, r: 15, t: 38, b: 70 },
    height: 210,
    xaxis: {
      tickfont: { size: 10 },
      fixedrange: true,
      tickangle: -45,
      ...xaxisExtra
    },
    yaxis: {
      title: yTitle,
      fixedrange: true,
      automargin: false,
      tickfont: { size: 11 },
      ...(yRange ? { range: yRange } : {})
    }
  };
}

function renderCharts(points) {
  const xs = points.map(p => p.x);        // numeric indices for equal spacing
  const labels = points.map(p => p.label); // for hover tooltips
  const unit = points[0]?.unit || 'F';

  // One label per day at noon
  const labeled = points.filter(p => p.hour === 12);
  const xTicks = {
    tickvals: labeled.map(p => p.x),
    ticktext: labeled.map(p => p.label),
    range: [xs[0] - 0.5, xs[xs.length - 1] + 0.5]
  };

  const nightShapes = buildNightShapes(points);

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
    text: labels,
    line: { color: '#d4603a', width: 2 },
    marker: { color: points.map(p => tempColor(p.temp, p.unit)), size: 7, line: { color: '#fff', width: 1 } },
    hovertemplate: '%{text}<br>%{y}°' + unit + '<extra></extra>'
  }], {
    ...baseLayout('Temperature', `°${unit}`, [tempMin - 8, tempMax + 8], xTicks),
    shapes: [...nightShapes, ...(unit === 'F' ? [freezingShape] : [])]
  }, CHART_CONFIG);

  // PoP + Clear Sky bars
    const pops = points.map(p => p.pop);
  const hasCloud = points.some(p => p.skyCover !== null);

  const popTraces = [];
  if (hasCloud) {
    const NIGHT_HOURS = new Set([18, 20, 1]);
    // Sunshine line at (100 - skyCover), fills upward from 0
    popTraces.push({
      type: 'scatter',
      mode: 'lines+markers',
      x: xs,
      y: points.map(p => p.skyCover !== null ? 100 - p.skyCover : null),
      text: labels,
      line: { color: 'rgba(180,150,0,0.5)', width: 2 },
      marker: {
        color: points.map(p => NIGHT_HOURS.has(p.hour) ? '#191970' : '#ffd200'),
        size: 6,
        line: { color: '#888', width: 1 }
      },
      fill: 'tozeroy',
      fillcolor: 'rgba(255,210,0,0.35)',
      hovertemplate: '%{text}<br>Sunshine: %{y}%<extra></extra>'
    });
  }

  // Colored fill bars (100-pop → 100), rain=blue, snow=magenta
  function isSnow(forecast) {
    const s = (forecast || '').toLowerCase();
    return s.includes('snow') || s.includes('flurr') || s.includes('blizzard') ||
        s.includes('sleet') || s.includes('freezing rain') || s.includes('ice pellet');
  }
  // Rain fill
  popTraces.push({
    type: 'bar', x: xs,
    y: points.map((p, i) => isSnow(p.shortForecast) ? 0 : pops[i]),
    base: points.map((p, i) => isSnow(p.shortForecast) ? 100 : 100 - pops[i]),
    marker: { color: 'rgba(74,144,217,0.30)', line: { width: 0 } },
    hoverinfo: 'skip', showlegend: false
  });
  // Snow/sleet fill
  popTraces.push({
    type: 'bar', x: xs,
    y: points.map((p, i) => isSnow(p.shortForecast) ? pops[i] : 0),
    base: points.map((p, i) => isSnow(p.shortForecast) ? 100 - pops[i] : 100),
    marker: { color: 'rgba(200,0,200,0.30)', line: { width: 0 } },
    hoverinfo: 'skip', showlegend: false
  });
  // PoP line on top
  popTraces.push({
    type: 'scatter',
    mode: 'lines+markers',
    x: xs,
    y: pops.map(p => 100 - p),
    customdata: pops,
    text: labels,
    name: 'PoP',
    line: { color: '#4a90d9', width: 2 },
    marker: { color: '#4a90d9', size: 6, line: { color: '#fff', width: 1 } },
    hovertemplate: '%{text}<br>PoP: %{customdata}%<extra></extra>'
  });
  Plotly.newPlot('chart-pop', popTraces, {
    ...baseLayout('Chance of Precipitation & Cloud Cover', '%', [0, 105], xTicks),
    shapes: nightShapes,
    showlegend: false,
  }, CHART_CONFIG);

  // Wind
    const winds = points.map(p => p.wind);
    const gusts = points.map(p => p.gust);
  const hasGusts = gusts.some(g => g > 0);
  const windMax = Math.max(...winds, ...(hasGusts ? gusts : []), 10);
  const windTraces = [
  {
    type: 'scatter',
    mode: 'lines+markers',
    x: xs,
    y: winds,
    text: points.map((p, i) => `${p.label}<br>${p.wind} mph${hasGusts && p.gust > 0 ? ` (gusts ${p.gust})` : ''}`),
    line: { color: '#5a9e4b', width: 2 },
    marker: { color: '#5a9e4b', size: 6, line: { color: '#fff', width: 1 } },
    fill: 'tozeroy',
    fillcolor: 'rgba(90,158,75,0.15)',
    hovertemplate: '%{text}<extra></extra>'
  }];
  if (hasGusts) {
    windTraces.push({
      type: 'scatter',
      mode: 'lines+markers',
      x: xs,
      y: gusts.map(g => g > 0 ? g : null),
      line: { color: '#5a9e4b', width: 1.5, dash: 'dot' },
      marker: { color: '#5a9e4b', size: 4 },
      showlegend: false,
      hoverinfo: 'skip'
    });
  }
  windTraces.push({
    type: 'scatter',
    mode: 'text',
    x: xs,
    y: winds.map(w => w + windMax * 0.09),
    text: points.map(p => windDirArrow(p.windDir)),
    textfont: { size: 13, color: '#3a6e2e' },
    showlegend: false,
    hoverinfo: 'skip'
  });
  Plotly.newPlot('chart-wind', windTraces, {
    ...baseLayout('Max Wind Speed', 'mph', [0, windMax * 1.25], xTicks),
    shapes: nightShapes,
    showlegend: false,
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

    const [periods, gridData] = await Promise.all([
      getHourlyForecast(points.office, points.gridX, points.gridY),
      getGridpointData(points.office, points.gridX, points.gridY).catch(() => null)
    ]);
    const skyCoverMap = gridData?.skyCover?.values
      ? buildHourlyMap(gridData.skyCover.values)
      : null;
    const gustMap = gridData?.windGust?.values
      ? buildHourlyMap(gridData.windGust.values, v => Math.round(v * 0.621371))
      : null;
    const series = buildTimeSeries(periods, skyCoverMap, gustMap);

    if (series.length === 0) {
      setStatus('No matching forecast hours found.', true);
      return;
    }

    let elevStr = '';
    if (gridData?.elevation?.value != null) {
      const elevM = gridData.elevation.value;
      const elevFt = Math.round(elevM * 3.28084);
      elevStr = `, ${elevFt.toLocaleString()} ft (${Math.round(elevM).toLocaleString()} m)`;
    }
    const coordStr = `${loc.latitude.toFixed(4)}, ${loc.longitude.toFixed(4)}${elevStr}`;
    const nwsUrl = `https://forecast.weather.gov/MapClick.php?lat=${loc.latitude.toFixed(4)}&lon=${loc.longitude.toFixed(4)}&FcstType=graphical`;

    const statusEl = document.getElementById('status');
    statusEl.className = '';
    statusEl.innerHTML = '';
    const line1 = document.createElement('span');
    line1.textContent = `${displayName} — ${coordStr}`;
    const line2 = document.createElement('span');
    line2.textContent = 'Times shown: 8am, 10am, noon, 2pm, 4pm, 6pm, 8pm, 1am';
    const line3 = document.createElement('a');
    line3.href = nwsUrl;
    line3.target = '_blank';
    line3.rel = 'noopener';
    line3.textContent = 'NWS graphical hourly forecast ↗';
    [line1, line2, line3].forEach(el => {
      statusEl.appendChild(el);
      statusEl.appendChild(document.createElement('br'));
    });

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
