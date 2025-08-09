// app.js - core logic for selecting points, countdown, and routing via OSRM

let map;
let startMarker = null;
let endMarker = null;
let routeLine = null;
let picking = null; // 'start' | 'end' | null
let countdownTimer = null;
let countdownRemaining = 0;
let cachedRoute = null;
let prefetchInFlight = null;

function initMap() {
  map = L.map('map').setView([20, 0], 2);

  // Using a dark-ish tile that works without API keys
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);

  map.on('click', onMapClick);
}

function onMapClick(e) {
  const { lat, lng } = e.latlng;
  if (picking === 'start') {
    if (startMarker) startMarker.remove();
    startMarker = L.marker([lat, lng], { draggable: true }).addTo(map);
    startMarker.on('dragend', updateDisplays);
  } else if (picking === 'end') {
    if (endMarker) endMarker.remove();
    endMarker = L.marker([lat, lng], { draggable: true }).addTo(map);
    endMarker.on('dragend', updateDisplays);
  } else {
    return; // ignore clicks unless picking
  }
  picking = null;
  updateDisplays();
  setStatus('Point set.');
}

function formatCoord(marker) {
  if (!marker) return 'not set';
  const [lat, lng] = [marker.getLatLng().lat, marker.getLatLng().lng];
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

function updateDisplays() {
  document.getElementById('startDisplay').textContent = `Start: ${formatCoord(startMarker)}`;
  document.getElementById('endDisplay').textContent = `End: ${formatCoord(endMarker)}`;
}

function setStatus(text) {
  document.getElementById('statusText').textContent = text;
}

function setCountdown(text) {
  document.getElementById('countdown').textContent = text || '';
}

function formatCountdown(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${s}s`;
}

function pick(which) {
  picking = which;
  setStatus(`Click on the map to set the ${which} point.`);
}

function clearRoute() {
  if (routeLine) {
    routeLine.remove();
    routeLine = null;
  }
}

async function fetchRoute(start, end, { timeoutMs = 15000 } = {}) {
  // OSRM expects lon,lat
  const startStr = `${start.lng},${start.lat}`;
  const endStr = `${end.lng},${end.lat}`;
  const url = `https://router.project-osrm.org/route/v1/driving/${startStr};${endStr}?overview=fullgeometries=geojson`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(new Error('Routing timed out')), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`Routing failed: ${res.status}`);
    const data = await res.json();
    if (!data.routes || !data.routes[0]) throw new Error('No route found');
    return data.routes[0];
  } finally {
    clearTimeout(t);
  }
}

function drawRoute(route) {
  const coords = route.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
  clearRoute();
  routeLine = L.polyline(coords, { color: '#22c55e', weight: 5, opacity: 0.8 }).addTo(map);
  map.fitBounds(routeLine.getBounds(), { padding: [30, 30] });
}

function stopCountdown() {
  if (countdownTimer) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
  setCountdown('');
}

function prefetchRouteNow() {
  cachedRoute = null;
  const start = startMarker.getLatLng();
  const end = endMarker.getLatLng();
  prefetchInFlight = fetchRoute(start, end).then((route) => {
    cachedRoute = route;
    return route;
  }).catch((e) => {
    // keep null, will try again at show time if needed
    console.warn('Prefetch failed', e);
    return null;
  });
  return prefetchInFlight;
}

async function startShowRoute() {
  stopCountdown();
  if (!startMarker || !endMarker) {
    setStatus('Please set both start and end points.');
    return;
  }
  const delayMinutes = Math.max(0, parseInt(document.getElementById('delayMinutes').value || '0', 10));
  const delaySeconds = delayMinutes * 60;
  countdownRemaining = delaySeconds;
  setStatus('Prefetching route in background...');
  // Start fetching immediately so it's ready when countdown ends
  prefetchRouteNow();
  setCountdown(formatCountdown(countdownRemaining));

  countdownTimer = setInterval(async () => {
    countdownRemaining -= 1;
    if (countdownRemaining > 0) {
      setCountdown(formatCountdown(countdownRemaining));
    } else {
      stopCountdown();
      try {
        // Use cached if available, otherwise wait briefly for prefetch
        let route = cachedRoute;
        if (!route && prefetchInFlight) {
          setStatus('Finishing route fetch...');
          route = await Promise.race([
            prefetchInFlight,
            new Promise((_, rej) => setTimeout(() => rej(new Error('Route fetch still pending')), 3000))
          ]).catch(() => null);
        }
        if (!route) {
          setStatus('Fetching route...');
          route = await fetchRoute(startMarker.getLatLng(), endMarker.getLatLng());
        }
        drawRoute(route);
        const distKm = (route.distance / 1000).toFixed(2);
        const durMin = Math.round(route.duration / 60);
        setStatus(`Route shown. Distance: ${distKm} km, ETA: ${durMin} min`);
      } catch (err) {
        console.error(err);
        setStatus(err.message || 'Failed to fetch route');
      }
    }
  }, 1000);
}

function resetAll() {
  stopCountdown();
  setStatus('Reset. Pick start and end points.');
  setCountdown('');
  if (startMarker) { startMarker.remove(); startMarker = null; }
  if (endMarker) { endMarker.remove(); endMarker = null; }
  clearRoute();
  updateDisplays();
}

function setupUI() {
  document.getElementById('pickStart').addEventListener('click', () => pick('start'));
  document.getElementById('pickEnd').addEventListener('click', () => pick('end'));
  document.getElementById('showRoute').addEventListener('click', startShowRoute);
  document.getElementById('reset').addEventListener('click', resetAll);
}

window.addEventListener('DOMContentLoaded', () => {
  initMap();
  setupUI();
  updateDisplays();
});

