// connect explicitly to the Flask Socket.IO server
const SOCKET_SERVER = 'http://127.0.0.1:5000';
const socket = io(SOCKET_SERVER);

const ssidEl = document.getElementById('ssid');
const signalPill = document.getElementById('signal-pill');
const canvas = document.getElementById('heatmap-canvas');
const ctx = canvas.getContext('2d');
const pointsListEl = document.getElementById('points-list');
const downloadBtn = document.getElementById('download-log');
const useBrowserBtn = document.getElementById('use-browser');
const stopBrowserBtn = document.getElementById('stop-browser');
const serverCam = document.getElementById('serverCam');
const browserCam = document.getElementById('browserCam');
const clearLocalBtn = document.getElementById('clear-local');

let points = []; // {x,y,signal,ts,label}
let localDrawNeeds = true;
let localStream = null;

// helpers
function clamp(v,a,b){return Math.max(a, Math.min(b, v));}

// Update SSID & signal badge
socket.on('signal_update', (data) => {
  const s = data.signal_pct;
  const ssid = data.ssid || '—';
  ssidEl.textContent = ssid;
  if (s === null || s === undefined) {
    signalPill.textContent = 'N/A';
    signalPill.style.background = 'gray';
  } else {
    signalPill.textContent = s + '%';
    // color mapping red->yellow->green
    const pct = clamp(s, 0, 100);
    // interpolate: 0=>red(220,40,40), 50=>yellow(230,200,50), 100=>green(48,200,88)
    let r, g, b;
    if (pct < 50) {
      const t = pct / 50;
      r = Math.round(220 * (1-t) + 230 * t);
      g = Math.round(40 * (1-t) + 200 * t);
      b = Math.round(40 * (1-t) + 50 * t);
    } else {
      const t = (pct-50) / 50;
      r = Math.round(230 * (1-t) + 48 * t);
      g = Math.round(200 * (1-t) + 200 * t);
      b = Math.round(50 * (1-t) + 88 * t);
    }
    signalPill.style.background = `rgb(${r},${g},${b})`;
  }
});

// Receive the full points list
socket.on('all_points', (data) => {
  if (!Array.isArray(data)) return;
  points = data.slice();
  drawHeatmap();
  renderPointsList();
});

// A single point was added
socket.on('point_added', (p) => {
  // server also emits all_points; but we still add for immediate feedback
  if (p && typeof p.x === 'number') {
    points.push(p);
    drawHeatmap();
    renderPointsList();
  }
});

// Connect ack
socket.on('connect', () => {
  console.log('connected to server');
});

// Emit add point when clicking canvas
canvas.addEventListener('click', (ev) => {
  const rect = canvas.getBoundingClientRect();
  const x = (ev.clientX - rect.left) / rect.width;
  const y = (ev.clientY - rect.top) / rect.height;
  socket.emit('add_point', {x: x, y: y, label: ''});
});

// Render list
function renderPointsList(){
  pointsListEl.innerHTML = '';
  const last = points.slice(-30).reverse();
  for (const p of last){
    const s = (p.signal === null || p.signal === undefined) ? 'N/A' : p.signal + '%';
    const ts = p.ts ? (new Date(p.ts)).toLocaleString() : '';
    const wrap = document.createElement('div');
    wrap.style.padding = '6px';
    wrap.style.borderBottom = '1px solid #f2f4f7';
    wrap.innerHTML = `<strong>${s}</strong> — <span style="color:#6b7280">${ts}</span>`;
    pointsListEl.appendChild(wrap);
  }
}

// Heatmap drawing:
// approach: draw many radial grayscale blobs into an offscreen canvas, then map grayscale -> color
const off = document.createElement('canvas');
off.width = canvas.width;
off.height = canvas.height;
const offCtx = off.getContext('2d');

