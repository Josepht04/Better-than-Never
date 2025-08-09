// app_gmaps.js - Google Maps version with Places Autocomplete, Directions, and delayed routing

let map;
let directionsService;
let directionsRenderer;
let startMarker = null;
let endMarker = null;
let picking = null; // 'start' | 'end' | null
let countdownTimer = null;
let countdownRemaining = 0;
let startPlace = null; // from autocomplete
let endPlace = null;   // from autocomplete
let cachedDirections = null;
let prefetchInFlight = null;

function initMap() {
  const center = { lat: 20, lng: 0 };
  map = new google.maps.Map(document.getElementById('map'), {
    center,
    zoom: 2,
    mapTypeControl: false,
    streetViewControl: false,
    fullscreenControl: true,
  });

  directionsService = new google.maps.DirectionsService();
  directionsRenderer = new google.maps.DirectionsRenderer({
    map,
    polylineOptions: { strokeColor: '#22c55e', strokeWeight: 6, strokeOpacity: 0.9 },
    suppressMarkers: false,
  });

  // Map click to set start/end when in picking mode
  map.addListener('click', (e) => onMapClick(e.latLng));

  // Autocomplete setup
  const startInput = document.getElementById('startInput');
  const endInput = document.getElementById('endInput');
  const acStart = new google.maps.places.Autocomplete(startInput, { fields: ['geometry', 'name'] });
  const acEnd = new google.maps.places.Autocomplete(endInput, { fields: ['geometry', 'name'] });

  acStart.addListener('place_changed', () => {
    const p = acStart.getPlace();
    if (!p || !p.geometry) return;
    startPlace = p;
    placeStartMarker(p.geometry.location);
    updateDisplays();
    map.panTo(p.geometry.location);
    map.setZoom(Math.max(map.getZoom(), 10));
  });

  acEnd.addListener('place_changed', () => {
    const p = acEnd.getPlace();
    if (!p || !p.geometry) return;
    endPlace = p;
    placeEndMarker(p.geometry.location);
    updateDisplays();
    map.panTo(p.geometry.location);
    map.setZoom(Math.max(map.getZoom(), 10));
  });

  setupUI();
  updateDisplays();
}

function onMapClick(latLng) {
  if (picking === 'start') {
    placeStartMarker(latLng);
  } else if (picking === 'end') {
    placeEndMarker(latLng);
  } else {
    return;
  }
  picking = null;
  setStatus('Point set.');
  updateDisplays();
}

function placeStartMarker(latLng) {
  if (startMarker) startMarker.setMap(null);
  startMarker = new google.maps.Marker({ position: latLng, map, draggable: true, label: 'A' });
  startMarker.addListener('dragend', updateDisplays);
  // Clear startPlace because it's now map-picked
  startPlace = null;
}

function placeEndMarker(latLng) {
  if (endMarker) endMarker.setMap(null);
  endMarker = new google.maps.Marker({ position: latLng, map, draggable: true, label: 'B' });
  endMarker.addListener('dragend', updateDisplays);
  endPlace = null;
}

function getOrigin() {
  if (startMarker) return startMarker.getPosition();
  if (startPlace && startPlace.geometry) return startPlace.geometry.location;
  return null;
}

function getDestination() {
  if (endMarker) return endMarker.getPosition();
  if (endPlace && endPlace.geometry) return endPlace.geometry.location;
  return null;
}

