const PROXIES = [
    (url) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
    (url) => `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`
];

let searchResults = []; // { href, date, trail }

function log(msg) {
    console.log(msg);
    const d = document.getElementById('debug');
    d.innerText += "\n> " + msg;
    d.scrollTop = d.scrollHeight;
}

async function smartFetch(url, options = {}) {
    for (let i = 0; i < PROXIES.length; i++) {
        try {
            const proxyUrl = PROXIES[i](url);
            const response = await fetch(proxyUrl, options);
            if (!response.ok) throw new Error(`Status ${response.status}`);
            let text;
            if (i === 1) {
                const json = await response.json();
                text = json.contents;
            } else {
                text = await response.text();
            }
            if (!text || text.length < 100) throw new Error("Empty/too short response");
            return text;
        } catch (e) {
            log(`Proxy ${i+1} failed: ${e.message}`);
        }
    }
    throw new Error("All proxies failed.");
}

const MONTHS = {Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};

function parseReportLink(a) {
    const href = a.getAttribute('href');
    const tds = a.closest('tr')?.querySelectorAll('td');
    if (!tds) return { href, date: null, peak: '?', trail: '?' };

    // TD[1]: <b>Peak</b><br>via Trail
    const peak = tds[1]?.querySelector('b')?.textContent.trim() ?? '';
    const trailMatch = tds[1]?.textContent.match(/via\s+(.+)/s);
    const trail = trailMatch ? trailMatch[1].trim() : '';

    // TD[2]: "Mon., Mar. 2, 2026\nSubmitter"
    const dateText = tds[2]?.textContent.trim() ?? '';
    const dm = dateText.match(/(\w+)\.\s+(\d+),\s+(\d{4})/);
    const date = dm ? new Date(parseInt(dm[3]), MONTHS[dm[1]], parseInt(dm[2])) : null;

    return { href, date, peak, trail };
}

function buildCalendar(reports) {
    // Index reports by date string
    const byDate = {};
    reports.forEach((r, idx) => {
        if (!r.date) return;
        const key = r.date.toDateString();
        if (!byDate[key]) byDate[key] = [];
        byDate[key].push(idx);
    });

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Find Monday of current week
    const dow = today.getDay();
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - (dow === 0 ? 6 : dow - 1));

    const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

    let html = '<div class="cal-wrap"><table class="calendar"><thead><tr>';
    for (const d of dayNames) html += `<th>${d}</th>`;
    html += '</tr></thead><tbody>';

    for (let week = 0; week < 3; week++) {
        html += '<tr>';
        for (let day = 0; day < 7; day++) {
            const cellDate = new Date(weekStart);
            cellDate.setDate(weekStart.getDate() - week * 7 + day);

            const isToday = cellDate.toDateString() === today.toDateString();
            const isFuture = cellDate > today;
            const key = cellDate.toDateString();
            const indices = byDate[key] || [];

            let cls = isFuture ? 'future' : (isToday ? 'today' : '');
            html += `<td class="${cls}"><div class="date-num">${cellDate.getDate()}</div>`;
            for (const idx of indices) {
                const r = reports[idx];
                html += `<a href="#report-panel" class="report-link" onclick="loadReport(${idx}); return false;">${r.peak}</a>`;
            }
            html += '</td>';
        }
        html += '</tr>';
    }

    html += '</tbody></table></div>';
    return html;
}

function extractReport(html) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const findField = (label) => {
        const tds = Array.from(doc.querySelectorAll('td'));
        const match = tds.find(td => td.textContent.trim() === label);
        return match ? match.nextElementSibling?.textContent.trim() : "";
    };
    return {
        peak:     findField("Peaks"),
        trail:    findField("Trails:"),
        date:     findField("Date of Hike:"),
        parking:  findField("Parking/Access Road Notes:"),
        comments: findField("Comments:"),
    };
}

async function loadReport(idx) {
    const panel = document.getElementById('report-panel');
    panel.style.display = 'block';
    panel.innerHTML = '<p>Loading...</p>';
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });

    try {
        const href = searchResults[idx].href;
        const html = await smartFetch("https://www.newenglandtrailconditions.com/" + href);
        const r = extractReport(html);
        panel.innerHTML = `
            <h4>${r.peak} &mdash; ${r.date}</h4>
            <p><b>Trail:</b> ${r.trail}</p>
            <p><b>Parking:</b> ${r.parking}</p>
            <div class="comments-box"><b>Comments:</b><br><br>${r.comments}</div>
        `;
    } catch (err) {
        panel.innerHTML = `<div class="error">${err.message}</div>`;
    }
}

async function runSearch() {
    const peak = document.getElementById('peakInput').value.trim();
    const status = document.getElementById('status');
    const results = document.getElementById('results');
    const output = document.getElementById('output-content');
    const panel = document.getElementById('report-panel');

    document.getElementById('debug').innerText = "Starting...";
    results.style.display = "none";
    panel.style.display = "none";
    status.innerHTML = "Searching...";

    try {
        const searchHtml = await smartFetch(
            "https://www.newenglandtrailconditions.com/inputsearch.php",
            { method: "POST", body: new URLSearchParams({ peak }) }
        );

        const searchDoc = new DOMParser().parseFromString(searchHtml, "text/html");
        const seen = new Set();
        const links = Array.from(searchDoc.querySelectorAll("a[href*='viewreport.php']"))
            .filter(a => { const h = a.getAttribute('href'); return seen.has(h) ? false : seen.add(h); });

        if (links.length === 0) throw new Error("No reports found for that peak.");

        searchResults = links.map(parseReportLink);
        log(`Found ${searchResults.length} report(s).`);

        output.innerHTML = buildCalendar(searchResults);
        results.style.display = "block";
        status.innerText = `${searchResults.length} report(s) found. Tap a day to read the report.`;

    } catch (err) {
        status.innerHTML = `<div class="error">${err.message}</div>`;
        log("Error: " + err.message);
    }
}
