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

function filterDayHours(periods) {
  const days = {};
  for (const p of periods) {
    const start = new Date(p.startTime);
    const hour = start.getHours();
    if (hour < 8 || hour > 18) continue;
    const dateKey = start.toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric' });
    if (!days[dateKey]) days[dateKey] = [];
    days[dateKey].push({ hour, temp: p.temperature, unit: p.temperatureUnit, short: p.shortForecast });
  }
  // Return as sorted array of { date, hours[] }
  return Object.entries(days)
    .slice(0, 7)
    .map(([date, hours]) => ({ date, hours: hours.sort((a, b) => a.hour - b.hour) }));
}

function renderChart(days, name, elevation) {
  const minTemp = Math.min(...days.flatMap(d => d.hours.map(h => h.temp)));
  const traces = days.map((day, i) => {
    const x = [7.983, ...day.hours.map(h => h.hour), 18.017];
    const y = day.hours.map(() => i);
    y.unshift(i); y.push(i);
    const z = [minTemp, ...day.hours.map(h => h.temp), minTemp];
    const text = day.hours.map(h => `${h.hour}:00 — ${h.temp}°${h.unit}<br>${h.short}`);

    return {
      type: 'scatter3d',
      mode: 'lines+markers',
      name: day.date,
      x,
      y,
      z,
      text,
      hovertemplate: '%{text}<extra>%{fullData.name}</extra>',
      line: { width: 5 },
      marker: { size: 4 },
      surfaceaxis: 1,
      opacity: 0.4
    };
  });

  // Freezing reference lines at 32°F across each day
  const freezingTraces = days.map((day, i) => ({
    type: 'scatter3d',
    mode: 'lines',
    name: '32°F',
    showlegend: i === 0,
    x: [8, 18],
    y: [i, i],
    z: [32, 32],
    line: { color: '#000000', width: 2, /*dash: 'dot' */},
    hoverinfo: 'skip'
  }));

  const unit = days[0]?.hours[0]?.unit || 'F';
  const elevFt = elevation ? ` — ${Math.round(elevation).toLocaleString()} m elev.` : '';

  const layout = {
    title: { text: `${name}${elevFt}`, font: { size: 16, color: '#2c3e50' } },
    scene: {
      xaxis: { title: 'Hour of Day', dtick: 2, range: [7, 19] },
      yaxis: {
        title: 'Day',
        tickmode: 'array',
        tickvals: days.map((_, i) => i),
        ticktext: days.map(d => d.date)
      },
      zaxis: { title: `Temp (°${unit})` },
      aspectmode: 'manual',
      aspectratio: { x: 1.5, y: 0.8, z: 1 },
      camera: { eye: { x: -0.95, y: -2.15, z: 0.75 } }
    },
    margin: { l: 0, r: 0, t: 50, b: 0 },
    paper_bgcolor: '#f4f6f8',
    legend: { orientation: 'h', y: -0.02 }
  };

  Plotly.newPlot('chart', [...traces, ...freezingTraces], layout, { responsive: true });
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
  document.getElementById('chart').innerHTML = '';

  try {
    const loc = await geocode(query);
    const displayName = loc.name + (loc.admin1 ? `, ${loc.admin1}` : '') + (loc.country ? `, ${loc.country}` : '');
    setStatus(`Found: ${displayName} (${loc.latitude.toFixed(3)}, ${loc.longitude.toFixed(3)}, ${loc.elevation ? loc.elevation + ' m' : 'elev unknown'}). Fetching forecast…`);

    const points = await getNWSPoints(loc.latitude, loc.longitude);
    setStatus('Loading hourly forecast…');

    const periods = await getHourlyForecast(points.office, points.gridX, points.gridY);
    const days = filterDayHours(periods);

    if (days.length === 0) {
      setStatus('No daytime hours (8am–6pm) found in forecast data.', true);
      return;
    }

    setStatus(`Showing 8am–6pm temperatures for ${displayName}`);
    renderChart(days, displayName, loc.elevation);
  } catch (err) {
    setStatus(err.message, true);
  }
}

document.getElementById('search-form').addEventListener('submit', e => {
  e.preventDefault();
  search(document.getElementById('location-input').value);
});