function formatLatLng(ll) {
  if (!ll) return 'not set';
  const lat = ll.lat();
  const lng = ll.lng();
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

function updateDisplays() {
  const origin = getOrigin();
  const dest = getDestination();
  document.getElementById('startDisplay').textContent = `Start: ${origin ? formatLatLng(origin) : 'not set'}`;
  document.getElementById('endDisplay').textContent = `End: ${dest ? formatLatLng(dest) : 'not set'}`;
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
  directionsRenderer.set('directions', null);
}

function prefetchDirectionsNow(origin, destination) {
  cachedDirections = null;
  prefetchInFlight = new Promise((resolve) => {
    directionsService.route(
      {
        origin,
        destination,
        travelMode: travelModeFromUI(),
        provideRouteAlternatives: false,
      },
      (result, status) => {
        if (status === google.maps.DirectionsStatus.OK) {
          cachedDirections = result;
          resolve(result);
        } else {
          resolve(null);
        }
      }
    );
  });
  return prefetchInFlight;
}

function stopCountdown() {
  if (countdownTimer) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
  setCountdown('');
}

async function startShowRoute() {
  stopCountdown();
  const origin = getOrigin();
  const destination = getDestination();
  if (!origin || !destination) {
    setStatus('Please set both start and end using the inputs or the map.');
    return;
  }
  const delayMinutes = Math.max(0, parseInt(document.getElementById('delayMinutes').value || '0', 10));
  const delaySeconds = delayMinutes * 60;
  countdownRemaining = delaySeconds;
  setStatus('Prefetching route in background...');
  prefetchDirectionsNow(origin, destination);
  setCountdown(formatCountdown(countdownRemaining));

  const onTick = async () => {
    countdownRemaining -= 1;
    if (countdownRemaining > 0) {
      setCountdown(formatCountdown(countdownRemaining));
    } else {
      stopCountdown();
      try {
        if (cachedDirections) {
          directionsRenderer.setDirections(cachedDirections);
        } else if (prefetchInFlight) {
          setStatus('Finishing route fetch...');
          const res = await Promise.race([
            prefetchInFlight,
            new Promise((resolve) => setTimeout(() => resolve(null), 3000))
          ]);
          if (res) {
            directionsRenderer.setDirections(res);
          } else {
            await fetchAndRenderRoute(origin, destination);
          }
        } else {
          await fetchAndRenderRoute(origin, destination);
        }
        // Update status with distance/duration if available
        const result = cachedDirections || null;
        const leg = result?.routes?.[0]?.legs?.[0];
        if (leg) {
          setStatus(`Route shown. Distance: ${leg.distance?.text || ''}, ETA: ${leg.duration?.text || ''}`);
        } else {
          setStatus('Route shown.');
        }
      } catch (err) {
        console.error(err);
        setStatus(err.message || 'Failed to fetch route');
      }
    }
  };

  if (delaySeconds === 0) {
    // immediate
    try {
      await fetchAndRenderRoute(origin, destination);
    } catch (err) {
      console.error(err);
      setStatus(err.message || 'Failed to fetch route');
    }
  } else {
    countdownTimer = setInterval(onTick, 1000);
  }
}

function travelModeFromUI() {
  const mode = document.getElementById('travelMode').value;
  return google.maps.TravelMode[mode] || google.maps.TravelMode.DRIVING;
}

function fetchAndRenderRoute(origin, destination) {
  return new Promise((resolve, reject) => {
    clearRoute();
    setStatus('Fetching route...');
    directionsService.route(
      {
        origin,
        destination,
        travelMode: travelModeFromUI(),
        provideRouteAlternatives: false,
      },
      (result, status) => {
        if (status === google.maps.DirectionsStatus.OK) {
          directionsRenderer.setDirections(result);
          // Compute distance and duration from first leg
          const leg = result.routes[0]?.legs?.[0];
          if (leg) {
            const dist = leg.distance?.text || '';
            const dur = leg.duration?.text || '';
            setStatus(`Route shown. Distance: ${dist}, ETA: ${dur}`);
          } else {
            setStatus('Route shown.');
          }
          // Fit bounds to route
          const bounds = new google.maps.LatLngBounds();
          result.routes[0].overview_path.forEach((p) => bounds.extend(p));
          map.fitBounds(bounds);
          resolve();
        } else {
          reject(new Error(`Directions failed: ${status}`));
        }
      }
    );
  });
}

function resetAll() {
  stopCountdown();
  setStatus('Reset. Set start and end.');
  setCountdown('');
  clearRoute();
  if (startMarker) { startMarker.setMap(null); startMarker = null; }
  if (endMarker) { endMarker.setMap(null); endMarker = null; }
  // Keep inputs but clear place refs
  startPlace = null;
  endPlace = null;
  updateDisplays();
}

function setupUI() {
  document.getElementById('pickStart').addEventListener('click', () => pick('start'));
  document.getElementById('pickEnd').addEventListener('click', () => pick('end'));
  document.getElementById('showRoute').addEventListener('click', startShowRoute);
  document.getElementById('reset').addEventListener('click', resetAll);
}

// Make initMap global for Google callback
window.initMap = initMap;

