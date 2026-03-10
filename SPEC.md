Vision: an app that shows the weather for a location over the next week

goals: translate a named location into longitude and latitude.
resolve ambiguity in favor of the one with the highest location.
look up longitude and latitude in a weather API.
a NWS API would be best, but commercial is ok too.
show the daily temperature as a line graph from 8 am to 6 pm, in waterfall chart, with time of day along the x axis and temperature along y and day of week along z

as a user i want to just type in the name of a place and see the temperature profile over the course of a week.

I'd like the tech stack to be just an HTML file and JS file and a CSS file,
front-end only.  You can use plotly.js for the chart.
Use NWS for the weather API.  We might try Open-Meteo later but for now I trust NWS.
Use a geocoding API that includes elevation naturally without a second call, e.g. open-topo data

files can be wx.html, wx.js and wx.css