function drawHeatmap(){
  // clear offscreen
  offCtx.clearRect(0,0,off.width,off.height);
  // draw radial blobs
  for (const p of points){
    const px = Math.round(p.x * off.width);
    const py = Math.round(p.y * off.height);
    // strength 0..100 -> radius & alpha
    const sig = (p.signal === null || p.signal === undefined) ? 30 : clamp(p.signal,0,100);
    const radius = 60 + (sig/100)*120; // can tune
    const grd = offCtx.createRadialGradient(px, py, 2, px, py, radius);
    const alpha = 0.12 + (sig/100)*0.5;
    grd.addColorStop(0, `rgba(255,255,255,${alpha})`);
    grd.addColorStop(1, `rgba(255,255,255,0)`);
    offCtx.fillStyle = grd;
    offCtx.beginPath();
    offCtx.fillRect(px-radius, py-radius, radius*2, radius*2);
  }
  // colorize: read pixels and map brightness -> color ramp
  const img = offCtx.getImageData(0,0,off.width,off.height);
  const data = img.data;
  for (let i=0;i<data.length;i+=4){
    // brightness is the red channel (we used white blobs)
    const b = data[i]; // 0..255
    if (b === 0) {
      // keep transparent
      data[i+3] = 0;
      continue;
    }
    const t = b/255; // 0..1
    // map t -> color from red (weak) to yellow to green (strong)
    // reverse mapping so high brightness => green
    const pct = clamp(t,0,1);
    let r,g,bl;
    if (pct < 0.5){
      const tt = pct / 0.5;
      // red -> yellow
      r = Math.round(220 * (1-tt) + 230*tt);
      g = Math.round(40 * (1-tt) + 200*tt);
      bl = Math.round(40 * (1-tt) + 50*tt);
    } else {
      const tt = (pct-0.5)/0.5;
      // yellow -> green
      r = Math.round(230 * (1-tt) + 48*tt);
      g = Math.round(200 * (1-tt) + 200*tt);
      bl = Math.round(50 * (1-tt) + 88*tt);
    }
    // set color
    data[i] = r;
    data[i+1] = g;
    data[i+2] = bl;
    // alpha scale by t
    data[i+3] = Math.round(150 * pct);
  }
  // draw onto main canvas with a soft background
  ctx.clearRect(0,0,canvas.width,canvas.height);
  // optional background (light grid)
  ctx.fillStyle = '#fff';
  ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.putImageData(img, 0, 0);

  // draw markers (black outline + inner color)
  for (const p of points){
    const px = Math.round(p.x * canvas.width);
    const py = Math.round(p.y * canvas.height);
    const sig = (p.signal === null || p.signal === undefined) ? 30 : clamp(p.signal,0,100);
    // inner color: same ramp
    let r,g,b;
    const pct = sig/100;
    if (pct < 0.5){
      const tt = pct / 0.5;
      r = Math.round(220 * (1-tt) + 230*tt);
      g = Math.round(40 * (1-tt) + 200*tt);
      b = Math.round(40 * (1-tt) + 50*tt);
    } else {
      const tt = (pct-0.5)/0.5;
      r = Math.round(230 * (1-tt) + 48*tt);
      g = Math.round(200 * (1-tt) + 200*tt);
      b = Math.round(50 * (1-tt) + 88*tt);
    }
    ctx.beginPath();
    ctx.arc(px, py, 8, 0, Math.PI*2);
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#111';
    ctx.stroke();
  }
}

// camera fallback using browser getUserMedia
useBrowserBtn.addEventListener('click', async () => {
  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia){
    try {
      localStream = await navigator.mediaDevices.getUserMedia({video: { width: 640, height: 480 }, audio: false});
      browserCam.srcObject = localStream;
      browserCam.style.display = 'block';
      serverCam.style.display = 'none';
      useBrowserBtn.style.display = 'none';
      stopBrowserBtn.style.display = 'inline-block';
    } catch (err){
      alert('Could not access camera in browser: ' + err.message);
    }
  } else {
    alert('getUserMedia not supported in this browser.');
  }
});

stopBrowserBtn.addEventListener('click', () => {
  if (localStream){
    localStream.getTracks().forEach(t => t.stop());
    localStream = null;
  }
  browserCam.style.display = 'none';
  serverCam.style.display = 'block';
  useBrowserBtn.style.display = 'inline-block';
  stopBrowserBtn.style.display = 'none';
});

// download log
downloadBtn.addEventListener('click', () => {
  window.location.href = '/wifi_log.csv';
});

// clear local points (not server)
clearLocalBtn.addEventListener('click', () => {
  if (!confirm('Clear all points from the local view? (server data will remain)')) return;
  points = [];
  drawHeatmap();
  renderPointsList();
});

// initial draw to show empty canvas
drawHeatmap();
